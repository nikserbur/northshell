import type { ProcessRow, UserUsage } from './types'

export type ProcSortKey =
  | 'pid'
  | 'user'
  | 'cpu'
  | 'mem'
  | 'rss'
  | 'vsz'
  | 'threads'
  | 'nice'
  | 'state'
  | 'elapsed'
  | 'disk'
  | 'net'
  | 'name'

export type UserSortKey = 'user' | 'procs' | 'cpu' | 'mem' | 'diskRead' | 'diskWrite' | 'disk' | 'net'

export interface SortState<K extends string> {
  key: K
  desc: boolean
}

/** What the "who loads the host" ranking is about. */
export type UserMetric = 'cpu' | 'mem' | 'disk' | 'net'

/** Sort direction when a column is first clicked: names go A→Z, numbers go biggest first. */
export function firstDirection(key: string): boolean {
  return key !== 'user' && key !== 'name' && key !== 'pid' && key !== 'state'
}

function compare(a: string | number, b: string | number): number {
  return typeof a === 'string' || typeof b === 'string' ? String(a).localeCompare(String(b)) : a - b
}

function procValue(p: ProcessRow, key: ProcSortKey): string | number {
  switch (key) {
    case 'disk':
      return p.diskRead + p.diskWrite
    case 'net':
      return p.netRx + p.netTx
    case 'threads':
      return p.threads ?? 0
    default:
      return p[key]
  }
}

export function compareProcs(sort: SortState<ProcSortKey>): (a: ProcessRow, b: ProcessRow) => number {
  return (a, b) => compare(procValue(a, sort.key), procValue(b, sort.key)) * (sort.desc ? -1 : 1) || a.pid - b.pid
}

function userValue(u: UserUsage, key: UserSortKey): string | number {
  switch (key) {
    case 'disk':
      return u.diskRead + u.diskWrite
    case 'net':
      return u.netRx + u.netTx
    default:
      return u[key]
  }
}

export function sortUsers(users: UserUsage[], sort: SortState<UserSortKey>): UserUsage[] {
  return [...users].sort((a, b) => compare(userValue(a, sort.key), userValue(b, sort.key)) * (sort.desc ? -1 : 1) || a.user.localeCompare(b.user))
}

/** Case-insensitive match on the command line, user or pid, optionally for one user only. */
export function filterProcs(rows: ProcessRow[], user: string | null, query: string): ProcessRow[] {
  const q = query.trim().toLowerCase()
  return rows.filter((p) => {
    if (user && p.user !== user) return false
    if (!q) return true
    return p.command.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || p.user.toLowerCase().includes(q) || String(p.pid) === q
  })
}

export function userMetricValue(u: UserUsage, metric: UserMetric): number {
  switch (metric) {
    case 'cpu':
      return u.cpu
    case 'mem':
      return u.mem
    case 'disk':
      return u.diskRead + u.diskWrite
    case 'net':
      return u.netRx + u.netTx
  }
}

export function procMetricValue(p: ProcessRow, metric: UserMetric): number {
  switch (metric) {
    case 'cpu':
      return p.cpu
    case 'mem':
      return p.rss
    case 'disk':
      return p.diskRead + p.diskWrite
    case 'net':
      return p.netRx + p.netTx
  }
}

/** Biggest consumers first; users doing nothing by this measure stay out. */
export function topUsers(users: UserUsage[], metric: UserMetric, limit: number): UserUsage[] {
  return users
    .filter((u) => userMetricValue(u, metric) > 0)
    .sort((a, b) => userMetricValue(b, metric) - userMetricValue(a, metric) || a.user.localeCompare(b.user))
    .slice(0, limit)
}

export function topProcs(rows: ProcessRow[], metric: UserMetric, limit: number): ProcessRow[] {
  return [...rows].sort((a, b) => procMetricValue(b, metric) - procMetricValue(a, metric) || a.pid - b.pid).slice(0, limit)
}

export interface TreeRow {
  row: ProcessRow
  /** Tree guides for the command column, e.g. `│  ├─ `. */
  prefix: string
}

/**
 * Parent → children order like htop's tree view. A process whose parent is filtered out or gone becomes
 * a root of its own; siblings keep the given order.
 */
export function processTree(rows: ProcessRow[], order: (a: ProcessRow, b: ProcessRow) => number): TreeRow[] {
  const pids = new Set(rows.map((p) => p.pid))
  const children = new Map<number, ProcessRow[]>()
  const roots: ProcessRow[] = []
  for (const p of rows) {
    if (p.ppid !== p.pid && pids.has(p.ppid)) children.set(p.ppid, [...(children.get(p.ppid) ?? []), p])
    else roots.push(p)
  }
  const out: TreeRow[] = []
  const walk = (list: ProcessRow[], indent: string, top: boolean): void => {
    const sorted = [...list].sort(order)
    sorted.forEach((row, i) => {
      const last = i === sorted.length - 1
      out.push({ row, prefix: top ? '' : `${indent}${last ? '└─ ' : '├─ '}` })
      walk(children.get(row.pid) ?? [], top ? '' : `${indent}${last ? '   ' : '│  '}`, false)
    })
  }
  walk(roots, '', true)
  return out
}
