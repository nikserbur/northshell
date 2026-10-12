/**
 * MobaXterm-style syntax highlighting of terminal output.
 *
 * Works on the decoded output stream: escape sequences are passed through untouched (even when
 * split across chunks), text the program already coloured is left alone, and highlighting pauses
 * while a full-screen app (alternate screen) is running. Only SGR codes are inserted, so cursor
 * positions and layout never change.
 */

const ESC = '\x1b'
const MAX_PENDING = 4096

const STYLES = {
  url: ['\x1b[4;38;5;75m', '\x1b[24;39m'],
  ip: ['\x1b[38;5;213m', '\x1b[39m'],
  bad: ['\x1b[1;38;5;203m', '\x1b[22;39m'],
  warn: ['\x1b[38;5;221m', '\x1b[39m'],
  good: ['\x1b[38;5;77m', '\x1b[39m'],
  info: ['\x1b[38;5;80m', '\x1b[39m']
} as const

type Style = keyof typeof STYLES

const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)'
const PATTERNS: [Style, string][] = [
  ['url', `\\bhttps?:\\/\\/[^\\s'"<>()\\x1b]*[^\\s'"<>().,;:!?\\x1b]`],
  ['ip', `(?<![\\w.])${OCTET}(?:\\.${OCTET}){3}(?![\\w]|\\.\\d)`],
  ['bad', '\\b(?:error|errors|failed|failure|fatal|denied|refused|critical|panic|unable|cannot)\\b'],
  ['warn', '\\b(?:warning|warnings|warn|deprecated)\\b'],
  ['good', '\\b(?:ok|success|successful|successfully|succeeded|enabled|active|running|passed|done)\\b'],
  ['info', '\\b(?:info|information|notice|last login)\\b|(?<=\\s)--?[a-zA-Z][\\w-]*']
]

const MATCHER = new RegExp(PATTERNS.map(([, p]) => `(${p})`).join('|'), 'gi')
const RESET_PARAMS = new Set(['', '0', '22', '23', '24', '27', '39', '49'])

/** Returns the index just past the escape sequence starting at `i`, or -1 if it is incomplete. */
function escapeEnd(s: string, i: number): number {
  const kind = s[i + 1]
  if (kind === undefined) return -1
  if (kind === '[') {
    for (let j = i + 2; j < s.length; j++) {
      const c = s.charCodeAt(j)
      if (c >= 0x40 && c <= 0x7e) return j + 1
    }
    return -1
  }
  if (kind === ']' || kind === 'P' || kind === '^' || kind === '_' || kind === 'X') {
    for (let j = i + 2; j < s.length; j++) {
      if (s[j] === '\x07') return j + 1
      if (s[j] === ESC) return s[j + 1] === undefined ? -1 : j + 2
    }
    return -1
  }
  if ('()*+#%'.includes(kind)) return s[i + 2] === undefined ? -1 : i + 3
  return i + 2
}

export class OutputHighlighter {
  private pending = ''
  private styled = false
  private altScreen = false

  push(chunk: string): string {
    const data = this.pending + chunk
    this.pending = ''
    let out = ''
    let textStart = 0
    let i = data.indexOf(ESC)
    while (i >= 0) {
      out += this.colorize(data.slice(textStart, i))
      const end = escapeEnd(data, i)
      if (end < 0) {
        const rest = data.slice(i)
        if (rest.length > MAX_PENDING) return out + rest
        this.pending = rest
        return out
      }
      const seq = data.slice(i, end)
      this.track(seq)
      out += seq
      textStart = end
      i = data.indexOf(ESC, end)
    }
    return out + this.colorize(data.slice(textStart))
  }

  /** Returns any buffered partial escape sequence (used when highlighting is switched off). */
  flush(): string {
    const rest = this.pending
    this.pending = ''
    return rest
  }

  private track(seq: string): void {
    const csi = /^\x1b\[([?\d;]*)([A-Za-z])$/.exec(seq)
    if (!csi) return
    const [, params, final] = csi
    if (final === 'm') {
      this.styled = !params.split(';').every((p) => RESET_PARAMS.has(p))
    } else if ((final === 'h' || final === 'l') && /^\?(1049|1047|47)$/.test(params)) {
      this.altScreen = final === 'h'
    }
  }

  private colorize(text: string): string {
    if (!text || this.styled || this.altScreen) return text
    return text.replace(MATCHER, (match, ...groups: unknown[]) => {
      const idx = groups.slice(0, PATTERNS.length).findIndex((g) => g !== undefined)
      const [open, close] = STYLES[PATTERNS[idx]?.[0] ?? 'info']
      return `${open}${match}${close}`
    })
  }
}
