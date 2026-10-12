import { Activity, Cpu, HardDrive, ListOrdered, MemoryStick, Network, Server } from 'lucide-react'
import { formatBytes, formatDuration, formatPercent, formatRate } from '@shared/format'
import { useT } from '../lib/useT'
import { levelClass } from '../lib/util'
import { monitorKeyFor } from '../store/actions'
import { useApp } from '../store/appStore'
import { registry } from '../terminal/registry'
import { Sparkline } from './Sparkline'

function Bar({ label, value, pct }: { label: string; value: string; pct: number }) {
  return (
    <div className={`bar-line ${levelClass(pct)}`}>
      <div className="top">
        <span className="truncate">{label}</span>
        <span>{value}</span>
      </div>
      <div className="track">
        <i style={{ transform: `scaleX(${Math.min(100, Math.max(0, pct)) / 100})` }} />
      </div>
    </div>
  )
}

export function MonitorPanel() {
  const t = useT()
  const tabs = useApp((s) => s.tabs)
  const activeId = useApp((s) => s.activeId)
  const monitors = useApp((s) => s.monitors)
  const tab = tabs.find((x) => x.id === activeId)
  const history = monitors[monitorKeyFor(tab)]

  if (!history) {
    return (
      <section className="monitor" style={{ gridTemplateColumns: '1fr' }}>
        <div className="mon-waiting">
          <Activity size={22} />
          {t('waitingStats')}
        </div>
      </section>
    )
  }

  const s = history.latest
  const memPct = s.memTotal > 0 ? (s.memUsed / s.memTotal) * 100 : 0
  const swapPct = s.swapTotal > 0 ? (s.swapUsed / s.swapTotal) * 100 : 0
  const entry = tab ? registry.get(tab.id) : undefined
  const connectedFor = tab?.connectedAt && tab.status === 'connected' ? (Date.now() - tab.connectedAt) / 1000 : 0

  return (
    <section className="monitor">
      <div className="mon-card">
        <div className="mon-title">
          <Server size={13} /> {t('system')}
        </div>
        <dl className="kv">
          <dt>Host</dt>
          <dd title={s.hostname}>{s.hostname || '—'}</dd>
          <dt>OS</dt>
          <dd title={s.os}>{s.os || '—'}</dd>
          <dt>{t('uptime')}</dt>
          <dd>{formatDuration(s.uptime)}</dd>
          <dt>{t('users')}</dt>
          <dd>{s.users}</dd>
          <dt>{t('load')}</dt>
          <dd>{s.load.map((l) => l.toFixed(1)).join(' ')}</dd>
          {tab && (
            <>
              <dt>{t('connectedFor')}</dt>
              <dd>{connectedFor ? formatDuration(connectedFor) : '—'}</dd>
              <dt>{t('traffic')}</dt>
              <dd>
                ↓{formatBytes(entry?.bytesIn ?? 0)} ↑{formatBytes(entry?.bytesOut ?? 0)}
              </dd>
            </>
          )}
        </dl>
      </div>

      <div className="mon-card">
        <div className="mon-title">
          <Cpu size={13} /> {t('cpu')}
        </div>
        <div className="mon-big">
          {formatPercent(s.cpu)}
          <small>
            {s.cores} {t('cores')}
          </small>
        </div>
        <Sparkline values={history.cpu} max={100} height={70} />
      </div>

      <div className="mon-card">
        <div className="mon-title">
          <MemoryStick size={13} /> {t('memory')}
        </div>
        <div className="mon-big">
          {formatBytes(s.memUsed)}
          <small>/ {formatBytes(s.memTotal)}</small>
        </div>
        <Sparkline values={history.mem} max={100} height={42} color="var(--violet)" />
        {s.swapTotal > 0 && (
          <Bar label={t('swap')} value={`${formatBytes(s.swapUsed)} / ${formatBytes(s.swapTotal)}`} pct={swapPct} />
        )}
        <Bar label={t('memory')} value={formatPercent(memPct)} pct={memPct} />
      </div>

      <div className="mon-card">
        <div className="mon-title">
          <Network size={13} /> {t('network')}
        </div>
        <div className="net-legend">
          <span className="rx">↓ {formatRate(s.netRx)}</span>
          <span className="tx">↑ {formatRate(s.netTx)}</span>
        </div>
        <Sparkline values={history.rx} second={history.tx} height={84} color="var(--info)" />
      </div>

      <div className="mon-card" style={{ overflowY: 'auto' }}>
        <div className="mon-title">
          <HardDrive size={13} /> {t('disks')}
        </div>
        {s.disks.length === 0 && <span className="muted">—</span>}
        {s.disks.map((d) => {
          const pct = d.total > 0 ? (d.used / d.total) * 100 : 0
          return (
            <Bar
              key={`${d.fs}${d.mount}`}
              label={d.mount}
              value={`${formatBytes(d.used)} / ${formatBytes(d.total)}`}
              pct={pct}
            />
          )
        })}
      </div>

      <div className="mon-card">
        <div className="mon-title">
          <ListOrdered size={13} /> {t('processes')}
        </div>
        <table className="proc-table">
          <tbody>
            {s.processes.slice(0, 7).map((p) => (
              <tr key={`${p.pid}-${p.name}`}>
                <td className="pid">{p.pid}</td>
                <td className="name" title={p.name}>
                  {p.name}
                </td>
                <td className="num">{p.cpu.toFixed(1)}%</td>
                <td className="num">{p.mem.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
