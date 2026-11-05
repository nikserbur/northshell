import { randomUUID } from 'node:crypto'
import { emptyWorkspace, type HttpHistoryItem, type HttpWorkspace, type ImportedCollection, type SavedRequest, type SavedRequestInput } from '@shared/httpWorkspace'
import { JsonFile } from './jsonFile'
import { httpWorkspaceSchema } from './schemas'

const MAX_HISTORY = 100
export const MAX_SAVED_REQUESTS = 5000
/** A history entry is for re-opening a request, not for keeping big uploads around. */
const MAX_HISTORY_ITEM_CHARS = 64 * 1024

/** Collections, variables and history in http-workspace.json (owner-only, like every store). */
export class HttpStore {
  private file: JsonFile<unknown>

  constructor(path: string) {
    this.file = new JsonFile<unknown>(path, emptyWorkspace)
  }

  workspace(): HttpWorkspace {
    const parsed = httpWorkspaceSchema.safeParse(this.file.read())
    if (parsed.success) return parsed.data
    console.error('[http] http-workspace.json has an unexpected shape; starting empty', parsed.error.message)
    return emptyWorkspace()
  }

  private update(change: (w: HttpWorkspace) => HttpWorkspace): HttpWorkspace {
    const next = change(this.workspace())
    this.file.write(next)
    return next
  }

  saveRequest(input: SavedRequestInput): { workspace: HttpWorkspace; id: string } {
    const id = input.id ?? randomUUID()
    const saved: SavedRequest = { ...input, id, name: input.name.trim(), folder: input.folder.trim(), updatedAt: Date.now() }
    const workspace = this.update((w) => {
      const exists = w.requests.some((r) => r.id === id)
      if (!exists && w.requests.length >= MAX_SAVED_REQUESTS) throw new Error('Too many saved requests')
      return { ...w, requests: exists ? w.requests.map((r) => (r.id === id ? saved : r)) : [...w.requests, saved] }
    })
    return { workspace, id }
  }

  removeRequest(id: string): HttpWorkspace {
    return this.update((w) => ({ ...w, requests: w.requests.filter((r) => r.id !== id) }))
  }

  setVars(sessionId: string, vars: Record<string, string>): HttpWorkspace {
    return this.update((w) => ({ ...w, vars: { ...w.vars, [sessionId]: vars } }))
  }

  addHistory(sessionId: string, item: HttpHistoryItem): HttpWorkspace {
    const small = JSON.stringify(item).length <= MAX_HISTORY_ITEM_CHARS ? item : { ...item, spec: { ...item.spec, body: '', form: [] } }
    return this.update((w) => ({ ...w, history: { ...w.history, [sessionId]: [small, ...(w.history[sessionId] ?? [])].slice(0, MAX_HISTORY) } }))
  }

  clearHistory(sessionId: string): HttpWorkspace {
    return this.update((w) => ({ ...w, history: { ...w.history, [sessionId]: [] } }))
  }

  /** Adds a collection file's requests for one environment; its variables never replace values already set. */
  addImported(sessionId: string, collection: ImportedCollection): HttpWorkspace {
    const now = Date.now()
    return this.update((w) => {
      const added = collection.requests.map<SavedRequest>((r) => ({ ...r, id: randomUUID(), sessionId, updatedAt: now }))
      if (w.requests.length + added.length > MAX_SAVED_REQUESTS) throw new Error('Too many saved requests')
      return { ...w, requests: [...w.requests, ...added], vars: { ...w.vars, [sessionId]: { ...collection.variables, ...w.vars[sessionId] } } }
    })
  }

  /** A duplicated environment starts with its own copy of the requests and variables. */
  copySession(fromId: string, toId: string): HttpWorkspace {
    const now = Date.now()
    return this.update((w) => {
      const copies = w.requests.filter((r) => r.sessionId === fromId).map((r) => ({ ...r, id: randomUUID(), sessionId: toId, updatedAt: now }))
      return { ...w, requests: [...w.requests, ...copies], vars: { ...w.vars, [toId]: { ...w.vars[fromId] } } }
    })
  }

  /** The environment was deleted; its shared requests stay. */
  removeSession(sessionId: string): HttpWorkspace {
    return this.update((w) => {
      const { [sessionId]: _v, ...vars } = w.vars
      const { [sessionId]: _h, ...history } = w.history
      return { requests: w.requests.filter((r) => r.sessionId !== sessionId), vars, history }
    })
  }
}
