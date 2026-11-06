import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { HttpRequestSpec, HttpResponseInfo } from '@shared/httpRequest'
import type { CookieEntry, HttpHistoryItem, HttpWorkspace, SavedRequestInput } from '@shared/httpWorkspace'
import { IPC } from '@shared/ipc'
import type {
  AppSettings,
  CommandLibrary,
  CommandSnippetInput,
  MenuAction,
  DiskOwners,
  MonitorEvent,
  UpdateStatus,
  OpenTarget,
  PromptRequest,
  PromptResponse,
  RemoteFile,
  SearchResult,
  SessionConfig,
  SessionInput,
  SftpEntry,
  TabStatusEvent,
  TransferInfo
} from '@shared/types'

function listen<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, ...args: unknown[]): void => cb(...(args as T))
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api = {
  sessions: {
    list: (): Promise<SessionConfig[]> => ipcRenderer.invoke(IPC.sessionsList),
    save: (input: SessionInput): Promise<SessionConfig> => ipcRenderer.invoke(IPC.sessionsSave, input),
    remove: (id: string): Promise<void> => ipcRenderer.invoke(IPC.sessionsRemove, id),
    duplicate: (id: string): Promise<SessionConfig | undefined> => ipcRenderer.invoke(IPC.sessionsDuplicate, id),
    importSshConfig: (): Promise<number> => ipcRenderer.invoke(IPC.sessionsImport)
  },
  commands: {
    list: (): Promise<CommandLibrary> => ipcRenderer.invoke(IPC.commandsList),
    save: (input: CommandSnippetInput): Promise<CommandLibrary> => ipcRenderer.invoke(IPC.commandsSave, input),
    remove: (id: string): Promise<CommandLibrary> => ipcRenderer.invoke(IPC.commandsRemove, id),
    importFile: (): Promise<{ added: number; library: CommandLibrary } | null> => ipcRenderer.invoke(IPC.commandsImport),
    exportFile: (): Promise<string | null> => ipcRenderer.invoke(IPC.commandsExport),
    openFile: (): Promise<void> => ipcRenderer.invoke(IPC.commandsOpenFile),
    onChanged: (cb: (library: CommandLibrary) => void): (() => void) => listen(IPC.commandsChanged, cb)
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke(IPC.settingsSet, patch)
  },
  term: {
    open: (tabId: string, target: OpenTarget, cols: number, rows: number): Promise<void> =>
      ipcRenderer.invoke(IPC.termOpen, tabId, target, cols, rows),
    write: (tabId: string, data: string): void => ipcRenderer.send(IPC.termWrite, tabId, data),
    resize: (tabId: string, cols: number, rows: number): void => ipcRenderer.send(IPC.termResize, tabId, cols, rows),
    close: (tabId: string): Promise<void> => ipcRenderer.invoke(IPC.termClose, tabId),
    onData: (cb: (tabId: string, data: Uint8Array) => void): (() => void) => listen(IPC.termData, cb),
    onStatus: (cb: (event: TabStatusEvent) => void): (() => void) => listen(IPC.termStatus, cb),
    onCwd: (cb: (tabId: string, dir: string) => void): (() => void) => listen(IPC.termCwd, cb)
  },
  sftp: {
    home: (tabId: string): Promise<string> => ipcRenderer.invoke(IPC.sftpHome, tabId),
    list: (tabId: string, path: string): Promise<SftpEntry[]> => ipcRenderer.invoke(IPC.sftpList, tabId, path),
    mkdir: (tabId: string, path: string): Promise<void> => ipcRenderer.invoke(IPC.sftpMkdir, tabId, path),
    rename: (tabId: string, from: string, to: string): Promise<void> => ipcRenderer.invoke(IPC.sftpRename, tabId, from, to),
    remove: (tabId: string, path: string): Promise<void> => ipcRenderer.invoke(IPC.sftpRemove, tabId, path),
    upload: (tabId: string, dir: string, localPaths: string[]): Promise<void> =>
      ipcRenderer.invoke(IPC.sftpUpload, tabId, dir, localPaths),
    uploadDialog: (tabId: string, dir: string): Promise<void> => ipcRenderer.invoke(IPC.sftpUploadDialog, tabId, dir),
    download: (tabId: string, paths: string[], ask: boolean): Promise<string | null> =>
      ipcRenderer.invoke(IPC.sftpDownload, tabId, paths, ask),
    readFile: (tabId: string, path: string): Promise<RemoteFile> => ipcRenderer.invoke(IPC.sftpReadFile, tabId, path),
    writeFile: (
      tabId: string,
      path: string,
      content: string,
      encoding: RemoteFile['encoding'],
      expectedMtime: number | null
    ): Promise<number> => ipcRenderer.invoke(IPC.sftpWriteFile, tabId, path, content, encoding, expectedMtime),
    createFile: (tabId: string, path: string): Promise<void> => ipcRenderer.invoke(IPC.sftpCreateFile, tabId, path),
    chmod: (tabId: string, path: string, mode: number): Promise<void> => ipcRenderer.invoke(IPC.sftpChmod, tabId, path, mode),
    search: (tabId: string, dir: string, query: string): Promise<SearchResult> =>
      ipcRenderer.invoke(IPC.sftpSearch, tabId, dir, query),
    onTransfer: (cb: (info: TransferInfo) => void): (() => void) => listen(IPC.sftpTransfer, cb)
  },
  http: {
    send: (tabId: string, spec: HttpRequestSpec): Promise<HttpResponseInfo> => ipcRenderer.invoke(IPC.httpSend, tabId, spec),
    cancel: (tabId: string): Promise<void> => ipcRenderer.invoke(IPC.httpCancel, tabId),
    workspace: (): Promise<HttpWorkspace> => ipcRenderer.invoke(IPC.httpWorkspace),
    saveRequest: (input: SavedRequestInput): Promise<{ workspace: HttpWorkspace; id: string }> => ipcRenderer.invoke(IPC.httpSaveRequest, input),
    removeRequest: (id: string): Promise<HttpWorkspace> => ipcRenderer.invoke(IPC.httpRemoveRequest, id),
    setVars: (sessionId: string, vars: Record<string, string>): Promise<HttpWorkspace> => ipcRenderer.invoke(IPC.httpSetVars, sessionId, vars),
    addHistory: (sessionId: string, item: HttpHistoryItem): Promise<HttpWorkspace> => ipcRenderer.invoke(IPC.httpAddHistory, sessionId, item),
    clearHistory: (sessionId: string): Promise<HttpWorkspace> => ipcRenderer.invoke(IPC.httpClearHistory, sessionId),
    importCollection: (sessionId: string): Promise<{ workspace: HttpWorkspace; count: number } | null> => ipcRenderer.invoke(IPC.httpImport, sessionId),
    exportCollection: (sessionId: string, name: string): Promise<string | null> => ipcRenderer.invoke(IPC.httpExport, sessionId, name),
    pickFile: (): Promise<string | null> => ipcRenderer.invoke(IPC.httpPickFile),
    saveResponse: (tabId: string, suggestedName: string): Promise<string | null> => ipcRenderer.invoke(IPC.httpSaveResponse, tabId, suggestedName),
    cookies: (sessionId: string): Promise<CookieEntry[]> => ipcRenderer.invoke(IPC.httpCookies, sessionId),
    removeCookies: (sessionId: string, cookie?: { domain: string; path: string; name: string }): Promise<CookieEntry[]> =>
      ipcRenderer.invoke(IPC.httpRemoveCookies, sessionId, cookie)
  },
  update: {
    get: (): Promise<UpdateStatus> => ipcRenderer.invoke(IPC.updateGet),
    install: (): Promise<void> => ipcRenderer.invoke(IPC.updateInstall),
    onStatus: (cb: (status: UpdateStatus) => void): (() => void) => listen(IPC.updateStatus, cb)
  },
  monitor: {
    setLocal: (on: boolean): Promise<void> => ipcRenderer.invoke(IPC.monitorLocal, on),
    setDetail: (id: string, on: boolean): Promise<void> => ipcRenderer.invoke(IPC.monitorDetail, id, on),
    diskOwners: (tabId: string, mount: string): Promise<DiskOwners> => ipcRenderer.invoke(IPC.monitorDiskOwners, tabId, mount),
    onSnapshot: (cb: (event: MonitorEvent) => void): (() => void) => listen(IPC.monitorSnapshot, cb)
  },
  prompts: {
    onRequest: (cb: (req: PromptRequest) => void): (() => void) => listen(IPC.promptRequest, cb),
    onCancel: (cb: (id: string) => void): (() => void) => listen(IPC.promptCancel, cb),
    respond: (res: PromptResponse): Promise<void> => ipcRenderer.invoke(IPC.promptRespond, res)
  },
  app: {
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.appOpenExternal, url),
    showInFolder: (path: string): Promise<void> => ipcRenderer.invoke(IPC.appShowInFolder, path),
    pickFile: (title?: string): Promise<string | null> => ipcRenderer.invoke(IPC.appPickFile, title),
    pickDir: (): Promise<string | null> => ipcRenderer.invoke(IPC.appPickDir),
    info: (): Promise<{ version: string; downloads: string; home: string; shell: string }> =>
      ipcRenderer.invoke(IPC.appInfo),
    onMenu: (cb: (action: MenuAction) => void): (() => void) => listen(IPC.menuAction, cb),
    pathForFile: (file: File): string => webUtils.getPathForFile(file)
  }
}

export type XmtApi = typeof api

contextBridge.exposeInMainWorld('xmt', api)
