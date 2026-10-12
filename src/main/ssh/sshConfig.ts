export interface SshConfigHost {
  alias: string
  host: string
  port: number
  username: string
  identityFile: string
}

function expandHome(path: string, home: string): string {
  return path === '~' || path.startsWith('~/') ? home + path.slice(1) : path
}

/** Minimal ~/.ssh/config reader: concrete `Host` blocks with HostName, User, Port, IdentityFile. */
export function parseSshConfig(text: string, home: string): SshConfigHost[] {
  const hosts: SshConfigHost[] = []
  let current: SshConfigHost | null = null

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const m = /^(\S+?)\s*(?:=|\s)\s*(.+)$/.exec(line)
    if (!m) continue
    const key = m[1].toLowerCase()
    const value = m[2].trim().replace(/^"(.*)"$/, '$1')

    if (key === 'host' || key === 'match') {
      const alias = value.split(/\s+/)[0]
      current = key === 'host' && !/[*?!]/.test(alias) ? { alias, host: alias, port: 22, username: '', identityFile: '' } : null
      if (current) hosts.push(current)
      continue
    }
    if (!current) continue
    if (key === 'hostname') current.host = value
    else if (key === 'user') current.username = value
    else if (key === 'identityfile' && !current.identityFile) current.identityFile = expandHome(value, home)
    else if (key === 'port') {
      const port = Number(value)
      if (Number.isInteger(port) && port >= 1 && port <= 65535) current.port = port
    }
  }
  return hosts
}
