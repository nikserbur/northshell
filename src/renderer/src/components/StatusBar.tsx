import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Clock, Cpu, Gauge, HardDrive, Laptop, MemoryStick, Users } from 'lucide-react'
import { formatBytes, formatDuration, formatPercent, formatRate } from '@shared/format'
import { useT } from '../lib/useT'
import { levelClass } from '../lib/util'
import { monitorKeyFor } from '../store/actions'
import { useApp } from '../store/appStore'

function Meter({ pct }: { pct: number }) {
  return (
    <span className={`meter ${levelClass(pct)}`}>
      <i style={{ transform: `scaleX(${Math.min(100, Math.max(0, pct)) / 100})` }} />
    </span>
  )
}

export function StatusBar() {
  const t = useT()
  const tabs = useApp((s) => s.tabs)
  const activeId = useApp((s) => s.activeId)
  const monitors = useApp((s) => s.monitors)
  const monitorOpen = useApp((s) => s.monitorOpen)
  const setMonitorOpen = useApp((s) => s.setMonitorOpen)
  const globalMonitoring = useApp((s) => s.settings.monitorEnabled)
  const sessions = useApp((s) => s.sessions)
  const tab = tabs.find((x) => x.id === activeId)
  const sessionMonitoring = tab?.sessionId ? (sessions.find((x) => x.id === tab.sessionId)?.monitoring ?? true) : true
  const monitorEnabled = globalMonitoring && sessionMonitoring
  const snap = monitors[monitorKeyFor(tab)]?.latest
  const isLocal = !tab || tab.kind === 'local'

  const statusText =
    tab?.status === 'connecting' ? t('connecting') : tab?.status === 'error' ? t('error') : tab?.status === 'closed' ? t('disconnected') : null
  const hostLabel = isLocal ? `${t('localMachine')}${snap ? ` · ${snap.hostname}` : ''}` : (snap?.hostname ?? tab?.endpoint ?? tab?.title)
  const root = snap?.disks[0]
  const memPct = snap && snap.memTotal > 0 ? (snap.memUsed / snap.memTotal) * 100 : 0
  const diskPct = root && root.total > 0 ? (root.used / root.total) * 100 : 0

  return (
    <footer className="statusbar">
      <div className="sb-seg">
        {isLocal ? <Laptop size={13} /> : <span className={`dot ${tab?.status ?? 'closed'}`} />}
        <span className="sb-host truncate">{hostLabel}</span>
      </div>

      {statusText && !isLocal && tab?.status !== 'connected' ? (
        <div className="sb-seg muted">{tab?.message ?? statusText}</div>
      ) : !monitorEnabled ? (
        <div className="sb-seg muted">{t('monitorDisabled')}</div>
      ) : !snap ? (
        <div className="sb-seg muted">{t('waitingStats')}</div>
      ) : (
        <>
          <button className="sb-seg sb-click" onClick={() => setMonitorOpen(!monitorOpen)} title={t('cpu')}>
            <Cpu size={13} />
            <span className="value">{formatPercent(snap.cpu).padStart(4, ' ')}</span>
            <Meter pct={snap.cpu} />
          </button>
          <button className="sb-seg sb-click" onClick={() => setMonitorOpen(!monitorOpen)} title={t('memory')}>
            <MemoryStick size={13} />
            <span className="value">
              {formatBytes(snap.memUsed)}
              <span className="label"> / {formatBytes(snap.memTotal)}</span>
            </span>
            <Meter pct={memPct} />
          </button>
          {root && (
            <button className="sb-seg sb-click" onClick={() => setMonitorOpen(!monitorOpen)} title={`${t('disk')} ${root.mount}`}>
              <HardDrive size={13} />
              <span className="value">{formatPercent(diskPct)}</span>
              <span className="label sb-opt2">{formatBytes(root.total - root.used)} free</span>
              <Meter pct={diskPct} />
            </button>
          )}
          <div className="sb-seg" title={t('network')}>
            <ArrowDown size={12} className="rx" />
            <span className="value">{formatRate(snap.netRx)}</span>
            <ArrowUp size={12} className="tx" />
            <span className="value">{formatRate(snap.netTx)}</span>
          </div>
          <div className="sb-seg sb-opt" title={t('load')}>
            <Gauge size={13} />
            <span className="value">{snap.load.map((l) => l.toFixed(2)).join(' ')}</span>
          </div>
          <div className="sb-seg sb-opt" title={t('uptime')}>
            <Clock size={13} />
            <span className="value">{formatDuration(snap.uptime)}</span>
          </div>
          <div className="sb-seg sb-opt2" title={t('users')}>
            <Users size={13} />
            <span className="value">{snap.users}</span>
          </div>
        </>
      )}
      <div className="sb-spacer" />
      <button className="sb-toggle" onClick={() => setMonitorOpen(!monitorOpen)}>
        {monitorOpen ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
        <span className="sb-toggle-label">{t('monitor')}</span>
      </button>
    </footer>
  )
}
