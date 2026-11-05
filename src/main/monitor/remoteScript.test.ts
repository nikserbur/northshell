import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { BlockSplitter, StatsTracker, parseRemoteBlock } from './parseRemote'
import { remoteMonitorCommand } from './remoteScript'

describe('remoteMonitorCommand', () => {
  const command = remoteMonitorCommand(3)
  const body = command.slice("exec sh -c '".length, -1)

  it('keeps single quotes out of the body so the sh -c wrapper stays intact', () => {
    expect(command.startsWith("exec sh -c '")).toBe(true)
    expect(body).not.toContain("'")
  })

  it('is valid POSIX shell', () => {
    const res = spawnSync('/bin/sh', ['-n', '-c', body], { encoding: 'utf8' })
    expect(res.stderr).toBe('')
    expect(res.status).toBe(0)
  })

  it('probes video memory on Linux and macOS hosts', () => {
    expect(body).toContain('@@nvsmi')
    expect(body).toContain('timeout 5')
    expect(body).toContain('mem_info_vram_total')
    expect(body).toContain('@@gpu; ioreg')
  })

  it('clamps the interval', () => {
    expect(remoteMonitorCommand(0)).toContain('sleep 1')
    expect(remoteMonitorCommand(600)).toContain('sleep 60')
  })

  it('sends the process list only in detail mode', () => {
    expect(body).not.toContain('@@pslist')
    const detail = remoteMonitorCommand(3, true)
    const detailBody = detail.slice("exec sh -c '".length, -1)
    expect(detailBody).not.toContain("'")
    expect(detailBody).toContain('@@pslist')
    expect(detailBody).toContain('@@pslistmac')
    const res = spawnSync('/bin/sh', ['-n', '-c', detailBody], { encoding: 'utf8' })
    expect(res.stderr).toBe('')
    expect(res.status).toBe(0)
  })
})

describe('the Linux probe, run against a fake /proc and fake tools', () => {
  const root = mkdtempSync(join(tmpdir(), 'northshell-monitor-'))
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  const STAT_TEMPLATE = (pid: number, name: string, utime: number, stime: number): string =>
    `${pid} (${name}) S 1 ${pid} ${pid} 0 -1 4194304 100 0 0 0 ${utime} ${stime} 0 0 20 0 1 0 100 1000 100 18446744073709551615\n`

  const write = (path: string, text: string, mode = 0o644): void => {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), text)
    chmodSync(join(root, path), mode)
  }

  /** One pass of the monitor's loop with /proc moved to a temp folder, parsed the way the app parses it. */
  const runOnce = (utime: number): string => {
    write('proc/4242/stat', STAT_TEMPLATE(4242, 'my (odd) name', utime, 50))
    const body = remoteMonitorCommand(1, true)
      .slice("exec sh -c '".length, -1)
      .replaceAll('/proc/', `${root}/proc/`)
      .replace(/sleep \d+\ndone/, 'break\ndone')
    const res = spawnSync('/bin/sh', ['-c', body], { encoding: 'utf8', env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}` } })
    expect(res.status).toBe(0)
    return res.stdout.replaceAll(root, '')
  }

  write('bin/uname', '#!/bin/sh\n[ "$1" = -s ] && echo Linux || echo "Linux web-01 6.8.0 x86_64"\n', 0o755)
  write('bin/getconf', '#!/bin/sh\necho 100\n', 0o755)
  write(
    'bin/ps',
    `#!/bin/sh
case "$*" in
  *args=*)
    echo "  4242     1  1000 alice   12.5  1.0 2048 4096 3 0 Sl 500 /usr/bin/python3 worker.py --name it"
    echo "    77     2     0 root     0.0  0.0 0 0 1 0 I 900 [kworker/0:1]"
    echo "  4300     1    33 www-data  0.1  0.5 1024 2048 1 5 S 100 nginx: worker process [2]"
    ;;
esac
`,
    0o755
  )
  write(
    'bin/ss',
    `#!/bin/sh
printf 'State Recv-Q Send-Q Local Peer\\n'
printf 'ESTAB 0 0 10.0.0.1:443 10.0.0.2:5555 users:(("nginx",pid=4300,fd=7)) uid:33 ino:1 sk:aa cgroup:/x <->\\n'
printf '\\t cubic wscale:7,7 rto:204 bytes_sent:5000 bytes_acked:4999 bytes_received:700 segs_out:9\\n'
printf 'ESTAB 0 0 10.0.0.1:22 10.0.0.3:6666 ino:2 sk:bb <->\\n'
printf '\\t cubic bytes_acked:900 bytes_received:100\\n'
printf 'ESTAB 0 0 10.0.0.1:80 10.0.0.4:7777 uid:1000 ino:3 sk:cc <->\\n'
printf '\\t cubic segs_out:1\\n'
`,
    0o755
  )
  write('proc/diskstats', '   8       0 sda 1000 0 2048 50 500 0 4096 60 0 120 180\n   8       1 sda1 900 0 2000 40 400 0 4000 50 0 100 150\n   7       0 loop0 1 0 8 0 0 0 0 0 0 0 0\n')
  write('proc/4242/io', 'rchar: 5\nwchar: 6\nsyscr: 1\nsyscw: 1\nread_bytes: 8192\nwrite_bytes: 0\ncancelled_write_bytes: 77\n')
  write('proc/4300/stat', STAT_TEMPLATE(4300, 'nginx', 10, 5))
  write('proc/4300/io', 'read_bytes: 0\nwrite_bytes: 4096\n')

  it('cuts every section down to what the parsers expect', () => {
    const [block] = new BlockSplitter().push(runOnce(150))
    const sample = parseRemoteBlock(block)
    const detail = sample.detail
    expect(detail).not.toBeNull()
    expect(sample.diskCounters).toEqual([{ name: 'sda', read: 2048 * 512, write: 4096 * 512, busyMs: 120 }])
    // Kernel threads are children of pid 2; brackets alone prove nothing, as the nginx row shows.
    expect(detail?.procs.map((p) => p.pid)).toEqual([4242, 4300])
    expect(detail?.procs[1].command).toBe('nginx: worker process [2]')
    expect(detail?.hz).toBe(100)
    expect(detail?.ticks.get(4242)).toBe(200)
    expect(detail?.ticks.get(4300)).toBe(15)
    expect(detail?.io?.get(4242)).toEqual({ read: 8192, write: 0 })
    expect(detail?.io?.get(4300)).toEqual({ read: 0, write: 4096 })
    expect(detail?.sockets).toEqual([
      { uid: 33, key: 'aa', pid: 4300, sent: 5000, recv: 700 },
      // No uid printed means root; a kernel without bytes_sent still reports bytes_acked.
      { uid: 0, key: 'bb', pid: 0, sent: 900, recv: 100 }
    ])
  })

  it('turns two passes into per-user rates', () => {
    const tracker = new StatsTracker()
    const first = parseRemoteBlock(new BlockSplitter().push(runOnce(100))[0])
    tracker.next(first, 1000)
    const second = parseRemoteBlock(new BlockSplitter().push(runOnce(300))[0])
    const snap = tracker.next(second, 3000)
    const alice = snap.detail?.users.find((u) => u.user === 'alice')
    expect(snap.detail?.processes.find((p) => p.pid === 4242)?.cpu).toBe(100)
    expect(alice?.procs).toBe(1)
    expect(snap.detail?.diskIo).toBe(process.getuid?.() === 0 ? 'all' : 'own')
    expect(snap.detail?.net).toBe('all')
  })
})
