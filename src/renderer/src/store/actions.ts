import { LOCAL_MONITOR_ID, type OpenTarget, type QuickTarget, type SessionConfig } from '@shared/types'
import { buildBanner } from '@shared/banner'
import { APP_NAME } from '@shared/brand'
import { makeT } from '../lib/i18n'
import { registry } from '../terminal/registry'
import { useApp, type Tab } from './appStore'

const api = (): typeof window.xmt => window.xmt
const DIM = '\x1b[38;5;244m'
const RED = '\x1b[38;5;203m'
const RESET = '\x1b[0m'

/** Forwards terminal keystrokes to main; in broadcast mode to every connected tab. */
registry.setInputHandler((tabId, data) => {
  const { broadcast, tabs } = useApp.getState()
  if (!broadcast) return api().term.write(tabId, data)
  for (const t of tabs) if (t.status === 'connected') api().term.write(t.id, data)
})

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
  return openTab(
    { kind: 'session', sessionId: session.id },
    { title: session.name, color: session.color, kind: 'ssh', sessionId: session.id, sftpEnabled: session.sftp }
  )
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

export function monitorKeyFor(tab: Tab | undefined): string {
  return !tab || tab.kind === 'local' ? LOCAL_MONITOR_ID : tab.id
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

function printBanner(tab: Tab, endpoint: string | undefined): void {
  const store = useApp.getState()
  if (!store.settings.terminalBanner || tab.kind !== 'ssh') return
  const session = tab.sessionId ? store.sessions.find((s) => s.id === tab.sessionId) : undefined
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
        printBanner(tab, ev.endpoint)
        if (tab.kind === 'local' && ev.endpoint) patch.title = ev.endpoint.split('/').pop() || tab.title
      }
      if (ev.status === 'connecting' && ev.endpoint && tab.kind === 'ssh') {
        registry.write(ev.tabId, `${DIM}⟳ ${ev.endpoint}…${RESET}\r\n`)
      }
      if (ev.status === 'error') registry.write(ev.tabId, `\r\n${RED}✖ ${ev.message ?? 'Error'}${RESET}\r\n`)
      if (ev.status === 'closed') registry.write(ev.tabId, `\r\n${DIM}— ${ev.message ?? 'Closed'} —${RESET}\r\n`)
      store.updateTab(ev.tabId, patch)
    }),
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
