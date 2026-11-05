import { describe, expect, it } from 'vitest'
import { compareProcs, filterProcs, firstDirection, processTree, sortUsers, topProcs, topUsers, userMetricValue } from './procTable'
import type { ProcessRow, UserUsage } from './types'

const proc = (over: Partial<ProcessRow>): ProcessRow => ({
  pid: 1,
  ppid: 0,
  user: 'root',
  cpu: 0,
  mem: 0,
  rss: 0,
  vsz: 0,
  threads: 1,
  nice: 0,
  state: 'S',
  elapsed: 0,
  name: 'init',
  command: '/sbin/init',
  diskRead: 0,
  diskWrite: 0,
  netRx: 0,
  netTx: 0,
  ...over
})

const user = (over: Partial<UserUsage>): UserUsage => ({
  user: 'root',
  procs: 1,
  cpu: 0,
  mem: 0,
  memPct: 0,
  diskRead: 0,
  diskWrite: 0,
  netRx: 0,
  netTx: 0,
  ...over
})

describe('sorting', () => {
  it('sorts processes by a column, ties by pid', () => {
    const rows = [proc({ pid: 3, cpu: 5 }), proc({ pid: 1, cpu: 50 }), proc({ pid: 2, cpu: 5 })]
    expect([...rows].sort(compareProcs({ key: 'cpu', desc: true })).map((p) => p.pid)).toEqual([1, 2, 3])
    expect([...rows].sort(compareProcs({ key: 'cpu', desc: false })).map((p) => p.pid)).toEqual([2, 3, 1])
  })

  it('sorts by disk and network as read + write', () => {
    const rows = [proc({ pid: 1, diskRead: 10 }), proc({ pid: 2, diskRead: 5, diskWrite: 20 })]
    expect([...rows].sort(compareProcs({ key: 'disk', desc: true }))[0].pid).toBe(2)
  })

  it('sorts names as text', () => {
    const rows = [proc({ pid: 1, user: 'zed' }), proc({ pid: 2, user: 'amy' })]
    expect([...rows].sort(compareProcs({ key: 'user', desc: false }))[0].user).toBe('amy')
  })

  it('sorts users without touching the input', () => {
    const users = [user({ user: 'a', diskWrite: 1 }), user({ user: 'b', diskRead: 9 })]
    expect(sortUsers(users, { key: 'disk', desc: true })[0].user).toBe('b')
    expect(users[0].user).toBe('a')
  })

  it('starts names ascending and numbers descending', () => {
    expect(firstDirection('name')).toBe(false)
    expect(firstDirection('cpu')).toBe(true)
  })
})

describe('filterProcs', () => {
  const rows = [proc({ pid: 10, user: 'alice', name: 'python3', command: '/usr/bin/python3 Worker.py' }), proc({ pid: 20, user: 'bob', name: 'nginx', command: 'nginx: master' })]

  it('keeps one user', () => {
    expect(filterProcs(rows, 'bob', '').map((p) => p.pid)).toEqual([20])
  })

  it('matches the command line in any case, the user, or an exact pid', () => {
    expect(filterProcs(rows, null, 'worker').map((p) => p.pid)).toEqual([10])
    expect(filterProcs(rows, null, 'BOB').map((p) => p.pid)).toEqual([20])
    expect(filterProcs(rows, null, '20').map((p) => p.pid)).toEqual([20])
    expect(filterProcs(rows, null, '2')).toEqual([])
  })
})

describe('top lists', () => {
  it('ranks users by the chosen measure and leaves idle ones out', () => {
    const users = [user({ user: 'idle' }), user({ user: 'reader', diskRead: 100 }), user({ user: 'writer', diskWrite: 300 })]
    expect(topUsers(users, 'disk', 5).map((u) => u.user)).toEqual(['writer', 'reader'])
    expect(topUsers(users, 'disk', 1).map((u) => u.user)).toEqual(['writer'])
    expect(userMetricValue(users[1], 'disk')).toBe(100)
  })

  it('ranks processes by memory in bytes', () => {
    const rows = [proc({ pid: 1, rss: 10 }), proc({ pid: 2, rss: 99 })]
    expect(topProcs(rows, 'mem', 1)[0].pid).toBe(2)
  })
})

describe('processTree', () => {
  const order = compareProcs({ key: 'pid', desc: false })

  it('nests children under parents with tree guides', () => {
    const rows = [proc({ pid: 1 }), proc({ pid: 2, ppid: 1 }), proc({ pid: 3, ppid: 2 }), proc({ pid: 4, ppid: 1 })]
    expect(processTree(rows, order).map((r) => [r.row.pid, r.prefix])).toEqual([
      [1, ''],
      [2, '├─ '],
      [3, '│  └─ '],
      [4, '└─ ']
    ])
  })

  it('makes a process whose parent is gone a root, and survives a self-parent', () => {
    const rows = [proc({ pid: 5, ppid: 999 }), proc({ pid: 6, ppid: 6 })]
    expect(processTree(rows, order).map((r) => r.row.pid)).toEqual([5, 6])
  })
})
