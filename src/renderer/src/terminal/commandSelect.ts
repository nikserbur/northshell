/**
 * Windows-style editing of the command being typed: Ctrl+A selects it, ⌫ deletes it, typing replaces it.
 * The terminal does not know where the shell prompt ends, so the input start is the cursor position
 * the shell left after its last output before the user began typing.
 */

/** Ctrl+E (end of line) then Ctrl+U (kill line): clears the input in bash, zsh, fish, readline REPLs and plain tty mode. */
export const KILL_LINE = '\x05\x15'

export interface CellPos {
  /** Column. */
  x: number
  /** Absolute buffer row. */
  y: number
}

export interface BufferCellLike {
  getChars(): string
  getWidth(): number
}

export interface BufferLineLike {
  isWrapped: boolean
  length: number
  getCell(x: number): BufferCellLike | undefined
}

export interface BufferLike {
  getLine(y: number): BufferLineLike | undefined
}

export interface Selection {
  col: number
  row: number
  /** In cells, across wrapped rows. */
  length: number
}

/**
 * The typed command as a selection: from the input start (or the start of the cursor's line when the
 * start is unknown or stale) to the last non-blank cell of the cursor's line, wrapped rows included.
 * Null when nothing is typed.
 */
/** Cells up to and including the last non-blank one (a wide character counts as two). */
function usedCells(line: BufferLineLike | undefined): number {
  if (!line) return 0
  for (let x = line.length - 1; x >= 0; x--) {
    const cell = line.getCell(x)
    const chars = cell?.getChars() ?? ''
    if (chars !== '' && chars !== ' ') return x + Math.max(1, cell?.getWidth() ?? 1)
  }
  return 0
}

export function commandSelection(buffer: BufferLike, cols: number, cursor: CellPos, inputStart: CellPos | null): Selection | null {
  let first = cursor.y
  while (first > 0 && buffer.getLine(first)?.isWrapped) first--
  let last = cursor.y
  while (buffer.getLine(last + 1)?.isWrapped) last++
  const startValid =
    inputStart !== null &&
    inputStart.y >= first &&
    (inputStart.y < cursor.y || (inputStart.y === cursor.y && inputStart.x <= cursor.x))
  const start = startValid && inputStart ? inputStart : { x: 0, y: first }
  let end = { x: start.x, y: start.y }
  for (let row = start.y; row <= last; row++) {
    const width = usedCells(buffer.getLine(row))
    if (width > (row === start.y ? start.x : 0)) end = { x: width, y: row }
  }
  const length = (end.y - start.y) * cols + end.x - start.x
  return length > 0 ? { col: start.x, row: start.y, length } : null
}

/** What to send for input arriving while the command is selected: delete keys clear it, text replaces it. */
export function replaceSelected(data: string): { data: string; handled: boolean } {
  if (data === '\x7f' || data === '\b' || data === '\x1b[3~') return { data: KILL_LINE, handled: true }
  const isText = data.startsWith('\x1b[200~') || (data.length > 0 && data.charCodeAt(0) >= 0x20 && data.charCodeAt(0) !== 0x7f)
  return isText ? { data: KILL_LINE + data, handled: true } : { data, handled: false }
}

/** Input that ends the current command line, so the next shell output leads up to a fresh prompt. */
export function endsCommand(data: string): boolean {
  return /[\r\n\x03\x04]/.test(data)
}

/** Replies the terminal sends by itself (device attributes, cursor position, focus and mouse reports), not typing. */
export function isTerminalReply(data: string): boolean {
  return /^\x1b\[(?:[?>][\d;]*c|\d+;\d+R|[IO]|<[\d;]+[Mm]|M[\s\S]{3})$/.test(data)
}
