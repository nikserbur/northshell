import type { DiskIoDevice } from '@shared/types'

/** Cumulative counters of one block device; `name` is empty where the OS only gives a total (macOS). */
export interface DiskCounters {
  name: string
  read: number
  write: number
  /** Milliseconds the device spent doing I/O, where the OS reports it. */
  busyMs: number | null
}

export interface DiskRates {
  diskRead: number
  diskWrite: number
  diskDevices: DiskIoDevice[]
}

/** /proc/diskstats always counts in 512-byte sectors, whatever the real sector size is. */
const SECTOR_BYTES = 512
/** Whole physical devices only: partitions, loop, dm and md would count the same I/O twice. */
export const PHYSICAL_DISK_PATTERN = '(sd[a-z]+|vd[a-z]+|xvd[a-z]+|hd[a-z]+|nvme[0-9]+n[0-9]+|mmcblk[0-9]+)'
const PHYSICAL_DISK_RE = new RegExp(`^${PHYSICAL_DISK_PATTERN}$`)

/** Lines of /proc/diskstats: major minor name reads merged sectors ms writes merged sectors ms inflight busy-ms … */
export function parseDiskstats(lines: string[]): DiskCounters[] {
  const out: DiskCounters[] = []
  for (const line of lines) {
    const f = line.trim().split(/\s+/)
    if (f.length < 13 || !PHYSICAL_DISK_RE.test(f[2])) continue
    out.push({ name: f[2], read: Number(f[5]) * SECTOR_BYTES, write: Number(f[9]) * SECTOR_BYTES, busyMs: Number(f[12]) })
  }
  return out
}

/** "Statistics" lines of `ioreg -c IOBlockStorageDriver`, summed: drivers there carry no usable disk name. */
export function parseDarwinDiskIo(lines: string[]): DiskCounters[] {
  let read = 0
  let write = 0
  let seen = false
  for (const line of lines) {
    const r = /"Bytes \(Read\)"=(\d+)/.exec(line)
    const w = /"Bytes \(Write\)"=(\d+)/.exec(line)
    if (!r && !w) continue
    seen = true
    read += Number(r?.[1] ?? 0)
    write += Number(w?.[1] ?? 0)
  }
  return seen ? [{ name: '', read, write, busyMs: null }] : []
}

/** Turns cumulative disk counters into bytes per second; a counter that went back (reboot, hot swap) counts as idle. */
export class DiskRateTracker {
  private prev: { counters: Map<string, DiskCounters>; ts: number } | null = null

  next(counters: DiskCounters[], ts: number): DiskRates {
    const prev = this.prev
    const dt = prev ? (ts - prev.ts) / 1000 : 0
    let diskRead = 0
    let diskWrite = 0
    const diskDevices: DiskIoDevice[] = []
    for (const c of counters) {
      const before = prev?.counters.get(c.name)
      const read = before && dt > 0 ? Math.max(0, c.read - before.read) / dt : 0
      const write = before && dt > 0 ? Math.max(0, c.write - before.write) / dt : 0
      diskRead += read
      diskWrite += write
      if (!c.name) continue
      const busy = before && dt > 0 && c.busyMs !== null && before.busyMs !== null ? Math.max(0, c.busyMs - before.busyMs) / (dt * 10) : null
      diskDevices.push({ name: c.name, read, write, util: busy === null ? null : Math.min(100, busy) })
    }
    this.prev = { counters: new Map(counters.map((c) => [c.name, c])), ts }
    return { diskRead, diskWrite, diskDevices }
  }
}
