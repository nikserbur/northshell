import { useMemo } from 'react'
import { formatBytes, formatPercent, formatRate } from '@shared/format'
import { sortUsers, type SortState, type UserSortKey } from '@shared/procTable'
import type { MonitorDetail, UserUsage } from '@shared/types'
import { useT } from '../../lib/useT'
import type { DiskOwnersState } from '../../store/appStore'
import { MeterCell, SortTable, type Column } from './SortTable'

const rate = (value: number): string => (value > 0 ? formatRate(value) : '—')

interface Props {
  detail: MonitorDetail
  /** Finished disk walks of this host; their totals fill the "used" column. */
  owners: Record<string, DiskOwnersState> | undefined
  sort: SortState<UserSortKey>
  onSort: (sort: SortState<UserSortKey>) => void
  selected: string | null
  onPick: (user: string) => void
}

/** Bytes a user owns across every volume that has been calculated, or null if none has. */
function ownedBytes(owners: Props['owners'], user: string): number | null {
  const results = Object.values(owners ?? {}).flatMap((o) => (o.result ? [o.result] : []))
  if (results.length === 0) return null
  return results.reduce((sum, r) => sum + (r.users.find((u) => u.user === user)?.bytes ?? 0), 0)
}

/** One row per user: who loads the CPU, memory, disk and network, and who takes up the space. */
export function UsersView({ detail, owners, sort, onSort, selected, onPick }: Props) {
  const t = useT()
  const rows = useMemo(() => sortUsers(detail.users, sort), [detail.users, sort])
  const scanned = Object.values(owners ?? {}).some((o) => o.result)

  const columns: Column<UserUsage, UserSortKey>[] = [
    { id: 'user', sort: 'user', label: t('colUser'), cell: (u) => <b className="truncate cell-user">{u.user}</b> },
    { id: 'procs', sort: 'procs', label: t('colProcs'), num: true, width: 92, cell: (u) => u.procs },
    { id: 'cpu', sort: 'cpu', label: t('colCpu'), title: t('userCpuHint'), num: true, width: 96, cell: (u) => <MeterCell text={formatPercent(u.cpu)} pct={u.cpu} /> },
    { id: 'mem', sort: 'mem', label: t('colRes'), num: true, width: 110, cell: (u) => <MeterCell text={formatBytes(u.mem)} pct={u.memPct} /> },
    ...(detail.diskIo !== 'none'
      ? ([
          { id: 'read', sort: 'diskRead', label: t('colRead'), num: true, width: 104, cell: (u) => rate(u.diskRead) },
          { id: 'write', sort: 'diskWrite', label: t('colWrite'), num: true, width: 104, cell: (u) => rate(u.diskWrite) }
        ] satisfies Column<UserUsage, UserSortKey>[])
      : []),
    ...(detail.net !== 'none'
      ? ([
          { id: 'netRx', sort: 'net', label: '↓ ' + t('colNet'), num: true, width: 104, cell: (u) => rate(u.netRx) },
          { id: 'netTx', label: '↑', num: true, width: 96, cell: (u) => rate(u.netTx) }
        ] satisfies Column<UserUsage, UserSortKey>[])
      : []),
    ...(scanned
      ? ([
          {
            id: 'owned',
            label: t('colDiskUsed'),
            num: true,
            width: 96,
            cell: (u) => {
              const bytes = ownedBytes(owners, u.user)
              return bytes ? formatBytes(bytes) : '—'
            }
          }
        ] satisfies Column<UserUsage, UserSortKey>[])
      : [])
  ]

  return (
    <div className="mon-table-scroll">
      <SortTable
        columns={columns}
        rows={rows}
        rowKey={(u) => u.user}
        sort={sort}
        onSort={onSort}
        onRowClick={(u) => onPick(u.user)}
        isSelected={(u) => u.user === selected}
      />
    </div>
  )
}
