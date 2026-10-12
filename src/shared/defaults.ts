import type { AppSettings } from './types'

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'ru',
  uiTheme: 'dark',
  accent: '#5eead4',
  terminalTheme: 'moda-night',
  fontFamily: 'JetBrains Mono',
  fontSize: 13,
  lineHeight: 1.2,
  cursorStyle: 'bar',
  cursorBlink: true,
  scrollback: 10000,
  copyOnSelect: false,
  rightClickPaste: true,
  terminalBanner: false,
  outputHighlight: false,
  localShell: '',
  keepaliveInterval: 30,
  connectTimeout: 20,
  defaultUsername: '',
  monitorEnabled: true,
  monitorInterval: 3,
  downloadDir: '',
  showHiddenFiles: false,
  confirmDelete: true,
  sftpPanelOpen: true,
  sidebarOpen: true
}

export const SESSION_COLORS = ['#5eead4', '#a78bfa', '#f472b6', '#fbbf24', '#60a5fa', '#f87171', '#4ade80', '#94a3b8']

export const ACCENTS = ['#5eead4', '#a78bfa', '#60a5fa', '#f472b6', '#fbbf24', '#4ade80']
