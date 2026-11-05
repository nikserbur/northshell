import { ChevronDown, ChevronRight, Copy, FileDown, FileUp, History, Library, Pencil, Play, Plus, Search, Trash2, Cookie, Braces } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react'
import type { CookieEntry, HttpHistoryItem, SavedRequest } from '@shared/httpWorkspace'
import type { SessionConfig } from '@shared/types'
import { useT } from '../../lib/useT'
import { errorMessage, formatDate, relativeTime } from '../../lib/util'
import { openSavedRequest, runHttpFolder, updateHttpWorkspace } from '../../store/actions'
import { useApp } from '../../store/appStore'
import { ContextMenu, type MenuEntry } from '../ContextMenu'
import { KeyValueTable } from './KeyValueTable'

type Side = 'collections' | 'history' | 'vars' | 'cookies'

const NO_HISTORY: HttpHistoryItem[] = []
const NO_VARS: Record<string, string> = {}

function statusTone(status: number): string {
  if (status >= 200 && status < 300) return 'ok'
  if (status >= 300 && status < 400) return 'info'
  if (status >= 400 && status < 500) return 'warn'
  return 'bad'
}

function matches(text: string, query: string): boolean {
  return text.toLowerCase().includes(query.trim().toLowerCase())
}

function CollectionsTab({ tabId, session, onNew }: { tabId: string; session: SessionConfig; onNew: () => void }) {
  const t = useT()
  const requests = useApp((s) => s.httpWorkspace.requests)
  const activeId = useApp((s) => s.httpPanels[tabId]?.savedId)
  const openDialog = useApp((s) => s.openDialog)
  const toast = useApp((s) => s.toast)
  const [query, setQuery] = useState('')
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<{ x: number; y: number; request: SavedRequest } | null>(null)

  const groups = useMemo(() => {
    const own = requests.filter((r) => (!r.sessionId || r.sessionId === session.id) && (!query.trim() || matches(`${r.name} ${r.spec.url} ${r.folder}`, query)))
    const byFolder = new Map<string, SavedRequest[]>()
    for (const r of own) byFolder.set(r.folder, [...(byFolder.get(r.folder) ?? []), r])
    return [...byFolder.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [requests, session.id, query])

  const toggle = (folder: string): void => {
    const next = new Set(closed)
    if (next.has(folder)) next.delete(folder)
    else next.add(folder)
    setClosed(next)
  }

  const importFile = (): void => {
    window.xmt.http
      .importCollection(session.id)
      .then((res) => {
        if (!res) return
        useApp.getState().setHttpWorkspace(res.workspace)
        toast({ kind: 'success', text: t('collectionImported', { n: res.count }) })
      })
      .catch((err: unknown) => toast({ kind: 'error', text: errorMessage(err) }))
  }
  const exportFile = (): void => {
    window.xmt.http
      .exportCollection(session.id, session.name)
      .then((path) => path && toast({ kind: 'success', text: t('collectionExported', { path }) }))
      .catch((err: unknown) => toast({ kind: 'error', text: errorMessage(err) }))
  }
  const rename = (r: SavedRequest): void => {
    openDialog({
      kind: 'input',
      title: t('rename'),
      value: r.name,
      confirmLabel: t('httpSave'),
      onSubmit: (name) => {
        if (name.trim()) void updateHttpWorkspace(window.xmt.http.saveRequest({ ...r, name }).then((x) => x.workspace))
      }
    })
  }
  const menuItems = (r: SavedRequest): MenuEntry[] => [
    { label: t('rename'), icon: <Pencil size={14} />, onClick: () => rename(r) },
    {
      label: t('httpDuplicate'),
      icon: <Copy size={14} />,
      onClick: () => void updateHttpWorkspace(window.xmt.http.saveRequest({ name: `${r.name} 2`, folder: r.folder, sessionId: r.sessionId, spec: r.spec }).then((x) => x.workspace))
    },
    'separator',
    { label: t('delete'), icon: <Trash2 size={14} />, danger: true, onClick: () => void updateHttpWorkspace(window.xmt.http.removeRequest(r.id)) }
  ]
  const openMenu = (e: MouseEvent, request: SavedRequest): void => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, request })
  }

  return (
    <>
      <div className="http-side-tools">
        <label className="http-side-search">
          <Search size={12} />
          <input value={query} placeholder={t('collectionsSearch')} spellCheck={false} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <button className="icon-btn sm" onClick={onNew} title={t('httpNewRequest')}>
          <Plus size={14} />
        </button>
        <button className="icon-btn sm" onClick={importFile} title={t('collectionImport')}>
          <FileUp size={14} />
        </button>
        <button className="icon-btn sm" onClick={exportFile} title={t('collectionExport')}>
          <FileDown size={14} />
        </button>
      </div>
      <div className="http-side-scroll">
        {groups.length === 0 && <p className="http-side-empty">{t('collectionsEmpty')}</p>}
        {groups.map(([folder, list]) => (
          <div key={folder} className="http-folder">
            <div className="http-folder-head">
              <button className="http-folder-toggle" onClick={() => toggle(folder)}>
                {closed.has(folder) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                <span className="truncate">{folder || t('collectionNoFolder')}</span>
                <span className="count">{list.length}</span>
              </button>
              <button className="icon-btn sm" onClick={() => void runHttpFolder(tabId, folder || t('collectionNoFolder'), list)} title={t('collectionRun')}>
                <Play size={12} />
              </button>
            </div>
            {!closed.has(folder) &&
              list.map((r) => (
                <button
                  key={r.id}
                  className={`http-request-row ${r.id === activeId ? 'on' : ''}`}
                  onClick={() => openSavedRequest(tabId, r)}
                  onContextMenu={(e) => openMenu(e, r)}
                  title={r.spec.url}
                >
                  <span className={`method-tag m-${r.spec.method.toLowerCase()}`}>{r.spec.method}</span>
                  <span className="truncate">{r.name}</span>
                </button>
              ))}
          </div>
        ))}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.request)} onClose={() => setMenu(null)} />}
    </>
  )
}

function HistoryTab({ tabId, sessionId }: { tabId: string; sessionId: string }) {
  const t = useT()
  const history = useApp((s) => s.httpWorkspace.history[sessionId]) ?? NO_HISTORY
  const language = useApp((s) => s.settings.language)
  const patch = useApp((s) => s.patchHttpPanel)
  const [query, setQuery] = useState('')
  const shown = history.filter((h) => !query.trim() || matches(`${h.spec.method} ${h.spec.url} ${h.status}`, query))
  return (
    <>
      <div className="http-side-tools">
        <label className="http-side-search">
          <Search size={12} />
          <input value={query} placeholder={t('historySearch')} spellCheck={false} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <button className="icon-btn sm" onClick={() => void updateHttpWorkspace(window.xmt.http.clearHistory(sessionId))} title={t('historyClear')} disabled={history.length === 0}>
          <Trash2 size={13} />
        </button>
      </div>
      <div className="http-side-scroll">
        {shown.length === 0 && <p className="http-side-empty">{t('noHistory')}</p>}
        {shown.map((h) => (
          <button
            key={h.id}
            className="http-request-row history"
            title={h.spec.url}
            onClick={() => patch(tabId, { spec: h.spec, savedId: undefined, response: undefined, error: undefined, testResults: undefined, run: undefined })}
          >
            <span className={`method-tag m-${h.spec.method.toLowerCase()}`}>{h.spec.method}</span>
            <span className="truncate">{h.spec.url || '/'}</span>
            <span className={`http-history-status ${statusTone(h.status)}`}>{h.status || '—'}</span>
            <span className="http-history-time">
              {h.timeMs} ms · {relativeTime(h.at, language)}
            </span>
          </button>
        ))}
      </div>
    </>
  )
}

function VarsTab({ sessionId }: { sessionId: string }) {
  const t = useT()
  const vars = useApp((s) => s.httpWorkspace.vars[sessionId]) ?? NO_VARS
  const rows = useMemo(() => Object.entries(vars).map(([name, value]) => ({ name, value, enabled: true })), [vars])
  const change = (next: { name: string; value: string }[]): void => {
    const store = useApp.getState()
    const entries = Object.fromEntries(next.filter((r) => r.name.trim()).map((r) => [r.name.trim(), r.value]))
    store.setHttpWorkspace({ ...store.httpWorkspace, vars: { ...store.httpWorkspace.vars, [sessionId]: entries } })
    void updateHttpWorkspace(window.xmt.http.setVars(sessionId, entries))
  }
  return (
    <div className="http-side-scroll pad">
      <p className="http-hint">{t('varsHint')}</p>
      <KeyValueTable rows={rows} noToggle onChange={change} />
    </div>
  )
}

function CookiesTab({ sessionId }: { sessionId: string }) {
  const t = useT()
  const language = useApp((s) => s.settings.language)
  const toast = useApp((s) => s.toast)
  const lastResponse = useApp((s) => s.httpWorkspace.history[sessionId]?.[0]?.id)
  const [cookies, setCookies] = useState<CookieEntry[]>([])
  const apply = useCallback(
    (change: Promise<CookieEntry[]>) => {
      change.then(setCookies).catch((err: unknown) => toast({ kind: 'error', text: errorMessage(err) }))
    },
    [toast]
  )
  useEffect(() => apply(window.xmt.http.cookies(sessionId)), [sessionId, lastResponse, apply])
  return (
    <>
      <div className="http-side-tools end">
        <button className="btn sm ghost" disabled={cookies.length === 0} onClick={() => apply(window.xmt.http.removeCookies(sessionId))}>
          <Trash2 size={13} /> {t('cookiesClear')}
        </button>
      </div>
      <div className="http-side-scroll">
        {cookies.length === 0 && <p className="http-side-empty">{t('cookiesEmpty')}</p>}
        {cookies.map((c) => (
          <div key={`${c.domain}${c.path}${c.name}`} className="http-cookie-row">
            <div className="truncate" title={c.value}>
              <b>{c.name}</b> <span className="mono">{c.value}</span>
            </div>
            <span className="http-history-time truncate">
              {c.domain}
              {c.path} · {c.expires ? formatDate(c.expires * 1000, language) : t('cookieSession')}
            </span>
            <button className="icon-btn sm" title={t('delete')} onClick={() => apply(window.xmt.http.removeCookies(sessionId, { domain: c.domain, path: c.path, name: c.name }))}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </>
  )
}

/** Left column of the workspace: saved requests, history, variables and cookies of this environment. */
export function CollectionsSidebar({ tabId, session, onNew }: { tabId: string; session: SessionConfig; onNew: () => void }) {
  const t = useT()
  const [side, setSide] = useState<Side>('collections')
  const tabs: { id: Side; label: string; icon: typeof History }[] = [
    { id: 'collections', label: t('sideCollections'), icon: Library },
    { id: 'history', label: t('sideHistory'), icon: History },
    { id: 'vars', label: t('sideVars'), icon: Braces },
    { id: 'cookies', label: t('sideCookies'), icon: Cookie }
  ]
  return (
    <div className="http-side">
      <div className="http-side-tabs" role="tablist">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} role="tab" aria-selected={side === id} className={side === id ? 'on' : ''} onClick={() => setSide(id)} title={label}>
            <Icon size={14} />
          </button>
        ))}
      </div>
      {side === 'collections' && <CollectionsTab tabId={tabId} session={session} onNew={onNew} />}
      {side === 'history' && <HistoryTab tabId={tabId} sessionId={session.id} />}
      {side === 'vars' && <VarsTab sessionId={session.id} />}
      {side === 'cookies' && <CookiesTab sessionId={session.id} />}
    </div>
  )
}
