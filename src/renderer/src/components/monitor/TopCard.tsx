import { ListOrdered, Maximize2, Users } from 'lucide-react'
import { useState } from 'react'
import { formatBytes, formatPercent, formatRate } from '@shared/format'
import { procMetricValue, topProcs, topUsers, userMetricValue, type UserMetric } from '@shared/procTable'
import type { MonitorSnapshot } from '@shared/types'
import { useT } from '../../lib/useT'
import { useApp } from '../../store/appStore'

const ROWS = 5

function metricText(metric: UserMetric, value: number): string {
  if (metric === 'cpu') return formatPercent(value)
  return metric === 'mem' ? formatBytes(value) : formatRate(value)
}

interface Props {
  monitorKey: string
  snapshot: MonitorSnapshot
}

/** The small "who is loading it" card: top users by the chosen measure, or the top processes of the picked user. */
export function TopCard({ monitorKey, snapshot }: Props) {
  const t = useT()
  const selected = useApp((s) => s.monitorUsers[monitorKey]) ?? null
  const setUser = useApp((s) => s.setMonitorUser)
  const setView = useApp((s) => s.setMonitorView)
  const [metric, setMetric] = useState<UserMetric>('cpu')
  const [mode, setMode] = useState<'users' | 'processes'>('users')
  const detail = snapshot.detail
  const metrics: { id: UserMetric; label: string; off?: boolean }[] = [
    { id: 'cpu', label: t('metricCpu') },
    { id: 'mem', label: t('metricMem') },
    { id: 'disk', label: t('metricDisk'), off: detail?.diskIo === 'none' },
    { id: 'net', label: t('metricNet'), off: detail?.net === 'none' }
  ]
  const showProcesses = mode === 'processes' || selected !== null

  const rows: { key: string; label: string; value: number; onClick: () => void; pid?: number }[] = !detail
    ? []
    : showProcesses
      ? topProcs(selected ? detail.processes.filter((p) => p.user === selected) : detail.processes, metric, ROWS).map((p) => ({
          key: String(p.pid),
          label: p.name,
          pid: p.pid,
          value: procMetricValue(p, metric),
          onClick: () => setView('processes')
        }))
      : topUsers(detail.users, metric, ROWS).map((u) => ({
          key: u.user,
          label: u.user,
          value: userMetricValue(u, metric),
          onClick: () => setUser(monitorKey, u.user)
        }))
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0)

  return (
    <div className="mon-card mon-top">
      <div className="mon-title">
        {showProcesses ? <ListOrdered size={13} /> : <Users size={13} />}
        <span className="truncate">{t('monWho')}</span>
        <button className="icon-btn sm mon-expand" onClick={() => setView(showProcesses ? 'processes' : 'users')} title={t('monExpand')}>
          <Maximize2 size={12} />
        </button>
      </div>
      <div className="segmented sm mon-top-metrics">
        {metrics.map((m) => (
          <button key={m.id} className={metric === m.id ? 'on' : ''} disabled={m.off} onClick={() => setMetric(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      <div className="mon-top-controls">
        {!selected && (
          <div className="segmented sm">
            <button className={mode === 'users' ? 'on' : ''} onClick={() => setMode('users')} title={t('monTabUsers')}>
              <Users size={12} />
            </button>
            <button className={mode === 'processes' ? 'on' : ''} onClick={() => setMode('processes')} title={t('monTabProcesses')}>
              <ListOrdered size={12} />
            </button>
          </div>
        )}
        <select
          className="input mon-user-select"
          value={selected ?? ''}
          aria-label={t('monPickUser')}
          title={t('monPickUser')}
          onChange={(e) => setUser(monitorKey, e.target.value || null)}
        >
          <option value="">{t('monAllUsers')}</option>
          {(detail?.users ?? []).map((u) => (
            <option key={u.user} value={u.user}>
              {u.user}
            </option>
          ))}
        </select>
      </div>
      <div className="mon-top-rows">
        {!detail && <span className="muted">{t('monCollecting')}</span>}
        {detail && rows.every((r) => r.value <= 0) && <span className="muted">{t('monNoActivity')}</span>}
        {rows
          .filter((r) => r.value > 0)
          .map((r) => (
            <button key={r.key} className="top-row" onClick={r.onClick} title={r.pid ? `PID ${r.pid}` : t('monPickUser')}>
              <span className="top-track">
                <i style={{ transform: `scaleX(${max > 0 ? r.value / max : 0})` }} />
              </span>
              <span className="top-name truncate">{r.label}</span>
              <span className="top-value">{metricText(metric, r.value)}</span>
            </button>
          ))}
      </div>
    </div>
  )
}
