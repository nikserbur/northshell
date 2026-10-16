import {
  Activity,
  ArrowRightLeft,
  Globe,
  HardDriveDownload,
  PanelLeft,
  Play,
  Plus,
  ScrollText,
  Search,
  Settings,
  SquareTerminal,
  Zap
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { parseQuickConnect } from '@shared/quickConnect'
import { groupSnippets } from '@shared/snippets'
import { makeT } from '../lib/i18n'
import { useT } from '../lib/useT'
import { monogram, sessionSubtitle } from '../lib/util'
import { openLocal, openQuick, openSession, runSnippet, setPanelOpen } from '../store/actions'
import { useApp } from '../store/appStore'

interface Item {
  id: string
  group: string
  label: string
  /** Extra search terms, e.g. the English label when the UI is Russian. */
  alias?: string
  sub?: string
  icon: ReactNode
  run: () => void
}

export function CommandPalette({ onToggleSidebar, onToggleSftp }: { onToggleSidebar: () => void; onToggleSftp: () => void }) {
  const t = useT()
  const sessions = useApp((s) => s.sessions)
  const tabs = useApp((s) => s.tabs)
  const settings = useApp((s) => s.settings)
  const library = useApp((s) => s.library)
  const activeId = useApp((s) => s.activeId)
  const setPalette = useApp((s) => s.setPalette)
  const openDialog = useApp((s) => s.openDialog)
  const setActive = useApp((s) => s.setActive)
  const setMonitorOpen = useApp((s) => s.setMonitorOpen)
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase()
    const match = (s: string): boolean => !q || s.toLowerCase().includes(q)
    const out: Item[] = []
    const quick = q ? parseQuickConnect(query, settings.defaultUsername) : null
    if (quick && (q.includes('@') || q.startsWith('ssh '))) {
      out.push({
        id: 'quick',
        group: t('connect'),
        label: `ssh ${quick.username}@${quick.host}`,
        sub: `:${quick.port}`,
        icon: <Zap size={15} />,
        run: () => openQuick(quick)
      })
    }
    tabs
      .filter((tab) => match(`${tab.title} ${tab.endpoint ?? ''}`))
      .forEach((tab) =>
        out.push({
          id: `tab-${tab.id}`,
          group: t('openTabs'),
          label: tab.title,
          sub: tab.endpoint,
          icon: <ArrowRightLeft size={15} />,
          run: () => setActive(tab.id)
        })
      )
    const active = tabs.find((tab) => tab.id === activeId)
    if (active?.status === 'connected') {
      const { own, shared } = groupSnippets(library.commands, active.sessionId, new Map())
      const relevant = [...own, ...shared]
      relevant
        .filter((c) => match(`${c.name} ${c.command}`))
        .forEach((c) =>
          out.push({
            id: `c-${c.id}`,
            group: t('commands'),
            label: c.name,
            sub: c.command.trim().split('\n')[0],
            icon: <Play size={15} />,
            run: () => runSnippet(c, active.id, true)
          })
        )
    }
    sessions
      .filter((s) => match(`${s.name} ${s.host} ${s.username} ${s.folder} ${s.baseUrl}`))
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
      .forEach((s) =>
        out.push({
          id: `s-${s.id}`,
          group: t('sessions'),
          label: s.name,
          sub: sessionSubtitle(s),
          icon: (
            <span className="monogram" style={{ width: 20, height: 20, fontSize: 9, borderRadius: 6, ['--mono-color' as string]: s.color }}>
              {monogram(s.name)}
            </span>
          ),
          run: () => openSession(s)
        })
      )
    const en = makeT('en')
    const actions: Item[] = [
      { id: 'a-local', group: t('actions'), label: t('localTerminal'), alias: en('localTerminal'), sub: '⌘T', icon: <SquareTerminal size={15} />, run: () => openLocal() },
      { id: 'a-new', group: t('actions'), label: t('newSession'), alias: en('newSession'), sub: '⌘N', icon: <Plus size={15} />, run: () => openDialog({ kind: 'session-editor' }) },
      {
        id: 'a-http',
        group: t('actions'),
        label: t('newHttpEnv'),
        alias: `${en('newHttpEnv')} curl api`,
        sub: '⌥⌘N',
        icon: <Globe size={15} />,
        run: () => openDialog({ kind: 'session-editor', sessionKind: 'http' })
      },
      {
        id: 'a-commands',
        group: t('actions'),
        label: t('commandLibrary'),
        alias: `${en('commandLibrary')} snippets macros`,
        sub: '⇧⌘L',
        icon: <ScrollText size={15} />,
        run: () => setPanelOpen('commandsPanelOpen', !useApp.getState().settings.commandsPanelOpen)
      },
      {
        id: 'a-new-command',
        group: t('actions'),
        label: t('newCommand'),
        alias: en('newCommand'),
        icon: <Plus size={15} />,
        run: () => openDialog({ kind: 'command-editor' })
      },
      { id: 'a-settings', group: t('actions'), label: t('settings'), alias: en('settings'), sub: '⌘,', icon: <Settings size={15} />, run: () => openDialog({ kind: 'settings' }) },
      { id: 'a-sidebar', group: t('actions'), label: t('toggleSidebar'), alias: en('toggleSidebar'), sub: '⌘B', icon: <PanelLeft size={15} />, run: onToggleSidebar },
      { id: 'a-sftp', group: t('actions'), label: t('toggleSftp'), alias: en('toggleSftp'), sub: '⇧⌘F', icon: <HardDriveDownload size={15} />, run: onToggleSftp },
      {
        id: 'a-monitor',
        group: t('actions'),
        label: t('toggleMonitor'), alias: en('toggleMonitor'),
        sub: '⇧⌘M',
        icon: <Activity size={15} />,
        run: () => setMonitorOpen(!useApp.getState().monitorOpen)
      }
    ]
    return [...out, ...actions.filter((a) => match(`${a.label} ${a.alias ?? ''}`))]
  }, [query, sessions, tabs, activeId, library.commands, settings.defaultUsername, t, setActive, openDialog, setMonitorOpen, onToggleSidebar, onToggleSftp])

  useEffect(() => setSel(0), [query])
  useEffect(() => {
    listRef.current?.querySelector('.palette-item.sel')?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const close = (): void => setPalette(false)
  const run = (item: Item | undefined): void => {
    if (!item) return
    close()
    item.run()
  }

  let lastGroup = ''
  return (
    <div className="palette-wrap" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-label={t('paletteHint')}>
        <div className="palette-input">
          <Search size={17} style={{ color: 'var(--text-2)' }} />
          <input
            autoFocus
            value={query}
            placeholder={t('paletteHint')}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close()
              else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSel((s) => Math.min(items.length - 1, s + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSel((s) => Math.max(0, s - 1))
              } else if (e.key === 'Enter') run(items[sel])
            }}
          />
          <span className="kbd">esc</span>
        </div>
        <div className="palette-list" ref={listRef}>
          {items.length === 0 && <div className="palette-group">{t('nothingFound')}</div>}
          {items.map((item, idx) => {
            const header = item.group !== lastGroup ? item.group : null
            lastGroup = item.group
            return (
              <div key={item.id}>
                {header && <div className="palette-group">{header}</div>}
                <button className={`palette-item ${idx === sel ? 'sel' : ''}`} onMouseMove={() => setSel(idx)} onClick={() => run(item)}>
                  {item.icon}
                  <span className="truncate">{item.label}</span>
                  {item.sub && <span className="sub truncate">{item.sub}</span>}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
