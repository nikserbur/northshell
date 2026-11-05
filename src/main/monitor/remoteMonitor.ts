import type { Client, ClientChannel } from 'ssh2'
import type { MonitorSnapshot } from '@shared/types'
import { BlockSplitter, StatsTracker, parseRemoteBlock } from './parseRemote'
import { remoteMonitorCommand } from './remoteScript'

const RESTART_DELAY_MS = 5000
const MAX_RESTARTS = 5
/** The full process list of a busy server is far bigger than the usual block. */
const MAX_BLOCK_BYTES = 4 * 1024 * 1024

/** Streams server statistics over a dedicated exec channel of an existing SSH connection. */
export class RemoteMonitor {
  private channel: ClientChannel | null = null
  private stopped = false
  private restarts = 0
  private restartTimer: NodeJS.Timeout | null = null
  /** Rates survive the switch to and from detail mode, so the graphs do not drop to zero. */
  private readonly tracker = new StatsTracker()
  /** The channel is being replaced because detail mode changed, not lost. */
  private switching = false

  constructor(
    private readonly client: Client,
    private readonly intervalSec: number,
    private readonly emit: (snapshot: MonitorSnapshot) => void,
    private detail = false
  ) {}

  /** Asks for the full process list and per-user numbers; costly, so only while the monitor panel is open. */
  setDetail(on: boolean): void {
    if (on === this.detail) return
    this.detail = on
    if (!this.channel) return
    this.switching = true
    this.channel.close()
  }

  start(): void {
    if (this.stopped) return
    const splitter = new BlockSplitter(MAX_BLOCK_BYTES)
    const startedWith = this.detail
    this.client.exec(remoteMonitorCommand(this.intervalSec, startedWith), (err, channel) => {
      if (err || this.stopped) {
        channel?.close()
        if (!this.stopped) this.scheduleRestart()
        return
      }
      this.channel = channel
      if (startedWith !== this.detail) {
        this.switching = true
        channel.close()
      }
      channel.on('data', (chunk: Buffer) => {
        for (const block of splitter.push(chunk.toString('utf8'))) {
          this.restarts = 0
          this.emit(this.tracker.next(parseRemoteBlock(block), Date.now()))
        }
      })
      channel.stderr.on('data', () => undefined)
      channel.on('close', () => {
        this.channel = null
        if (this.switching) {
          this.switching = false
          this.start()
        } else {
          this.scheduleRestart()
        }
      })
    })
  }

  private scheduleRestart(): void {
    if (this.stopped || this.restarts >= MAX_RESTARTS) return
    this.restarts++
    this.restartTimer = setTimeout(() => this.start(), RESTART_DELAY_MS)
  }

  stop(): void {
    this.stopped = true
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.channel?.close()
    this.channel = null
  }
}
