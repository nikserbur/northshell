import type { QuickTarget } from './types'

const HOST_RE = /^[A-Za-z0-9._%-]+$|^[0-9A-Fa-f:.]+$/

function toPort(raw: string | undefined): number | null {
  if (raw === undefined) return 22
  if (!/^\d{1,5}$/.test(raw)) return null
  const port = Number(raw)
  return port >= 1 && port <= 65535 ? port : null
}

function splitHostPort(spec: string): { host: string; port: string | undefined } {
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(spec)
  if (bracketed) return { host: bracketed[1], port: bracketed[2] }
  const colons = spec.split(':').length - 1
  if (colons === 1) {
    const [host, port] = spec.split(':')
    return { host, port }
  }
  return { host: spec, port: undefined }
}

/**
 * Parses "user@host:port", "host", or an `ssh [-p port] [-l user] user@host` command line.
 * Returns null when the input cannot be turned into a connectable target.
 */
export function parseQuickConnect(input: string, defaultUser: string): QuickTarget | null {
  const tokens = input.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return null
  if (tokens[0] === 'ssh') tokens.shift()

  let flagPort: string | undefined
  let flagUser: string | undefined
  const positional: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token === '-p') flagPort = tokens[++i]
    else if (token === '-l') flagUser = tokens[++i]
    else positional.push(token)
  }
  if (positional.length !== 1) return null

  const spec = positional[0]
  const at = spec.lastIndexOf('@')
  const userPart = at >= 0 ? spec.slice(0, at) : ''
  const hostSpec = at >= 0 ? spec.slice(at + 1) : spec
  const { host, port: specPort } = splitHostPort(hostSpec)

  if (!host || !HOST_RE.test(host)) return null
  const port = toPort(flagPort ?? specPort)
  if (port === null) return null
  const username = flagUser || userPart || defaultUser
  if (!username) return null
  return { host, port, username }
}
