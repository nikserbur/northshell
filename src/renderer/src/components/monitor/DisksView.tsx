import { Calculator, Info, Loader2 } from 'lucide-react'
import { formatBytes, formatPercent, formatRate } from '@shared/format'
import { topUsers } from '@shared/procTable'
import type { MonitorSnapshot } from '@shared/types'
import { useT } from '../../lib/useT'
import { levelClass, relativeTime } from '../../lib/util'
import { scanDiskOwners } from '../../store/actions'
import { useApp, type MonitorHistory } from '../../store/appStore'
import { Sparkline } from '../Sparkline'

const LOAD_ROWS = 8
const OWNER_ROWS = 8

function ShareBar({ label, value, pct, onClick, selected }: { label: string; value: string; pct: number; onClick?: () => void; selected?: boolean }) {
  return (
    <button className={`share-bar ${selected ? 'selected' : ''}`} onClick={onClick} disabled={!onClick}>
      <span className="share-name truncate">{label}</span>
      <span className="share-track">
        <i style={{ transform: `scaleX(${Math.min(100, Math.max(0, pct)) / 100})` }} />
      </span>
      <span className="share-value">{value}</span>
    </button>
  )
}

/** Who is reading and writing right now, and which users own the space on each volume. */
function LoadSection({ snapshot, history, selected, onPick }: { snapshot: MonitorSnapshot; history: MonitorHistory; selected: string | null; onPick: (user: string) => void }) {
  const t = useT()
  const detail = snapshot.detail
  const users = detail ? topUsers(detail.users, 'disk', LOAD_ROWS) : []
  const max = users.reduce((m, u) => Math.max(m, u.diskRead + u.diskWrite), 0)
  return (
    <section className="disk-section">
      <h3>{t('diskLoadNow')}</h3>
      <div className="net-legend">
        <span className="rx">
          ↓ {t('diskReadLabel')} {formatRate(snapshot.diskRead)}
        </span>
        <span className="tx">
          ↑ {t('diskWriteLabel')} {formatRate(snapshot.diskWrite)}
        </span>
      </div>
      <Sparkline values={history.diskRead} second={history.diskWrite} height={72} color="var(--spark-3, var(--info))" />

      {snapshot.diskDevices.length > 0 && (
        <table className="sort-table compact">
          <thead>
            <tr>
              <th>{t('diskDevices')}</th>
              <th className="num">{t('colRead')}</th>
              <th className="num">{t('colWrite')}</th>
              <th className="num">{t('diskBusy')}</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.diskDevices.map((d) => (
              <tr key={d.name}>
                <td>{d.name}</td>
                <td className="num">{formatRate(d.read)}</td>
                <td className="num">{formatRate(d.write)}</td>
                <td className={`num ${d.util !== null ? levelClass(d.util) : ''}`}>{d.util === null ? '—' : formatPercent(d.util)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {detail?.diskIo !== 'none' && (
        <div className="share-list">
          {users.length === 0 && <span className="muted">{detail ? t('monNoActivity') : t('monCollecting')}</span>}
          {users.map((u) => (
            <ShareBar
              key={u.user}
              label={u.user}
              value={`↓${formatRate(u.diskRead)} ↑${formatRate(u.diskWrite)}`}
              pct={max > 0 ? ((u.diskRead + u.diskWrite) / max) * 100 : 0}
              selected={u.user === selected}
              onClick={() => onPick(u.user)}
            />
          ))}
        </div>
      )}
      {detail?.diskIo === 'own' && (
        <p className="mon-hint">
          <Info size={12} /> {t('diskIoOwn')}
        </p>
      )}
      {detail?.diskIo === 'none' && (
        <p className="mon-hint">
          <Info size={12} /> {t('diskIoNone')}
        </p>
      )}
    </section>
  )
}

function SpaceSection({ monitorKey, snapshot, remote, selected, onPick }: { monitorKey: string; snapshot: MonitorSnapshot; remote: boolean; selected: string | null; onPick: (user: string) => void }) {
  const t = useT()
  const owners = useApp((s) => s.diskOwners[monitorKey])
  const language = useApp((s) => s.settings.language)
  return (
    <section className="disk-section">
      <h3>{t('diskSpaceWho')}</h3>
      {!remote && (
        <p className="mon-hint">
          <Info size={12} /> {t('diskScanLocal')}
        </p>
      )}
      {snapshot.disks.map((d) => {
        const state = owners?.[d.mount]
        const pct = d.total > 0 ? (d.used / d.total) * 100 : 0
        const result = state?.result
        return (
          <div key={`${d.fs}${d.mount}`} className="disk-owner-block">
            <div className="disk-owner-head">
              <div className={`bar-line grow ${levelClass(pct)}`}>
                <div className="top">
                  <span className="truncate">{d.mount}</span>
                  <span>
                    {formatBytes(d.used)} / {formatBytes(d.total)}
                  </span>
                </div>
                <div className="track">
                  <i style={{ transform: `scaleX(${Math.min(100, pct) / 100})` }} />
                </div>
              </div>
              {remote && (
                <button className="btn sm" disabled={state?.running} onClick={() => void scanDiskOwners(monitorKey, d.mount)} title={t('diskScanHint')}>
                  {state?.running ? <Loader2 size={13} className="spin" /> : <Calculator size={13} />}
                  {state?.running ? t('diskScanning') : result ? t('diskScanAgain') : t('diskScan')}
                </button>
              )}
            </div>
            {state?.error && <p className="mon-hint err">{state.error}</p>}
            {result && (
              <div className="share-list">
                {result.users.length === 0 && <span className="muted">{t('diskScanEmpty')}</span>}
                {result.users.slice(0, OWNER_ROWS).map((u) => (
                  <ShareBar
                    key={u.user}
                    label={u.user}
                    value={formatBytes(u.bytes)}
                    pct={d.total > 0 ? (u.bytes / d.total) * 100 : 0}
                    selected={u.user === selected}
                    onClick={() => onPick(u.user)}
                  />
                ))}
                <span className="mon-hint-line">{t('diskScanAge', { when: relativeTime(result.at, language) })}</span>
                {result.partial && (
                  <p className="mon-hint">
                    <Info size={12} /> {t('diskScanPartial')}
                  </p>
                )}
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}

interface Props {
  monitorKey: string
  history: MonitorHistory
  remote: boolean
  selected: string | null
  onPick: (user: string) => void
}

export function DisksView({ monitorKey, history, remote, selected, onPick }: Props) {
  return (
    <div className="disks-view">
      <LoadSection snapshot={history.latest} history={history} selected={selected} onPick={onPick} />
      <SpaceSection monitorKey={monitorKey} snapshot={history.latest} remote={remote} selected={selected} onPick={onPick} />
    </div>
  )
}
