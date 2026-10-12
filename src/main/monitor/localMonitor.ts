import { execFile } from 'node:child_process'
import { hostname, loadavg, uptime, cpus } from 'node:os'
import { promisify } from 'node:util'
import si from 'systeminformation'
import type { DiskUsage, MonitorSnapshot } from '@shared/types'
import { parsePs } from './parseRemote'

const run = promisify(execFile)

function pickDisks(list: si.Systeminformation.FsSizeData[]): DiskUsage[] {
  const seen = new Set<string>()
  return list
    .filter((d) => d.mount === '/System/Volumes/Data' || d.mount === '/' || d.mount.startsWith('/Volumes/'))
    .filter((d) => d.size > 0)
    .sort((a, b) => (a.mount === '/System/Volumes/Data' ? -1 : b.mount === '/System/Volumes/Data' ? 1 : 0))
    .filter((d) => {
      const key = d.mount.startsWith('/Volumes/') ? d.mount : 'root'
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((d) => ({
      mount: d.mount.startsWith('/Volumes/') ? d.mount : '/',
      fs: d.fs,
      total: d.size,
      used: Math.max(0, d.size - d.available)
    }))
}

async function topProcesses(): Promise<MonitorSnapshot['processes']> {
  try {
    const { stdout } = await run('/bin/ps', ['-Aceo', 'pid=,pcpu=,pmem=,comm=', '-r'], { timeout: 3000 })
    return parsePs(stdout.split('\n').slice(0, 8))
  } catch {
    return []
  }
}

/** Polls the local Mac for the same metrics the remote monitor reports. */
export class LocalMonitor {
  private timer: NodeJS.Timeout | null = null
  private busy = false
  private osName = ''

  constructor(
    private readonly intervalSec: () => number,
    private readonly emit: (snapshot: MonitorSnapshot) => void
  ) {}

  start(): void {
    if (this.timer) return
    void this.tick()
    this.timer = setInterval(() => void this.tick(), Math.max(1, this.intervalSec()) * 1000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async tick(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      if (!this.osName) {
        const os = await si.osInfo()
        this.osName = `${os.distro} ${os.release}`.trim()
      }
      const [load, mem, fs, net, users, processes] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.fsSize(),
        si.networkStats('*'),
        si.users(),
        topProcesses()
      ])
      const la = loadavg()
      this.emit({
        ts: Date.now(),
        hostname: hostname(),
        os: this.osName,
        cpu: load.currentLoad,
        cores: cpus().length,
        load: [la[0], la[1], la[2]],
        memTotal: mem.total,
        memUsed: mem.active,
        swapTotal: mem.swaptotal,
        swapUsed: mem.swapused,
        disks: pickDisks(fs),
        netRx: net.reduce((a, n) => a + Math.max(0, n.rx_sec ?? 0), 0),
        netTx: net.reduce((a, n) => a + Math.max(0, n.tx_sec ?? 0), 0),
        uptime: uptime(),
        users: new Set(users.map((u) => u.user)).size,
        userNames: [...new Set(users.map((u) => u.user))].sort(),
        processes
      })
    } catch (err) {
      console.error('[monitor] local sampling failed', err)
    } finally {
      this.busy = false
    }
  }
}
