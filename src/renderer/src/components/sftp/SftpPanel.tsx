import {
  ArrowUp,
  ClipboardCopy,
  Download,
  Eye,
  EyeOff,
  FilePen,
  FilePlus2,
  Folder,
  FolderInput,
  FolderPlus,
  FolderSearch,
  HardDriveDownload,
  House,
  KeyRound,
  Loader2,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { filterEntries, sortEntries, type SortDir, type SortKey } from '@shared/fileSort'
import { formatBytes } from '@shared/format'
import type { SearchHit, SftpEntry } from '@shared/types'
import { usePanelWidth } from '../../hooks/usePanelWidth'
import { useT } from '../../lib/useT'
import { errorMessage } from '../../lib/util'
import { useApp, type Tab } from '../../store/appStore'
import { ContextMenu, type MenuEntry } from '../ContextMenu'
import { TransferList } from '../TransferList'
import { FileTable, SearchList } from './FileTable'
import { PathBar } from './PathBar'
import { parentOf, useFileActions } from './useFileActions'

const PREFS_KEY = 'xmt.sftp.prefs'
interface Prefs {
  sortKey: SortKey
  sortDir: SortDir
}

function loadPrefs(): Prefs {
  const fallback: Prefs = { sortKey: 'name', sortDir: 'asc' }
  try {
    return { ...fallback, ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>) }
  } catch {
    return fallback
  }
}

function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    /* storage unavailable — preferences just won't persist */
  }
}

export function SftpPanel({ tab }: { tab: Tab }) {
  const t = useT()
  const showHidden = useApp((s) => s.settings.showHiddenFiles)
  const path = useApp((s) => s.sftpPaths[tab.id])
  const revision = useApp((s) => s.sftpRevision)
  const setSftpPath = useApp((s) => s.setSftpPath)
  const doneUploads = useApp(
    (s) => s.transfers.filter((x) => x.tabId === tab.id && x.direction === 'upload' && x.state === 'done').length
  )
  const [entries, setEntries] = useState<SftpEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<number | null>(null)
  const [filter, setFilter] = useState('')
  const [hits, setHits] = useState<{ root: string; query: string; list: SearchHit[]; truncated: boolean } | null>(null)
  const [searching, setSearching] = useState(false)
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs)
  const panel = usePanelWidth('xmt.sftp.width', 312, 240, 720)
  const [dragOver, setDragOver] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const connected = tab.status === 'connected'
  const api = window.xmt.sftp
  const latestDir = useRef<string | null>(null)

  const visible = useMemo(
    () => sortEntries(filterEntries(entries, filter, showHidden), prefs.sortKey, prefs.sortDir),
    [entries, filter, showHidden, prefs.sortKey, prefs.sortDir]
  )
  const selectedEntries = visible.filter((e) => selected.has(e.path))

  const load = useCallback(
    async (dir: string, keepSelection = false): Promise<void> => {
      latestDir.current = dir
      setLoading(true)
      setError(null)
      try {
        const list = await api.list(tab.id, dir)
        if (latestDir.current !== dir) return
        setEntries(list)
        if (!keepSelection) {
          setSelected(new Set())
          setAnchor(null)
        }
      } catch (err) {
        if (latestDir.current !== dir) return
        setError(errorMessage(err))
        setEntries([])
      } finally {
        if (latestDir.current === dir) setLoading(false)
      }
    },
    [api, tab.id]
  )
  const reload = useCallback(() => void (path && load(path, true)), [path, load])
  const actions = useFileActions(tab.id, path, reload)

  useEffect(() => {
    if (!connected) return
    if (!path) {
      api
        .home(tab.id)
        .then((home) => setSftpPath(tab.id, home))
        .catch((err: unknown) => setError(errorMessage(err)))
      return
    }
    setFilter('')
    setHits(null)
    void load(path)
  }, [connected, path, tab.id, api, load, setSftpPath])

  useEffect(() => {
    if ((doneUploads > 0 || revision > 0) && connected) reload()
  }, [doneUploads, revision]) // only refresh when an upload finishes or a file is saved

  const updatePrefs = (patch: Partial<Prefs>): void => {
    setPrefs((p) => {
      const next = { ...p, ...patch }
      savePrefs(next)
      return next
    })
  }

  const onSort = (key: SortKey): void =>
    updatePrefs(
      prefs.sortKey === key
        ? { sortDir: prefs.sortDir === 'asc' ? 'desc' : 'asc' }
        : { sortKey: key, sortDir: key === 'name' ? 'asc' : 'desc' }
    )

  const navigate = (dir: string): void => setSftpPath(tab.id, dir)

  const runSearch = async (): Promise<void> => {
    const q = filter.trim()
    if (!q || !path) return
    setSearching(true)
    try {
      const result = await api.search(tab.id, path, q)
      if (latestDir.current !== path) return
      setHits({ root: path, query: q, list: result.hits, truncated: result.truncated })
    } catch (err) {
      useApp.getState().toast({ kind: 'error', text: errorMessage(err) })
    } finally {
      setSearching(false)
    }
  }

  const open = (entry: SftpEntry): void => {
    if (entry.isDir) navigate(entry.path)
    else void actions.openInEditor(entry.path, entry.name)
  }

  const select = (e: MouseEvent, idx: number, entry: SftpEntry): void => {
    if (e.shiftKey && anchor !== null) {
      const [a, b] = [Math.min(anchor, idx), Math.max(anchor, idx)]
      setSelected(new Set(visible.slice(a, b + 1).map((x) => x.path)))
      return
    }
    if (e.metaKey) {
      setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(entry.path)) next.delete(entry.path)
        else next.add(entry.path)
        return next
      })
    } else {
      setSelected(new Set([entry.path]))
    }
    setAnchor(idx)
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Backspace' && e.metaKey) actions.remove(selectedEntries)
    else if (e.key === 'Backspace' && path) navigate(parentOf(path))
    else if (e.key === 'Enter' && selectedEntries.length === 1) open(selectedEntries[0])
    else if (e.key === 'a' && e.metaKey) {
      e.preventDefault()
      setSelected(new Set(visible.map((x) => x.path)))
    }
  }

  const onDrop = (e: DragEvent): void => {
    e.preventDefault()
    setDragOver(false)
    actions.upload([...e.dataTransfer.files].map((f) => window.xmt.app.pathForFile(f)).filter(Boolean))
  }

  const single = selectedEntries.length === 1 ? selectedEntries[0] : null
  const menuItems: MenuEntry[] = [
    ...(single && !single.isDir
      ? [{ label: t('openInEditor'), icon: <FilePen size={14} />, onClick: () => open(single) }]
      : []),
    ...(selectedEntries.length > 0
      ? ([
          { label: t('download'), icon: <Download size={14} />, onClick: () => actions.download(selectedEntries, false) },
          { label: t('downloadTo'), icon: <FolderInput size={14} />, onClick: () => actions.download(selectedEntries, true) },
          ...(single
            ? [
                { label: t('rename'), icon: <Pencil size={14} />, onClick: () => actions.rename(single) },
                { label: t('permissions'), icon: <KeyRound size={14} />, onClick: () => actions.chmod(single) }
              ]
            : []),
          { label: t('copyPath'), icon: <ClipboardCopy size={14} />, onClick: () => actions.copyPaths(selectedEntries) },
          'separator'
        ] as MenuEntry[])
      : []),
    { label: t('newFile'), icon: <FilePlus2 size={14} />, onClick: actions.newFile },
    { label: t('newFolder'), icon: <FolderPlus size={14} />, onClick: actions.mkdir },
    { label: t('upload'), icon: <Upload size={14} />, onClick: () => path && void api.uploadDialog(tab.id, path) },
    { label: t('refresh'), icon: <RefreshCw size={14} />, onClick: reload },
    ...(selectedEntries.length > 0
      ? ([
          'separator',
          { label: t('delete'), icon: <Trash2 size={14} />, danger: true, onClick: () => actions.remove(selectedEntries) }
        ] as MenuEntry[])
      : [])
  ]

  if (!connected) {
    return (
      <aside className="sftp" style={{ width: panel.width }}>
        <div className="sftp-head">
          <span className="title">
            <HardDriveDownload size={13} /> {t('sftp')}
          </span>
        </div>
        <div className="sftp-empty">
          <Folder size={28} />
          {t('sftpUnavailable')}
        </div>
      </aside>
    )
  }

  const totalSize = visible.reduce((sum, e) => sum + (e.isDir ? 0 : e.size), 0)
  const selectedSize = selectedEntries.reduce((sum, e) => sum + (e.isDir ? 0 : e.size), 0)

  return (
    <aside
      className="sftp"
      style={{ width: panel.width }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false)
      }}
      onDrop={onDrop}
    >
      <div className="sftp-head">
        <span className="title">
          <HardDriveDownload size={13} /> <span className="title-text">{t('sftp')}</span>
          {(loading || searching) && <Loader2 size={12} className="spin" />}
        </span>
        <button className="icon-btn sm" title={t('up')} onClick={() => path && navigate(parentOf(path))}>
          <ArrowUp size={14} />
        </button>
        <button className="icon-btn sm" title={t('goHome')} onClick={() => void api.home(tab.id).then(navigate)}>
          <House size={13} />
        </button>
        <button className="icon-btn sm" title={t('refresh')} onClick={reload}>
          <RefreshCw size={13} />
        </button>
        <button className="icon-btn sm" title={t('newFile')} onClick={actions.newFile}>
          <FilePlus2 size={14} />
        </button>
        <button className="icon-btn sm" title={t('newFolder')} onClick={actions.mkdir}>
          <FolderPlus size={14} />
        </button>
        <button className="icon-btn sm" title={t('upload')} onClick={() => path && void api.uploadDialog(tab.id, path)}>
          <Upload size={14} />
        </button>
        <button
          className="icon-btn sm"
          title={t('download')}
          disabled={selectedEntries.length === 0}
          onClick={() => actions.download(selectedEntries, false)}
        >
          <Download size={14} />
        </button>
        <button
          className={`icon-btn sm ${showHidden ? 'on' : ''}`}
          title={t('showHidden')}
          onClick={() =>
            void window.xmt.settings.set({ showHiddenFiles: !showHidden }).then((s) => useApp.getState().setSettings(s))
          }
        >
          {showHidden ? <Eye size={13} /> : <EyeOff size={13} />}
        </button>
      </div>

      {path && <PathBar path={path} onNavigate={navigate} />}

      <div className="sftp-search">
        <Search size={13} />
        <input
          value={filter}
          placeholder={t('filterPlaceholder')}
          spellCheck={false}
          onChange={(e) => {
            setFilter(e.target.value)
            if (!e.target.value) setHits(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void runSearch()
            if (e.key === 'Escape') {
              setFilter('')
              setHits(null)
            }
          }}
        />
        {filter && (
          <button className="icon-btn sm" title={t('deepSearch')} onClick={() => void runSearch()}>
            <FolderSearch size={13} />
          </button>
        )}
      </div>

      {hits && (
        <div className="search-banner">
          <span className="truncate">
            {t('searchResults', { n: hits.list.length, query: hits.query })}
            {hits.truncated && ` · ${t('searchTruncated')}`}
          </span>
          <button
            className="icon-btn sm"
            onClick={() => {
              setHits(null)
              setFilter('')
            }}
            title={t('cancel')}
          >
            <X size={12} />
          </button>
        </div>
      )}

      <div
        className="sftp-list"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onClick={(e) => e.target === e.currentTarget && setSelected(new Set())}
        onContextMenu={(e) => {
          e.preventDefault()
          if (!hits) setMenu({ x: e.clientX, y: e.clientY })
        }}
      >
        {hits ? (
          <SearchList
            root={hits.root}
            hits={hits.list}
            onOpen={(hit) => (hit.isDir ? navigate(hit.path) : void actions.openInEditor(hit.path, hit.name))}
            onReveal={(hit) => navigate(hit.isDir ? hit.path : parentOf(hit.path))}
          />
        ) : (
          <FileTable
              placeholder={
                error ? (
                  <div className="sftp-empty" style={{ color: 'var(--danger)' }}>
                    {error}
                  </div>
                ) : !loading && visible.length === 0 ? (
                  <div className="sftp-empty">{filter ? t('nothingFoundHint') : t('emptyFolder')}</div>
                ) : null
              }
              entries={visible}
              selected={selected}
              sortKey={prefs.sortKey}
              sortDir={prefs.sortDir}
              onSort={onSort}
              onRowClick={select}
              onRowOpen={open}
              onRowMenu={(idx, entry) => {
                if (!selected.has(entry.path)) {
                  setSelected(new Set([entry.path]))
                  setAnchor(idx)
                }
              }}
            />
        )}
      </div>

      <div className="sftp-status mono">
        {t('itemsCount', { n: visible.length })} · {formatBytes(totalSize)}
        {selectedEntries.length > 0 && (
          <span className="sel-info">
            {' '}
            · {t('selectedCount', { n: selectedEntries.length })} {formatBytes(selectedSize)}
          </span>
        )}
      </div>

      <TransferList tabId={tab.id} />

      <div className="resize-handle" onMouseDown={panel.startResize} onDoubleClick={panel.reset} title={t('resizeHint')} />

      {dragOver && (
        <div className="drop-overlay">
          <div>
            <Upload size={26} />
            <div>{t('dropToUpload', { path: path ?? '' })}</div>
          </div>
        </div>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </aside>
  )
}
