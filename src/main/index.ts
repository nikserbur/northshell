import { join } from 'node:path'
import { app, BrowserWindow, nativeTheme, safeStorage, session, shell } from 'electron'
import { APP_NAME } from '@shared/brand'
import { IPC } from '@shared/ipc'
import { LOCAL_MONITOR_ID } from '@shared/types'
import { registerIpc } from './ipc'
import { buildMenu } from './menu'
import { LocalMonitor } from './monitor/localMonitor'
import { PromptBroker } from './prompts'
import { SftpService } from './sftp/sftpService'
import { KnownHostsStore } from './store/knownHosts'
import { SessionStore } from './store/sessionStore'
import { SettingsStore } from './store/settingsStore'
import { TerminalService } from './terminals'

app.setName(APP_NAME)

let mainWindow: BrowserWindow | null = null
const getWindow = (): BrowserWindow | null => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null)
const send = (channel: string, ...args: unknown[]): void => {
  const win = getWindow()
  if (win && !win.webContents.isDestroyed()) win.webContents.send(channel, ...args)
}

function createWindow(settings: SettingsStore): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    show: false,
    title: APP_NAME,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })
  nativeTheme.themeSource = settings.get().uiTheme
  win.once('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

const ALLOWED_PERMISSIONS = new Set(['clipboard-read', 'clipboard-sanitized-write'])

void app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(ALLOWED_PERMISSIONS.has(permission))
  )
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission))
  const dataDir = app.getPath('userData')
  const settings = new SettingsStore(join(dataDir, 'settings.json'))
  const sessions = new SessionStore(join(dataDir, 'sessions.json'), {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
    decrypt: (cipher) => safeStorage.decryptString(Buffer.from(cipher, 'base64'))
  })
  const knownHosts = new KnownHostsStore(join(dataDir, 'known_hosts.json'))
  const prompts = new PromptBroker(() => getWindow()?.webContents ?? null)

  let sftp: SftpService | null = null
  const terminals = new TerminalService({
    sessions,
    knownHosts,
    prompts,
    settings: () => settings.get(),
    sendData: (tabId, data) => send(IPC.termData, tabId, data),
    sendStatus: (event) => send(IPC.termStatus, event),
    sendMonitor: (tabId, snapshot) => send(IPC.monitorSnapshot, { id: tabId, snapshot }),
    onSshClosed: (tabId) => sftp?.dispose(tabId)
  })
  sftp = new SftpService(
    (tabId) => terminals.clientFor(tabId),
    (info) => send(IPC.sftpTransfer, info)
  )

  let localMonitor: LocalMonitor | null = null
  const setLocalMonitor = (on: boolean): void => {
    localMonitor?.stop()
    localMonitor = null
    if (on && settings.get().monitorEnabled) {
      localMonitor = new LocalMonitor(
        () => settings.get().monitorInterval,
        (snapshot) => send(IPC.monitorSnapshot, { id: LOCAL_MONITOR_ID, snapshot })
      )
      localMonitor.start()
    }
  }

  registerIpc({
    window: getWindow,
    sessions,
    settings,
    terminals,
    sftp,
    prompts,
    setLocalMonitor,
    onSettingsChanged: () => {
      nativeTheme.themeSource = settings.get().uiTheme
      if (localMonitor) setLocalMonitor(true)
    }
  })
  buildMenu(getWindow)

  const openMainWindow = (): void => {
    mainWindow = createWindow(settings)
    mainWindow.on('closed', () => {
      prompts.cancelAll()
      terminals.closeAll()
      setLocalMonitor(false)
      mainWindow = null
    })
  }
  openMainWindow()
  app.on('activate', () => {
    if (!getWindow()) openMainWindow()
  })
  app.on('before-quit', () => terminals.closeAll())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
