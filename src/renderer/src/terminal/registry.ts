import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal, type IMarker, type ITerminalOptions } from '@xterm/xterm'
import { OutputHighlighter } from '@shared/highlight'
import type { AppSettings } from '@shared/types'
import { commandSelection, endsCommand, isTerminalReply, replaceSelected } from './commandSelect'
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
  /** Present while MobaXterm-style output highlighting is on. */
  highlight: { decoder: TextDecoder; hl: OutputHighlighter } | null
  /** No key typed since the last command ended: shell output still leads up to the prompt. */
  promptPending: boolean
  /** Where typing started on the current prompt (a marker survives scrollback trimming). */
  inputStart: { marker: IMarker; x: number } | null
  /** Text of the Ctrl+A selection while the typed command is selected. */
  commandSelected: string | null
}

type InputHandler = (tabId: string, data: string) => void

const MAX_WEBGL = 12
const entries = new Map<string, TermEntry>()
let inputHandler: InputHandler = () => undefined
let webglCount = 0
let highlightOn = false
let ctrlASelects = true
/** False while input goes to several tabs (MultiExec): a line kill must not reach a tab running vim. */
let commandSelectAllowed: () => boolean = () => true

function clearCommandSelection(entry: TermEntry): void {
  entry.commandSelected = null
  entry.term.clearSelection()
}

/** Ctrl+A on a shell prompt: selects the typed command. False when there is nothing to select. */
function selectCommand(entry: TermEntry): boolean {
  const { term } = entry
  const b = term.buffer.active
  const marker = entry.inputStart?.marker
  const start = entry.inputStart && marker && !marker.isDisposed && marker.line >= 0 ? { x: entry.inputStart.x, y: marker.line } : null
  const sel = commandSelection(b, term.cols, { x: b.cursorX, y: b.baseY + b.cursorY }, start)
  if (!sel) return false
  term.select(sel.col, sel.row, sel.length)
  entry.commandSelected = term.getSelection()
  return true
}

function onKey(entry: TermEntry, ev: KeyboardEvent): boolean {
  if (ev.type !== 'keydown') return true
  // keyCode 65 is what xterm itself turns into ^A, so this matches in Russian or AZERTY layouts too.
  const ctrlA = ev.keyCode === 65 && ev.ctrlKey && !ev.metaKey && !ev.altKey && !ev.shiftKey
  if (entry.commandSelected !== null) {
    if (ev.key === 'Escape') {
      clearCommandSelection(entry)
      return false
    }
    // A second Ctrl+A goes to the shell as usual (start of line).
    if (ctrlA) clearCommandSelection(entry)
    return true
  }
  // Full-screen programs (vim, nano, tmux, screen) keep their own Ctrl+A.
  if (!ctrlA || !ctrlASelects || !commandSelectAllowed() || entry.term.buffer.active.type !== 'normal') return true
  return !selectCommand(entry)
}

/** Remembers where the cursor is after shell output that precedes the user's typing. */
function markInputStart(entry: TermEntry): void {
  const { term } = entry
  if (!entry.promptPending || term.buffer.active.type !== 'normal') return
  entry.inputStart?.marker.dispose()
  const marker = term.registerMarker(0)
  entry.inputStart = marker ? { marker, x: term.buffer.active.cursorX } : null
}

/** After output is drawn: track the prompt, and stretch a Ctrl+A selection over echo that arrived late. */
function afterOutput(entry: TermEntry): void {
  markInputStart(entry)
  if (entry.commandSelected !== null && !selectCommand(entry)) clearCommandSelection(entry)
}

function writeOutput(entry: TermEntry, data: string | Uint8Array): void {
  if (entry.promptPending || entry.commandSelected !== null) entry.term.write(data, () => afterOutput(entry))
  else entry.term.write(data)
}

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

  /** Ctrl+A selects the command only when this says so (e.g. not in MultiExec mode). */
  setCommandSelectGuard(fn: () => boolean): void {
    commandSelectAllowed = fn
  },

  create(tabId: string, settings: AppSettings): TermEntry {
    ctrlASelects = settings.ctrlASelectsCommand
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
    const entry: TermEntry = {
      term,
      fit,
      search,
      opened: false,
      webgl: false,
      needsConnect: true,
      bytesIn: 0,
      bytesOut: 0,
      highlight: null,
      promptPending: true,
      inputStart: null,
      commandSelected: null
    }
    const send = (input: string): void => {
      let data = input
      if (entry.commandSelected !== null) {
        data = replaceSelected(input).data
        clearCommandSelection(entry)
      }
      if (endsCommand(data)) entry.promptPending = true
      else if (!isTerminalReply(data)) entry.promptPending = false
      entry.bytesOut += data.length
      inputHandler(tabId, data)
    }
    term.onData(send)
    term.onBinary((data) => {
      entry.bytesOut += data.length
      inputHandler(tabId, data)
    })
    // Leaving vim, less or top hands the screen back to the shell, which prints a new prompt.
    term.buffer.onBufferChange((buffer) => {
      if (buffer.type === 'normal') entry.promptPending = true
    })
    term.attachCustomKeyEventHandler((ev) => onKey(entry, ev))
    term.onSelectionChange(() => {
      // A mouse selection replaces the Ctrl+A one: typing must not delete the command then.
      if (entry.commandSelected !== null && term.getSelection() !== entry.commandSelected) entry.commandSelected = null
    })
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
    if (typeof data === 'string') return entry.term.write(data)
    entry.bytesIn += data.length
    if (!highlightOn) return writeOutput(entry, data)
    entry.highlight ??= { decoder: new TextDecoder('utf-8'), hl: new OutputHighlighter() }
    writeOutput(entry, entry.highlight.hl.push(entry.highlight.decoder.decode(data, { stream: true })))
  },

  /** Turns MobaXterm-style output highlighting on or off for all terminals. */
  setHighlight(on: boolean): void {
    if (on === highlightOn) return
    highlightOn = on
    if (on) return
    for (const entry of entries.values()) {
      if (!entry.highlight) continue
      const rest = entry.highlight.decoder.decode() + entry.highlight.hl.flush()
      if (rest) entry.term.write(rest)
      entry.highlight = null
    }
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
    ctrlASelects = settings.ctrlASelectsCommand
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
