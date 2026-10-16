import type { CommandSnippet } from './types'

/**
 * `{{name}}` or `{{name:default}}` — asked for when the command runs; names may be in any script.
 * `\{{` is an escape for literal braces (e.g. Go templates: `\{{end}}`).
 */
const PLACEHOLDER_RE = /\\\{\{|\{\{\s*([\p{L}_][\p{L}\p{N}_-]{0,40})\s*(?::([^}]*))?\}\}/gu
const ESCAPE = '\\{{'

export interface Placeholder {
  name: string
  fallback: string
}

/** Unique placeholders in order of first appearance; the first default given for a name wins. */
export function placeholders(command: string): Placeholder[] {
  const seen = new Map<string, Placeholder>()
  for (const m of command.matchAll(PLACEHOLDER_RE)) {
    if (m[0] !== ESCAPE && !seen.has(m[1])) seen.set(m[1], { name: m[1], fallback: m[2]?.trim() ?? '' })
  }
  return [...seen.values()]
}

/** Replaces every placeholder with its value (or its default when the value is missing) and unescapes `\{{`. */
export function fillPlaceholders(command: string, values: Record<string, string>): string {
  return command.replace(PLACEHOLDER_RE, (m: string, name: string | undefined, fallback: string | undefined) =>
    m === ESCAPE || name === undefined ? '{{' : (values[name] ?? fallback?.trim() ?? '')
  )
}

/** Splits a command into plain text and placeholder parts for highlighting. */
export function splitPlaceholders(command: string): { text: string; placeholder: boolean }[] {
  const parts: { text: string; placeholder: boolean }[] = []
  let last = 0
  for (const m of command.matchAll(PLACEHOLDER_RE)) {
    const at = m.index ?? 0
    if (at > last) parts.push({ text: command.slice(last, at), placeholder: false })
    parts.push({ text: m[0], placeholder: m[0] !== ESCAPE })
    last = at + m[0].length
  }
  if (last < command.length) parts.push({ text: command.slice(last), placeholder: false })
  return parts
}

/** C0 controls other than tab and newlines; ESC in particular could end a bracketed paste early. */
export const UNSAFE_CONTROL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/

/**
 * Text sent to the terminal: control characters are dropped (so "insert" can never execute), and so
 * are trailing newlines, which would run an "insert only" command by accident.
 */
export function commandText(command: string): string {
  return command.replace(new RegExp(UNSAFE_CONTROL_RE.source, 'g'), '').replace(/\s+$/, '')
}

export interface SnippetGroups {
  own: CommandSnippet[]
  shared: CommandSnippet[]
  /** Commands of other connections, keyed by connection name ('' = a connection that no longer exists). */
  others: [string, CommandSnippet[]][]
}

const byName = (a: CommandSnippet, b: CommandSnippet): number => a.name.localeCompare(b.name)

/** Groups the library for one connection: its own commands, shared ones, then everything else. */
export function groupSnippets(
  commands: CommandSnippet[],
  sessionId: string | undefined,
  sessionNames: Map<string, string>
): SnippetGroups {
  const own: CommandSnippet[] = []
  const shared: CommandSnippet[] = []
  const others = new Map<string, CommandSnippet[]>()
  for (const c of commands) {
    if (!c.sessionId && !c.sessionName) shared.push(c)
    else if (sessionId && c.sessionId === sessionId) own.push(c)
    else {
      const label = (c.sessionId && sessionNames.get(c.sessionId)) || c.sessionName || ''
      others.set(label, [...(others.get(label) ?? []), c])
    }
  }
  return {
    own: own.sort(byName),
    shared: shared.sort(byName),
    others: [...others.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, list]) => [k, list.sort(byName)])
  }
}
