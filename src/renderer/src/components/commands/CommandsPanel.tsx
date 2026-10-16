import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Copy,
  CornerDownLeft,
  FileDown,
  FileUp,
  FolderOpen,
  Layers,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  ScrollText,
  Search,
  Share2,
  SquareTerminal,
  Trash2,
  X
} from 'lucide-react'
import { useMemo, useState, type MouseEvent } from 'react'
import { groupSnippets, splitPlaceholders } from '@shared/snippets'
import type { CommandSnippet } from '@shared/types'
import { usePanelWidth } from '../../hooks/usePanelWidth'
import { useT } from '../../lib/useT'
import { errorMessage } from '../../lib/util'
import { reloadCommands, removeCommand, runSnippet, saveCommand } from '../../store/actions'
import { useApp, type Tab } from '../../store/appStore'
import { ContextMenu, type MenuEntry } from '../ContextMenu'

const SHOW_ALL_KEY = 'xmt.commands.all'

function readShowAll(): boolean {
  try {
    return localStorage.getItem(SHOW_ALL_KEY) === '1'
  } catch {
    return false
  }
}

function writeShowAll(on: boolean): void {
  try {
    localStorage.setItem(SHOW_ALL_KEY, on ? '1' : '0')
  } catch {
    /* storage unavailable — the toggle just won't persist */
  }
}

/** First line of a command with {{placeholders}} highlighted. */
function CommandPreview({ command }: { command: string }) {
  const [first, ...rest] = command.trim().split('\n')
  return (
    <>
      {splitPlaceholders(first).map((part, i) =>
        part.placeholder ? (
          <mark key={i} className="ph">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
      {rest.length > 0 && <span className="more"> +{rest.length}</span>}
    </>
  )
}

interface Section {
  key: string
  label: string
  list: CommandSnippet[]
  /** Scope for the section's "+" button; undefined = no button. */
  addTo?: { sessionId?: string }
}

type MenuState = { x: number; y: number; snippet?: CommandSnippet }

export function CommandsPanel({ tab, onClose }: { tab: Tab | undefined; onClose: () => void }) {
  const t = useT()
  const library = useApp((s) => s.library)
  const sessions = useApp((s) => s.sessions)
  const openDialog = useApp((s) => s.openDialog)
  const toast = useApp((s) => s.toast)
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(readShowAll)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<MenuState | null>(null)
  const panel = usePanelWidth('xmt.commands.width', 320, 240, 560, 'right')

  const session = tab?.sessionId ? sessions.find((s) => s.id === tab.sessionId) : undefined
  const canRun = tab?.status === 'connected'
  const names = useMemo(() => new Map(sessions.map((s) => [s.id, s.name])), [sessions])

  const sections = useMemo<Section[]>(() => {
    const q = query.trim().toLowerCase()
    const filtered = q ? library.commands.filter((c) => `${c.name}\n${c.command}`.toLowerCase().includes(q)) : library.commands
    const groups = groupSnippets(filtered, session?.id, names)
    const out: Section[] = []
    if (session) {
      out.push({ key: 'own', label: `${t('thisConnection')} · ${session.name}`, list: groups.own, addTo: { sessionId: session.id } })
    }
    out.push({ key: 'shared', label: t('sharedCommands'), list: groups.shared, addTo: {} })
    if (showAll || !tab) {
      for (const [label, list] of groups.others) out.push({ key: `other:${label}`, label: label || t('missingConnection'), list })
    }
    return out
  }, [library.commands, query, session, names, showAll, tab, t])

  const total = sections.reduce((n, s) => n + s.list.length, 0)

  const toggleSection = (key: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const use = (snippet: CommandSnippet, run: boolean): void => {
    if (!tab || !canRun) {
      toast({ kind: 'info', text: t('needTerminal') })
      return
    }
    runSnippet(snippet, tab.id, run)
  }

  /** Without an explicit scope, commands made in an HTTP tab belong to that environment. */
  const add = (scope?: { sessionId?: string }): void =>
    openDialog({ kind: 'command-editor', sessionId: scope ? scope.sessionId : tab?.kind === 'http' ? session?.id : undefined })

  const edit = (snippet: CommandSnippet): void => openDialog({ kind: 'command-editor', snippet })

  const remove = (snippet: CommandSnippet): void =>
    openDialog({
      kind: 'confirm',
      text: t('deleteCommandConfirm', { name: snippet.name }),
      confirmLabel: t('delete'),
      danger: true,
      onConfirm: () => void removeCommand(snippet.id)
    })

  const rescope = (snippet: CommandSnippet, sessionId: string | undefined): void =>
    void saveCommand({ id: snippet.id, name: snippet.name, command: snippet.command, ...(sessionId ? { sessionId } : {}) })

  const copy = (snippet: CommandSnippet): void => {
    navigator.clipboard
      .writeText(snippet.command)
      .then(() => toast({ kind: 'success', text: t('copied') }))
      .catch((err: unknown) => toast({ kind: 'error', text: errorMessage(err) }))
  }

  const fileAction = async (action: () => Promise<unknown>): Promise<void> => {
    try {
      await action()
    } catch (err) {
      toast({ kind: 'error', text: errorMessage(err) })
    }
  }

  const importFile = (): Promise<void> =>
    fileAction(async () => {
      const res = await window.xmt.commands.importFile()
      if (!res) return
      useApp.getState().setLibrary(res.library)
      toast({ kind: 'success', text: t('importedCommands', { n: res.added }) })
    })

  const exportFile = (): Promise<void> =>
    fileAction(async () => {
      const path = await window.xmt.commands.exportFile()
      if (path) {
        toast({
          kind: 'success',
          text: t('exportedCommands', { path }),
          action: { label: t('showInFinder'), run: () => void window.xmt.app.showInFolder(path) }
        })
      }
    })

  const toggleShowAll = (): void => {
    writeShowAll(!showAll)
    setShowAll(!showAll)
  }

  const snippetMenu = (snippet: CommandSnippet): MenuEntry[] => {
    const scopeItem: MenuEntry[] =
      snippet.sessionId || snippet.sessionName
        ? [{ label: t('makeShared'), icon: <Share2 size={14} />, onClick: () => rescope(snippet, undefined) }]
        : session
          ? [{ label: t('onlyForSession', { name: session.name }), icon: <Share2 size={14} />, onClick: () => rescope(snippet, session.id) }]
          : []
    return [
      ...(canRun
        ? ([
            { label: t('runCommand'), icon: <Play size={14} />, onClick: () => use(snippet, true) },
            { label: t('insertCommand'), icon: <CornerDownLeft size={14} />, onClick: () => use(snippet, false) },
            'separator'
          ] as MenuEntry[])
        : []),
      { label: t('edit'), icon: <Pencil size={14} />, onClick: () => edit(snippet) },
      {
        label: t('duplicate'),
        icon: <Copy size={14} />,
        onClick: () =>
          void saveCommand({
            name: `${snippet.name} copy`,
            command: snippet.command,
            sessionId: snippet.sessionId,
            sessionName: snippet.sessionName
          })
      },
      { label: t('copyCommand'), icon: <ClipboardCopy size={14} />, onClick: () => copy(snippet) },
      ...scopeItem,
      'separator',
      { label: t('delete'), icon: <Trash2 size={14} />, danger: true, onClick: () => remove(snippet) }
    ]
  }

  const fileMenu: MenuEntry[] = [
    { label: t('openLibraryFile'), icon: <ScrollText size={14} />, onClick: () => void fileAction(() => window.xmt.commands.openFile()) },
    ...(library.path
      ? [{ label: t('showInFinder'), icon: <FolderOpen size={14} />, onClick: () => void window.xmt.app.showInFolder(library.path) }]
      : []),
    'separator',
    { label: t('importCommands'), icon: <FileDown size={14} />, onClick: () => void importFile() },
    { label: t('exportCommands'), icon: <FileUp size={14} />, onClick: () => void exportFile() },
    'separator',
    { label: showAll ? t('hideOtherConnections') : t('showAllConnections'), icon: <Layers size={14} />, onClick: toggleShowAll }
  ]

  const openMenu = (e: MouseEvent, snippet?: CommandSnippet): void => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, snippet })
  }

  return (
    <aside className="sftp cmd-panel" style={{ width: panel.width }}>
      <div className="sftp-head">
        <span className="title">
          <ScrollText size={13} /> <span className="title-text">{t('commands')}</span>
        </span>
        <button className="icon-btn sm" onClick={() => add()} title={t('newCommand')}>
          <Plus size={15} />
        </button>
        <button className={`icon-btn sm ${showAll ? 'on' : ''}`} onClick={toggleShowAll} title={showAll ? t('hideOtherConnections') : t('showAllConnections')}>
          <Layers size={13} />
        </button>
        <button className="icon-btn sm" onClick={(e) => openMenu(e)} title={t('libraryMenu')}>
          <MoreHorizontal size={14} />
        </button>
        <button className="icon-btn sm" onClick={onClose} title={`${t('close')} ⇧⌘L`}>
          <X size={13} />
        </button>
      </div>

      {library.error && (
        <div className="callout danger cmd-error">
          <AlertTriangle size={15} />
          <div>
            {t('libraryFileError', { error: library.error })}
            <div className="cmd-error-actions">
              <button className="btn sm" onClick={() => void fileAction(() => window.xmt.commands.openFile())}>
                {t('openLibraryFile')}
              </button>
              <button className="btn sm ghost" onClick={() => void reloadCommands()}>
                {t('refresh')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="sftp-search">
        <Search size={13} />
        <input
          value={query}
          placeholder={t('commandLibrary')}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
        />
      </div>

      {!canRun && tab === undefined && library.commands.length > 0 && (
        <div className="cmd-note">
          <SquareTerminal size={12} /> {t('needTerminal')}
        </div>
      )}

      <div className="sftp-list cmd-list" onContextMenu={(e) => openMenu(e)}>
        {library.commands.length === 0 ? (
          <div className="sftp-empty">
            <ScrollText size={28} />
            <div>
              <div style={{ color: 'var(--text-1)', fontWeight: 550 }}>{t('noCommands')}</div>
              <div>{t('noCommandsHint')}</div>
            </div>
            <button className="btn sm primary" onClick={() => add()}>
              <Plus size={13} /> {t('addCommand')}
            </button>
          </div>
        ) : total === 0 && query ? (
          <div className="sftp-empty">{t('nothingFound')}</div>
        ) : (
          sections.map((section) => {
            const isCollapsed = collapsed.has(section.key)
            return (
              <div key={section.key} className="cmd-section">
                <div className="sidebar-section">
                  <button onClick={() => toggleSection(section.key)}>
                    {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    <span className="truncate">{section.label}</span>
                  </button>
                  <span className="count">{section.list.length}</span>
                  {section.addTo && (
                    <button className="icon-btn sm cmd-section-add" onClick={() => add(section.addTo)} title={t('addCommand')}>
                      <Plus size={12} />
                    </button>
                  )}
                </div>
                {!isCollapsed &&
                  section.list.map((snippet) => (
                    <div
                      key={snippet.id}
                      className="cmd-row"
                      onDoubleClick={() => use(snippet, true)}
                      onContextMenu={(e) => openMenu(e, snippet)}
                      title={`${snippet.command.trim()}\n\n${t('dblClickToRun')}`}
                    >
                      <div className="cmd-main">
                        <span className="cmd-name truncate">{snippet.name}</span>
                        <code className="cmd-text truncate">
                          <CommandPreview command={snippet.command} />
                        </code>
                      </div>
                      <div className="cmd-actions">
                        <button className="icon-btn sm" disabled={!canRun} onClick={() => use(snippet, true)} title={t('runCommand')}>
                          <Play size={13} />
                        </button>
                        <button className="icon-btn sm" disabled={!canRun} onClick={() => use(snippet, false)} title={t('insertCommand')}>
                          <CornerDownLeft size={13} />
                        </button>
                        <button className="icon-btn sm" onClick={() => edit(snippet)} title={t('edit')}>
                          <Pencil size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            )
          })
        )}
      </div>

      <div className="resize-handle left" onMouseDown={panel.startResize} onDoubleClick={panel.reset} title={t('resizeHint')} />
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.snippet ? snippetMenu(menu.snippet) : fileMenu}
          onClose={() => setMenu(null)}
        />
      )}
    </aside>
  )
}
