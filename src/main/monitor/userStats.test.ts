import { describe, expect, it } from 'vitest'
import { DetailTracker, parseDarwinProcs, parseElapsed, parseLinuxProcs, parseNettop, parseProcIo, parseRawDetail, parseSockets, parseTicks, processName, type RawDetail } from './userStats'

const proc = (over: Partial<RawDetail['procs'][number]> = {}): RawDetail['procs'][number] => ({
  pid: 100,
  ppid: 1,
  uid: 1000,
  user: 'alice',
  cpu: 50,
  mem: 1,
  rss: 1024,
  vsz: 2048,
  threads: 1,
  nice: 0,
  state: 'S',
  elapsed: 10,
  command: '/usr/bin/python3 app.py',
  ...over
})

const raw = (over: Partial<RawDetail> = {}): RawDetail => ({
  privileged: true,
  hz: 100,
  procs: [proc()],
  ticks: new Map(),
  io: new Map(),
  sockets: [],
  procNet: null,
  ...over
})

describe('parsers', () => {
  it('reads the Linux process list with a full command line', () => {
    const [p] = parseLinuxProcs(['  812     1  1000 deploy   25.0  3.1 204800 512000    12   0 Ssl   93784 /usr/bin/node /srv/app/server.js --port 80'])
    expect(p).toMatchObject({ pid: 812, ppid: 1, uid: 1000, user: 'deploy', cpu: 25, mem: 3.1, rss: 204800 * 1024, threads: 12, state: 'Ssl', elapsed: 93784 })
    expect(p.command).toBe('/usr/bin/node /srv/app/server.js --port 80')
  })

  it('treats a realtime nice of "-" as zero', () => {
    expect(parseLinuxProcs(['  9  2  0 root 0.0 0.0 0 0 1 - S 5 /sbin/x'])[0]?.nice).toBe(0)
  })

  it('reads the macOS process list and its etime format', () => {
    const [p] = parseDarwinProcs(['  303     1     0 root               0.5  0.1  23200 410551776  0 Ss   12-02:22:34 /usr/libexec/logd'])
    expect(p).toMatchObject({ pid: 303, user: 'root', threads: null, elapsed: 12 * 86400 + 2 * 3600 + 22 * 60 + 34 })
    expect(parseElapsed('05:09')).toBe(309)
    expect(parseElapsed('1:00:00')).toBe(3600)
    expect(parseElapsed('nonsense')).toBe(0)
  })

  it('derives a short process name', () => {
    expect(processName('/usr/bin/python3 app.py')).toBe('python3')
    expect(processName('nginx: worker process')).toBe('nginx')
    expect(processName('[kworker/0:1]')).toBe('[kworker/0:1]')
    expect(processName('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --flag')).toBe('Google Chrome')
  })

  it('reads counters and skips garbage', () => {
    expect(parseTicks(['10 5 7', 'garbage']).get(10)).toBe(12)
    const io = parseProcIo(['/proc/7/io:read_bytes: 100', '/proc/7/io:write_bytes: 40', '/proc/8/io:write_bytes: 1', 'x'])
    expect(io.get(7)).toEqual({ read: 100, write: 40 })
    expect(io.get(8)).toEqual({ read: 0, write: 1 })
    expect(parseSockets(['1000 abc 55 10 20', 'bad line'])).toEqual([{ uid: 1000, key: 'abc', pid: 55, sent: 10, recv: 20 }])
    expect(parseNettop([',bytes_in,bytes_out,', 'apsd.344,136555,226381,', 'Google Chrome H.900,1,2,']).get(900)).toEqual({ rx: 1, tx: 2 })
  })

  it('has no detail without a process list and notices missing sources', () => {
    expect(parseRawDetail(new Map([['users', []]]))).toBeNull()
    const d = parseRawDetail(new Map([['pslist', []], ['uid', ['0']], ['hz', ['100']], ['procio', []]]))
    expect(d).toMatchObject({ privileged: true, hz: 100, sockets: null, procNet: null })
    expect(d?.io?.size).toBe(0)
  })
})

describe('DetailTracker', () => {
  it('uses ps values for the first sample, then measures CPU from ticks', () => {
    const tracker = new DetailTracker()
    const first = tracker.next(raw({ ticks: new Map([[100, 1000]]) }), 1000, 4, 8192)
    expect(first.processes[0].cpu).toBe(50)
    const second = tracker.next(raw({ ticks: new Map([[100, 1200]]) }), 3000, 4, 8192)
    // 200 ticks at 100 Hz in 2 s is one full core, no matter what the lifetime average in ps says.
    expect(second.processes[0].cpu).toBe(100)
    expect(second.users[0].cpu).toBe(25)
  })

  it('reports who reads and writes the disk per process and per user', () => {
    const tracker = new DetailTracker()
    const procs = [proc({ pid: 1 }), proc({ pid: 2 }), proc({ pid: 3, uid: 0, user: 'root' })]
    tracker.next(raw({ procs, io: new Map([[1, { read: 100, write: 0 }], [2, { read: 0, write: 10 }]]) }), 1000, 2, 0)
    const d = tracker.next(raw({ procs, io: new Map([[1, { read: 2100, write: 0 }], [2, { read: 0, write: 410 }], [3, { read: 500, write: 0 }]]) }), 3000, 2, 0)
    expect(d.processes.map((p) => p.diskRead)).toEqual([1000, 0, 250])
    const alice = d.users.find((u) => u.user === 'alice')
    expect(alice).toMatchObject({ procs: 2, diskRead: 1000, diskWrite: 200 })
    expect(d.users.find((u) => u.user === 'root')?.diskRead).toBe(250)
  })

  it('never reports negative rates when a counter restarts', () => {
    const tracker = new DetailTracker()
    tracker.next(raw({ io: new Map([[100, { read: 900, write: 900 }]]) }), 1000, 1, 0)
    const d = tracker.next(raw({ io: new Map([[100, { read: 10, write: 10 }]]) }), 2000, 1, 0)
    expect(d.processes[0]).toMatchObject({ diskRead: 0, diskWrite: 0 })
  })

  it('attributes TCP traffic to the socket owner, even without per-process access', () => {
    const tracker = new DetailTracker()
    const sock = { uid: 1000, key: 'a', pid: 0, sent: 100, recv: 200 }
    tracker.next(raw({ sockets: [sock] }), 1000, 1, 0)
    const d = tracker.next(raw({ sockets: [{ ...sock, sent: 300, recv: 1200 }, { uid: 33, key: 'b', pid: 0, sent: 50, recv: 0 }] }), 2000, 1, 0)
    expect(d.users.find((u) => u.user === 'alice')).toMatchObject({ netRx: 1000, netTx: 200 })
    // A socket opened after the baseline counts in full; an owner with no process in the list still shows up.
    expect(d.users.find((u) => u.user === 'uid 33')).toMatchObject({ netTx: 50 })
    expect(d.net).toBe('all')
  })

  it('adds socket traffic to a process when ss could name it', () => {
    const tracker = new DetailTracker()
    tracker.next(raw({ sockets: [{ uid: 1000, key: 'a', pid: 100, sent: 0, recv: 0 }] }), 1000, 1, 0)
    const d = tracker.next(raw({ sockets: [{ uid: 1000, key: 'a', pid: 100, sent: 500, recv: 100 }] }), 2000, 1, 0)
    expect(d.processes[0]).toMatchObject({ netRx: 100, netTx: 500 })
    expect(d.users[0]).toMatchObject({ netRx: 100, netTx: 500 })
  })

  it('sums macOS per-process traffic into users', () => {
    const tracker = new DetailTracker()
    tracker.next(raw({ sockets: null, procNet: new Map([[100, { rx: 10, tx: 10 }]]) }), 1000, 1, 0)
    const d = tracker.next(raw({ sockets: null, procNet: new Map([[100, { rx: 110, tx: 60 }]]) }), 2000, 1, 0)
    expect(d.users[0]).toMatchObject({ netRx: 100, netTx: 50 })
  })

  it('says what is visible: all, own processes or nothing', () => {
    expect(new DetailTracker().next(raw(), 1, 1, 0).diskIo).toBe('all')
    expect(new DetailTracker().next(raw({ privileged: false }), 1, 1, 0).diskIo).toBe('own')
    const none = new DetailTracker().next(raw({ io: null, sockets: null }), 1, 1, 0)
    expect(none.diskIo).toBe('none')
    expect(none.net).toBe('none')
  })

  it('computes the share of RAM per user', () => {
    const d = new DetailTracker().next(raw({ procs: [proc({ rss: 2048 })] }), 1, 1, 8192)
    expect(d.users[0].memPct).toBe(25)
  })
})
