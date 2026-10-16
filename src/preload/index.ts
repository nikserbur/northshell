import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  AppSettings,
  CommandLibrary,
  CommandSnippetInput,
  MenuAction,
  MonitorEvent,
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
    onStatus: (cb: (event: TabStatusEvent) => void): (() => void) => listen(IPC.termStatus, cb)
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
  monitor: {
    setLocal: (on: boolean): Promise<void> => ipcRenderer.invoke(IPC.monitorLocal, on),
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
