import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, watch, type FSWatcher } from 'node:fs'
import { basename, dirname } from 'node:path'
import type { CommandLibrary, CommandSnippet } from '@shared/types'
import { JsonFile } from './jsonFile'
import { commandFileEntrySchema, commandInputSchema } from './schemas'

export interface SessionRef {
  id: string
  name: string
}

/** commands.json as written to disk: meant to be read and edited by people as well. */
interface FileEntry {
  name: string
  command: string
  session?: string
  sessionId?: string
  id: string
}

interface LibraryFile {
  version: 1
  help: string
  commands: FileEntry[]
}

const HELP =
  'Northshell command library — edit it here or in the app (⇧⌘L). Each command has "name" and "command". ' +
  'Add "session": "<connection name>" to show it only for that connection; leave it out to share it everywhere. ' +
  '{{name}} or {{name:default}} in a command asks for a value when it runs.'

export const MAX_COMMANDS = 2000
const WATCH_DEBOUNCE_MS = 150

/** Keys of a library entry the app understands; anything else a person adds is kept as is. */
const KNOWN_KEYS = new Set(['id', 'name', 'command', 'session', 'sessionId'])

type Extras = Map<string, Record<string, unknown>>
type Parsed = { commands: CommandSnippet[]; extras: Extras; error?: undefined } | { commands?: undefined; error: string }

function extraFields(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const extra = Object.fromEntries(Object.entries(raw).filter(([key]) => !KNOWN_KEYS.has(key)))
  return Object.keys(extra).length > 0 ? extra : null
}

const sameScope = (c: CommandSnippet): string => `${c.name}\0${c.command}\0${c.sessionId ?? ''}\0${c.sessionName ?? ''}`

function autoId(name: string, command: string, session: string): string {
  return `auto-${createHash('sha1').update(`${name}\0${command}\0${session}`).digest('hex').slice(0, 12)}`
}

/**
 * Saved commands, shared or tied to one connection. The JSON file is the source of truth and is
 * re-read on every call, so hand edits are picked up; while it cannot be parsed, edits from the
 * app are refused instead of overwriting the user's file.
 */
export class CommandStore {
  private file: JsonFile<LibraryFile>
  private lastGood: CommandSnippet[] = []
  /** Hand-added fields per command id, written back unchanged. */
  private extras: Extras = new Map()

  constructor(
    readonly path: string,
    private readonly sessions: () => SessionRef[]
  ) {
    this.file = new JsonFile(path, () => ({ version: 1, help: HELP, commands: [] }))
  }

  /** Validates raw entries (from the library file or an import) and links them to connections. */
  private parse(entries: unknown): Parsed {
    if (!Array.isArray(entries)) return { error: '"commands" must be a list' }
    if (entries.length > MAX_COMMANDS) return { error: `more than ${MAX_COMMANDS} commands` }
    const sessions = this.sessions()
    const byId = new Set(sessions.map((s) => s.id))
    const usedIds = new Set<string>()
    const commands: CommandSnippet[] = []
    const extras: Extras = new Map()
    for (const [i, raw] of entries.entries()) {
      const res = commandFileEntrySchema.safeParse(raw)
      if (!res.success) {
        const issue = res.error.issues[0]
        return { error: `command #${i + 1}${issue?.path.length ? ` "${issue.path.join('.')}"` : ''}: ${issue?.message ?? 'invalid'}` }
      }
      const e = res.data
      const named = e.session ? sessions.find((s) => s.name === e.session) : undefined
      const scope: Pick<CommandSnippet, 'sessionId' | 'sessionName'> =
        e.sessionId && byId.has(e.sessionId)
          ? { sessionId: e.sessionId }
          : named
            ? { sessionId: named.id }
            : { ...(e.sessionId ? { sessionId: e.sessionId } : {}), ...(e.session ? { sessionName: e.session } : {}) }
      let id = e.id && !usedIds.has(e.id) ? e.id : autoId(e.name, e.command, e.sessionId ?? e.session ?? '')
      for (let n = 2; usedIds.has(id); n++) id = `${id.replace(/-\d+$/, '')}-${n}`
      usedIds.add(id)
      commands.push({ id, name: e.name, command: e.command, ...scope })
      const extra = extraFields(raw)
      if (extra) extras.set(id, extra)
    }
    return { commands, extras }
  }

  private read(): Parsed {
    if (!existsSync(this.path)) return { commands: [], extras: new Map() }
    let data: unknown
    try {
      data = JSON.parse(readFileSync(this.path, 'utf8'))
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
    return this.parse(Array.isArray(data) ? data : (data as { commands?: unknown } | null)?.commands)
  }

  library(): CommandLibrary {
    const parsed = this.read()
    if (parsed.error !== undefined) return { path: this.path, commands: this.lastGood, error: parsed.error }
    this.lastGood = parsed.commands
    this.extras = parsed.extras
    return { path: this.path, commands: parsed.commands }
  }

  private editable(): CommandSnippet[] {
    const parsed = this.read()
    if (parsed.error !== undefined) throw new Error(`${basename(this.path)} has an error (${parsed.error}) — fix the file first`)
    this.extras = parsed.extras
    return parsed.commands
  }

  private toFile(commands: CommandSnippet[]): LibraryFile {
    const names = new Map(this.sessions().map((s) => [s.id, s.name]))
    return {
      version: 1,
      help: HELP,
      commands: commands.map((c) => {
        const session = (c.sessionId && names.get(c.sessionId)) || c.sessionName
        return {
          name: c.name,
          command: c.command,
          ...(session ? { session } : {}),
          ...(c.sessionId ? { sessionId: c.sessionId } : {}),
          ...this.extras.get(c.id),
          id: c.id
        }
      })
    }
  }

  private persist(commands: CommandSnippet[]): CommandLibrary {
    this.file.write(this.toFile(commands))
    this.lastGood = commands
    return { path: this.path, commands }
  }

  /** Creates an empty library (with the help note) so there is a file to open. */
  ensureFile(): void {
    if (!existsSync(this.path)) this.persist([])
  }

  save(raw: unknown): CommandLibrary {
    const input = commandInputSchema.parse(raw)
    const commands = this.editable()
    const existing = input.id ? commands.find((c) => c.id === input.id) : undefined
    if (!existing && commands.length >= MAX_COMMANDS) throw new Error(`The library is full (${MAX_COMMANDS} commands)`)
    const next: CommandSnippet = {
      id: existing?.id ?? randomUUID(),
      name: input.name,
      command: input.command,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.sessionName ? { sessionName: input.sessionName } : {})
    }
    return this.persist(existing ? commands.map((c) => (c.id === next.id ? next : c)) : [...commands, next])
  }

  remove(id: string): CommandLibrary {
    return this.persist(this.editable().filter((c) => c.id !== id))
  }

  /** Drops a deleted connection's commands. A broken library file is left untouched. */
  removeForSession(sessionId: string): void {
    const parsed = this.read()
    if (parsed.error !== undefined || !parsed.commands.some((c) => c.sessionId === sessionId)) return
    this.extras = parsed.extras
    this.persist(parsed.commands.filter((c) => c.sessionId !== sessionId))
  }

  /** Gives a duplicated connection its own copy of the original's commands. */
  copySession(fromId: string, toId: string): void {
    const parsed = this.read()
    if (parsed.error !== undefined) return
    this.extras = parsed.extras
    const copies = parsed.commands
      .filter((c) => c.sessionId === fromId)
      .map(({ sessionName: _n, ...c }) => ({ ...c, id: randomUUID(), sessionId: toId }))
    if (copies.length > 0 && parsed.commands.length + copies.length <= MAX_COMMANDS) {
      this.persist([...parsed.commands, ...copies])
    }
  }

  /** Merges a library exported from Northshell (or written by hand). Returns how many commands were added. */
  importText(text: string): { added: number; library: CommandLibrary } {
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch (err) {
      throw new Error(`Not a JSON file: ${err instanceof Error ? err.message : String(err)}`)
    }
    const incoming = this.parse(Array.isArray(data) ? data : (data as { commands?: unknown } | null)?.commands)
    if (incoming.error !== undefined) throw new Error(incoming.error)
    const commands = this.editable()
    const seen = new Set(commands.map(sameScope))
    const ids = new Set(commands.map((c) => c.id))
    const added: CommandSnippet[] = []
    for (const c of incoming.commands) {
      if (seen.has(sameScope(c))) continue
      seen.add(sameScope(c))
      const id = ids.has(c.id) || c.id.startsWith('auto-') ? randomUUID() : c.id
      ids.add(id)
      added.push({ ...c, id })
    }
    if (commands.length + added.length > MAX_COMMANDS) throw new Error(`The library would exceed ${MAX_COMMANDS} commands`)
    return { added: added.length, library: added.length > 0 ? this.persist([...commands, ...added]) : this.library() }
  }

  exportText(): string {
    return `${JSON.stringify(this.toFile(this.editable()), null, 2)}\n`
  }

  /** Calls back when the file changes on disk (edited by hand, synced, restored). Returns a disposer. */
  watch(onChange: (library: CommandLibrary) => void): () => void {
    const dir = dirname(this.path)
    const name = basename(this.path)
    let timer: ReturnType<typeof setTimeout> | undefined
    let watcher: FSWatcher | null = null
    try {
      mkdirSync(dir, { recursive: true })
      watcher = watch(dir, (_event, file) => {
        if (file && file !== name) return
        clearTimeout(timer)
        timer = setTimeout(() => onChange(this.library()), WATCH_DEBOUNCE_MS)
      })
      watcher.on('error', (err) => console.error('[commands] file watcher failed', err))
    } catch (err) {
      console.error('[commands] cannot watch the library file', err)
    }
    return () => {
      clearTimeout(timer)
      watcher?.close()
    }
  }
}
