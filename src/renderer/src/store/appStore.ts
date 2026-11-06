import { create } from 'zustand'
import { DEFAULT_SETTINGS } from '@shared/defaults'
import { gpuTotals } from '@shared/gpu'
import { emptyRequest, type HttpRequestSpec, type HttpResponseInfo } from '@shared/httpRequest'
import type { TestResult } from '@shared/httpTests'
import { emptyWorkspace, type HttpWorkspace } from '@shared/httpWorkspace'
import type {
  AppSettings,
  CommandLibrary,
  CommandSnippet,
  DiskOwners,
  MonitorSnapshot,
  OpenTarget,
  PromptRequest,
  RemoteFile,
  SessionConfig,
  TabStatus,
  TransferInfo,
  UpdateStatus
} from '@shared/types'

export interface Tab {
  id: string
  title: string
  kind: 'local' | 'ssh' | 'http'
  target: OpenTarget
  sessionId?: string
  color: string
  sftpEnabled: boolean
  status: TabStatus
  message?: string
  endpoint?: string
  connectedAt?: number
}

export interface MonitorHistory {
  latest: MonitorSnapshot
  cpu: number[]
  mem: number[]
  /** Video memory in use, % of all GPUs; stays empty for hosts without a GPU. */
  vram: number[]
  rx: number[]
  tx: number[]
  diskRead: number[]
  diskWrite: number[]
}

export type MonitorTab = 'processes' | 'users' | 'disks'

/** A walk over one file system: running, finished or failed. Kept until the tab closes. */
export interface DiskOwnersState {
  running: boolean
  result?: DiskOwners
  error?: string
}

/** One request of a folder run. */
export interface HttpRunResult {
  id: string
  name: string
  method: string
  status: number
  timeMs: number
  error?: string
  tests: TestResult[]
}

export interface HttpRunState {
  title: string
  total: number
  results: HttpRunResult[]
  running: boolean
}

/** Request panel of one HTTP environment tab: the form and its last response. */
export interface HttpPanelState {
  spec: HttpRequestSpec
  pending: boolean
  response?: HttpResponseInfo
  /** Request could not be sent at all (bad URL, missing token…). */
  error?: string
  testResults?: TestResult[]
  /** The saved request this form was opened from, so edits can be saved back to it. */
  savedId?: string
  /** A folder run shown instead of the response. */
  run?: HttpRunState
}

export const EMPTY_HTTP_PANEL: HttpPanelState = { spec: emptyRequest(), pending: false }

export interface Toast {
  id: string
  kind: 'info' | 'success' | 'error'
  text: string
  action?: { label: string; run: () => void }
}

export interface EditorDoc extends RemoteFile {
  tabId: string
  name: string
}

export type Dialog =
  | { kind: 'session-editor'; session?: SessionConfig; sessionKind?: SessionConfig['kind'] }
  | { kind: 'command-editor'; snippet?: CommandSnippet; sessionId?: string; draft?: { name: string; command: string } }
  | { kind: 'http-import'; tabId: string }
  | { kind: 'http-save'; tabId: string }
  | { kind: 'http-code'; tabId: string }
  | { kind: 'command-vars'; snippet: CommandSnippet; tabId: string }
  | { kind: 'settings' }
  | { kind: 'confirm'; text: string; confirmLabel: string; danger?: boolean; onConfirm: () => void }
  | { kind: 'input'; title: string; value: string; confirmLabel: string; onSubmit: (value: string) => void }

const HISTORY = 60

function pushHistory(list: number[] | undefined, value: number): number[] {
  const next = [...(list ?? []), value]
  return next.length > HISTORY ? next.slice(next.length - HISTORY) : next
}

interface AppState {
  ready: boolean
  settings: AppSettings
  sessions: SessionConfig[]
  library: CommandLibrary
  tabs: Tab[]
  activeId: string | null
  monitors: Record<string, MonitorHistory>
  transfers: TransferInfo[]
  prompts: PromptRequest[]
  sftpPaths: Record<string, string>
  /** Last known working directory of each SSH tab's shell. */
  terminalCwds: Record<string, string>
  dialog: Dialog | null
  editor: EditorDoc | null
  sftpRevision: number
  paletteOpen: boolean
  monitorOpen: boolean
  /** The enlarged monitor view and the tab it shows; null while it is closed. */
  monitorView: MonitorTab | null
  /** User picked in the monitor, per monitor key. */
  monitorUsers: Record<string, string>
  /** Who owns what, per monitor key and mount point. */
  diskOwners: Record<string, Record<string, DiskOwnersState>>
  findOpen: boolean
  broadcast: boolean
  toasts: Toast[]
  httpPanels: Record<string, HttpPanelState>
  /** Collections, variables and history of all HTTP environments, as stored by the main process. */
  httpWorkspace: HttpWorkspace
  update: UpdateStatus

  init(settings: AppSettings, sessions: SessionConfig[]): void
  setSettings(settings: AppSettings): void
  setSessions(sessions: SessionConfig[]): void
  setLibrary(library: CommandLibrary): void
  addTab(tab: Tab): void
  updateTab(id: string, patch: Partial<Tab>): void
  removeTab(id: string): void
  setActive(id: string | null): void
  moveTab(from: number, to: number): void
  pushMonitor(id: string, snapshot: MonitorSnapshot): void
  upsertTransfer(info: TransferInfo): void
  clearFinishedTransfers(tabId: string): void
  pushPrompt(req: PromptRequest): void
  popPrompt(id: string): void
  setSftpPath(tabId: string, path: string): void
  setTerminalCwd(tabId: string, dir: string): void
  openDialog(dialog: Dialog | null): void
  setEditor(doc: EditorDoc | null): void
  bumpSftp(): void
  setPalette(open: boolean): void
  setMonitorOpen(open: boolean): void
  setMonitorView(view: MonitorTab | null): void
  setMonitorUser(key: string, user: string | null): void
  setDiskOwners(key: string, mount: string, state: DiskOwnersState): void
  setFindOpen(open: boolean): void
  setBroadcast(on: boolean): void
  patchHttpPanel(tabId: string, patch: Partial<HttpPanelState>): void
  setHttpWorkspace(workspace: HttpWorkspace): void
  setUpdate(update: UpdateStatus): void
  toast(toast: Omit<Toast, 'id'>): void
  dismissToast(id: string): void
}

export const useApp = create<AppState>((set) => ({
  ready: false,
  settings: DEFAULT_SETTINGS,
  sessions: [],
  library: { path: '', commands: [] },
  tabs: [],
  activeId: null,
  monitors: {},
  transfers: [],
  prompts: [],
  sftpPaths: {},
  terminalCwds: {},
  dialog: null,
  editor: null,
  sftpRevision: 0,
  paletteOpen: false,
  monitorOpen: false,
  monitorView: null,
  monitorUsers: {},
  diskOwners: {},
  findOpen: false,
  broadcast: false,
  toasts: [],
  httpPanels: {},
  httpWorkspace: emptyWorkspace(),
  update: { state: 'idle' },

  init: (settings, sessions) => set({ settings, sessions, ready: true }),
  setSettings: (settings) => set({ settings }),
  setSessions: (sessions) => set({ sessions }),
  setLibrary: (library) => set({ library }),
  addTab: (tab) => set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id })),
  updateTab: (id, patch) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
  removeTab: (id) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id)
      const tabs = s.tabs.filter((t) => t.id !== id)
      const activeId = s.activeId === id ? (tabs[Math.min(idx, tabs.length - 1)]?.id ?? null) : s.activeId
      const { [id]: _m, ...monitors } = s.monitors
      const { [id]: _p, ...sftpPaths } = s.sftpPaths
      const { [id]: _h, ...httpPanels } = s.httpPanels
      const { [id]: _c, ...terminalCwds } = s.terminalCwds
      const { [id]: _u, ...monitorUsers } = s.monitorUsers
      const { [id]: _o, ...diskOwners } = s.diskOwners
      return {
        tabs,
        activeId,
        monitors,
        monitorUsers,
        diskOwners,
        sftpPaths,
        httpPanels,
        terminalCwds,
        transfers: s.transfers.filter((t) => t.tabId !== id || t.state === 'running')
      }
    }),
  setActive: (activeId) => set({ activeId, findOpen: false }),
  moveTab: (from, to) =>
    set((s) => {
      const tabs = [...s.tabs]
      const [moved] = tabs.splice(from, 1)
      tabs.splice(to, 0, moved)
      return { tabs }
    }),
  pushMonitor: (id, snapshot) =>
    set((s) => {
      const prev = s.monitors[id]
      const memPct = snapshot.memTotal > 0 ? (snapshot.memUsed / snapshot.memTotal) * 100 : 0
      const gpu = gpuTotals(snapshot.gpus)
      return {
        monitors: {
          ...s.monitors,
          [id]: {
            latest: snapshot,
            cpu: pushHistory(prev?.cpu, snapshot.cpu),
            mem: pushHistory(prev?.mem, memPct),
            vram: gpu ? pushHistory(prev?.vram, gpu.pct) : [],
            rx: pushHistory(prev?.rx, snapshot.netRx),
            tx: pushHistory(prev?.tx, snapshot.netTx),
            diskRead: pushHistory(prev?.diskRead, snapshot.diskRead),
            diskWrite: pushHistory(prev?.diskWrite, snapshot.diskWrite)
          }
        }
      }
    }),
  upsertTransfer: (info) =>
    set((s) => {
      const exists = s.transfers.some((t) => t.id === info.id)
      return { transfers: exists ? s.transfers.map((t) => (t.id === info.id ? info : t)) : [...s.transfers, info] }
    }),
  clearFinishedTransfers: (tabId) =>
    set((s) => ({ transfers: s.transfers.filter((t) => t.tabId !== tabId || t.state === 'running' || t.state === 'queued') })),
  pushPrompt: (req) => set((s) => ({ prompts: [...s.prompts, req] })),
  popPrompt: (id) => set((s) => ({ prompts: s.prompts.filter((p) => p.id !== id) })),
  setSftpPath: (tabId, path) => set((s) => ({ sftpPaths: { ...s.sftpPaths, [tabId]: path } })),
  setTerminalCwd: (tabId, dir) =>
    set((s) => (s.tabs.some((t) => t.id === tabId) ? { terminalCwds: { ...s.terminalCwds, [tabId]: dir } } : s)),
  openDialog: (dialog) => set({ dialog }),
  setEditor: (editor) => set({ editor }),
  bumpSftp: () => set((s) => ({ sftpRevision: s.sftpRevision + 1 })),
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setMonitorOpen: (monitorOpen) => set(monitorOpen ? { monitorOpen } : { monitorOpen, monitorView: null }),
  setMonitorView: (monitorView) => set({ monitorView }),
  setMonitorUser: (key, user) =>
    set((s) => {
      const { [key]: _old, ...rest } = s.monitorUsers
      return { monitorUsers: user ? { ...rest, [key]: user } : rest }
    }),
  setDiskOwners: (key, mount, state) =>
    set((s) => ({ diskOwners: { ...s.diskOwners, [key]: { ...s.diskOwners[key], [mount]: state } } })),
  setFindOpen: (findOpen) => set({ findOpen }),
  setBroadcast: (broadcast) => set({ broadcast }),
  // A request that finishes after its tab was closed must not bring the panel state back.
  patchHttpPanel: (tabId, patch) =>
    set((s) =>
      s.tabs.some((t) => t.id === tabId)
        ? { httpPanels: { ...s.httpPanels, [tabId]: { ...(s.httpPanels[tabId] ?? EMPTY_HTTP_PANEL), ...patch } } }
        : s
    ),
  setHttpWorkspace: (httpWorkspace) => set({ httpWorkspace }),
  setUpdate: (update) => set({ update }),
  toast: (toast) => {
    const id = crypto.randomUUID()
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...toast, id }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), toast.action ? 7000 : 4000)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))
