import { execFile } from 'node:child_process'
import { hostname, loadavg, uptime, cpus } from 'node:os'
import { promisify } from 'node:util'
import si from 'systeminformation'
import type { DiskUsage, GpuUsage, MonitorDetail, MonitorSnapshot } from '@shared/types'
import { DiskRateTracker, parseDarwinDiskIo, type DiskCounters } from './diskIo'
import { parseDarwinGpus } from './parseGpu'
import { parsePs } from './parseRemote'
import { DetailTracker, parseDarwinProcs, parseNettop } from './userStats'

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

async function localDiskCounters(): Promise<DiskCounters[]> {
  try {
    const { stdout } = await run('/usr/sbin/ioreg', ['-c', 'IOBlockStorageDriver', '-r', '-w0', '-k', 'Statistics'], {
      timeout: 3000,
      maxBuffer: 4 * 1024 * 1024
    })
    return parseDarwinDiskIo(stdout.split('\n'))
  } catch {
    return []
  }
}

/** Every process of this Mac with what each is doing; macOS has no per-process disk counters for `ps` to show. */
async function localDetail(tracker: DetailTracker, cores: number, memTotal: number): Promise<MonitorDetail | undefined> {
  try {
    const [ps, net] = await Promise.all([
      run('/bin/ps', ['-Aww', '-o', 'pid=,ppid=,uid=,user=,pcpu=,pmem=,rss=,vsz=,nice=,stat=,etime=,args='], { timeout: 3000, maxBuffer: 16 * 1024 * 1024 }),
      run('/usr/bin/nettop', ['-P', '-L', '1', '-x', '-J', 'bytes_in,bytes_out'], { timeout: 3000, maxBuffer: 4 * 1024 * 1024 }).then(
        (r) => parseNettop(r.stdout.split('\n')),
        () => null
      )
    ])
    const raw = { privileged: false, hz: 0, procs: parseDarwinProcs(ps.stdout.split('\n')), ticks: new Map<number, number>(), io: null, sockets: null, procNet: net }
    return tracker.next(raw, Date.now(), cores, memTotal)
  } catch {
    return undefined
  }
}

const IOREG_LINE_RE = /^[ |]*\+-o|"(model|PerformanceStatistics)" =/

/** GPU memory of this Mac from ioreg (same parser as for macOS servers). */
async function localGpus(memTotal: number): Promise<GpuUsage[]> {
  try {
    const [{ stdout }, limit] = await Promise.all([
      run('/usr/sbin/ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator'], { timeout: 3000, maxBuffer: 4 * 1024 * 1024 }),
      run('/usr/sbin/sysctl', ['-n', 'iogpu.wired_limit_mb'], { timeout: 3000 }).then(
        (r) => Number(r.stdout.trim()) || 0,
        () => 0
      )
    ])
    return parseDarwinGpus(stdout.split('\n').filter((l) => IOREG_LINE_RE.test(l)), memTotal, limit)
  } catch {
    return []
  }
}

/** Polls the local Mac for the same metrics the remote monitor reports. */
export class LocalMonitor {
  private timer: NodeJS.Timeout | null = null
  private busy = false
  private osName = ''
  private readonly disk = new DiskRateTracker()
  private readonly detail = new DetailTracker()
  private wantsDetail = false

  constructor(
    private readonly intervalSec: () => number,
    private readonly emit: (snapshot: MonitorSnapshot) => void
  ) {}

  /** Asks for the full process list and per-user numbers while the monitor panel is open. */
  setDetail(on: boolean): void {
    if (on === this.wantsDetail) return
    this.wantsDetail = on
    if (on) void this.tick()
  }

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
      const [load, mem, fs, net, users, processes, diskCounters] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.fsSize(),
        si.networkStats('*'),
        si.users(),
        topProcesses(),
        localDiskCounters()
      ])
      const la = loadavg()
      const gpus = await localGpus(mem.total)
      const detail = this.wantsDetail ? await localDetail(this.detail, cpus().length, mem.total) : undefined
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
        gpus,
        disks: pickDisks(fs),
        netRx: net.reduce((a, n) => a + Math.max(0, n.rx_sec ?? 0), 0),
        netTx: net.reduce((a, n) => a + Math.max(0, n.tx_sec ?? 0), 0),
        ...this.disk.next(diskCounters, Date.now()),
        uptime: uptime(),
        users: new Set(users.map((u) => u.user)).size,
        userNames: [...new Set(users.map((u) => u.user))].sort(),
        processes,
        ...(detail ? { detail } : {})
      })
    } catch (err) {
      console.error('[monitor] local sampling failed', err)
    } finally {
      this.busy = false
    }
  }
}
