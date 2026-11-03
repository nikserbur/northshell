import { AlertTriangle, ClipboardCopy, Loader2, Send, X } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { formatBytes } from '@shared/format'
import { prettyBody, type HttpResponseInfo } from '@shared/httpRequest'
import { useT } from '../../lib/useT'

/** Larger bodies are shown as plain text: span-per-token highlighting gets slow. */
const HIGHLIGHT_LIMIT = 256 * 1024
const JSON_TOKEN_RE = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g

function JsonText({ text }: { text: string }) {
  const parts = useMemo(() => {
    const out: ReactNode[] = []
    let last = 0
    for (const m of text.matchAll(JSON_TOKEN_RE)) {
      const at = m.index ?? 0
      if (at > last) out.push(text.slice(last, at))
      const cls = m[1] ? (m[2] ? 'j-key' : 'j-str') : m[3] ? 'j-lit' : 'j-num'
      out.push(
        <span key={at} className={cls}>
          {m[1] ?? m[0]}
        </span>
      )
      if (m[2]) out.push(m[2])
      last = at + m[0].length
    }
    if (last < text.length) out.push(text.slice(last))
    return out
  }, [text])
  return <>{parts}</>
}

function statusClass(status: number): string {
  if (status >= 200 && status < 300) return 'ok'
  if (status >= 300 && status < 400) return 'info'
  if (status >= 400 && status < 500) return 'warn'
  return 'bad'
}

interface Props {
  response?: HttpResponseInfo
  pending: boolean
  error?: string
  onCancel: () => void
  onCopy: (text: string) => void
}

export function ResponseView({ response, pending, error, onCancel, onCopy }: Props) {
  const t = useT()
  const [view, setView] = useState<'body' | 'headers'>('body')
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
  const meta = [
    `${response.timeMs} ms`,
    formatBytes(response.bodyBytes),
    response.contentType.split(';')[0],
    response.redirects > 0 ? t('redirectsCount', { n: response.redirects }) : ''
  ].filter(Boolean)
  const headersText = response.headers.map((h) => `${h.name}: ${h.value}`).join('\n')

  return (
    <>
      <div className="http-resp-head">
        <span className={`http-status ${failed ? 'bad' : statusClass(response.status)}`}>
          {failed ? t('responseFailed') : `${response.status} ${response.statusText}`.trim()}
        </span>
        <span className="http-resp-meta truncate" title={response.url}>
          {meta.join(' · ')}
        </span>
        <div className="segmented sm">
          <button className={view === 'body' ? 'on' : ''} onClick={() => setView('body')}>
            {t('requestBody')}
          </button>
          <button className={view === 'headers' ? 'on' : ''} onClick={() => setView('headers')}>
            {t('requestHeaders')} <span className="count">{response.headers.length}</span>
          </button>
        </div>
        <button
          className="icon-btn sm"
          title={t('copyResponse')}
          onClick={() => onCopy(view === 'body' ? pretty.text : headersText)}
          disabled={view === 'body' ? !pretty.text : !headersText}
        >
          <ClipboardCopy size={13} />
        </button>
      </div>
      <div className="http-resp-scroll">
        {response.error && (
          <div className="callout danger">
            <AlertTriangle size={15} />
            <span>{response.error}</span>
          </div>
        )}
        {view === 'headers' ? (
          <dl className="http-headers">
            {response.headers.map((h, i) => (
              <div key={`${i}-${h.name}`}>
                <dt>{h.name}</dt>
                <dd>{h.value}</dd>
              </div>
            ))}
          </dl>
        ) : response.binary ? (
          <div className="http-note">{t('binaryBody', { size: formatBytes(response.bodyBytes) })}</div>
        ) : !pretty.text ? (
          failed ? null : <div className="http-note">{t('emptyBody')}</div>
        ) : (
          <pre className="http-body">
            {pretty.json && pretty.text.length <= HIGHLIGHT_LIMIT ? <JsonText text={pretty.text} /> : pretty.text}
          </pre>
        )}
        {view === 'body' && response.truncated && (
          <div className="http-note">{t('bodyTruncated', { size: formatBytes(response.body.length) })}</div>
        )}
      </div>
    </>
  )
}
