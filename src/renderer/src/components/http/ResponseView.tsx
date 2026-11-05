import { AlertTriangle, Check, ClipboardCopy, Download, Loader2, Send, WrapText, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { formatBytes } from '@shared/format'
import { prettyBody, type HttpResponseInfo, type ResponseTiming } from '@shared/httpRequest'
import type { TestResult } from '@shared/httpTests'
import type { I18nKey } from '../../lib/i18n'
import { useT } from '../../lib/useT'
import { errorMessage } from '../../lib/util'
import { useApp } from '../../store/appStore'
import { CodeView } from './CodeView'

type ResponseTab = 'body' | 'headers' | 'cookies' | 'timing' | 'timeline' | 'tests'
type BodyMode = 'pretty' | 'raw' | 'preview'

function statusClass(status: number): string {
  if (status >= 200 && status < 300) return 'ok'
  if (status >= 300 && status < 400) return 'info'
  if (status >= 400 && status < 500) return 'warn'
  return 'bad'
}

const LANGUAGE_FILES: [RegExp, string][] = [
  [/json/, 'body.json'],
  [/html/, 'body.html'],
  [/xml/, 'body.xml'],
  [/javascript|ecmascript/, 'body.js'],
  [/css/, 'body.css'],
  [/yaml/, 'body.yaml']
]

function languageFile(contentType: string, json: boolean): string | undefined {
  if (json) return 'body.json'
  return LANGUAGE_FILES.find(([re]) => re.test(contentType.toLowerCase()))?.[1]
}

interface ParsedCookie {
  name: string
  value: string
  attrs: string
}

function responseCookies(response: HttpResponseInfo): ParsedCookie[] {
  return response.headers
    .filter((h) => h.name.toLowerCase() === 'set-cookie')
    .map((h) => {
      const [pair = '', ...attrs] = h.value.split(';')
      const eq = pair.indexOf('=')
      return { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim(), attrs: attrs.map((a) => a.trim()).join('; ') }
    })
}

const PHASES: { key: keyof ResponseTiming; label: I18nKey }[] = [
  { key: 'dns', label: 'timingDns' },
  { key: 'connect', label: 'timingConnect' },
  { key: 'tls', label: 'timingTls' },
  { key: 'wait', label: 'timingWait' },
  { key: 'download', label: 'timingDownload' }
]

function TimingView({ response }: { response: HttpResponseInfo }) {
  const t = useT()
  const timing = response.timing
  const total = timing ? PHASES.reduce((sum, p) => sum + timing[p.key], 0) : 0
  let offset = 0
  return (
    <div className="http-timing">
      {timing &&
        PHASES.map((p) => {
          const left = total > 0 ? (offset / total) * 100 : 0
          const width = total > 0 ? (timing[p.key] / total) * 100 : 0
          offset += timing[p.key]
          return (
            <div key={p.key} className={`timing-row t-${p.key}`}>
              <span>{t(p.label)}</span>
              <span className="timing-track">
                <i style={{ left: `${left}%`, width: `max(2px, ${width}%)` }} />
              </span>
              <b>{timing[p.key]} ms</b>
            </div>
          )
        })}
      <dl className="http-headers">
        <div>
          <dt>{t('timingTotal')}</dt>
          <dd>{response.timeMs} ms</dd>
        </div>
        {response.remoteIp && (
          <div>
            <dt>{t('timingAddress')}</dt>
            <dd>{response.remoteIp}</dd>
          </div>
        )}
        {Boolean(response.uploadBytes) && (
          <div>
            <dt>{t('timingUpload')}</dt>
            <dd>{formatBytes(response.uploadBytes ?? 0)}</dd>
          </div>
        )}
        <div>
          <dt>HTTP</dt>
          <dd>{response.httpVersion}</dd>
        </div>
        <div>
          <dt>URL</dt>
          <dd>{response.url}</dd>
        </div>
      </dl>
    </div>
  )
}

function TestsView({ results }: { results: TestResult[] }) {
  const t = useT()
  if (results.length === 0) return <div className="http-note">{t('respNoTests')}</div>
  return (
    <ul className="test-results">
      {results.map((r, i) => (
        <li key={i} className={r.pass ? 'pass' : 'fail'}>
          {r.pass ? <Check size={13} /> : <X size={13} />}
          <span className="mono">
            {r.rule.target}
            {r.rule.path ? ` ${r.rule.path}` : ''} {r.rule.op} {r.rule.op === 'exists' ? '' : r.rule.value}
          </span>
          {!r.pass && <em className="truncate">{t('testActual', { value: r.actual || '—' })}</em>}
        </li>
      ))}
    </ul>
  )
}

function BodyView({ response, mode, wrap }: { response: HttpResponseInfo; mode: BodyMode; wrap: boolean }) {
  const t = useT()
  const pretty = useMemo(() => prettyBody(response.body), [response])
  const failed = response.status === 0
  if (mode === 'preview') {
    if (response.bodyBase64) {
      return (
        <div className="http-preview-image">
          <img src={`data:${response.contentType.split(';')[0]};base64,${response.bodyBase64}`} alt="" />
        </div>
      )
    }
    // No allow-* flags: the page cannot run scripts or reach the app, and the CSP keeps external resources out.
    return <iframe className="http-preview" sandbox="" srcDoc={response.body} title={t('respPreview')} />
  }
  if (response.binary) return <div className="http-note pad">{t('binaryBody', { size: formatBytes(response.bodyBytes) })}</div>
  if (!response.body) return failed ? null : <div className="http-note pad">{t('emptyBody')}</div>
  return (
    <>
      {response.truncated && <div className="http-note pad">{t('bodyTruncated', { size: formatBytes(response.body.length) })}</div>}
      <div className="http-body">
        <CodeView value={mode === 'raw' ? response.body : pretty.text} languageFile={mode === 'raw' ? undefined : languageFile(response.contentType, pretty.json)} wrap={wrap} />
      </div>
    </>
  )
}

interface Props {
  tabId: string
  response?: HttpResponseInfo
  pending: boolean
  error?: string
  testResults?: TestResult[]
  onCancel: () => void
  onCopy: (text: string) => void
}

export function ResponseView({ tabId, response, pending, error, testResults, onCancel, onCopy }: Props) {
  const t = useT()
  const toast = useApp((s) => s.toast)
  const [tab, setTab] = useState<ResponseTab>('body')
  const [mode, setMode] = useState<BodyMode>('pretty')
  const [wrap, setWrap] = useState(true)
  const pretty = useMemo(() => (response ? prettyBody(response.body) : null), [response])

  if (pending) {
    return (
      <div className="http-resp-empty">
        <Loader2 size={20} className="spin" />
        <span>{t('sending')}</span>
        <button className="btn sm ghost" onClick={onCancel}>
          <X size={13} /> {t('cancel')}
        </button>
      </div>
    )
  }
  if (error) {
    return (
      <div className="http-resp-scroll">
        <div className="callout danger">
          <AlertTriangle size={15} />
          <span>{error}</span>
        </div>
      </div>
    )
  }
  if (!response || !pretty) {
    return (
      <div className="http-resp-empty">
        <Send size={22} />
        <span>{t('noResponseYet')}</span>
      </div>
    )
  }

  const failed = response.status === 0
  const results = testResults ?? []
  const passed = results.filter((r) => r.pass).length
  const cookies = responseCookies(response)
  const canPreview = /html/i.test(response.contentType) || Boolean(response.bodyBase64)
  const shownMode = mode === 'preview' && !canPreview ? 'pretty' : mode
  const headersText = response.headers.map((h) => `${h.name}: ${h.value}`).join('\n')
  const fileName = (): string => {
    const name = response.url.split(/[?#]/)[0].split('/').pop()
    return name || 'response'
  }
  const save = (): void => {
    window.xmt.http
      .saveResponse(tabId, fileName())
      .then((path) => path && toast({ kind: 'success', text: t('respSaved', { path }) }))
      .catch((err: unknown) => toast({ kind: 'error', text: errorMessage(err) }))
  }
  const tabs: { id: ResponseTab; label: string; count?: number | string }[] = [
    { id: 'body', label: t('requestBody') },
    { id: 'headers', label: t('requestHeaders'), count: response.headers.length },
    { id: 'cookies', label: t('respTabCookies'), count: cookies.length || undefined },
    { id: 'timing', label: t('respTabTiming') },
    { id: 'timeline', label: t('respTabTimeline') },
    { id: 'tests', label: t('respTabTests'), count: results.length ? `${passed}/${results.length}` : undefined }
  ]

  return (
    <>
      <div className="http-resp-head">
        <span className={`http-status ${failed ? 'bad' : statusClass(response.status)}`}>
          {failed ? t('responseFailed') : `${response.status} ${response.statusText}`.trim()}
        </span>
        <span className="http-resp-meta truncate" title={response.url}>
          {[`${response.timeMs} ms`, formatBytes(response.bodyBytes), response.contentType.split(';')[0], response.redirects > 0 ? t('redirectsCount', { n: response.redirects }) : '']
            .filter(Boolean)
            .join(' · ')}
        </span>
        {results.length > 0 && <span className={`http-tests-badge ${passed === results.length ? 'pass' : 'fail'}`}>{t('testsPassed', { pass: passed, total: results.length })}</span>}
        <button className="icon-btn sm" title={t('respSave')} onClick={save} disabled={failed}>
          <Download size={13} />
        </button>
        <button
          className="icon-btn sm"
          title={t('copyResponse')}
          onClick={() => onCopy(tab === 'headers' ? headersText : tab === 'timeline' ? (response.timeline ?? '') : mode === 'raw' ? response.body : pretty.text)}
        >
          <ClipboardCopy size={13} />
        </button>
      </div>
      <div className="http-resp-tabs" role="tablist">
        {tabs.map((x) => (
          <button key={x.id} role="tab" aria-selected={tab === x.id} className={tab === x.id ? 'on' : ''} onClick={() => setTab(x.id)}>
            {x.label} {x.count !== undefined && <span className="count">{x.count}</span>}
          </button>
        ))}
      </div>
      {tab === 'body' && (
        <div className="http-resp-modes">
          <div className="segmented sm">
            <button className={shownMode === 'pretty' ? 'on' : ''} onClick={() => setMode('pretty')}>
              {t('respPretty')}
            </button>
            <button className={shownMode === 'raw' ? 'on' : ''} onClick={() => setMode('raw')}>
              {t('respRaw')}
            </button>
            {canPreview && (
              <button className={shownMode === 'preview' ? 'on' : ''} onClick={() => setMode('preview')} title={t('respPreviewNote')}>
                {t('respPreview')}
              </button>
            )}
          </div>
          <button className={`icon-btn sm ${wrap ? 'active' : ''}`} onClick={() => setWrap(!wrap)} title={t('respWrap')} aria-pressed={wrap}>
            <WrapText size={13} />
          </button>
        </div>
      )}
      {response.error && (
        <div className="callout danger http-resp-error">
          <AlertTriangle size={15} />
          <span>{response.error}</span>
        </div>
      )}
      {tab === 'body' ? (
        <BodyView response={response} mode={shownMode} wrap={wrap} />
      ) : (
        <div className="http-resp-scroll">
          {tab === 'headers' && (
            <dl className="http-headers">
              {response.headers.map((h, i) => (
                <div key={`${i}-${h.name}`}>
                  <dt>{h.name}</dt>
                  <dd>{h.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {tab === 'cookies' &&
            (cookies.length === 0 ? (
              <div className="http-note">{t('respNoCookies')}</div>
            ) : (
              <dl className="http-headers">
                {cookies.map((c, i) => (
                  <div key={`${i}-${c.name}`}>
                    <dt>{c.name}</dt>
                    <dd>
                      {c.value}
                      {c.attrs && <span className="http-cookie-attrs">{c.attrs}</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            ))}
          {tab === 'timing' && <TimingView response={response} />}
          {tab === 'timeline' && <pre className="http-timeline">{response.timeline}</pre>}
          {tab === 'tests' && <TestsView results={results} />}
        </div>
      )}
    </>
  )
}
