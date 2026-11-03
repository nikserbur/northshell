import {
  ArrowRight,
  ClipboardCopy,
  ClipboardPaste,
  History,
  Loader2,
  MoreHorizontal,
  Save,
  Send,
  SquareTerminal,
  Trash2,
  WandSparkles,
  X
} from 'lucide-react'
import { useMemo, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { parseHeaders } from '@shared/httpEnv'
import {
  HTTP_METHODS,
  buildCurlCommand,
  emptyRequest,
  formatJson,
  isCurlCommand,
  looksLikeJson,
  resolveRequestUrl,
  type HttpMethod,
  type HttpRequestSpec
} from '@shared/httpRequest'
import { placeholders } from '@shared/snippets'
import type { SessionConfig } from '@shared/types'
import { usePanelWidth } from '../../hooks/usePanelWidth'
import { useT } from '../../lib/useT'
import { errorMessage, relativeTime } from '../../lib/util'
import { cancelHttpRequest, fillRequest, loadCurlIntoPanel, sendCommand, sendHttpRequest } from '../../store/actions'
import { EMPTY_HTTP_PANEL, useApp, type HttpHistoryItem, type Tab } from '../../store/appStore'
import { ContextMenu, type MenuEntry } from '../ContextMenu'
import { ResponseView } from './ResponseView'

const NO_HISTORY: HttpHistoryItem[] = []
const LIBRARY_NAME_MAX = 60

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

type MenuState = { x: number; y: number; kind: 'more' | 'history' }

/** Request builder for an HTTP environment: a form instead of hand-written curl, with the response beside the terminal. */
export function HttpPanel({ tab, session, onClose }: { tab: Tab; session: SessionConfig; onClose: () => void }) {
  const t = useT()
  const panel = useApp((s) => s.httpPanels[tab.id]) ?? EMPTY_HTTP_PANEL
  const history = useApp((s) => s.httpHistory[session.id]) ?? NO_HISTORY
  const language = useApp((s) => s.settings.language)
  const patch = useApp((s) => s.patchHttpPanel)
  const openDialog = useApp((s) => s.openDialog)
  const toast = useApp((s) => s.toast)
  const [section, setSection] = useState<'headers' | 'body'>(() => (panel.spec.body ? 'body' : 'headers'))
  const [menu, setMenu] = useState<MenuState | null>(null)
  const width = usePanelWidth('xmt.http.width', 440, 340, 900, 'left')

  const { spec, vars } = panel
  const envHeaders = useMemo(() => parseHeaders(session.headers).headers.map((h) => h.name), [session.headers])
  const params = useMemo(() => placeholders(`${spec.url}\n${spec.headers}\n${spec.body}`), [spec.url, spec.headers, spec.body])
  const filled = fillRequest(spec, vars)
  const resolved = resolveRequestUrl(session.baseUrl, filled.url)
  const foreignHost = resolved !== null && originOf(resolved) !== originOf(session.baseUrl)
  const connected = tab.status === 'connected'
  const canSend = connected && resolved !== null && !panel.pending
  const headerCount = spec.headers.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).length
  const bodyIsJson = looksLikeJson(spec.body)
  const hasContentType = /^\s*content-type\s*:/im.test(spec.headers) || envHeaders.some((n) => n.toLowerCase() === 'content-type')

  const setSpec = (p: Partial<HttpRequestSpec>): void => patch(tab.id, { spec: { ...spec, ...p } })
  const setVar = (name: string, value: string): void => patch(tab.id, { vars: { ...vars, [name]: value } })
  const send = (): void => {
    if (canSend) void sendHttpRequest(tab.id)
  }
  const sendOnCmdEnter = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      send()
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

  const formatBody = (): void => {
    const formatted = formatJson(spec.body)
    if (formatted !== null) setSpec({ body: formatted })
  }

  const saveToLibrary = (): void => {
    const name = `${spec.method} ${spec.url.trim() || '/'}`.slice(0, LIBRARY_NAME_MAX)
    openDialog({ kind: 'command-editor', sessionId: session.id, draft: { name, command: buildCurlCommand(spec, envHeaders) } })
  }

  const openMenu = (e: MouseEvent, kind: MenuState['kind']): void => {
    const r = e.currentTarget.getBoundingClientRect()
    setMenu({ x: r.left, y: r.bottom + 4, kind })
  }

  const moreMenu: MenuEntry[] = [
    { label: t('copyAsCurl'), icon: <ClipboardCopy size={14} />, onClick: () => copy(buildCurlCommand(filled, envHeaders)) },
    { label: t('importCurl'), icon: <ClipboardPaste size={14} />, onClick: () => openDialog({ kind: 'http-import', tabId: tab.id }) },
    'separator',
    {
      label: t('resetRequest'),
      icon: <Trash2 size={14} />,
      onClick: () => patch(tab.id, { spec: emptyRequest(), vars: {}, response: undefined, error: undefined })
    }
  ]

  const historyMenu: MenuEntry[] =
    history.length === 0
      ? [{ label: t('noHistory'), onClick: () => undefined }]
      : history.map((h) => ({
          label: `${h.status || '—'}  ${h.spec.method} ${h.spec.url || '/'}  · ${relativeTime(h.at, language)}`,
          onClick: () => patch(tab.id, { spec: h.spec, response: undefined, error: undefined })
        }))

  return (
    <aside className="sftp http-panel" style={{ width: width.width }} onKeyDown={sendOnCmdEnter}>
      <div className="sftp-head">
        <span className="title">
          <Send size={13} /> <span className="title-text">{t('httpPanel')}</span>
        </span>
        <button className="icon-btn sm" onClick={() => openDialog({ kind: 'http-import', tabId: tab.id })} title={t('importCurl')}>
          <ClipboardPaste size={14} />
        </button>
        <button className="icon-btn sm" onClick={(e) => openMenu(e, 'history')} title={t('requestHistory')}>
          <History size={14} />
        </button>
        <button className="icon-btn sm" onClick={(e) => openMenu(e, 'more')} title={t('libraryMenu')}>
          <MoreHorizontal size={14} />
        </button>
        <button className="icon-btn sm" onClick={onClose} title={`${t('close')} ⇧⌘R`}>
          <X size={13} />
        </button>
      </div>

      <div className="http-form">
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
            <button className="btn primary" disabled={!canSend} onClick={send} title={`${t('sendRequest')} ⌘↩`}>
              <Send size={13} /> {t('sendRequest')}
            </button>
          )}
        </div>
        <div className={`http-resolved mono truncate ${resolved ? '' : 'err'}`} title={resolved ?? undefined}>
          {!connected ? t('envClosed') : resolved ? (
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
                  onChange={(e) => setVar(p.name, e.target.value)}
                />
              </label>
            ))}
          </div>
        )}

        <div className="http-tabs">
          <div className="segmented sm">
            <button className={section === 'headers' ? 'on' : ''} onClick={() => setSection('headers')}>
              {t('requestHeaders')} {headerCount > 0 && <span className="count">{headerCount}</span>}
            </button>
            <button className={section === 'body' ? 'on' : ''} onClick={() => setSection('body')} disabled={spec.method === 'HEAD'}>
              {t('requestBody')} {spec.body.trim() && <span className="count">•</span>}
            </button>
          </div>
          {section === 'body' && bodyIsJson && (
            <button className="btn sm ghost" onClick={formatBody} title={t('formatJson')}>
              <WandSparkles size={12} /> {t('formatJson')}
            </button>
          )}
        </div>

        {section === 'headers' || spec.method === 'HEAD' ? (
          <>
            <textarea
              className="input mono http-text"
              rows={4}
              value={spec.headers}
              spellCheck={false}
              placeholder={'X-Request-Id: 42\nAuthorization: Bearer $TOKEN'}
              onChange={(e) => setSpec({ headers: e.target.value })}
            />
            {envHeaders.length > 0 && <span className="http-hint">{t('envAddsHeaders', { names: envHeaders.join(', ') })}</span>}
          </>
        ) : (
          <>
            <textarea
              className="input mono http-text"
              rows={7}
              value={spec.body}
              spellCheck={false}
              placeholder={'{\n  "name": "value"\n}'}
              onChange={(e) => setSpec({ body: e.target.value })}
            />
            {spec.body.trim() && (
              <span className="http-hint">{bodyIsJson ? (hasContentType ? 'JSON ✓' : t('jsonContentTypeAuto')) : t('notJsonBody')}</span>
            )}
          </>
        )}

        <div className="http-actions">
          <label className="http-check">
            <input type="checkbox" checked={spec.followRedirects} onChange={(e) => setSpec({ followRedirects: e.target.checked })} />
            {t('followRedirects')}
          </label>
          <button
            className="btn sm ghost"
            disabled={!connected || !resolved}
            onClick={() => sendCommand(tab.id, buildCurlCommand(filled, envHeaders), true)}
            title={t('runInTerminal')}
          >
            <SquareTerminal size={13} /> {t('runInTerminal')}
          </button>
          <button className="btn sm ghost" onClick={saveToLibrary} title={t('saveToLibrary')}>
            <Save size={13} /> {t('saveToLibrary')}
          </button>
        </div>
      </div>

      <div className="http-response">
        <ResponseView
          response={panel.response}
          pending={panel.pending}
          error={panel.error}
          onCancel={() => cancelHttpRequest(tab.id)}
          onCopy={copy}
        />
      </div>

      <div className="resize-handle" onMouseDown={width.startResize} onDoubleClick={width.reset} title={t('resizeHint')} />
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.kind === 'more' ? moreMenu : historyMenu} onClose={() => setMenu(null)} />
      )}
    </aside>
  )
}
