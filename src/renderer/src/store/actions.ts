import {
  LOCAL_MONITOR_ID,
  type CommandLibrary,
  type CommandSnippet,
  type CommandSnippetInput,
  type OpenTarget,
  type QuickTarget,
  type SessionConfig,
  type TabStatusEvent
} from '@shared/types'
import { buildBanner, buildHttpBanner } from '@shared/banner'
import { APP_NAME } from '@shared/brand'
import { parseHeaders, usesToken } from '@shared/httpEnv'
import { parseCurlCommand, type HttpRequestSpec } from '@shared/httpRequest'
import { commandText, fillPlaceholders, placeholders } from '@shared/snippets'
import { makeT } from '../lib/i18n'
import { errorMessage } from '../lib/util'
import { registry } from '../terminal/registry'
import { EMPTY_HTTP_PANEL, useApp, type Tab } from './appStore'

const api = (): typeof window.xmt => window.xmt
const DIM = '\x1b[38;5;244m'
const RED = '\x1b[38;5;203m'
const RESET = '\x1b[0m'

registry.setCommandSelectGuard(() => !useApp.getState().broadcast)

/** Forwards terminal keystrokes to main; in broadcast mode to every connected tab. */
registry.setInputHandler((tabId, data) => {
  const { broadcast, tabs } = useApp.getState()
  if (!broadcast) return api().term.write(tabId, data)
  for (const t of tabs) if (t.status === 'connected') api().term.write(t.id, data)
})

/** Types a command into a tab as a paste (no accidental runs of multi-line text), optionally pressing Enter. */
export function sendCommand(tabId: string, command: string, run: boolean): void {
  const entry = registry.get(tabId)
  const text = commandText(command)
  if (!entry || !text) return
  entry.term.paste(text)
  if (run) entry.term.input('\r')
  registry.focus(tabId)
}

/** Runs (or inserts) a library command in a tab, asking for {{placeholders}} first. */
export function runSnippet(snippet: CommandSnippet, tabId: string, run: boolean): void {
  if (placeholders(snippet.command).length > 0) {
    useApp.getState().openDialog({ kind: 'command-vars', snippet, tabId })
    return
  }
  sendCommand(tabId, snippet.command, run)
}

function openTab(target: OpenTarget, meta: Pick<Tab, 'title' | 'color' | 'kind' | 'sessionId' | 'sftpEnabled'>): string {
  const id = crypto.randomUUID()
  registry.create(id, useApp.getState().settings)
  useApp.getState().addTab({ id, target, status: 'connecting', ...meta })
  return id
}

export function openLocal(): string {
  return openTab({ kind: 'local' }, { title: 'zsh', color: '#94a3b8', kind: 'local', sftpEnabled: false })
}

export function openSession(session: SessionConfig): string {
  const http = session.kind === 'http'
  // An HTTP environment is all about its saved requests, so show the library with it.
  if (http && !useApp.getState().settings.commandsPanelOpen) setPanelOpen('commandsPanelOpen', true)
  return openTab(
    { kind: 'session', sessionId: session.id },
    { title: session.name, color: session.color, kind: http ? 'http' : 'ssh', sessionId: session.id, sftpEnabled: !http && session.sftp }
  )
}

type PanelKey = 'sidebarOpen' | 'sftpPanelOpen' | 'commandsPanelOpen' | 'httpPanelOpen'

/** Shows or hides a side panel; the choice is remembered in settings. */
export function setPanelOpen(key: PanelKey, open: boolean): void {
  const store = useApp.getState()
  store.setSettings({ ...store.settings, [key]: open })
  void api()
    .settings.set({ [key]: open })
    .then((s) => useApp.getState().setSettings(s))
}

export function openQuick(target: QuickTarget): string {
  return openTab(
    { kind: 'quick', target },
    { title: `${target.username}@${target.host}`, color: '#5eead4', kind: 'ssh', sftpEnabled: true }
  )
}

/** Called by the terminal view once xterm is mounted and sized. */
export function connectTab(tabId: string): void {
  const tab = useApp.getState().tabs.find((t) => t.id === tabId)
  const entry = registry.get(tabId)
  if (!tab || !entry) return
  entry.needsConnect = false
  const { cols, rows } = registry.size(tabId)
  useApp.getState().updateTab(tabId, { status: 'connecting', message: undefined })
  api()
    .term.open(tabId, tab.target, cols, rows)
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': /, '') : String(err)
      useApp.getState().updateTab(tabId, { status: 'error', message })
      registry.write(tabId, `\r\n${RED}✖ ${message}${RESET}\r\n`)
    })
}

export function reconnectTab(tabId: string): void {
  registry.write(tabId, `\r\n${DIM}────────────────────────────────────────${RESET}\r\n`)
  connectTab(tabId)
}

export function closeTab(tabId: string): void {
  void api().term.close(tabId)
  registry.dispose(tabId)
  useApp.getState().removeTab(tabId)
}

export function activateRelative(delta: number): void {
  const { tabs, activeId, setActive } = useApp.getState()
  if (tabs.length === 0) return
  const idx = tabs.findIndex((t) => t.id === activeId)
  const next = (idx + delta + tabs.length) % tabs.length
  setActive(tabs[next].id)
}

export async function reloadSessions(): Promise<void> {
  useApp.getState().setSessions(await api().sessions.list())
}

/** Applies a library change from main; errors (e.g. a broken commands.json) become a toast. */
async function updateLibrary(change: Promise<CommandLibrary>): Promise<boolean> {
  try {
    useApp.getState().setLibrary(await change)
    return true
  } catch (err) {
    useApp.getState().toast({ kind: 'error', text: errorMessage(err) })
    return false
  }
}

export function saveCommand(input: CommandSnippetInput): Promise<boolean> {
  return updateLibrary(api().commands.save(input))
}

export function removeCommand(id: string): Promise<boolean> {
  return updateLibrary(api().commands.remove(id))
}

export function reloadCommands(): Promise<boolean> {
  return updateLibrary(api().commands.list())
}

/** Fills {{placeholders}} in every field of a request. */
export function fillRequest(spec: HttpRequestSpec, vars: Record<string, string>): HttpRequestSpec {
  const fill = (text: string): string => fillPlaceholders(text, vars)
  return { ...spec, url: fill(spec.url), headers: fill(spec.headers), body: fill(spec.body) }
}

/** Sends the request panel's form of an HTTP tab and records the result. */
export async function sendHttpRequest(tabId: string): Promise<void> {
  const store = useApp.getState()
  const tab = store.tabs.find((t) => t.id === tabId)
  // The panel has no stored state until its form is first edited.
  const panel = store.httpPanels[tabId] ?? EMPTY_HTTP_PANEL
  if (!tab || panel.pending) return
  const spec = fillRequest(panel.spec, panel.vars)
  store.patchHttpPanel(tabId, { pending: true, error: undefined })
  try {
    const response = await api().http.send(tabId, spec)
    useApp.getState().patchHttpPanel(tabId, { pending: false, response })
    if (tab.sessionId) {
      useApp.getState().addHttpHistory(tab.sessionId, {
        id: crypto.randomUUID(),
        spec: panel.spec,
        status: response.status,
        timeMs: response.timeMs,
        at: Date.now()
      })
    }
  } catch (err) {
    useApp.getState().patchHttpPanel(tabId, { pending: false, error: errorMessage(err), response: undefined })
  }
}

export function cancelHttpRequest(tabId: string): void {
  void api().http.cancel(tabId)
}

/**
 * Loads a curl command (pasted or from the library) into the request panel of an HTTP tab.
 * Returns the options that could not be carried over, or null when the text is not a curl command.
 */
export function loadCurlIntoPanel(tabId: string, command: string): string[] | null {
  const store = useApp.getState()
  const tab = store.tabs.find((t) => t.id === tabId)
  const session = tab?.sessionId ? store.sessions.find((s) => s.id === tab.sessionId) : undefined
  const parsed = parseCurlCommand(command, session?.baseUrl ?? '')
  if (!parsed) return null
  store.patchHttpPanel(tabId, { spec: parsed.spec, response: undefined, error: undefined })
  if (!store.settings.httpPanelOpen) setPanelOpen('httpPanelOpen', true)
  return parsed.warnings
}

/** Local and HTTP tabs run on this Mac, so they show its stats. */
export function monitorKeyFor(tab: Tab | undefined): string {
  return !tab || tab.kind !== 'ssh' ? LOCAL_MONITOR_ID : tab.id
}

function notifyDownloadsFinished(tabId: string, localPath: string): void {
  const store = useApp.getState()
  const pending = store.transfers.some(
    (x) => x.tabId === tabId && x.direction === 'download' && (x.state === 'queued' || x.state === 'running')
  )
  if (pending) return
  const t = makeT(store.settings.language)
  const dir = localPath.slice(0, localPath.lastIndexOf('/')) || localPath
  store.toast({
    kind: 'success',
    text: t('downloadedTo', { path: dir }),
    action: { label: t('showInFinder'), run: () => void api().app.showInFolder(localPath) }
  })
}

let appVersion = ''

function printBanner(tab: Tab, ev: TabStatusEvent): void {
  const store = useApp.getState()
  const endpoint = ev.endpoint
  const session = tab.sessionId ? store.sessions.find((s) => s.id === tab.sessionId) : undefined
  // HTTP environments always explain themselves: $BASE_URL, $TOKEN and the headers are their whole point.
  if (tab.kind === 'http' && session) {
    const headers = parseHeaders(session.headers).headers
    const token = !session.hasSecret ? 'none' : ev.tokenUnreadable ? 'unreadable' : 'keychain'
    registry.write(
      tab.id,
      buildHttpBanner({
        name: session.name,
        baseUrl: endpoint ?? session.baseUrl,
        token,
        headerNames: headers.map((h) => h.name),
        skippedHeaders: token === 'keychain' ? [] : headers.filter((h) => usesToken(h.value)).map((h) => h.name),
        insecure: session.insecure
      })
    )
    return
  }
  if (!store.settings.terminalBanner || tab.kind !== 'ssh') return
  registry.write(
    tab.id,
    buildBanner({
      app: APP_NAME,
      version: appVersion,
      target: endpoint ?? tab.endpoint ?? tab.title,
      sftp: tab.sftpEnabled,
      monitoring: store.settings.monitorEnabled && (session?.monitoring ?? true)
    })
  )
}

/** Subscribes to all main-process events. Returns an unsubscribe function. */
export function bindIpc(): () => void {
  void api()
    .app.info()
    .then((info) => (appVersion = info.version))
  const offs = [
    api().term.onData((tabId, data) => registry.write(tabId, data)),
    api().term.onStatus((ev) => {
      const store = useApp.getState()
      const tab = store.tabs.find((t) => t.id === ev.tabId)
      if (!tab) return
      const patch: Partial<Tab> = { status: ev.status, message: ev.message, endpoint: ev.endpoint ?? tab.endpoint }
      if (ev.status === 'connected') {
        patch.connectedAt = Date.now()
        printBanner(tab, ev)
        if (tab.kind === 'local' && ev.endpoint) patch.title = ev.endpoint.split('/').pop() || tab.title
      }
      if (ev.status === 'connecting' && ev.endpoint && tab.kind === 'ssh') {
        registry.write(ev.tabId, `${DIM}⟳ ${ev.endpoint}…${RESET}\r\n`)
      }
      if (ev.status === 'error') registry.write(ev.tabId, `\r\n${RED}✖ ${ev.message ?? 'Error'}${RESET}\r\n`)
      if (ev.status === 'closed') registry.write(ev.tabId, `\r\n${DIM}— ${ev.message ?? 'Closed'} —${RESET}\r\n`)
      store.updateTab(ev.tabId, patch)
    }),
    api().term.onCwd((tabId, dir) => useApp.getState().setTerminalCwd(tabId, dir)),
    api().commands.onChanged((library) => useApp.getState().setLibrary(library)),
    api().monitor.onSnapshot(({ id, snapshot }) => useApp.getState().pushMonitor(id, snapshot)),
    api().sftp.onTransfer((info) => {
      const store = useApp.getState()
      store.upsertTransfer(info)
      if (info.state === 'error') store.toast({ kind: 'error', text: `${info.name}: ${info.error ?? 'error'}` })
      if (info.state === 'done' && info.direction === 'download') notifyDownloadsFinished(info.tabId, info.localPath)
    }),
    api().prompts.onRequest((req) => useApp.getState().pushPrompt(req)),
    api().prompts.onCancel((id) => useApp.getState().popPrompt(id))
  ]
  return () => offs.forEach((off) => off())
}
