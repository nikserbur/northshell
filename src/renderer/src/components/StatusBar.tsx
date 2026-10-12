import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Clock, Cpu, Gauge, HardDrive, Laptop, MemoryStick, Users } from 'lucide-react'
import { useRef } from 'react'
import { formatBytes, formatDuration, formatPercent, formatRate } from '@shared/format'
import type { DiskUsage } from '@shared/types'
import { useFitPriority } from '../hooks/useFitPriority'
import { useT } from '../lib/useT'
import { levelClass } from '../lib/util'
import { monitorKeyFor } from '../store/actions'
import { useApp } from '../store/appStore'

const DISK_CRIT = 90

function Meter({ pct }: { pct: number }) {
  return (
    <span className={`meter ${levelClass(pct)}`}>
      <i style={{ transform: `scaleX(${Math.min(100, Math.max(0, pct)) / 100})` }} />
    </span>
  )
}

/** Tiny CPU history graph (shown by the MobaXterm theme, like its remote-monitoring bar). */
function CpuGraph({ values }: { values: number[] }) {
  const bars = values.slice(-20)
  return (
    <svg className="sb-cpu-graph" viewBox="0 0 40 16" preserveAspectRatio="none" aria-hidden>
      {bars.map((v, i) => {
        const h = Math.max(1.5, (Math.min(100, v) / 100) * 15)
        return <rect key={i} x={40 - (bars.length - i) * 2} y={16 - h} width={1.4} height={h} />
      })}
    </svg>
  )
}

const diskPct = (d: DiskUsage): number => (d.total > 0 ? (d.used / d.total) * 100 : 0)
const MIN_DISK_BYTES = 512 * 1024 * 1024
const MAX_BAR_DISKS = 4

/** "/Volumes/Backup Drive" → "Backup Drive", long names shortened, like MobaXterm's compact list. */
function diskLabel(mount: string): string {
  const name = mount.startsWith('/Volumes/') ? mount.slice('/Volumes/'.length) : mount
  return name.length > 16 ? `${name.slice(0, 15)}…` : name
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
  const rowRef = useRef<HTMLDivElement>(null)
  const tab = tabs.find((x) => x.id === activeId)
  const sessionMonitoring = tab?.sessionId ? (sessions.find((x) => x.id === tab.sessionId)?.monitoring ?? true) : true
  const monitorEnabled = globalMonitoring && sessionMonitoring
  const history = monitors[monitorKeyFor(tab)]
  const snap = history?.latest
  const isLocal = !tab || tab.kind === 'local'

  useFitPriority(rowRef, [snap, tab?.status, tab?.id, monitorEnabled])

  const toggle = (): void => setMonitorOpen(!monitorOpen)
  const statusText =
    tab?.status === 'connecting' ? t('connecting') : tab?.status === 'error' ? t('error') : tab?.status === 'closed' ? t('disconnected') : null
  const hostLabel = isLocal ? `${t('localMachine')}${snap ? ` · ${snap.hostname}` : ''}` : (snap?.hostname ?? tab?.endpoint ?? tab?.title)
  const root = snap?.disks[0]
  const memPct = snap && snap.memTotal > 0 ? (snap.memUsed / snap.memTotal) * 100 : 0
  const rootPct = root ? diskPct(root) : 0

  return (
    <footer className="statusbar">
      <div className="sb-segs" ref={rowRef}>
        <div className="sb-seg sb-host-seg" data-priority="0">
          {isLocal ? <Laptop size={13} /> : <span className={`dot ${tab?.status ?? 'closed'}`} />}
          <span className="sb-host truncate">{hostLabel}</span>
        </div>

        {statusText && !isLocal && tab?.status !== 'connected' ? (
          <div className="sb-seg muted" data-priority="1">
            {tab?.message ?? statusText}
          </div>
        ) : !monitorEnabled ? (
          <div className="sb-seg muted" data-priority="1">
            {t('monitorDisabled')}
          </div>
        ) : !snap ? (
          <div className="sb-seg muted" data-priority="1">
            {t('waitingStats')}
          </div>
        ) : (
          <>
            <button className="sb-seg sb-click sb-cpu" data-priority="1" onClick={toggle} title={t('cpu')}>
              <Cpu size={13} />
              <span className="value">{formatPercent(snap.cpu).padStart(4, ' ')}</span>
              <Meter pct={snap.cpu} />
              <CpuGraph values={history?.cpu ?? []} />
            </button>
            <button className="sb-seg sb-click sb-mem" data-priority="2" onClick={toggle} title={t('memory')}>
              <MemoryStick size={13} />
              <span className="value">
                {formatBytes(snap.memUsed)}
                <span className="label"> / {formatBytes(snap.memTotal)}</span>
              </span>
              <Meter pct={memPct} />
            </button>
            <div className="sb-seg sb-net" data-priority="3" title={t('network')}>
              <ArrowDown size={12} className="rx" />
              <span className="value">{formatRate(snap.netRx)}</span>
              <ArrowUp size={12} className="tx" />
              <span className="value">{formatRate(snap.netTx)}</span>
            </div>
            {root && (
              <button className="sb-seg sb-click sb-disk-root" data-priority="4" onClick={toggle} title={`${t('disk')} ${root.mount}`}>
                <HardDrive size={13} />
                <span className={`value ${rootPct >= DISK_CRIT ? 'crit' : ''}`}>{formatPercent(rootPct)}</span>
                <span className="label sb-free">{formatBytes(root.total - root.used)} free</span>
                <Meter pct={rootPct} />
              </button>
            )}
            {snap.disks.length > 0 && (
              <button
              className="sb-seg sb-click sb-disks-all"
              data-priority="4"
              onClick={toggle}
              title={snap.disks.map((d) => `${d.mount}: ${Math.round(diskPct(d))}%`).join('\n')}
            >
                <HardDrive size={13} />
                {snap.disks
                  .filter((d) => d.total >= MIN_DISK_BYTES)
                  .slice(0, MAX_BAR_DISKS)
                  .map((d) => (
                    <span key={`${d.fs}${d.mount}`} className={`sb-disk ${diskPct(d) >= DISK_CRIT ? 'crit' : ''}`}>
                      {diskLabel(d.mount)}: {Math.round(diskPct(d))}%
                    </span>
                  ))}
              </button>
            )}
            <div className="sb-seg sb-uptime" data-priority="5" title={t('uptime')}>
              <Clock size={13} />
              <span className="value">{formatDuration(snap.uptime)}</span>
            </div>
            <div className="sb-seg sb-load" data-priority="6" title={t('load')}>
              <Gauge size={13} />
              <span className="value">{snap.load.map((l) => l.toFixed(2)).join(' ')}</span>
            </div>
            <div className="sb-seg sb-users" data-priority="7" title={snap.userNames.join(', ') || t('users')}>
              <Users size={13} />
              <span className="value sb-users-count">{snap.users}</span>
              <span className="value sb-users-names truncate">{snap.userNames.join('  ') || '—'}</span>
            </div>
          </>
        )}
      </div>
      <button className="sb-toggle" onClick={toggle} title={`${t('toggleMonitor')} ⇧⌘M`}>
        {monitorOpen ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
        <span className="sb-toggle-label">{t('monitor')}</span>
      </button>
    </footer>
  )
}
