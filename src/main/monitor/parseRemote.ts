import type { DiskUsage, MonitorSnapshot, ProcessInfo } from '@shared/types'
import { parseDarwinMemory, parseNetstat, parseTopCpu } from './parseDarwin'

export interface CpuTimes {
  idle: number
  total: number
}

export interface RawSample {
  hostname: string
  os: string
  cpuTimes: CpuTimes | null
  /** Direct busy percentage (macOS hosts report it instead of cumulative counters). */
  cpuPercent: number | null
  cores: number
  load: [number, number, number]
  uptime: number
  memTotal: number
  memUsed: number
  swapTotal: number
  swapUsed: number
  netRx: number
  netTx: number
  disks: DiskUsage[]
  users: number
  processes: ProcessInfo[]
}

const BEGIN = '@@XMT_BEGIN\n'
const END = '@@XMT_END'
const PSEUDO_FS = new Set(['tmpfs', 'devtmpfs', 'overlay', 'squashfs', 'udev', 'none', 'shm', 'efivarfs', 'run', 'devfs', 'map'])
const APFS_DATA = '/System/Volumes/Data'
const PSEUDO_MOUNTS = ['/proc', '/sys', '/dev', '/run', '/snap', '/boot/efi']
const VIRTUAL_IFACES = ['lo', 'veth', 'docker', 'br-', 'virbr', 'cni', 'flannel', 'cali']

function num(value: string | undefined): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export function parseSections(block: string): Map<string, string[]> {
  const sections = new Map<string, string[]>()
  let current: string[] | null = null
  for (const line of block.split('\n')) {
    if (line.startsWith('@@')) {
      current = []
      sections.set(line.slice(2).trim(), current)
    } else if (current && line.trim() !== '') {
      current.push(line)
    }
  }
  return sections
}

function parseCpu(lines: string[]): CpuTimes | null {
  const line = lines.find((l) => l.startsWith('cpu '))
  if (!line) return null
  const f = line.trim().split(/\s+/).slice(1).map(num)
  const total = f.slice(0, 8).reduce((a, b) => a + b, 0)
  if (total <= 0) return null
  return { idle: f[3] + (f[4] ?? 0), total }
}

function parseMeminfo(lines: string[]): Pick<RawSample, 'memTotal' | 'memUsed' | 'swapTotal' | 'swapUsed'> {
  const kv = new Map<string, number>()
  for (const line of lines) {
    const m = /^(\w+):\s+(\d+)/.exec(line)
    if (m) kv.set(m[1], Number(m[2]) * 1024)
  }
  const total = kv.get('MemTotal') ?? 0
  const available =
    kv.get('MemAvailable') ?? (kv.get('MemFree') ?? 0) + (kv.get('Buffers') ?? 0) + (kv.get('Cached') ?? 0)
  const swapTotal = kv.get('SwapTotal') ?? 0
  return {
    memTotal: total,
    memUsed: Math.max(0, total - available),
    swapTotal,
    swapUsed: Math.max(0, swapTotal - (kv.get('SwapFree') ?? 0))
  }
}

function parseNet(lines: string[]): { rx: number; tx: number } {
  let rx = 0
  let tx = 0
  for (const line of lines) {
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const name = line.slice(0, idx).trim()
    if (VIRTUAL_IFACES.some((p) => name === p || name.startsWith(p))) continue
    const f = line.slice(idx + 1).trim().split(/\s+/)
    rx += num(f[0])
    tx += num(f[8])
  }
  return { rx, tx }
}

function parseDf(lines: string[]): DiskUsage[] {
  const disks: DiskUsage[] = []
  const seen = new Set<string>()
  for (const line of lines.slice(1)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 6) continue
    const [fs, , used, avail] = parts
    const mount = parts.slice(5).join(' ')
    if (PSEUDO_FS.has(fs) || PSEUDO_MOUNTS.some((p) => mount === p || mount.startsWith(`${p}/`))) continue
    if (seen.has(fs)) continue
    const total = (num(used) + num(avail)) * 1024
    if (total <= 0) continue
    seen.add(fs)
    disks.push({ mount, fs, total, used: num(used) * 1024 })
  }
  const collapsed = disks.some((d) => d.mount === APFS_DATA)
    ? disks
        .filter((d) => d.mount === APFS_DATA || (d.mount.startsWith('/Volumes/') && d.mount !== '/Volumes/Recovery'))
        .map((d) => (d.mount === APFS_DATA ? { ...d, mount: '/' } : d))
    : disks
  return collapsed.sort((a, b) => (a.mount === '/' ? -1 : b.mount === '/' ? 1 : a.mount.localeCompare(b.mount)))
}

export function parsePs(lines: string[]): ProcessInfo[] {
  const out: ProcessInfo[] = []
  for (const line of lines) {
    const m = /^\s*(\d+)\s+([\d.]+)\s+([\d.]+)\s+(.+)$/.exec(line)
    if (m) out.push({ pid: Number(m[1]), cpu: Number(m[2]), mem: Number(m[3]), name: m[4].trim() })
  }
  return out
}

export function parseRemoteBlock(block: string): RawSample {
  const s = parseSections(block)
  const get = (key: string): string[] => s.get(key) ?? []
  const uname = (get('uname')[0] ?? '').trim().split(/\s+/)
  const load = (get('loadavg')[0] ?? '').match(/\d+(?:\.\d+)?/g)?.map(Number) ?? []
  const net = s.has('netstat') ? parseNetstat(get('netstat')) : parseNet(get('net'))
  const memory = s.has('memsize') ? parseDarwinMemory(get('memsize'), get('vmstat'), get('swap')) : parseMeminfo(get('meminfo'))
  return {
    hostname: uname[1] ?? '',
    os: (get('os')[0] ?? '').trim() || [uname[0], uname[2], uname[3]].filter(Boolean).join(' '),
    cpuTimes: parseCpu(get('stat')),
    cpuPercent: s.has('cpupct') ? parseTopCpu(get('cpupct')) : null,
    cores: Math.max(1, num(get('nproc')[0]?.trim())),
    load: [load[0] ?? 0, load[1] ?? 0, load[2] ?? 0],
    uptime: num((get('uptime')[0] ?? '').trim().split(/\s+/)[0]),
    ...memory,
    netRx: net.rx,
    netTx: net.tx,
    disks: parseDf(get('df')),
    users: num(get('users')[0]?.trim()),
    processes: parsePs(get('ps'))
  }
}

/** Turns cumulative counters from consecutive samples into rates and usage percentages. */
export class StatsTracker {
  private prev: { cpu: CpuTimes | null; rx: number; tx: number; ts: number } | null = null

  next(raw: RawSample, ts: number): MonitorSnapshot {
    let cpu = 0
    let netRx = 0
    let netTx = 0
    const prev = this.prev
    if (raw.cpuPercent !== null) {
      cpu = raw.cpuPercent
    } else if (raw.cpuTimes) {
      if (prev?.cpu) {
        const dTotal = raw.cpuTimes.total - prev.cpu.total
        const dIdle = raw.cpuTimes.idle - prev.cpu.idle
        cpu = dTotal > 0 ? ((dTotal - dIdle) / dTotal) * 100 : 0
      } else {
        cpu = ((raw.cpuTimes.total - raw.cpuTimes.idle) / raw.cpuTimes.total) * 100
      }
    }
    if (prev) {
      const dt = (ts - prev.ts) / 1000
      if (dt > 0) {
        netRx = Math.max(0, (raw.netRx - prev.rx) / dt)
        netTx = Math.max(0, (raw.netTx - prev.tx) / dt)
      }
      if (raw.netRx < prev.rx) netRx = 0
      if (raw.netTx < prev.tx) netTx = 0
    }
    this.prev = { cpu: raw.cpuTimes, rx: raw.netRx, tx: raw.netTx, ts }
    return {
      ts,
      hostname: raw.hostname,
      os: raw.os,
      cpu: Math.min(100, Math.max(0, cpu)),
      cores: raw.cores,
      load: raw.load,
      memTotal: raw.memTotal,
      memUsed: raw.memUsed,
      swapTotal: raw.swapTotal,
      swapUsed: raw.swapUsed,
      disks: raw.disks,
      netRx,
      netTx,
      uptime: raw.uptime,
      users: raw.users,
      processes: raw.processes
    }
  }
}

/** Extracts marker-delimited blocks from a streamed exec channel. */
export class BlockSplitter {
  private buffer = ''

  constructor(private readonly maxBuffer = 1024 * 1024) {}

  push(chunk: string): string[] {
    this.buffer += chunk
    const blocks: string[] = []
    for (;;) {
      const start = this.buffer.indexOf(BEGIN)
      if (start < 0) break
      const end = this.buffer.indexOf(END, start + BEGIN.length)
      if (end < 0) {
        this.buffer = this.buffer.slice(start)
        break
      }
      blocks.push(this.buffer.slice(start + BEGIN.length, end))
      this.buffer = this.buffer.slice(end + END.length)
    }
    if (this.buffer.length > this.maxBuffer) {
      const start = this.buffer.lastIndexOf(BEGIN)
      this.buffer = start >= 0 && this.buffer.length - start <= this.maxBuffer ? this.buffer.slice(start) : ''
    }
    return blocks
  }
}
