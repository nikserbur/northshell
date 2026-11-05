import {
  ArrowRight,
  ClipboardCopy,
  ClipboardPaste,
  Code2,
  Loader2,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  PanelLeft,
  Save,
  Send,
  SquareTerminal,
  Trash2,
  X
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import { bodyKindOf, parseHeaderRows, parseQuery } from '@shared/httpBody'
import { parseHeaders } from '@shared/httpEnv'
import { HTTP_METHODS, buildCurlCommand, emptyRequest, isCurlCommand, resolveRequestUrl, type HttpMethod, type HttpRequestSpec } from '@shared/httpRequest'
import { fillRequest, requestPlaceholders } from '@shared/httpVars'
import type { SessionConfig } from '@shared/types'
import { usePanelWidth } from '../../hooks/usePanelWidth'
import { useT } from '../../lib/useT'
import { errorMessage } from '../../lib/util'
import { cancelHttpRequest, loadCurlIntoPanel, saveHttpRequest, sendCommand, sendHttpRequest, setHttpVars, setPanelOpen } from '../../store/actions'
import { EMPTY_HTTP_PANEL, useApp, type Tab } from '../../store/appStore'
import { ContextMenu, type MenuEntry } from '../ContextMenu'
import { CollectionsSidebar } from './CollectionsSidebar'
import { RequestEditor, type RequestSection } from './RequestEditor'
import { ResponseView } from './ResponseView'
import { RunnerView } from './RunnerView'

const NO_VARS: Record<string, string> = {}
const LIBRARY_NAME_MAX = 60
const SPLIT_KEY = 'xmt.http.split'
const SIDE_KEY = 'xmt.http.side'
const MIN_SPLIT = 20
const MAX_SPLIT = 80

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

function readSplit(): number {
  try {
    const v = Number(localStorage.getItem(SPLIT_KEY))
    return v >= MIN_SPLIT && v <= MAX_SPLIT ? v : 50
  } catch {
    return 50
  }
}

function readSideOpen(): boolean {
  try {
    return localStorage.getItem(SIDE_KEY) !== '0'
  } catch {
    return true
  }
}

/** Request builder for an HTTP environment: a Postman-style workspace instead of hand-written curl. */
export function HttpPanel({ tab, session, onClose }: { tab: Tab; session: SessionConfig; onClose: () => void }) {
  const t = useT()
  const panel = useApp((s) => s.httpPanels[tab.id]) ?? EMPTY_HTTP_PANEL
  const vars = useApp((s) => s.httpWorkspace.vars[session.id]) ?? NO_VARS
  const expanded = useApp((s) => s.settings.httpPanelExpanded)
  const savedRequest = useApp((s) => s.httpWorkspace.requests.find((r) => r.id === panel.savedId))
  const patch = useApp((s) => s.patchHttpPanel)
  const openDialog = useApp((s) => s.openDialog)
  const toast = useApp((s) => s.toast)
  const [section, setSection] = useState<RequestSection>(() => (bodyKindOf(panel.spec) !== 'none' ? 'body' : 'params'))
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [sideOpen, setSideOpen] = useState(readSideOpen)
  const [split, setSplit] = useState(readSplit)
  const editorRef = useRef<HTMLDivElement>(null)
  const width = usePanelWidth('xmt.http.width', 520, 340, 1100, 'left')

  const { spec } = panel
  const envHeaders = useMemo(() => parseHeaders(session.headers).headers.map((h) => h.name), [session.headers])
  const params = useMemo(() => requestPlaceholders(spec), [spec])
  const filled = useMemo(() => fillRequest(spec, vars), [spec, vars])
  const resolved = resolveRequestUrl(session.baseUrl, filled.url)
  const foreignHost = resolved !== null && originOf(resolved) !== originOf(session.baseUrl)
  const connected = tab.status === 'connected'
  const canSend = connected && resolved !== null && !panel.pending
  const dirty = savedRequest !== undefined && JSON.stringify(savedRequest.spec) !== JSON.stringify(spec)
  const showSide = expanded && sideOpen

  // The panel covers the terminal only while it is open: closing it must bring the terminal back at full size.
  useEffect(() => {
    try {
      localStorage.setItem(SIDE_KEY, sideOpen ? '1' : '0')
    } catch {
      /* the choice is only a convenience */
    }
  }, [sideOpen])

  const setSpec = (p: Partial<HttpRequestSpec>): void => patch(tab.id, { spec: { ...spec, ...p } })
  const send = (): void => {
    if (canSend) void sendHttpRequest(tab.id)
  }
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!(e.metaKey || e.ctrlKey)) return
    if (e.key === 'Enter') {
      e.preventDefault()
      send()
    } else if (e.key.toLowerCase() === 's' && !e.shiftKey) {
      e.preventDefault()
      void saveHttpRequest(tab.id)
    }
  }

  const copy = (text: string): void => {
    navigator.clipboard
      .writeText(text)
      .then(() => toast({ kind: 'success', text: t('copied') }))
      .catch((err: unknown) => toast({ kind: 'error', text: errorMessage(err) }))
  }

  const importCurl = (text: string): boolean => {
    const warnings = loadCurlIntoPanel(tab.id, text)
    if (warnings === null) return false
    if (warnings.length > 0) toast({ kind: 'info', text: t('importCurlWarnings', { opts: warnings.join(', ') }) })
    return true
  }

  /** A curl command pasted into the address field fills the whole form. */
  const onUrlPaste = (e: ClipboardEvent<HTMLInputElement>): void => {
    const text = e.clipboardData.getData('text')
    if (isCurlCommand(text) && importCurl(text)) e.preventDefault()
  }

  const newRequest = (): void => patch(tab.id, { spec: emptyRequest(), savedId: undefined, response: undefined, error: undefined, testResults: undefined, run: undefined })

  const saveToLibrary = (): void => {
    const name = `${spec.method} ${spec.url.trim() || '/'}`.slice(0, LIBRARY_NAME_MAX)
    openDialog({ kind: 'command-editor', sessionId: session.id, draft: { name, command: buildCurlCommand(spec, envHeaders) } })
  }

  const curlOf = (): string | null => {
    try {
      return buildCurlCommand(filled, envHeaders)
    } catch (err) {
      toast({ kind: 'error', text: errorMessage(err) })
      return null
    }
  }

  const runInTerminal = (): void => {
    const curl = curlOf()
    if (!curl) return
    if (expanded) setPanelOpen('httpPanelExpanded', false)
    sendCommand(tab.id, curl, true)
  }

  const moreMenu: MenuEntry[] = [
    { label: t('httpSaveAs'), icon: <Save size={14} />, onClick: () => openDialog({ kind: 'http-save', tabId: tab.id }) },
    { label: t('saveToLibrary'), icon: <Save size={14} />, onClick: saveToLibrary },
    'separator',
    ...(connected && resolved ? [{ label: t('runInTerminal'), icon: <SquareTerminal size={14} />, onClick: runInTerminal }] : []),
    {
      label: t('copyAsCurl'),
      icon: <ClipboardCopy size={14} />,
      onClick: () => {
        const curl = curlOf()
        if (curl) copy(curl)
      }
    },
    { label: t('importCurl'), icon: <ClipboardPaste size={14} />, onClick: () => openDialog({ kind: 'http-import', tabId: tab.id }) },
    'separator',
    { label: t('resetRequest'), icon: <Trash2 size={14} />, onClick: newRequest }
  ]

  const startSplit = (e: PointerEvent<HTMLDivElement>): void => {
    const host = editorRef.current
    if (!host) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const rect = host.getBoundingClientRect()
    const vertical = rect.width >= 720
    const onMove = (ev: globalThis.PointerEvent): void => {
      const raw = vertical ? ((ev.clientX - rect.left) / rect.width) * 100 : ((ev.clientY - rect.top) / rect.height) * 100
      setSplit(Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, raw)))
    }
    const target = e.currentTarget
    const onUp = (): void => {
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      setSplit((value) => {
        try {
          localStorage.setItem(SPLIT_KEY, String(value))
        } catch {
          /* the split is only a convenience */
        }
        return value
      })
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
  }

  const queryCount = parseQuery(spec.url).params.length
  const headerCount = parseHeaderRows(spec.headers).filter((r) => r.enabled).length
  const testCount = (spec.tests?.length ?? 0) + (spec.extract?.length ?? 0)
  const authOn = spec.auth !== undefined && spec.auth.type !== 'none'
  const bodyOn = bodyKindOf(spec) !== 'none'
  const sections: { id: RequestSection; label: string; count?: number | string; off?: boolean }[] = [
    { id: 'params', label: t('httpTabParams'), count: queryCount || undefined },
    { id: 'auth', label: t('httpTabAuth'), count: authOn ? '•' : undefined },
    { id: 'headers', label: t('requestHeaders'), count: headerCount || undefined },
    { id: 'body', label: t('requestBody'), count: bodyOn ? '•' : undefined, off: spec.method === 'HEAD' },
    { id: 'tests', label: t('httpTabTests'), count: testCount || undefined },
    { id: 'settings', label: t('httpTabSettings') }
  ]

  return (
    <aside className={`http-panel ${expanded ? 'expanded' : 'side'}`} style={expanded ? undefined : { width: width.width }} onKeyDown={onKeyDown}>
      <div className="http-top">
        {expanded && (
          <button className={`icon-btn sm ${sideOpen ? 'active' : ''}`} onClick={() => setSideOpen(!sideOpen)} title={t('httpShowCollections')} aria-pressed={sideOpen}>
            <PanelLeft size={14} />
          </button>
        )}
        <span className="http-top-title truncate">
          <Send size={13} /> <b className="truncate">{session.name}</b>
          {savedRequest && <span className="http-top-request truncate">/ {savedRequest.name}</span>}
          {dirty && <i className="http-dirty" title={t('unsavedDot')} />}
        </span>
        <button className="icon-btn sm" onClick={() => openDialog({ kind: 'http-code', tabId: tab.id })} title={t('httpGenerateCode')}>
          <Code2 size={14} />
        </button>
        <button className="icon-btn sm" onClick={() => openDialog({ kind: 'http-import', tabId: tab.id })} title={t('importCurl')}>
          <ClipboardPaste size={14} />
        </button>
        <button
          className="icon-btn sm"
          onClick={(e: MouseEvent) => {
            const r = e.currentTarget.getBoundingClientRect()
            setMenu({ x: r.left, y: r.bottom + 4 })
          }}
          title={t('libraryMenu')}
        >
          <MoreHorizontal size={14} />
        </button>
        <button className="icon-btn sm" onClick={() => setPanelOpen('httpPanelExpanded', !expanded)} title={expanded ? t('httpCollapse') : t('httpExpand')}>
          {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        <button className="icon-btn sm" onClick={onClose} title={`${t('close')} ⇧⌘R`}>
          <X size={13} />
        </button>
      </div>

      <div className="http-ws">
        {showSide && <CollectionsSidebar tabId={tab.id} session={session} onNew={newRequest} />}
        <div className="http-main">
          <div className="http-line">
            <select
              className={`input http-method m-${spec.method.toLowerCase()}`}
              value={spec.method}
              aria-label="HTTP method"
              onChange={(e) => setSpec({ method: e.target.value as HttpMethod })}
            >
              {HTTP_METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <input
              className={`input mono grow ${spec.url && !resolved ? 'invalid' : ''}`}
              value={spec.url}
              placeholder={t('requestPath')}
              spellCheck={false}
              onPaste={onUrlPaste}
              onChange={(e) => setSpec({ url: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && !e.metaKey && send()}
            />
            {panel.pending ? (
              <button className="btn" onClick={() => cancelHttpRequest(tab.id)} title={t('cancel')}>
                <Loader2 size={13} className="spin" />
              </button>
            ) : (
              <button className="btn primary http-send" disabled={!canSend} onClick={send} title={`${t('sendRequest')} ⌘↩`}>
                <Send size={13} /> {t('sendRequest')}
              </button>
            )}
            <button className="btn http-save" onClick={() => void saveHttpRequest(tab.id)} title={`${t('httpSave')} ⌘S`}>
              <Save size={13} />
            </button>
          </div>
          <div className={`http-resolved mono truncate ${resolved ? '' : 'err'}`} title={resolved ?? undefined}>
            {!connected ? (
              t('envClosed')
            ) : resolved ? (
              <>
                <ArrowRight size={11} /> <span className="truncate">{resolved}</span>
                {foreignHost && <span className="http-foreign">{t('foreignHost')}</span>}
              </>
            ) : (
              t('invalidRequestUrl')
            )}
          </div>

          {params.length > 0 && (
            <div className="http-params">
              <span className="field-label">{t('requestParams')}</span>
              {params.map((p) => (
                <label key={p.name} className="http-param">
                  <span className="mono">{p.name}</span>
                  <input
                    className="input mono"
                    value={vars[p.name] ?? ''}
                    placeholder={p.fallback}
                    spellCheck={false}
                    onChange={(e) => setHttpVars(session.id, { [p.name]: e.target.value })}
                  />
                </label>
              ))}
            </div>
          )}

          <div ref={editorRef} className="http-editor" style={{ '--http-split': `${split}%` } as React.CSSProperties}>
            <section className="http-request-pane">
              <div className="http-tabs" role="tablist">
                {sections.map((x) => (
                  <button key={x.id} role="tab" aria-selected={section === x.id} className={section === x.id ? 'on' : ''} disabled={x.off} onClick={() => setSection(x.id)}>
                    {x.label} {x.count !== undefined && <span className="count">{x.count}</span>}
                  </button>
                ))}
              </div>
              <RequestEditor spec={spec} setSpec={setSpec} session={session} envHeaders={envHeaders} section={section === 'body' && spec.method === 'HEAD' ? 'headers' : section} />
            </section>
            <div className="http-divider" onPointerDown={startSplit} title={t('resizeHint')} />
            <section className="http-response">
              {panel.run ? (
                <RunnerView tabId={tab.id} run={panel.run} />
              ) : (
                <ResponseView
                  tabId={tab.id}
                  response={panel.response}
                  pending={panel.pending}
                  error={panel.error}
                  testResults={panel.testResults}
                  onCancel={() => cancelHttpRequest(tab.id)}
                  onCopy={copy}
                />
              )}
            </section>
          </div>
        </div>
      </div>

      {!expanded && <div className="resize-handle" onMouseDown={width.startResize} onDoubleClick={width.reset} title={t('resizeHint')} />}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={moreMenu} onClose={() => setMenu(null)} />}
    </aside>
  )
}
