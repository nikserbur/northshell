import type { ITheme } from '@xterm/xterm'

export interface TerminalTheme {
  id: string
  name: string
  dark: boolean
  theme: ITheme
}

export const TERMINAL_THEMES: TerminalTheme[] = [
  {
    id: 'moda-night',
    name: 'Moda Night',
    dark: true,
    theme: {
      background: '#0b0e14',
      foreground: '#d7dce6',
      cursor: '#5eead4',
      cursorAccent: '#0b0e14',
      selectionBackground: '#5eead433',
      black: '#1c212b',
      red: '#ff6b81',
      green: '#7ee0a1',
      yellow: '#f5c76b',
      blue: '#6aa7ff',
      magenta: '#c49bff',
      cyan: '#5eead4',
      white: '#c9cfda',
      brightBlack: '#5a6377',
      brightRed: '#ff8fa0',
      brightGreen: '#a3f0bf',
      brightYellow: '#ffdb94',
      brightBlue: '#94c0ff',
      brightMagenta: '#d9bdff',
      brightCyan: '#99f6e4',
      brightWhite: '#f4f6fa'
    }
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    dark: true,
    theme: {
      background: '#1a1b26',
      foreground: '#c0caf5',
      cursor: '#c0caf5',
      selectionBackground: '#33467c',
      black: '#15161e',
      red: '#f7768e',
      green: '#9ece6a',
      yellow: '#e0af68',
      blue: '#7aa2f7',
      magenta: '#bb9af7',
      cyan: '#7dcfff',
      white: '#a9b1d6',
      brightBlack: '#414868',
      brightRed: '#f7768e',
      brightGreen: '#9ece6a',
      brightYellow: '#e0af68',
      brightBlue: '#7aa2f7',
      brightMagenta: '#bb9af7',
      brightCyan: '#7dcfff',
      brightWhite: '#c0caf5'
    }
  },
  {
    id: 'dracula',
    name: 'Dracula',
    dark: true,
    theme: {
      background: '#282a36',
      foreground: '#f8f8f2',
      cursor: '#f8f8f2',
      selectionBackground: '#44475a',
      black: '#21222c',
      red: '#ff5555',
      green: '#50fa7b',
      yellow: '#f1fa8c',
      blue: '#bd93f9',
      magenta: '#ff79c6',
      cyan: '#8be9fd',
      white: '#f8f8f2',
      brightBlack: '#6272a4',
      brightRed: '#ff6e6e',
      brightGreen: '#69ff94',
      brightYellow: '#ffffa5',
      brightBlue: '#d6acff',
      brightMagenta: '#ff92df',
      brightCyan: '#a4ffff',
      brightWhite: '#ffffff'
    }
  },
  {
    id: 'nord',
    name: 'Nord',
    dark: true,
    theme: {
      background: '#2e3440',
      foreground: '#d8dee9',
      cursor: '#d8dee9',
      selectionBackground: '#434c5e',
      black: '#3b4252',
      red: '#bf616a',
      green: '#a3be8c',
      yellow: '#ebcb8b',
      blue: '#81a1c1',
      magenta: '#b48ead',
      cyan: '#88c0d0',
      white: '#e5e9f0',
      brightBlack: '#4c566a',
      brightRed: '#bf616a',
      brightGreen: '#a3be8c',
      brightYellow: '#ebcb8b',
      brightBlue: '#81a1c1',
      brightMagenta: '#b48ead',
      brightCyan: '#8fbcbb',
      brightWhite: '#eceff4'
    }
  },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    dark: true,
    theme: {
      background: '#002b36',
      foreground: '#93a1a1',
      cursor: '#93a1a1',
      selectionBackground: '#073642',
      black: '#073642',
      red: '#dc322f',
      green: '#859900',
      yellow: '#b58900',
      blue: '#268bd2',
      magenta: '#d33682',
      cyan: '#2aa198',
      white: '#eee8d5',
      brightBlack: '#586e75',
      brightRed: '#cb4b16',
      brightGreen: '#93a1a1',
      brightYellow: '#839496',
      brightBlue: '#839496',
      brightMagenta: '#6c71c4',
      brightCyan: '#93a1a1',
      brightWhite: '#fdf6e3'
    }
  },
  {
    id: 'paper',
    name: 'Paper (light)',
    dark: false,
    theme: {
      background: '#fbfaf7',
      foreground: '#2b2f36',
      cursor: '#0d9488',
      cursorAccent: '#fbfaf7',
      selectionBackground: '#0d948833',
      black: '#2b2f36',
      red: '#c8364b',
      green: '#2f8a4c',
      yellow: '#a46a00',
      blue: '#2563eb',
      magenta: '#8b46c9',
      cyan: '#0f8b85',
      white: '#d6d3cc',
      brightBlack: '#6b7280',
      brightRed: '#e0566a',
      brightGreen: '#3fa660',
      brightYellow: '#c08400',
      brightBlue: '#3b82f6',
      brightMagenta: '#a463e0',
      brightCyan: '#14a39c',
      brightWhite: '#ffffff'
    }
  }
]

export function getTerminalTheme(id: string): TerminalTheme {
  return TERMINAL_THEMES.find((t) => t.id === id) ?? TERMINAL_THEMES[0]
}
