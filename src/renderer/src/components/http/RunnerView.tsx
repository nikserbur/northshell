import { Check, Loader2, Square, X } from 'lucide-react'
import { useT } from '../../lib/useT'
import { stopHttpRun } from '../../store/actions'
import { useApp, type HttpRunResult, type HttpRunState } from '../../store/appStore'

function succeeded(r: HttpRunResult): boolean {
  return !r.error && r.status > 0 && r.status < 400 && r.tests.every((x) => x.pass)
}

/** The report of a folder run, shown in place of the response. */
export function RunnerView({ tabId, run }: { tabId: string; run: HttpRunState }) {
  const t = useT()
  const patch = useApp((s) => s.patchHttpPanel)
  const ok = run.results.filter(succeeded).length
  return (
    <div className="http-run">
      <div className="http-resp-head">
        {run.running && <Loader2 size={14} className="spin" />}
        <span className="http-run-title truncate">{t('runTitle', { name: run.title })}</span>
        <span className="http-resp-meta">
          {run.running ? t('runProgress', { done: run.results.length, total: run.total }) : t('runSummary', { ok, total: run.results.length })}
        </span>
        {run.running ? (
          <button className="btn sm" onClick={() => stopHttpRun(tabId)}>
            <Square size={12} /> {t('runStop')}
          </button>
        ) : (
          <button className="icon-btn sm" onClick={() => patch(tabId, { run: undefined })} title={t('runClose')}>
            <X size={14} />
          </button>
        )}
      </div>
      <ul className="http-run-list">
        {run.results.map((r, i) => {
          const failedTests = r.tests.filter((x) => !x.pass)
          return (
            <li key={`${i}-${r.id}`} className={succeeded(r) ? 'pass' : 'fail'}>
              {succeeded(r) ? <Check size={13} /> : <X size={13} />}
              <span className={`method-tag m-${r.method.toLowerCase()}`}>{r.method}</span>
              <span className="truncate">{r.name}</span>
              <span className="http-run-meta">
                {r.status || '—'} · {r.timeMs} ms
              </span>
              {r.tests.length > 0 && <span className="http-run-meta">{t('testsPassed', { pass: r.tests.length - failedTests.length, total: r.tests.length })}</span>}
              {r.error && <em className="truncate">{r.error}</em>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
