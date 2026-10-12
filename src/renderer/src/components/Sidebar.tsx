import {
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Play,
  Plus,
  Search,
  Server,
  SquareTerminal,
  Trash2
} from 'lucide-react'
import { useMemo, useState, type MouseEvent } from 'react'
import { usePanelWidth } from '../hooks/usePanelWidth'
import type { SessionConfig } from '@shared/types'
import { BRAND_HEAD, BRAND_TAIL } from '@shared/brand'
import iconMark from '../assets/icon-32.png'
import { useT } from '../lib/useT'
import { errorMessage, monogram } from '../lib/util'
import { openLocal, openSession, reloadSessions } from '../store/actions'
import { useApp } from '../store/appStore'
import { ContextMenu, type MenuEntry } from './ContextMenu'

interface MenuState {
  x: number
  y: number
  session: SessionConfig
}

export function Sidebar({ onCollapse }: { onCollapse: () => void }) {
  const t = useT()
  const sessions = useApp((s) => s.sessions)
  const tabs = useApp((s) => s.tabs)
  const openDialog = useApp((s) => s.openDialog)
  const toast = useApp((s) => s.toast)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<MenuState | null>(null)
  const panel = usePanelWidth('xmt.sidebar.width', 264, 200, 460)

  const openIds = useMemo(() => new Set(tabs.map((tab) => tab.sessionId).filter(Boolean)), [tabs])

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = sessions.filter(
      (s) => !q || `${s.name} ${s.host} ${s.username} ${s.folder}`.toLowerCase().includes(q)
    )
    const map = new Map<string, SessionConfig[]>()
    for (const s of [...filtered].sort((a, b) => a.name.localeCompare(b.name))) {
      const key = s.folder || ''
      map.set(key, [...(map.get(key) ?? []), s])
    }
    return [...map.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
  }, [sessions, query])

  const toggleFolder = (folder: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(folder)) next.delete(folder)
      else next.add(folder)
      return next
    })
  }

  const remove = (s: SessionConfig): void =>
    openDialog({
      kind: 'confirm',
      text: t('deleteSessionConfirm', { name: s.name }),
      confirmLabel: t('delete'),
      danger: true,
      onConfirm: () => {
        void window.xmt.sessions
          .remove(s.id)
          .then(reloadSessions)
          .catch((err: unknown) => toast({ kind: 'error', text: errorMessage(err) }))
      }
    })

  const duplicate = (s: SessionConfig): void => {
    void window.xmt.sessions.duplicate(s.id).then(reloadSessions)
  }

  const importConfig = async (): Promise<void> => {
    try {
      const n = await window.xmt.sessions.importSshConfig()
      await reloadSessions()
      toast(n > 0 ? { kind: 'success', text: t('imported', { n }) } : { kind: 'info', text: t('nothingToImport') })
    } catch (err) {
      toast({ kind: 'error', text: errorMessage(err) })
    }
  }

  const menuItems = (s: SessionConfig): MenuEntry[] => [
    { label: t('connect'), icon: <Play size={14} />, onClick: () => openSession(s) },
    { label: t('edit'), icon: <Pencil size={14} />, onClick: () => openDialog({ kind: 'session-editor', session: s }) },
    { label: t('duplicate'), icon: <Copy size={14} />, onClick: () => duplicate(s) },
    'separator',
    { label: t('delete'), icon: <Trash2 size={14} />, danger: true, onClick: () => remove(s) }
  ]

  const showMenu = (e: MouseEvent, session: SessionConfig): void => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, session })
  }

  return (
    <aside className="sidebar" style={{ width: panel.width }}>
      <div className="sidebar-top drag">
        <button className="icon-btn no-drag" onClick={onCollapse} title={t('toggleSidebar')}>
          <PanelLeftClose size={16} />
        </button>
        <button className="icon-btn no-drag" onClick={() => openDialog({ kind: 'session-editor' })} title={t('newSession')}>
          <Plus size={17} />
        </button>
      </div>

      <div className="brand">
        <img className="brand-mark" src={iconMark} width={32} height={32} alt="" />
        <div className="brand-name">
          {BRAND_HEAD}
          <em>{BRAND_TAIL}</em>
        </div>
      </div>

      <div className="sidebar-search">
        <div className="input-group">
          <Search size={14} />
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchSessions')}
            spellCheck={false}
          />
        </div>
      </div>

      <div className="sidebar-list">
        {sessions.length === 0 && (
          <div className="sftp-empty">
            <Server size={28} />
            <div>
              <div style={{ color: 'var(--text-1)', fontWeight: 550 }}>{t('noSessions')}</div>
              <div>{t('noSessionsHint')}</div>
            </div>
          </div>
        )}
        {groups.map(([folder, list]) => {
          const isCollapsed = collapsed.has(folder)
          return (
            <div key={folder || '__root'}>
              <div className="sidebar-section">
                <button onClick={() => toggleFolder(folder)}>
                  {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  {folder || t('ungrouped')}
                </button>
                <span className="count">{list.length}</span>
              </div>
              {!isCollapsed &&
                list.map((s) => (
                  <div
                    key={s.id}
                    className={`session-row ${openIds.has(s.id) ? 'is-open' : ''}`}
                    style={{ ['--row-color' as string]: s.color }}
                    onDoubleClick={() => openSession(s)}
                    onContextMenu={(e) => showMenu(e, s)}
                    title={`${s.username}@${s.host}:${s.port}`}
                  >
                    <div className="monogram" style={{ ['--mono-color' as string]: s.color }}>
                      {monogram(s.name)}
                    </div>
                    <div className="session-meta">
                      <span className="session-name truncate">{s.name}</span>
                      <span className="session-host truncate">
                        {s.username ? `${s.username}@` : ''}
                        {s.host}
                        {s.port !== 22 ? `:${s.port}` : ''}
                      </span>
                    </div>
                    <div className="session-actions">
                      <button className="icon-btn sm" onClick={() => openSession(s)} title={t('connect')}>
                        <Play size={13} />
                      </button>
                      <button className="icon-btn sm" onClick={(e) => showMenu(e, s)} title={t('more')}>
                        <MoreHorizontal size={14} />
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          )
        })}
      </div>

      <div className="sidebar-footer">
        <button className="btn sm" onClick={() => openLocal()} title={`${t('localTerminal')} ⌘T`}>
          <SquareTerminal size={14} /> {t('localTerminal').split(' ')[0]}
        </button>
        <button className="btn sm" onClick={() => void importConfig()} title={t('importSshConfig')}>
          <Download size={14} /> ssh config
        </button>
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.session)} onClose={() => setMenu(null)} />}
      <div className="resize-handle" onMouseDown={panel.startResize} onDoubleClick={panel.reset} title={t('resizeHint')} />
    </aside>
  )
}
