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

function drawBox(lines: Line[]): string {
  const width = Math.max(...lines.map((l) => [...l.text].length)) + 4
  const row = (l: Line): string => {
    const len = [...l.text].length
    const left = l.center ? Math.floor((width - len) / 2) : 2
    const right = width - len - left
    return `│${' '.repeat(left)}${l.styled}${' '.repeat(right)}│`
  }
  return [`┌${'─'.repeat(width)}┐`, ...lines.map(row), `└${'─'.repeat(width)}┘`, ''].join('\r\n')
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
  return drawBox(lines)
}

/** What an HTTP environment provides. Header values are never printed — they may hold secrets. */
export interface HttpBannerInfo {
  name: string
  baseUrl: string
  token: 'keychain' | 'none' | 'unreadable'
  headerNames: string[]
  /** Headers left out because they need $TOKEN and none is saved. */
  skippedHeaders: string[]
  insecure: boolean
}

function field(label: string, value: string, styled = value): Line {
  const head = `  ${label.padEnd(10)} `
  return { text: `${head}${value}`, styled: `${head}${styled}` }
}

export function buildHttpBanner(info: HttpBannerInfo): string {
  const headers = info.headerNames.length > 0 ? info.headerNames.join(', ') : '—'
  const lines: Line[] = [
    { text: `▸ HTTP environment · ${info.name}`, styled: `▸ HTTP environment · ${MAGENTA}${info.name}${RESET}` },
    field('$BASE_URL', info.baseUrl, `${CYAN}${info.baseUrl}${RESET}`),
    info.token === 'keychain'
      ? field('$TOKEN', '✓ from Keychain', `${GREEN}✓${RESET} from Keychain`)
      : info.token === 'unreadable'
        ? field('$TOKEN', '✗ cannot read from Keychain — enter it again', `${RED}✗ cannot read from Keychain${RESET}${DIM} — enter it again${RESET}`)
        : field('$TOKEN', '✗ not set', `${RED}✗${RESET}${DIM} not set${RESET}`),
    field('headers', headers, `${DIM}${headers}${RESET}`),
    ...(info.skippedHeaders.length > 0
      ? [field('skipped', `${info.skippedHeaders.join(', ')} (needs $TOKEN)`, `${RED}${info.skippedHeaders.join(', ')}${RESET}${DIM} (needs $TOKEN)${RESET}`)]
      : []),
    ...(info.insecure ? [field('TLS', '✗ certificate not checked (-k)', `${RED}✗${RESET}${DIM} certificate not checked (-k)${RESET}`)] : []),
    plain(''),
    {
      text: '▸ curl $BASE_URL/… — headers are added automatically',
      styled: `▸ ${CYAN}curl $BASE_URL/…${RESET} — headers are added automatically`
    },
    {
      text: '  to every curl in this tab: use another tab for other hosts',
      styled: `${DIM}  to every curl in this tab: use another tab for other hosts${RESET}`
    },
    { text: '▸ ⇧⌘L command library', styled: `▸ ${CYAN}⇧⌘L${RESET} command library` }
  ]
  return drawBox(lines)
}
