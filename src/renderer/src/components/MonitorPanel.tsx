import { Activity, Cpu, Gauge, Gpu, HardDrive, Loader2, Maximize2, MemoryStick, Network, Server, Users } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { formatBytes, formatDuration, formatPercent, formatRate } from '@shared/format'
import { gpuTotals } from '@shared/gpu'
import { topUsers } from '@shared/procTable'
import { useT } from '../lib/useT'
import { levelClass } from '../lib/util'
import { monitorKeyFor, scanDiskOwners } from '../store/actions'
import { useApp, type DiskOwnersState } from '../store/appStore'
import { registry } from '../terminal/registry'
import { MonitorExpanded } from './monitor/MonitorExpanded'
import { TopCard } from './monitor/TopCard'
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

/** Numbers of the user picked in the monitor, shown under a card's main figure. */
function UserLine({ user, children }: { user: string; children: ReactNode }) {
  return (
    <div className="mon-user-line">
      <Users size={11} />
      <span className="truncate">{user}</span>
      <b>{children}</b>
    </div>
  )
}

/** Under a disk's bar: who owns most of it, or a button to find out. */
function DiskOwnersLine({ monitorKey, mount, state, picked }: { monitorKey: string; mount: string; state?: DiskOwnersState; picked: string | null }) {
  const t = useT()
  if (state?.running) {
    return (
      <span className="mon-link busy">
        <Loader2 size={11} className="spin" /> {t('diskScanning')}
      </span>
    )
  }
  const result = state?.result
  if (!result) {
    return (
      <button className="mon-link" onClick={() => void scanDiskOwners(monitorKey, mount)} title={state?.error ?? t('diskScanHint')}>
        <Users size={11} /> {t('diskSpaceWho')}
      </button>
    )
  }
  const mine = picked ? result.users.find((u) => u.user === picked) : undefined
  const shown = mine ? [mine] : result.users.slice(0, 2)
  return (
    <span className="mon-owners truncate" title={result.users.map((u) => `${u.user} ${formatBytes(u.bytes)}`).join('\n')}>
      {shown.map((u) => `${u.user} ${formatBytes(u.bytes)}`).join(' · ')}
    </span>
  )
}

export function MonitorPanel() {
  const t = useT()
  const tabs = useApp((s) => s.tabs)
  const activeId = useApp((s) => s.activeId)
  const monitors = useApp((s) => s.monitors)
  const view = useApp((s) => s.monitorView)
  const setView = useApp((s) => s.setMonitorView)
  const tab = tabs.find((x) => x.id === activeId)
  const monitorKey = monitorKeyFor(tab)
  const history = monitors[monitorKey]
  const picked = useApp((s) => s.monitorUsers[monitorKey]) ?? null
  const owners = useApp((s) => s.diskOwners[monitorKey])

  // The full process list costs the server some work, so it is collected only while this panel is open.
  useEffect(() => {
    void window.xmt.monitor.setDetail(monitorKey, true)
    return () => void window.xmt.monitor.setDetail(monitorKey, false)
  }, [monitorKey])

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
  const gpu = gpuTotals(s.gpus)
  const entry = tab ? registry.get(tab.id) : undefined
  const connectedFor = tab?.connectedAt && tab.status === 'connected' ? (Date.now() - tab.connectedAt) / 1000 : 0
  const remote = tab?.kind === 'ssh'
  const detail = s.detail
  const pickedUsage = picked ? detail?.users.find((u) => u.user === picked) : undefined
  const topDiskUser = detail ? topUsers(detail.users, 'disk', 1)[0] : undefined

  return (
    <>
    <section className={`monitor ${gpu ? 'has-gpu' : ''}`}>
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
        <Sparkline values={history.cpu} max={100} height={pickedUsage ? 48 : 70} />
        {pickedUsage && <UserLine user={pickedUsage.user}>{formatPercent(pickedUsage.cpu)}</UserLine>}
      </div>

      <div className="mon-card">
        <div className="mon-title">
          <MemoryStick size={13} /> {t('memory')}
        </div>
        <div className="mon-big">
          {formatBytes(s.memUsed)}
          <small>/ {formatBytes(s.memTotal)}</small>
        </div>
        <Sparkline values={history.mem} max={100} height={42} color="var(--spark-2, var(--violet))" />
        {s.swapTotal > 0 && (
          <Bar label={t('swap')} value={`${formatBytes(s.swapUsed)} / ${formatBytes(s.swapTotal)}`} pct={swapPct} />
        )}
        <Bar label={t('memory')} value={formatPercent(memPct)} pct={memPct} />
        {pickedUsage && <UserLine user={pickedUsage.user}>{formatBytes(pickedUsage.mem)}</UserLine>}
      </div>

      {gpu && (
        <div className="mon-card mon-gpu" title={gpu.shared ? t('gpuShared', { total: formatBytes(gpu.total) }) : undefined}>
          <div className="mon-title">
            <Gpu size={13} /> {t('gpu')}
            {gpu.util !== null && (
              <span className="mon-title-extra" title={t('gpuLoad', { n: Math.round(gpu.util) })}>
                {Math.round(gpu.util)}%
              </span>
            )}
          </div>
          <div className="mon-big">
            {formatBytes(gpu.used)}
            <small>
              / {gpu.shared ? '≈' : ''}
              {formatBytes(gpu.total)}
            </small>
          </div>
          <Sparkline values={history.vram} max={100} height={42} color="var(--spark-4, var(--warn))" />
          <div className="mon-gpu-list">
            {s.gpus.map((g, i) => {
              const pct = g.memTotal > 0 ? (g.memUsed / g.memTotal) * 100 : 0
              // With several GPUs each row carries its own load; a single GPU shows it in the title.
              const label = s.gpus.length > 1 && g.util !== null ? `${g.name} · ${Math.round(g.util)}%` : g.name
              return <Bar key={`${i}-${g.name}`} label={label} value={formatPercent(pct)} pct={pct} />
            })}
          </div>
        </div>
      )}

      <div className="mon-card">
        <div className="mon-title">
          <Network size={13} /> {t('network')}
        </div>
        <div className="net-legend">
          <span className="rx">↓ {formatRate(s.netRx)}</span>
          <span className="tx">↑ {formatRate(s.netTx)}</span>
        </div>
        <Sparkline values={history.rx} second={history.tx} height={pickedUsage ? 58 : 84} color="var(--spark-3, var(--info))" />
        {pickedUsage && (
          <UserLine user={pickedUsage.user}>
            ↓{formatRate(pickedUsage.netRx)} ↑{formatRate(pickedUsage.netTx)}
          </UserLine>
        )}
      </div>

      <div className="mon-card mon-diskio">
        <div className="mon-title">
          <Gauge size={13} /> {t('diskSpeed')}
          <button className="icon-btn sm mon-expand" onClick={() => setView('disks')} title={t('monExpand')}>
            <Maximize2 size={12} />
          </button>
        </div>
        <div className="net-legend">
          <span className="rx">↓ {formatRate(s.diskRead)}</span>
          <span className="tx">↑ {formatRate(s.diskWrite)}</span>
        </div>
        <Sparkline values={history.diskRead} second={history.diskWrite} height={pickedUsage || topDiskUser ? 58 : 84} color="var(--spark-3, var(--info))" />
        {pickedUsage ? (
          <UserLine user={pickedUsage.user}>
            ↓{formatRate(pickedUsage.diskRead)} ↑{formatRate(pickedUsage.diskWrite)}
          </UserLine>
        ) : (
          topDiskUser && (
            <UserLine user={topDiskUser.user}>
              ↓{formatRate(topDiskUser.diskRead)} ↑{formatRate(topDiskUser.diskWrite)}
            </UserLine>
          )
        )}
      </div>

      <div className="mon-card" style={{ overflowY: 'auto' }}>
        <div className="mon-title">
          <HardDrive size={13} /> {t('disks')}
          <button className="icon-btn sm mon-expand" onClick={() => setView('disks')} title={t('monExpand')}>
            <Maximize2 size={12} />
          </button>
        </div>
        {s.disks.length === 0 && <span className="muted">—</span>}
        {s.disks.map((d) => {
          const pct = d.total > 0 ? (d.used / d.total) * 100 : 0
          return (
            <div key={`${d.fs}${d.mount}`} className="mon-disk-row">
              <Bar label={d.mount} value={`${formatBytes(d.used)} / ${formatBytes(d.total)}`} pct={pct} />
              {remote && <DiskOwnersLine monitorKey={monitorKey} mount={d.mount} state={owners?.[d.mount]} picked={picked} />}
            </div>
          )
        })}
      </div>

      <TopCard monitorKey={monitorKey} snapshot={s} />
    </section>
    {view && <MonitorExpanded monitorKey={monitorKey} history={history} remote={remote} tab={view} />}
    </>
  )
}
