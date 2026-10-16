import { create } from 'zustand'
import { DEFAULT_SETTINGS } from '@shared/defaults'
import type {
  AppSettings,
  CommandLibrary,
  CommandSnippet,
  MonitorSnapshot,
  OpenTarget,
  PromptRequest,
  RemoteFile,
  SessionConfig,
  TabStatus,
  TransferInfo
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
  rx: number[]
  tx: number[]
}

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
  | { kind: 'command-editor'; snippet?: CommandSnippet; sessionId?: string }
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
  dialog: Dialog | null
  editor: EditorDoc | null
  sftpRevision: number
  paletteOpen: boolean
  monitorOpen: boolean
  findOpen: boolean
  broadcast: boolean
  toasts: Toast[]

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
  openDialog(dialog: Dialog | null): void
  setEditor(doc: EditorDoc | null): void
  bumpSftp(): void
  setPalette(open: boolean): void
  setMonitorOpen(open: boolean): void
  setFindOpen(open: boolean): void
  setBroadcast(on: boolean): void
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
  dialog: null,
  editor: null,
  sftpRevision: 0,
  paletteOpen: false,
  monitorOpen: false,
  findOpen: false,
  broadcast: false,
  toasts: [],

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
      return {
        tabs,
        activeId,
        monitors,
        sftpPaths,
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
      return {
        monitors: {
          ...s.monitors,
          [id]: {
            latest: snapshot,
            cpu: pushHistory(prev?.cpu, snapshot.cpu),
            mem: pushHistory(prev?.mem, memPct),
            rx: pushHistory(prev?.rx, snapshot.netRx),
            tx: pushHistory(prev?.tx, snapshot.netTx)
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
  openDialog: (dialog) => set({ dialog }),
  setEditor: (editor) => set({ editor }),
  bumpSftp: () => set((s) => ({ sftpRevision: s.sftpRevision + 1 })),
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setMonitorOpen: (monitorOpen) => set({ monitorOpen }),
  setFindOpen: (findOpen) => set({ findOpen }),
  setBroadcast: (broadcast) => set({ broadcast }),
  toast: (toast) => {
    const id = crypto.randomUUID()
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...toast, id }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), toast.action ? 7000 : 4000)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))
