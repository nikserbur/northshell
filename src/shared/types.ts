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
  /** SFTP panel follows `cd` in the terminal of the same connection. */
  sftpFollowTerminal: boolean
  /** ⌘A in the terminal selects the typed command first (⌫ deletes it, typing replaces it). */
  selectAllPicksCommand: boolean
  sftpPanelOpen: boolean
  sidebarOpen: boolean
  commandsPanelOpen: boolean
  /** Request panel next to the terminal of an HTTP environment. */
  httpPanelOpen: boolean
  /** The request panel covers the terminal, as a full workspace. */
  httpPanelExpanded: boolean
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

export interface GpuUsage {
  name: string
  /** Bytes of video memory; for shared-memory GPUs (Apple Silicon) the estimated share of RAM the GPU may use. */
  memTotal: number
  memUsed: number
  /** Busy percentage, when the driver reports it. */
  util: number | null
  /** Unified memory shared with the CPU: `memTotal` is an estimate and `memUsed` is also counted in RAM. */
  shared: boolean
}

/** Throughput of one block device. Rates are in bytes per second. */
export interface DiskIoDevice {
  name: string
  read: number
  write: number
  /** Share of time the device was busy, %; null where the OS does not report it (macOS). */
  util: number | null
}

/** One row of the full process table. Rates are in bytes per second. */
export interface ProcessRow {
  pid: number
  ppid: number
  user: string
  /** Percent of one core, like htop: a process busy on two cores shows 200. */
  cpu: number
  /** Percent of RAM. */
  mem: number
  /** Resident memory, bytes. */
  rss: number
  /** Virtual memory, bytes. */
  vsz: number
  /** Null where `ps` cannot tell (macOS). */
  threads: number | null
  nice: number
  state: string
  /** Seconds since the process started. */
  elapsed: number
  name: string
  command: string
  diskRead: number
  diskWrite: number
  netRx: number
  netTx: number
}

/** What one user costs the host right now. */
export interface UserUsage {
  user: string
  procs: number
  /** Percent of all cores together, so the users add up to the host's CPU figure. */
  cpu: number
  /** Resident memory of the user's processes, bytes (shared pages count once per process). */
  mem: number
  memPct: number
  diskRead: number
  diskWrite: number
  netRx: number
  netTx: number
}

/** Sent only while someone is looking at the monitor panel: it costs more to collect. */
export interface MonitorDetail {
  processes: ProcessRow[]
  users: UserUsage[]
  /** `all` needs root on Linux; `own` means only the login user's processes could be read; macOS has no such counters. */
  diskIo: 'all' | 'own' | 'none'
  net: 'all' | 'none'
}

/** Result of walking one file system to see who owns what. */
export interface DiskOwners {
  mount: string
  at: number
  users: { user: string; bytes: number }[]
  /** Not root: folders the login user cannot read were not counted. */
  partial: boolean
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
  /** Video memory per GPU; empty when the host has no GPU the monitor can read. */
  gpus: GpuUsage[]
  disks: DiskUsage[]
  netRx: number
  netTx: number
  /** Disk throughput of the whole host, bytes per second. */
  diskRead: number
  diskWrite: number
  diskDevices: DiskIoDevice[]
  uptime: number
  users: number
  userNames: string[]
  processes: ProcessInfo[]
  detail?: MonitorDetail
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
  | 'toggle-http'
  | 'new-http'
  | 'find'
  | 'clear'
  | 'next-tab'
  | 'prev-tab'
  | `tab-${number}`
