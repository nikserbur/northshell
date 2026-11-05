import { describe, expect, it } from 'vitest'
import { DiskRateTracker, parseDarwinDiskIo, parseDiskstats } from './diskIo'

const STATS = [
  '   8       0 sda 1000 0 2048 50 500 0 4096 60 0 120 180 0 0 0 0',
  '   8       1 sda1 900 0 2000 40 400 0 4000 50 0 100 150 0 0 0 0',
  ' 259       0 nvme0n1 10 0 100 1 20 0 200 2 0 30 3 0 0 0 0',
  ' 259       1 nvme0n1p1 10 0 100 1 20 0 200 2 0 30 3 0 0 0 0',
  '   7       0 loop0 1 0 8 0 0 0 0 0 0 0 0 0 0 0 0',
  ' 253       0 dm-0 900 0 2000 40 400 0 4000 50 0 100 150 0 0 0 0'
]

describe('parseDiskstats', () => {
  it('counts whole physical disks in bytes and skips partitions, loop and dm devices', () => {
    expect(parseDiskstats(STATS)).toEqual([
      { name: 'sda', read: 2048 * 512, write: 4096 * 512, busyMs: 120 },
      { name: 'nvme0n1', read: 100 * 512, write: 200 * 512, busyMs: 30 }
    ])
  })
})

describe('parseDarwinDiskIo', () => {
  it('sums every block storage driver', () => {
    const lines = [
      '      "Statistics" = {"Operations (Write)"=0,"Bytes (Read)"=100,"Bytes (Write)"=40}',
      '      "Statistics" = {"Bytes (Read)"=2,"Bytes (Write)"=1}'
    ]
    expect(parseDarwinDiskIo(lines)).toEqual([{ name: '', read: 102, write: 41, busyMs: null }])
    expect(parseDarwinDiskIo(['nothing here'])).toEqual([])
  })
})

describe('DiskRateTracker', () => {
  it('starts from zero and then reports bytes per second and device load', () => {
    const tracker = new DiskRateTracker()
    const counters = (read: number, write: number, busyMs: number) => [{ name: 'sda', read, write, busyMs }]
    expect(tracker.next(counters(1000, 1000, 0), 1000)).toEqual({
      diskRead: 0,
      diskWrite: 0,
      diskDevices: [{ name: 'sda', read: 0, write: 0, util: null }]
    })
    expect(tracker.next(counters(3000, 2000, 500), 3000)).toEqual({
      diskRead: 1000,
      diskWrite: 500,
      diskDevices: [{ name: 'sda', read: 1000, write: 500, util: 25 }]
    })
  })

  it('treats a counter that went back as idle', () => {
    const tracker = new DiskRateTracker()
    tracker.next([{ name: 'sda', read: 5000, write: 5000, busyMs: 900 }], 1000)
    const rates = tracker.next([{ name: 'sda', read: 10, write: 10, busyMs: 1 }], 2000)
    expect(rates).toMatchObject({ diskRead: 0, diskWrite: 0 })
    expect(rates.diskDevices[0].util).toBe(0)
  })

  it('reports macOS totals without a device list', () => {
    const tracker = new DiskRateTracker()
    tracker.next([{ name: '', read: 0, write: 0, busyMs: null }], 1000)
    expect(tracker.next([{ name: '', read: 2048, write: 1024, busyMs: null }], 2000)).toEqual({ diskRead: 2048, diskWrite: 1024, diskDevices: [] })
  })
})
