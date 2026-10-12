/** MobaXterm-style information box printed into the terminal when an SSH session opens. */
export interface BannerInfo {
  app: string
  version: string
  target: string
  sftp: boolean
  monitoring: boolean
}

const GREEN = '\x1b[38;5;77m'
const MAGENTA = '\x1b[38;5;213m'
const RED = '\x1b[38;5;203m'
const CYAN = '\x1b[38;5;80m'
const DIM = '\x1b[38;5;245m'
const RESET = '\x1b[0m'

interface Line {
  text: string
  styled: string
  center?: boolean
}

const plain = (text: string): Line => ({ text, styled: text })
const mark = (ok: boolean): Line => (ok ? { text: '✓', styled: `${GREEN}✓${RESET}` } : { text: '✗', styled: `${RED}✗${RESET}` })

function feature(label: string, ok: boolean, note = ''): Line {
  const m = mark(ok)
  const head = `  • ${label.padEnd(18)}:  `
  return { text: `${head}${m.text}${note}`, styled: `${head}${m.styled}${note ? `${DIM}${note}${RESET}` : ''}` }
}

export function buildBanner(info: BannerInfo): string {
  const title = `• ${info.app} ${info.version} •`
  const lines: Line[] = [
    { text: title, styled: `${GREEN}${title}${RESET}`, center: true },
    { text: '(SSH client, SFTP browser and server monitor)', styled: `${GREEN}(SSH client, SFTP browser and server monitor)${RESET}`, center: true },
    plain(''),
    { text: `▸ SSH session to ${info.target}`, styled: `▸ SSH session to ${MAGENTA}${info.target}${RESET}` },
    feature('Direct SSH', true),
    feature('Host key', true, '  (verified)'),
    feature('SFTP browser', info.sftp),
    feature('Server monitoring', info.monitoring),
    plain(''),
    {
      text: '▸ ⌘P commands · ⌘F search · ⇧⌘M monitor',
      styled: `▸ ${CYAN}⌘P${RESET} commands · ${CYAN}⌘F${RESET} search · ${CYAN}⇧⌘M${RESET} monitor`
    }
  ]
  const width = Math.max(...lines.map((l) => [...l.text].length)) + 4
  const row = (l: Line): string => {
    const len = [...l.text].length
    const left = l.center ? Math.floor((width - len) / 2) : 2
    const right = width - len - left
    return `│${' '.repeat(left)}${l.styled}${' '.repeat(right)}│`
  }
  return [`┌${'─'.repeat(width)}┐`, ...lines.map(row), `└${'─'.repeat(width)}┘`, ''].join('\r\n')
}
