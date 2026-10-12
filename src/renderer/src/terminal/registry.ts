import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal, type ITerminalOptions } from '@xterm/xterm'
import type { AppSettings } from '@shared/types'
import { getTerminalTheme } from './themes'

export interface TermEntry {
  term: Terminal
  fit: FitAddon
  search: SearchAddon
  opened: boolean
  webgl: boolean
  needsConnect: boolean
  bytesIn: number
  bytesOut: number
}

type InputHandler = (tabId: string, data: string) => void

const MAX_WEBGL = 12
const entries = new Map<string, TermEntry>()
let inputHandler: InputHandler = () => undefined
let webglCount = 0

function optionsFrom(s: AppSettings): ITerminalOptions {
  return {
    fontFamily: `"${s.fontFamily}", "JetBrains Mono", Menlo, monospace`,
    fontSize: s.fontSize,
    lineHeight: s.lineHeight,
    cursorStyle: s.cursorStyle,
    cursorBlink: s.cursorBlink,
    cursorInactiveStyle: 'outline',
    scrollback: s.scrollback,
    theme: getTerminalTheme(s.terminalTheme).theme,
    allowProposedApi: true,
    macOptionIsMeta: true,
    macOptionClickForcesSelection: true,
    drawBoldTextInBrightColors: true,
    minimumContrastRatio: 1,
    smoothScrollDuration: 0
  }
}

export const registry = {
  setInputHandler(fn: InputHandler): void {
    inputHandler = fn
  },

  create(tabId: string, settings: AppSettings): TermEntry {
    const term = new Terminal(optionsFrom(settings))
    const fit = new FitAddon()
    const search = new SearchAddon()
    term.loadAddon(fit)
    term.loadAddon(search)
    term.loadAddon(new Unicode11Addon())
    term.unicode.activeVersion = '11'
    term.loadAddon(
      new WebLinksAddon((event, uri) => {
        if (event.metaKey) void window.xmt.app.openExternal(uri)
      })
    )
    const entry: TermEntry = { term, fit, search, opened: false, webgl: false, needsConnect: true, bytesIn: 0, bytesOut: 0 }
    const send = (data: string): void => {
      entry.bytesOut += data.length
      inputHandler(tabId, data)
    }
    term.onData(send)
    term.onBinary(send)
    entries.set(tabId, entry)
    return entry
  },

  /** Opens the terminal into its host element the first time it is mounted. */
  attach(tabId: string, host: HTMLElement): TermEntry | undefined {
    const entry = entries.get(tabId)
    if (!entry || entry.opened) return entry
    entry.term.open(host)
    entry.opened = true
    if (webglCount < MAX_WEBGL) {
      try {
        const webgl = new WebglAddon()
        webgl.onContextLoss(() => {
          webgl.dispose()
          entry.webgl = false
          webglCount = Math.max(0, webglCount - 1)
        })
        entry.term.loadAddon(webgl)
        entry.webgl = true
        webglCount++
      } catch {
        /* DOM renderer fallback */
      }
    }
    return entry
  },

  get(tabId: string): TermEntry | undefined {
    return entries.get(tabId)
  },

  write(tabId: string, data: Uint8Array | string): void {
    const entry = entries.get(tabId)
    if (!entry) return
    if (typeof data !== 'string') entry.bytesIn += data.length
    entry.term.write(data)
  },

  fit(tabId: string): void {
    const entry = entries.get(tabId)
    if (!entry?.opened) return
    try {
      entry.fit.fit()
    } catch {
      /* host not measurable yet */
    }
  },

  size(tabId: string): { cols: number; rows: number } {
    const term = entries.get(tabId)?.term
    return { cols: term?.cols ?? 80, rows: term?.rows ?? 24 }
  },

  focus(tabId: string): void {
    entries.get(tabId)?.term.focus()
  },

  applySettings(settings: AppSettings): void {
    const opts = optionsFrom(settings)
    for (const [id, entry] of entries) {
      entry.term.options = opts
      registry.fit(id)
    }
  },

  dispose(tabId: string): void {
    const entry = entries.get(tabId)
    if (!entry) return
    entries.delete(tabId)
    if (entry.webgl) webglCount = Math.max(0, webglCount - 1)
    entry.term.dispose()
  }
}
