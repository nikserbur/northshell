export type AuthMethod = 'password' | 'key' | 'agent'

/** `ssh` — a real SSH connection; `http` — a local shell prepared for curl requests to one server. */
export type SessionKind = 'ssh' | 'http'

/** Saved connection as seen by the renderer. Secrets never leave the main process. */
export interface SessionConfig {
  id: string
  kind: SessionKind
  name: string
  folder: string
  host: string
  port: number
  username: string
  auth: AuthMethod
  keyPath: string
  color: string
  startupCommand: string
  monitoring: boolean
  sftp: boolean
  /** HTTP environments: exported to the shell as $BASE_URL. */
  baseUrl: string
  /** HTTP environments: curl headers, one `Name: value` per line ($TOKEN is expanded). */
  headers: string
  /** HTTP environments: skip TLS certificate checks (curl --insecure). */
  insecure: boolean
  hasSecret: boolean
  createdAt: number
  lastUsedAt: number
  useCount: number
}

export interface SessionInput {
  id?: string
  kind: SessionKind
  name: string
  folder: string
  host: string
  port: number
  username: string
  auth: AuthMethod
  keyPath: string
  color: string
  startupCommand: string
  monitoring: boolean
  sftp: boolean
  baseUrl: string
  headers: string
  insecure: boolean
  /** New password / key passphrase / HTTP token. Undefined or empty = keep the stored one. */
  secret?: string
  clearSecret?: boolean
}

export type UiTheme = 'dark' | 'light' | 'system' | 'vs' | 'retro' | 'moba'
export type CursorStyle = 'block' | 'bar' | 'underline'
export type Language = 'ru' | 'en'

export interface AppSettings {
  language: Language
  uiTheme: UiTheme
  accent: string
  terminalTheme: string
  fontFamily: string
  fontSize: number
  lineHeight: number
  cursorStyle: CursorStyle
  cursorBlink: boolean
  scrollback: number
  copyOnSelect: boolean
  rightClickPaste: boolean
  /** MobaXterm-style info box printed when an SSH session connects. */
  terminalBanner: boolean
  /** MobaXterm-style colouring of IPs, URLs and keywords in terminal output. */
  outputHighlight: boolean
  localShell: string
  keepaliveInterval: number
  connectTimeout: number
  defaultUsername: string
  monitorEnabled: boolean
  monitorInterval: number
  downloadDir: string
  showHiddenFiles: boolean
  confirmDelete: boolean
  sftpPanelOpen: boolean
  sidebarOpen: boolean
  commandsPanelOpen: boolean
}

export interface QuickTarget {
  host: string
  port: number
  username: string
}

export type OpenTarget =
  | { kind: 'local' }
  | { kind: 'session'; sessionId: string }
  | { kind: 'quick'; target: QuickTarget }

export type TabStatus = 'connecting' | 'connected' | 'closed' | 'error'

export interface TabStatusEvent {
  tabId: string
  status: TabStatus
  message?: string
  /** Human readable remote endpoint, e.g. root@10.0.0.1:22 */
  endpoint?: string
  /** HTTP environments: a token is saved but could not be read from the Keychain. */
  tokenUnreadable?: boolean
}

export interface DiskUsage {
  mount: string
  fs: string
  total: number
  used: number
}

export interface ProcessInfo {
  pid: number
  name: string
  cpu: number
  mem: number
}

export interface MonitorSnapshot {
  ts: number
  hostname: string
  os: string
  cpu: number
  cores: number
  load: [number, number, number]
  memTotal: number
  memUsed: number
  swapTotal: number
  swapUsed: number
  disks: DiskUsage[]
  netRx: number
  netTx: number
  uptime: number
  users: number
  userNames: string[]
  processes: ProcessInfo[]
}

export const LOCAL_MONITOR_ID = '__local__'

export interface MonitorEvent {
  id: string
  snapshot: MonitorSnapshot
}

export interface SftpEntry {
  name: string
  path: string
  isDir: boolean
  isLink: boolean
  size: number
  mtime: number
  mode: string
}

export interface RemoteFile {
  path: string
  content: string
  encoding: 'utf8' | 'latin1'
  mtime: number
  size: number
}

export interface SearchHit {
  path: string
  name: string
  isDir: boolean
}

export interface SearchResult {
  hits: SearchHit[]
  /** True when the search hit the result limit or time budget. */
  truncated: boolean
}

export type TransferDirection = 'upload' | 'download'
export type TransferState = 'queued' | 'running' | 'done' | 'error'

export interface TransferInfo {
  id: string
  tabId: string
  direction: TransferDirection
  name: string
  localPath: string
  remotePath: string
  total: number
  transferred: number
  state: TransferState
  error?: string
  startedAt: number
  finishedAt?: number
}

/** A saved command. Without `sessionId` / `sessionName` it is shared by every connection. */
export interface CommandSnippet {
  id: string
  name: string
  command: string
  sessionId?: string
  /** Connection name as written in the library file; used when the id is unknown (hand edits, imports). */
  sessionName?: string
}

export interface CommandSnippetInput {
  id?: string
  name: string
  command: string
  sessionId?: string
  sessionName?: string
}

export interface CommandLibrary {
  path: string
  commands: CommandSnippet[]
  /** Set while the library file cannot be parsed; edits are refused until it is fixed. */
  error?: string
}

export type PromptRequest =
  | { id: string; kind: 'hostkey-new'; host: string; port: number; keyType: string; fingerprint: string }
  | {
      id: string
      kind: 'hostkey-changed'
      host: string
      port: number
      keyType: string
      fingerprint: string
      previous: string
    }
  | {
      id: string
      kind: 'secret'
      purpose: 'password' | 'passphrase'
      target: string
      canRemember: boolean
      retry: boolean
    }
  | {
      id: string
      kind: 'keyboard-interactive'
      title: string
      instructions: string
      prompts: { prompt: string; echo: boolean }[]
    }

export interface PromptResponse {
  id: string
  accepted: boolean
  values?: string[]
  remember?: boolean
}

export type MenuAction =
  | 'new-local'
  | 'new-session'
  | 'close-tab'
  | 'settings'
  | 'palette'
  | 'toggle-sftp'
  | 'toggle-sidebar'
  | 'toggle-monitor'
  | 'toggle-commands'
  | 'new-http'
  | 'find'
  | 'clear'
  | 'next-tab'
  | 'prev-tab'
  | `tab-${number}`
