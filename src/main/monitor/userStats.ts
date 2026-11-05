import type { MonitorDetail, ProcessRow, UserUsage } from '@shared/types'

/** One row of the full process list, before rates are known. */
export interface RawProc {
  pid: number
  ppid: number
  uid: number
  user: string
  cpu: number
  mem: number
  /** Bytes. */
  rss: number
  vsz: number
  threads: number | null
  nice: number
  state: string
  elapsed: number
  command: string
}

export interface RawSocket {
  uid: number
  /** Kernel socket cookie: stable while the socket lives. */
  key: string
  pid: number
  sent: number
  recv: number
}

export interface RawDetail {
  privileged: boolean
  /** Clock ticks per second; 0 where the OS has no per-process tick counters (macOS). */
  hz: number
  procs: RawProc[]
  ticks: Map<number, number>
  /** Cumulative bytes per process; null where the OS does not expose them. */
  io: Map<number, { read: number; write: number }> | null
  sockets: RawSocket[] | null
  /** Cumulative network bytes per process, where the OS reports them directly (macOS). */
  procNet: Map<number, { rx: number; tx: number }> | null
}

const KB = 1024
const LINUX_PS_RE = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s*(.*)$/
const DARWIN_PS_RE = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/
const APP_BUNDLE_RE = /\.app\/Contents\/MacOS\/([^/]+?)(?:\s+-.*)?$/

function int(value: string | undefined): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** `ps` etime: [[DD-]HH:]MM:SS → seconds. */
export function parseElapsed(text: string): number {
  const m = /^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/.exec(text.trim())
  return m ? int(m[1]) * 86400 + int(m[2]) * 3600 + int(m[3]) * 60 + int(m[4]) : 0
}

/** Short process name from its command line: `/usr/bin/python3 app.py` → python3, `nginx: worker` → nginx. */
export function processName(command: string): string {
  const app = APP_BUNDLE_RE.exec(command)
  if (app) return app[1]
  const first = command.trim().split(/\s+/)[0] ?? ''
  if (first.startsWith('[')) return first
  return first.slice(first.lastIndexOf('/') + 1).replace(/:$/, '')
}

/** `pid ppid uid user pcpu pmem rss vsz nlwp ni stat etimes args` */
export function parseLinuxProcs(lines: string[]): RawProc[] {
  const out: RawProc[] = []
  for (const line of lines) {
    const m = LINUX_PS_RE.exec(line)
    if (!m) continue
    out.push({
      pid: int(m[1]),
      ppid: int(m[2]),
      uid: int(m[3]),
      user: m[4],
      cpu: int(m[5]),
      mem: int(m[6]),
      rss: int(m[7]) * KB,
      vsz: int(m[8]) * KB,
      threads: int(m[9]),
      nice: int(m[10]),
      state: m[11],
      elapsed: int(m[12]),
      command: m[13].trim()
    })
  }
  return out
}

/** `pid ppid uid user pcpu pmem rss vsz nice stat etime args` */
export function parseDarwinProcs(lines: string[]): RawProc[] {
  const out: RawProc[] = []
  for (const line of lines) {
    const m = DARWIN_PS_RE.exec(line)
    if (!m) continue
    out.push({
      pid: int(m[1]),
      ppid: int(m[2]),
      uid: int(m[3]),
      user: m[4],
      cpu: int(m[5]),
      mem: int(m[6]),
      rss: int(m[7]) * KB,
      vsz: int(m[8]) * KB,
      threads: null,
      nice: int(m[9]),
      state: m[10],
      elapsed: parseElapsed(m[11]),
      command: m[12].trim()
    })
  }
  return out
}

/** `pid utime stime` lines cut from /proc/PID/stat. */
export function parseTicks(lines: string[]): Map<number, number> {
  const out = new Map<number, number>()
  for (const line of lines) {
    const m = /^(\d+) (\d+) (\d+)$/.exec(line.trim())
    if (m) out.set(int(m[1]), int(m[2]) + int(m[3]))
  }
  return out
}

/** `/proc/123/io:read_bytes: 1024` lines; zero counters are filtered out by the script. */
export function parseProcIo(lines: string[]): Map<number, { read: number; write: number }> {
  const out = new Map<number, { read: number; write: number }>()
  for (const line of lines) {
    const m = /^\/proc\/(\d+)\/io:(read|write)_bytes:\s*(\d+)$/.exec(line.trim())
    if (!m) continue
    const pid = int(m[1])
    const prev = out.get(pid) ?? { read: 0, write: 0 }
    out.set(pid, m[2] === 'read' ? { ...prev, read: int(m[3]) } : { ...prev, write: int(m[3]) })
  }
  return out
}

/** `uid sk pid sent received` lines the script's awk cuts from `ss -tinep`. */
export function parseSockets(lines: string[]): RawSocket[] {
  const out: RawSocket[] = []
  for (const line of lines) {
    const f = line.trim().split(/\s+/)
    if (f.length !== 5 || !/^\d+$/.test(f[0])) continue
    out.push({ uid: int(f[0]), key: f[1], pid: int(f[2]), sent: int(f[3]), recv: int(f[4]) })
  }
  return out
}

/** `name.pid,bytes_in,bytes_out,` lines of macOS `nettop -P -L 1 -x`. */
export function parseNettop(lines: string[]): Map<number, { rx: number; tx: number }> {
  const out = new Map<number, { rx: number; tx: number }>()
  for (const line of lines) {
    const m = /\.(\d+),(\d+),(\d+),?\s*$/.exec(line)
    if (m) out.set(int(m[1]), { rx: int(m[2]), tx: int(m[3]) })
  }
  return out
}

/** The optional sections of a monitor block in detail mode; null when the block has no process list. */
export function parseRawDetail(s: Map<string, string[]>): RawDetail | null {
  const linux = s.get('pslist')
  const darwin = s.get('pslistmac')
  if (!linux && !darwin) return null
  return {
    privileged: (s.get('uid')?.[0] ?? '').trim() === '0',
    hz: int(s.get('hz')?.[0]?.trim()),
    procs: linux ? parseLinuxProcs(linux) : parseDarwinProcs(darwin ?? []),
    ticks: parseTicks(s.get('ticks') ?? []),
    io: s.has('procio') ? parseProcIo(s.get('procio') ?? []) : null,
    sockets: s.has('tcp') ? parseSockets(s.get('tcp') ?? []) : null,
    procNet: s.has('nettop') ? parseNettop(s.get('nettop') ?? []) : null
  }
}

interface Previous {
  ts: number
  ticks: Map<number, number>
  io: RawDetail['io']
  sockets: Map<string, { sent: number; recv: number }>
  procNet: RawDetail['procNet']
}

/** Growth of a counter since the last sample; a process or socket first seen after the baseline counts in full. */
const grown = (now: number, before: number | undefined): number => Math.max(0, now - (before ?? 0))

/**
 * Turns the full process list and its cumulative counters into per-process and per-user rates.
 * The first sample only sets the baseline, so rates start at zero; CPU falls back to what `ps` reports.
 */
export class DetailTracker {
  private prev: Previous | null = null

  next(raw: RawDetail, ts: number, cores: number, memTotal: number): MonitorDetail {
    const prev = this.prev
    const dt = prev ? (ts - prev.ts) / 1000 : 0
    const perSec = (bytes: number): number => (dt > 0 ? bytes / dt : 0)

    const netByPid = new Map<number, { rx: number; tx: number }>()
    const netByUid = new Map<number, { rx: number; tx: number }>()
    const addNet = (map: Map<number, { rx: number; tx: number }>, key: number, rx: number, tx: number): void => {
      const cur = map.get(key) ?? { rx: 0, tx: 0 }
      map.set(key, { rx: cur.rx + rx, tx: cur.tx + tx })
    }
    if (prev) {
      for (const sock of raw.sockets ?? []) {
        const before = prev.sockets.get(sock.key)
        const rx = perSec(grown(sock.recv, before?.recv))
        const tx = perSec(grown(sock.sent, before?.sent))
        addNet(netByUid, sock.uid, rx, tx)
        if (sock.pid > 0) addNet(netByPid, sock.pid, rx, tx)
      }
      for (const [pid, net] of raw.procNet ?? []) {
        const before = prev.procNet?.get(pid)
        addNet(netByPid, pid, perSec(grown(net.rx, before?.rx)), perSec(grown(net.tx, before?.tx)))
      }
    }

    const processes: ProcessRow[] = raw.procs.map((p) => {
      const tick = raw.ticks.get(p.pid)
      const tickBefore = prev?.ticks.get(p.pid)
      // `ps` reports CPU averaged over the whole life of a process; the tick delta is what is happening now.
      const cpu = raw.hz > 0 && tick !== undefined && tickBefore !== undefined && dt > 0 ? ((tick - tickBefore) / raw.hz / dt) * 100 : p.cpu
      const io = raw.io?.get(p.pid)
      const ioBefore = prev?.io?.get(p.pid)
      const net = netByPid.get(p.pid)
      return {
        pid: p.pid,
        ppid: p.ppid,
        user: p.user,
        cpu: Math.max(0, cpu),
        mem: p.mem,
        rss: p.rss,
        vsz: p.vsz,
        threads: p.threads,
        nice: p.nice,
        state: p.state,
        elapsed: p.elapsed,
        name: processName(p.command),
        command: p.command,
        diskRead: prev && io ? perSec(grown(io.read, ioBefore?.read)) : 0,
        diskWrite: prev && io ? perSec(grown(io.write, ioBefore?.write)) : 0,
        netRx: net?.rx ?? 0,
        netTx: net?.tx ?? 0
      }
    })

    this.prev = {
      ts,
      ticks: raw.ticks,
      io: raw.io,
      sockets: new Map((raw.sockets ?? []).map((s) => [s.key, { sent: s.sent, recv: s.recv }])),
      procNet: raw.procNet
    }

    return {
      processes,
      users: aggregateUsers(raw, processes, netByUid, cores, memTotal),
      diskIo: raw.io === null ? 'none' : raw.privileged ? 'all' : 'own',
      net: raw.sockets === null && raw.procNet === null ? 'none' : 'all'
    }
  }
}

function aggregateUsers(
  raw: RawDetail,
  processes: ProcessRow[],
  netByUid: Map<number, { rx: number; tx: number }>,
  cores: number,
  memTotal: number
): UserUsage[] {
  const names = new Map(raw.procs.map((p) => [p.uid, p.user]))
  const users = new Map<string, UserUsage>()
  const entry = (user: string): UserUsage => {
    const found = users.get(user)
    if (found) return found
    const created: UserUsage = { user, procs: 0, cpu: 0, mem: 0, memPct: 0, diskRead: 0, diskWrite: 0, netRx: 0, netTx: 0 }
    users.set(user, created)
    return created
  }
  // Sockets carry the owner's uid for everyone, so they are the only source when per-process data is partial.
  const fromSockets = raw.sockets !== null
  for (const p of processes) {
    const u = entry(p.user)
    u.procs += 1
    u.cpu += p.cpu
    u.mem += p.rss
    u.diskRead += p.diskRead
    u.diskWrite += p.diskWrite
    if (!fromSockets) {
      u.netRx += p.netRx
      u.netTx += p.netTx
    }
  }
  for (const [uid, net] of netByUid) {
    const u = entry(names.get(uid) ?? `uid ${uid}`)
    u.netRx += net.rx
    u.netTx += net.tx
  }
  return [...users.values()]
    .map((u) => ({ ...u, cpu: u.cpu / Math.max(1, cores), memPct: memTotal > 0 ? Math.min(100, (u.mem / memTotal) * 100) : 0 }))
    .sort((a, b) => b.cpu - a.cpu || b.mem - a.mem)
}
