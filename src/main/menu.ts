import { app, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { IPC } from '@shared/ipc'
import type { MenuAction } from '@shared/types'

export function buildMenu(getWindow: () => BrowserWindow | null): void {
  const send = (action: MenuAction) => (): void => {
    getWindow()?.webContents.send(IPC.menuAction, action)
  }
  const tabItems: MenuItemConstructorOptions[] = Array.from({ length: 9 }, (_, i) => ({
    label: `Tab ${i + 1}`,
    accelerator: `CmdOrCtrl+${i + 1}`,
    click: send(`tab-${i + 1}`)
  }))

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: send('settings') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Shell',
      submenu: [
        { label: 'New Local Terminal', accelerator: 'CmdOrCtrl+T', click: send('new-local') },
        { label: 'New SSH Session…', accelerator: 'CmdOrCtrl+N', click: send('new-session') },
        { label: 'Command Palette', accelerator: 'CmdOrCtrl+P', click: send('palette') },
        { type: 'separator' },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: send('close-tab') }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: send('find') },
        { label: 'Clear Terminal', accelerator: 'CmdOrCtrl+K', click: send('clear') }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Sessions Sidebar', accelerator: 'CmdOrCtrl+B', click: send('toggle-sidebar') },
        { label: 'Toggle SFTP Browser', accelerator: 'CmdOrCtrl+Shift+F', click: send('toggle-sftp') },
        { label: 'Toggle Monitor', accelerator: 'CmdOrCtrl+Shift+M', click: send('toggle-monitor') },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : ([{ role: 'toggleDevTools' }] as MenuItemConstructorOptions[]))
      ]
    },
    {
      label: 'Window',
      submenu: [
        { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: send('next-tab') },
        { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: send('prev-tab') },
        { type: 'separator' },
        ...tabItems,
        { type: 'separator' },
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'front' }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
