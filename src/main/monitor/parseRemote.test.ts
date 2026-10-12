import { describe, expect, it } from 'vitest'
import { BlockSplitter, StatsTracker, parsePs, parseRemoteBlock } from './parseRemote'

const block = (stat: string, rx: number, tx: number): string => `@@uname
Linux web-01 6.8.0-45-generic x86_64
@@os
Ubuntu 24.04.1 LTS
@@stat
${stat}
@@nproc
4
@@loadavg
0.52 0.40 0.31 2/301 12345
@@uptime
93784.12 300000.00
@@meminfo
MemTotal:        8000000 kB
MemFree:          500000 kB
MemAvailable:    6000000 kB
Buffers:          100000 kB
Cached:          1000000 kB
SwapTotal:       2000000 kB
SwapFree:        1500000 kB
@@net
    lo: 9999999 100 0 0 0 0 0 0 9999999 100 0 0 0 0 0 0
  eth0: ${rx} 2000 0 0 0 0 0 0 ${tx} 1500 0 0 0 0 0 0
veth12: 5555 10 0 0 0 0 0 0 5555 10 0 0 0 0 0 0
@@df
Filesystem     1024-blocks     Used Available Capacity Mounted on
/dev/sda1         51290592 20000000  28000000      42% /
tmpfs              4000000        0   4000000       0% /dev/shm
/dev/sdb1        103081248 50000000  48000000      51% /data/my disk
/dev/sda1         51290592 20000000  28000000      42% /var/lib/docker
@@users
deploy
root
@@ps
    812  25.0  3.1 node
     77   2.5  0.4 nginx: worker
`

describe('parseRemoteBlock', () => {
  const raw = parseRemoteBlock(block('cpu  100 0 100 700 100 0 0 0 0 0', 1000, 500))

  it('reads identity info', () => {
    expect(raw.hostname).toBe('web-01')
    expect(raw.os).toBe('Ubuntu 24.04.1 LTS')
    expect(raw.cores).toBe(4)
    expect(raw.uptime).toBeCloseTo(93784.12)
    expect(raw.load).toEqual([0.52, 0.4, 0.31])
    expect(raw.users).toBe(2)
    expect(raw.userNames).toEqual(['deploy', 'root'])
  })

  it('reads memory in bytes using MemAvailable', () => {
    expect(raw.memTotal).toBe(8000000 * 1024)
    expect(raw.memUsed).toBe(2000000 * 1024)
    expect(raw.swapTotal).toBe(2000000 * 1024)
    expect(raw.swapUsed).toBe(500000 * 1024)
  })

  it('sums network counters excluding loopback and virtual interfaces', () => {
    expect(raw.netRx).toBe(1000)
    expect(raw.netTx).toBe(500)
  })

  it('parses disks, skipping pseudo filesystems and duplicate devices', () => {
    expect(raw.disks.map((d) => d.mount)).toEqual(['/', '/data/my disk'])
    expect(raw.disks[0]).toEqual({ mount: '/', fs: '/dev/sda1', total: 48000000 * 1024, used: 20000000 * 1024 })
  })

  it('parses top processes', () => {
    expect(raw.processes).toEqual([
      { pid: 812, cpu: 25, mem: 3.1, name: 'node' },
      { pid: 77, cpu: 2.5, mem: 0.4, name: 'nginx: worker' }
    ])
  })

  it('computes cpu times from /proc/stat', () => {
    expect(raw.cpuTimes).toEqual({ idle: 800, total: 1000 })
  })

  it('falls back to MemFree+Buffers+Cached without MemAvailable', () => {
    const r = parseRemoteBlock('@@meminfo\nMemTotal: 1000 kB\nMemFree: 100 kB\nBuffers: 50 kB\nCached: 250 kB\n')
    expect(r.memUsed).toBe(600 * 1024)
  })

  it('tolerates missing sections', () => {
    const r = parseRemoteBlock('')
    expect(r.cpuTimes).toBeNull()
    expect(r.disks).toEqual([])
    expect(r.hostname).toBe('')
  })
})

describe('StatsTracker', () => {
  it('derives cpu usage and rates from consecutive samples', () => {
    const tracker = new StatsTracker()
    const first = tracker.next(parseRemoteBlock(block('cpu  100 0 100 700 100 0 0 0 0 0', 1000, 500)), 1000)
    expect(first.cpu).toBeCloseTo(20)
    expect(first.netRx).toBe(0)

    const second = tracker.next(parseRemoteBlock(block('cpu  150 0 150 750 150 0 0 0 0 0', 3000, 1500)), 3000)
    expect(second.cpu).toBeCloseTo(50)
    expect(second.netRx).toBe(1000)
    expect(second.netTx).toBe(500)
    expect(second.hostname).toBe('web-01')
  })

  it('never reports negative rates after counter reset', () => {
    const tracker = new StatsTracker()
    tracker.next(parseRemoteBlock(block('cpu  1 0 1 1 0 0 0 0 0 0', 5000, 5000)), 0)
    const snap = tracker.next(parseRemoteBlock(block('cpu  1 0 1 1 0 0 0 0 0 0', 10, 10)), 1000)
    expect(snap.netRx).toBe(0)
    expect(snap.netTx).toBe(0)
    expect(snap.cpu).toBe(0)
  })
})

describe('BlockSplitter', () => {
  it('emits complete blocks across chunk boundaries', () => {
    const s = new BlockSplitter()
    expect(s.push('junk\n@@XMT_BEGIN\n@@users\n')).toEqual([])
    expect(s.push('3\n@@XMT_END\n@@XMT_BEGIN\n@@users\n4\n@@XMT_')).toEqual(['@@users\n3\n'])
    expect(s.push('END\n')).toEqual(['@@users\n4\n'])
  })

  it('drops runaway buffers without markers', () => {
    const s = new BlockSplitter(64)
    s.push('x'.repeat(100))
    expect(s.push('@@XMT_BEGIN\nA\n@@XMT_END\n')).toEqual(['A\n'])
  })
})

describe('parsePs', () => {
  it('ignores malformed lines', () => {
    expect(parsePs(['garbage', '  1 0.0 0.1 launchd'])).toEqual([{ pid: 1, cpu: 0, mem: 0.1, name: 'launchd' }])
  })
})

const darwinBlock = `@@uname
Darwin mac-mini.local 23.6.0 arm64
@@cpupct
CPU usage: 5.20% user, 5.3% sys, 89.50% idle
@@nproc
10
@@os
macOS 14.6.1
@@loadavg
{ 3.17 3.82 5.66 }
@@uptime
9506806
@@memsize
17179869184
@@vmstat
Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               21916.
Pages active:                            300000.
Pages wired down:                        100000.
Pages occupied by compressor:            100000.
@@swap
total = 6144.00M  used = 1024.00M  free = 5120.00M  (encrypted)
@@netstat
Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll
lo0        16384 <Link#1>                      173239628     0 275320128840 173239628     0 275320128840     0
en0        1500  <Link#15>   bc:d0:74:ac:5d:24 329146828     0 1000 248506511     0 400     0
en0        1500  192.168.0     192.168.0.2     329146828     - 1000 248506511     - 400     -
utun1      1380  <Link#19>                            0     0          0     6658     0    1251182     0
en1        1500  <Link#10>   36:c2:1f:b1:fc:80        0     0          24        0     0          6     0
@@df
Filesystem     1024-blocks      Used Available Capacity  Mounted on
/dev/disk3s1s1   971350180  10727744 400000000     3%    /
devfs                  212       212         0   100%    /dev
/dev/disk3s6     971350180   2097172 400000000     1%    /System/Volumes/VM
/dev/disk3s5     971350180 500000000 400000000    56%    /System/Volumes/Data
map auto_home            0         0         0   100%    /System/Volumes/Data/home
/dev/disk9s1        200000     10000    190000     5%    /private/var/folders/xx/cryptex
/dev/disk5s1      61202432  20000000  41202432    33%    /Volumes/USB Stick
@@users
admin
@@ps
  412  12.0  1.5 WindowServer
`

describe('parseRemoteBlock (macOS host)', () => {
  const raw = parseRemoteBlock(darwinBlock)

  it('uses the direct cpu percentage from top', () => {
    expect(raw.cpuPercent).toBeCloseTo(10.5)
    expect(new StatsTracker().next(raw, 0).cpu).toBeCloseTo(10.5)
  })

  it('reads load from sysctl braces and identity', () => {
    expect(raw.load).toEqual([3.17, 3.82, 5.66])
    expect(raw.hostname).toBe('mac-mini.local')
    expect(raw.os).toBe('macOS 14.6.1')
    expect(raw.uptime).toBe(9506806)
  })

  it('computes memory from vm_stat pages and swap usage', () => {
    expect(raw.memTotal).toBe(17179869184)
    expect(raw.memUsed).toBe(500000 * 16384)
    expect(raw.swapTotal).toBe(6144 * 1024 * 1024)
    expect(raw.swapUsed).toBe(1024 * 1024 * 1024)
  })

  it('sums physical interface link counters from netstat', () => {
    expect(raw.netRx).toBe(1024)
    expect(raw.netTx).toBe(406)
  })

  it('collapses APFS system volumes into a single root disk', () => {
    expect(raw.disks.map((d) => d.mount)).toEqual(['/', '/Volumes/USB Stick'])
    expect(raw.disks[0].used).toBe(500000000 * 1024)
  })
})
