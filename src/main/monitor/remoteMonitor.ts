import type { Client, ClientChannel } from 'ssh2'
import type { MonitorSnapshot } from '@shared/types'
import { BlockSplitter, StatsTracker, parseRemoteBlock } from './parseRemote'
import { remoteMonitorCommand } from './remoteScript'

const RESTART_DELAY_MS = 5000
const MAX_RESTARTS = 5

/** Streams server statistics over a dedicated exec channel of an existing SSH connection. */
export class RemoteMonitor {
  private channel: ClientChannel | null = null
  private stopped = false
  private restarts = 0
  private restartTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly client: Client,
    private readonly intervalSec: number,
    private readonly emit: (snapshot: MonitorSnapshot) => void
  ) {}

  start(): void {
    if (this.stopped) return
    const splitter = new BlockSplitter()
    const tracker = new StatsTracker()
    this.client.exec(remoteMonitorCommand(this.intervalSec), (err, channel) => {
      if (err || this.stopped) {
        channel?.close()
        if (!this.stopped) this.scheduleRestart()
        return
      }
      this.channel = channel
      channel.on('data', (chunk: Buffer) => {
        for (const block of splitter.push(chunk.toString('utf8'))) {
          this.restarts = 0
          this.emit(tracker.next(parseRemoteBlock(block), Date.now()))
        }
      })
      channel.stderr.on('data', () => undefined)
      channel.on('close', () => {
        this.channel = null
        this.scheduleRestart()
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
