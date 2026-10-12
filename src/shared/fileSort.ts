import type { SftpEntry } from './types'

export type SortKey = 'name' | 'size' | 'mtime'
export type SortDir = 'asc' | 'desc'

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Returns a new array: folders first, then by the chosen key. */
export function sortEntries(entries: readonly SftpEntry[], key: SortKey, dir: SortDir): SftpEntry[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    const byName = collator.compare(a.name, b.name)
    const primary = key === 'size' ? a.size - b.size : key === 'mtime' ? a.mtime - b.mtime : byName
    return primary !== 0 ? primary * sign : byName
  })
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`, 'i')
}

export function filterEntries(entries: readonly SftpEntry[], query: string, showHidden: boolean): SftpEntry[] {
  const q = query.trim()
  const visible = showHidden ? entries : entries.filter((e) => !e.name.startsWith('.'))
  if (!q) return [...visible]
  if (/[*?]/.test(q)) {
    const re = globToRegExp(q)
    return visible.filter((e) => re.test(e.name))
  }
  const lower = q.toLowerCase()
  return visible.filter((e) => e.name.toLowerCase().includes(lower))
}
