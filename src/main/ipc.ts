import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, dialog, ipcMain, shell, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc'
import type { PromptResponse } from '@shared/types'
import type { PromptBroker } from './prompts'
import type { SftpService } from './sftp/sftpService'
import { parseSshConfig } from './ssh/sshConfig'
import type { SessionStore } from './store/sessionStore'
import type { SettingsStore } from './store/settingsStore'
import type { TerminalService } from './terminals'

interface IpcDeps {
  window: () => BrowserWindow | null
  sessions: SessionStore
  settings: SettingsStore
  terminals: TerminalService
  sftp: SftpService
  prompts: PromptBroker
  setLocalMonitor: (on: boolean) => void
  onSettingsChanged: () => void
}

const id = z.string().min(1).max(128)
const remotePath = z.string().min(1).max(4096)
const absolutePath = remotePath.refine((p) => p.startsWith('/'), 'Path must be absolute')
const quickTarget = z.object({
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  username: z.string().min(1).max(64)
})
const openTarget = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('local') }),
  z.object({ kind: z.literal('session'), sessionId: id }),
  z.object({ kind: z.literal('quick'), target: quickTarget })
])
const promptResponse = z.object({
  id,
  accepted: z.boolean(),
  values: z.array(z.string().max(4096)).max(16).optional(),
  remember: z.boolean().optional()
})

function downloadDir(deps: IpcDeps): string {
  return deps.settings.get().downloadDir || app.getPath('downloads')
}

export function registerIpc(deps: IpcDeps): void {
  const trusted = (e: IpcMainEvent | IpcMainInvokeEvent): boolean => e.sender === deps.window()?.webContents
  const handle = (channel: string, fn: (...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, (e, ...args) => {
      if (!trusted(e)) throw new Error('Untrusted sender')
      return fn(...args)
    })
  }

  handle(IPC.sessionsList, () => deps.sessions.list())
  handle(IPC.sessionsSave, (input) => deps.sessions.save(input))
  handle(IPC.sessionsRemove, (sid) => deps.sessions.remove(id.parse(sid)))
  handle(IPC.sessionsDuplicate, (sid) => deps.sessions.duplicate(id.parse(sid)))
  handle(IPC.sessionsImport, async () => {
    const path = join(homedir(), '.ssh', 'config')
    const text = await readFile(path, 'utf8').catch(() => '')
    return deps.sessions.importHosts(parseSshConfig(text, homedir()), deps.settings.get().defaultUsername)
  })

  handle(IPC.settingsGet, () => deps.settings.get())
  handle(IPC.settingsSet, (patch) => {
    const next = deps.settings.set(patch)
    deps.onSettingsChanged()
    return next
  })

  handle(IPC.termOpen, (tabId, target, cols, rows) =>
    deps.terminals.open(id.parse(tabId), openTarget.parse(target), Number(cols), Number(rows))
  )
  ipcMain.on(IPC.termWrite, (e, tabId: unknown, data: unknown) => {
    if (trusted(e) && typeof tabId === 'string' && typeof data === 'string') deps.terminals.write(tabId, data)
  })
  ipcMain.on(IPC.termResize, (e, tabId: unknown, cols: unknown, rows: unknown) => {
    if (trusted(e) && typeof tabId === 'string') deps.terminals.resize(tabId, Number(cols), Number(rows))
  })
  handle(IPC.termClose, (tabId) => {
    const t = id.parse(tabId)
    deps.sftp.dispose(t)
    deps.terminals.close(t)
  })

  handle(IPC.sftpHome, (tabId) => deps.sftp.home(id.parse(tabId)))
  handle(IPC.sftpList, (tabId, path) => deps.sftp.list(id.parse(tabId), remotePath.parse(path)))
  handle(IPC.sftpMkdir, (tabId, path) => deps.sftp.mkdir(id.parse(tabId), remotePath.parse(path)))
  handle(IPC.sftpRename, (tabId, from, to) =>
    deps.sftp.rename(id.parse(tabId), remotePath.parse(from), remotePath.parse(to))
  )
  handle(IPC.sftpRemove, (tabId, path) => deps.sftp.remove(id.parse(tabId), remotePath.parse(path)))
  handle(IPC.sftpUpload, (tabId, dir, paths) =>
    deps.sftp.upload(id.parse(tabId), remotePath.parse(dir), z.array(z.string().min(1).max(4096)).max(1000).parse(paths))
  )
  handle(IPC.sftpUploadDialog, async (tabId, dir) => {
    const win = deps.window()
    if (!win) return
    const res = await dialog.showOpenDialog(win, { properties: ['openFile', 'openDirectory', 'multiSelections'] })
    if (!res.canceled && res.filePaths.length > 0) await deps.sftp.upload(id.parse(tabId), remotePath.parse(dir), res.filePaths)
  })
  handle(IPC.sftpReadFile, (tabId, path) => deps.sftp.readFile(id.parse(tabId), remotePath.parse(path)))
  handle(IPC.sftpWriteFile, (tabId, path, content, encoding, expectedMtime) =>
    deps.sftp.writeFile(
      id.parse(tabId),
      remotePath.parse(path),
      z.string().max(12 * 1024 * 1024).parse(content),
      z.enum(['utf8', 'latin1']).parse(encoding),
      z.number().nullable().parse(expectedMtime)
    )
  )
  handle(IPC.sftpCreateFile, (tabId, path) => deps.sftp.createFile(id.parse(tabId), remotePath.parse(path)))
  handle(IPC.sftpChmod, (tabId, path, mode) =>
    deps.sftp.chmod(id.parse(tabId), remotePath.parse(path), z.number().int().min(0).max(0o7777).parse(mode))
  )
  handle(IPC.sftpSearch, (tabId, dir, query) =>
    deps.sftp.search(id.parse(tabId), absolutePath.parse(dir), z.string().min(1).max(200).parse(query))
  )
  handle(IPC.sftpDownload, async (tabId, paths, ask) => {
    let target = downloadDir(deps)
    const win = deps.window()
    if (ask === true && win) {
      const res = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: target })
      if (res.canceled || res.filePaths.length === 0) return null
      target = res.filePaths[0]
    }
    await deps.sftp.download(id.parse(tabId), z.array(remotePath).max(1000).parse(paths), target)
    return target
  })

  handle(IPC.monitorLocal, (on) => deps.setLocalMonitor(on === true))
  handle(IPC.promptRespond, (res) => deps.prompts.respond(promptResponse.parse(res) as PromptResponse))

  handle(IPC.appOpenExternal, (url) => {
    const parsed = new URL(z.string().max(4096).parse(url))
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') void shell.openExternal(parsed.toString())
  })
  handle(IPC.appShowInFolder, (path) => shell.showItemInFolder(z.string().max(4096).parse(path)))
  handle(IPC.appPickFile, async (title) => {
    const win = deps.window()
    if (!win) return null
    const res = await dialog.showOpenDialog(win, {
      title: typeof title === 'string' ? title : undefined,
      defaultPath: join(homedir(), '.ssh'),
      properties: ['openFile', 'showHiddenFiles']
    })
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })
  handle(IPC.appPickDir, async () => {
    const win = deps.window()
    if (!win) return null
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })
  handle(IPC.appInfo, () => ({
    version: app.getVersion(),
    downloads: downloadDir(deps),
    home: homedir(),
    shell: process.env.SHELL ?? '/bin/zsh'
  }))
}
