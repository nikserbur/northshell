import { Activity, HardDrive, Info, ListOrdered, ListTree, Search, Users, X } from 'lucide-react'
import { useState } from 'react'
import { formatBytes, formatPercent, formatRate } from '@shared/format'
import type { ProcSortKey, SortState, UserSortKey } from '@shared/procTable'
import { useT } from '../../lib/useT'
import { levelClass } from '../../lib/util'
import { useApp, type MonitorHistory, type MonitorTab } from '../../store/appStore'
import { Modal } from '../Modal'
import { DisksView } from './DisksView'
import { ProcessesView } from './ProcessesView'
import { UsersView } from './UsersView'

function Meter({ label, value, pct }: { label: string; value: string; pct: number }) {
  return (
    <div className={`htop-meter ${levelClass(pct)}`}>
      <span className="label">{label}</span>
      <div className="track">
        <i style={{ transform: `scaleX(${Math.min(100, Math.max(0, pct)) / 100})` }} />
      </div>
      <span className="value">{value}</span>
    </div>
  )
}

interface Props {
  monitorKey: string
  history: MonitorHistory
  remote: boolean
  tab: MonitorTab
}

/** The enlarged monitor: everything about who loads the host, sorted and filtered the way htop does it. */
export function MonitorExpanded({ monitorKey, history, remote, tab }: Props) {
  const t = useT()
  const setView = useApp((s) => s.setMonitorView)
  const setUser = useApp((s) => s.setMonitorUser)
  const selected = useApp((s) => s.monitorUsers[monitorKey]) ?? null
  const owners = useApp((s) => s.diskOwners[monitorKey])
  const [query, setQuery] = useState('')
  const [tree, setTree] = useState(false)
  const [procSort, setProcSort] = useState<SortState<ProcSortKey>>({ key: 'cpu', desc: true })
  const [userSort, setUserSort] = useState<SortState<UserSortKey>>({ key: 'cpu', desc: true })

  const s = history.latest
  const detail = s.detail
  const memPct = s.memTotal > 0 ? (s.memUsed / s.memTotal) * 100 : 0
  const swapPct = s.swapTotal > 0 ? (s.swapUsed / s.swapTotal) * 100 : 0
  const tabs: { id: MonitorTab; label: string; icon: typeof Users }[] = [
    { id: 'processes', label: t('monTabProcesses'), icon: ListOrdered },
    { id: 'users', label: t('monTabUsers'), icon: Users },
    { id: 'disks', label: t('monTabDisks'), icon: HardDrive }
  ]

  /** From any list: choose this user and look at what their processes are doing, heaviest first. */
  const showUser = (user: string, sortBy: ProcSortKey): void => {
    setUser(monitorKey, user)
    setProcSort({ key: sortBy, desc: true })
    setView('processes')
  }

  return (
    <Modal
      size="full"
      bodyless
      icon={<Activity size={16} />}
      title={s.hostname || t('system')}
      onClose={() => setView(null)}
    >
      <div className="htop-meters">
        <Meter label="CPU" value={`${formatPercent(s.cpu)} · ${s.load.map((l) => l.toFixed(1)).join(' ')}`} pct={s.cpu} />
        <Meter label="RAM" value={`${formatBytes(s.memUsed)} / ${formatBytes(s.memTotal)}`} pct={memPct} />
        {s.swapTotal > 0 && <Meter label={t('swap')} value={`${formatBytes(s.swapUsed)} / ${formatBytes(s.swapTotal)}`} pct={swapPct} />}
        <div className="htop-rates">
          <span>
            {t('colDisk')} ↓{formatRate(s.diskRead)} ↑{formatRate(s.diskWrite)}
          </span>
          <span>
            {t('colNet')} ↓{formatRate(s.netRx)} ↑{formatRate(s.netTx)}
          </span>
          {detail && (
            <span>
              {t('monTasks')} {detail.processes.length}
            </span>
          )}
        </div>
      </div>

      <div className="mon-toolbar">
        <div className="segmented sm" role="tablist">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setView(id)}>
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>
        <select
          className="input mon-user-select"
          value={selected ?? ''}
          aria-label={t('monPickUser')}
          onChange={(e) => setUser(monitorKey, e.target.value || null)}
        >
          <option value="">{t('monAllUsers')}</option>
          {(detail?.users ?? []).map((u) => (
            <option key={u.user} value={u.user}>
              {u.user}
            </option>
          ))}
        </select>
        {selected && (
          <button className="icon-btn sm" onClick={() => setUser(monitorKey, null)} title={t('monAllUsers')}>
            <X size={13} />
          </button>
        )}
        {tab === 'processes' && (
          <>
            <label className="mon-search">
              <Search size={13} />
              <input value={query} placeholder={t('monFilter')} spellCheck={false} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <button className={`icon-btn sm ${tree ? 'active' : ''}`} onClick={() => setTree(!tree)} title={t('monTree')} aria-pressed={tree}>
              <ListTree size={14} />
            </button>
          </>
        )}
      </div>

      <div className="mon-view-body">
        {!detail && tab !== 'disks' ? (
          <div className="mon-waiting">
            <Activity size={22} />
            {t('monCollecting')}
          </div>
        ) : tab === 'disks' ? (
          <DisksView monitorKey={monitorKey} history={history} remote={remote} selected={selected} onPick={(user) => showUser(user, 'disk')} />
        ) : !detail ? null : tab === 'users' ? (
          <>
            <UsersView
              detail={detail}
              owners={owners}
              sort={userSort}
              onSort={setUserSort}
              selected={selected}
              onPick={(user) => showUser(user, userSort.key === 'disk' || userSort.key === 'diskRead' || userSort.key === 'diskWrite' ? 'disk' : userSort.key === 'net' ? 'net' : userSort.key === 'mem' ? 'mem' : 'cpu')}
            />
            {detail.net !== 'none' && (
              <div className="mon-foot">
                <Info size={11} /> {t('netTcpHint')}
              </div>
            )}
          </>
        ) : (
          <ProcessesView detail={detail} user={selected} query={query} tree={tree} cores={s.cores} sort={procSort} onSort={setProcSort} />
        )}
      </div>
    </Modal>
  )
}
