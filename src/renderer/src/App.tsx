import { useCallback, useEffect, useRef } from 'react'
import { APP_NAME } from '@shared/brand'
import type { AppSettings, MenuAction } from '@shared/types'
import { CommandPalette } from './components/CommandPalette'
import { CommandsPanel } from './components/commands/CommandsPanel'
import { DialogHost } from './components/dialogs/DialogHost'
import { PromptHost } from './components/dialogs/PromptHost'
import { MonitorPanel } from './components/MonitorPanel'
import { FileEditor } from './components/editor/FileEditor'
import { editorBridge } from './components/editor/editorBridge'
import { SftpPanel } from './components/sftp/SftpPanel'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { TabBar } from './components/TabBar'
import { TerminalArea } from './components/TerminalArea'
import { Toasts } from './components/Toasts'
import { TooltipLayer } from './components/TooltipLayer'
import { activateRelative, bindIpc, closeTab, openLocal, setPanelOpen } from './store/actions'
import { useApp } from './store/appStore'
import { registry } from './terminal/registry'
import { getTerminalTheme } from './terminal/themes'

function inkFor(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  return lum > 0.6 ? '#05201c' : '#ffffff'
}

/** Branded themes ship their own palette, so the user accent is not applied to them. */
const FIXED_PALETTE_THEMES = new Set(['vs', 'retro', 'moba'])

function applyTheme(settings: AppSettings): void {
  const root = document.documentElement
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const theme = settings.uiTheme === 'system' ? (prefersDark ? 'dark' : 'light') : settings.uiTheme
  root.dataset.theme = theme
  root.lang = settings.language
  if (FIXED_PALETTE_THEMES.has(theme)) {
    root.style.removeProperty('--accent')
    root.style.removeProperty('--accent-ink')
  } else {
    root.style.setProperty('--accent', settings.accent)
    root.style.setProperty('--accent-ink', inkFor(settings.accent))
  }
  root.style.setProperty('--term-bg', getTerminalTheme(settings.terminalTheme).theme.background ?? '#0b0e14')
}

async function loadFonts(): Promise<void> {
  await Promise.allSettled([
    document.fonts.load('13px "JetBrains Mono"'),
    document.fonts.load('bold 13px "JetBrains Mono"'),
    document.fonts.load('13px "Inter Variable"')
  ])
}

export function App() {
  const ready = useApp((s) => s.ready)
  const settings = useApp((s) => s.settings)
  const tabs = useApp((s) => s.tabs)
  const activeId = useApp((s) => s.activeId)
  const dialog = useApp((s) => s.dialog)
  const paletteOpen = useApp((s) => s.paletteOpen)
  const monitorOpen = useApp((s) => s.monitorOpen)
  const firstApply = useRef(true)
  const active = tabs.find((t) => t.id === activeId)

  useEffect(() => {
    document.title = APP_NAME
    const off = bindIpc()
    void Promise.all([window.xmt.settings.get(), window.xmt.sessions.list(), window.xmt.commands.list(), loadFonts()]).then(
      ([s, sessions, library]) => {
        applyTheme(s)
        useApp.getState().setLibrary(library)
        useApp.getState().init(s, sessions)
      }
    )
    return off
  }, [])

  useEffect(() => {
    registry.setHighlight(settings.outputHighlight)
  }, [settings.outputHighlight])

  useEffect(() => {
    if (!ready) return
    applyTheme(settings)
    if (firstApply.current) {
      firstApply.current = false
      return
    }
    registry.applySettings(settings)
  }, [settings, ready])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => applyTheme(useApp.getState().settings)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const wantsLocalStats = !active || active.kind !== 'ssh'
  useEffect(() => {
    if (!ready) return
    void window.xmt.monitor.setLocal(wantsLocalStats && settings.monitorEnabled)
  }, [ready, wantsLocalStats, settings.monitorEnabled])

  const toggleSetting = useCallback((key: 'sidebarOpen' | 'sftpPanelOpen' | 'commandsPanelOpen') => {
    setPanelOpen(key, !useApp.getState().settings[key])
  }, [])
  const toggleSidebar = useCallback(() => toggleSetting('sidebarOpen'), [toggleSetting])
  const toggleSftp = useCallback(() => toggleSetting('sftpPanelOpen'), [toggleSetting])
  const toggleCommands = useCallback(() => toggleSetting('commandsPanelOpen'), [toggleSetting])

  useEffect(() => {
    const handle = (action: MenuAction): void => {
      const store = useApp.getState()
      const current = store.tabs.find((t) => t.id === store.activeId)
      if (action.startsWith('tab-')) {
        const tab = store.tabs[Number(action.slice(4)) - 1]
        if (tab) store.setActive(tab.id)
        return
      }
      switch (action) {
        case 'new-local':
          openLocal()
          break
        case 'new-session':
          store.openDialog({ kind: 'session-editor' })
          break
        case 'new-http':
          store.openDialog({ kind: 'session-editor', sessionKind: 'http' })
          break
        case 'toggle-commands':
          toggleCommands()
          break
        case 'close-tab':
          if (store.dialog) store.openDialog(null)
          else if (store.editor) editorBridge.requestClose()
          else if (current) closeTab(current.id)
          break
        case 'settings':
          store.openDialog({ kind: 'settings' })
          break
        case 'palette':
          store.setPalette(!store.paletteOpen)
          break
        case 'toggle-sftp':
          toggleSftp()
          break
        case 'toggle-sidebar':
          toggleSidebar()
          break
        case 'toggle-monitor':
          store.setMonitorOpen(!store.monitorOpen)
          break
        case 'find':
          if (store.editor) editorBridge.find()
          else if (current) store.setFindOpen(true)
          break
        case 'clear':
          if (current) registry.get(current.id)?.term.clear()
          break
        case 'next-tab':
          activateRelative(1)
          break
        case 'prev-tab':
          activateRelative(-1)
          break
      }
    }
    return window.xmt.app.onMenu(handle)
  }, [toggleSftp, toggleSidebar, toggleCommands])

  if (!ready) return <div className="app" style={{ background: 'var(--surface-0)' }} />

  const showSftp = settings.sftpPanelOpen && active?.kind === 'ssh' && active.sftpEnabled

  return (
    <div className="app">
      {settings.sidebarOpen && <Sidebar onCollapse={toggleSidebar} />}
      <main className="main">
        <TabBar sidebarOpen={settings.sidebarOpen} onShowSidebar={toggleSidebar} />
        <div className="workspace">
          {showSftp && active && <SftpPanel key={active.id} tab={active} />}
          <TerminalArea />
          {settings.commandsPanelOpen && <CommandsPanel tab={active} onClose={toggleCommands} />}
        </div>
        {monitorOpen && <MonitorPanel />}
        <StatusBar />
      </main>
      <FileEditor />
      {dialog && <DialogHost />}
      {paletteOpen && <CommandPalette onToggleSidebar={toggleSidebar} onToggleSftp={toggleSftp} />}
      <PromptHost />
      <Toasts />
      <TooltipLayer />
    </div>
  )
}
