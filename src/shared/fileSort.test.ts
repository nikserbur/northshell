import { describe, expect, it } from 'vitest'
import { filterEntries, sortEntries } from './fileSort'
import type { SftpEntry } from './types'

const e = (name: string, isDir: boolean, size: number, mtime: number): SftpEntry => ({
  name,
  path: `/x/${name}`,
  isDir,
  isLink: false,
  size,
  mtime,
  mode: isDir ? 'drwxr-xr-x' : '-rw-r--r--'
})

const list = [e('b.txt', false, 300, 1), e('src', true, 0, 5), e('A.log', false, 10, 9), e('.env', false, 50, 3), e('docs', true, 0, 2)]

describe('sortEntries', () => {
  it('sorts by name case-insensitively with folders first', () => {
    expect(sortEntries(list, 'name', 'asc').map((x) => x.name)).toEqual(['docs', 'src', '.env', 'A.log', 'b.txt'])
  })

  it('sorts by size descending, folders still first', () => {
    expect(sortEntries(list, 'size', 'desc').map((x) => x.name)).toEqual(['docs', 'src', 'b.txt', '.env', 'A.log'])
  })

  it('sorts by modification date', () => {
    expect(sortEntries(list, 'mtime', 'desc').map((x) => x.name)).toEqual(['src', 'docs', 'A.log', '.env', 'b.txt'])
  })

  it('does not mutate the input', () => {
    const copy = [...list]
    sortEntries(list, 'size', 'asc')
    expect(list).toEqual(copy)
  })
})

describe('filterEntries', () => {
  it('hides dotfiles unless requested', () => {
    expect(filterEntries(list, '', false).map((x) => x.name)).not.toContain('.env')
    expect(filterEntries(list, '', true).map((x) => x.name)).toContain('.env')
  })

  it('matches substrings case-insensitively', () => {
    expect(filterEntries(list, 'LOG', true).map((x) => x.name)).toEqual(['A.log'])
  })

  it('supports simple globs', () => {
    expect(filterEntries(list, '*.txt', true).map((x) => x.name)).toEqual(['b.txt'])
  })
})
