import { describe, expect, it } from 'vitest'
import { KILL_LINE, commandSelection, endsCommand, isTerminalReply, replaceSelected, type BufferLike } from './commandSelect'

const COLS = 20

/** Rows of a 20-column terminal; a leading `~` marks a row wrapped from the previous one. CJK takes two cells. */
function buffer(rows: string[]): BufferLike {
  return {
    getLine: (y) => {
      const raw = rows[y]
      if (raw === undefined) return undefined
      const isWrapped = raw.startsWith('~')
      const cells: { chars: string; width: number }[] = []
      for (const ch of isWrapped ? raw.slice(1) : raw) {
        const wide = /[\u3000-\u9fff]/.test(ch)
        cells.push({ chars: ch, width: wide ? 2 : 1 })
        if (wide) cells.push({ chars: '', width: 0 })
      }
      while (cells.length < COLS) cells.push({ chars: '', width: 1 })
      return {
        isWrapped,
        length: COLS,
        getCell: (x) => (cells[x] ? { getChars: () => cells[x].chars, getWidth: () => cells[x].width } : undefined)
      }
    }
  }
}

describe('commandSelection', () => {
  it('selects what was typed after the prompt', () => {
    const buf = buffer(['old output', 'user@web:~$ ls -la   '])
    expect(commandSelection(buf, 20, { x: 18, y: 1 }, { x: 12, y: 1 })).toEqual({ col: 12, row: 1, length: 6 })
  })

  it('covers a command wrapped over several rows, wherever the cursor is in it', () => {
    const buf = buffer(['$ echo aaaaaaaaaaaaa', '~aaaaaaaaaaaaaaaaaaa', '~bbb'])
    expect(commandSelection(buf, 20, { x: 4, y: 0 }, { x: 2, y: 0 })).toEqual({ col: 2, row: 0, length: 18 + 20 + 3 })
  })

  it('falls back to the whole line when the input start is unknown or stale', () => {
    const buf = buffer(['prompt', '$ git status'])
    expect(commandSelection(buf, 20, { x: 12, y: 1 }, null)).toEqual({ col: 0, row: 1, length: 12 })
    expect(commandSelection(buf, 20, { x: 12, y: 1 }, { x: 3, y: 0 })).toEqual({ col: 0, row: 1, length: 12 })
  })

  it('counts wide characters as two cells', () => {
    expect(commandSelection(buffer(['$ echo 你好']), 20, { x: 11, y: 0 }, { x: 2, y: 0 })).toEqual({ col: 2, row: 0, length: 9 })
  })

  it('returns null when nothing is typed', () => {
    expect(commandSelection(buffer(['user@web:~$ ']), 20, { x: 12, y: 0 }, { x: 12, y: 0 })).toBeNull()
    expect(commandSelection(buffer(['']), 20, { x: 0, y: 0 }, null)).toBeNull()
  })
})

describe('replaceSelected', () => {
  it('turns ⌫ and Delete into a line kill', () => {
    expect(replaceSelected('\x7f')).toEqual({ data: KILL_LINE, handled: true })
    expect(replaceSelected('\x1b[3~')).toEqual({ data: KILL_LINE, handled: true })
  })

  it('replaces the command with typed or pasted text', () => {
    expect(replaceSelected('l')).toEqual({ data: `${KILL_LINE}l`, handled: true })
    expect(replaceSelected('\x1b[200~pwd\x1b[201~')).toEqual({ data: `${KILL_LINE}\x1b[200~pwd\x1b[201~`, handled: true })
  })

  it('leaves Enter, arrows and control keys alone', () => {
    for (const key of ['\r', '\x1b[D', '\x03', '\t']) expect(replaceSelected(key)).toEqual({ data: key, handled: false })
  })
})

describe('isTerminalReply', () => {
  it('recognises replies xterm sends on its own', () => {
    for (const reply of ['\x1b[?1;2c', '\x1b[>0;276;0c', '\x1b[24;80R', '\x1b[I', '\x1b[<0;10;5M', '\x1b[M !!']) {
      expect(isTerminalReply(reply)).toBe(true)
    }
  })

  it('does not mistake keys for replies', () => {
    for (const key of ['\x1b[A', '\x1b[D', 'q', '\x1b', '\x1b[3~']) expect(isTerminalReply(key)).toBe(false)
  })
})

describe('endsCommand', () => {
  it('is true for Enter, Ctrl+C and Ctrl+D', () => {
    expect(['\r', '\x03', '\x04', 'ls\r'].every(endsCommand)).toBe(true)
    expect(endsCommand('l')).toBe(false)
  })
})
