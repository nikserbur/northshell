import { useMemo, useState } from 'react'
import { formatBytes, formatDuration, formatRate } from '@shared/format'
import { compareProcs, filterProcs, processTree, type ProcSortKey, type SortState } from '@shared/procTable'
import type { MonitorDetail, ProcessRow } from '@shared/types'
import { useT } from '../../lib/useT'
import { MeterCell, SortTable, type Column } from './SortTable'

/** Rows actually rendered: a table with thousands of them, redrawn every few seconds, would stutter. */
const MAX_ROWS = 500

const rate = (value: number): string => (value > 0 ? formatRate(value) : '—')

/** The arguments after the program name; an app bundle's path repeats the name, so skip past it first. */
function argsOf(p: ProcessRow): string {
  const bundle = p.command.indexOf('.app/Contents/MacOS/')
  const at = p.command.indexOf(p.name, Math.max(0, bundle))
  return at < 0 ? p.command : p.command.slice(at + p.name.length)
}

interface Props {
  detail: MonitorDetail
  user: string | null
  query: string
  tree: boolean
  cores: number
  sort: SortState<ProcSortKey>
  onSort: (sort: SortState<ProcSortKey>) => void
}

/** The htop-like table: every process, sortable by any column, with the full command line a click away. */
export function ProcessesView({ detail, user, query, tree, cores, sort, onSort }: Props) {
  const t = useT()
  const [openPid, setOpenPid] = useState<number | null>(null)

  const filtered = useMemo(() => filterProcs(detail.processes, user, query), [detail.processes, user, query])
  const order = useMemo(() => compareProcs(sort), [sort])
  const rows = useMemo(() => {
    if (tree) return processTree(filtered, order)
    return [...filtered].sort(order).map((row) => ({ row, prefix: '' }))
  }, [filtered, order, tree])
  const prefixes = useMemo(() => new Map(rows.map((r) => [r.row.pid, r.prefix])), [rows])
  const shown = useMemo(() => rows.slice(0, MAX_ROWS).map((r) => r.row), [rows])

  const columns: Column<ProcessRow, ProcSortKey>[] = [
    { id: 'pid', sort: 'pid', label: t('colPid'), num: true, width: 66, cell: (p) => <span className="dim">{p.pid}</span> },
    { id: 'user', sort: 'user', label: t('colUser'), width: 116, cell: (p) => <span className="truncate cell-user">{p.user}</span> },
    { id: 'cpu', sort: 'cpu', label: t('colCpu'), num: true, width: 82, cell: (p) => <MeterCell text={p.cpu.toFixed(1)} pct={p.cpu / cores} /> },
    { id: 'mem', sort: 'mem', label: t('colMem'), num: true, width: 74, cell: (p) => <MeterCell text={p.mem.toFixed(1)} pct={p.mem} /> },
    { id: 'rss', sort: 'rss', label: t('colRes'), num: true, width: 78, cell: (p) => formatBytes(p.rss) },
    { id: 'vsz', sort: 'vsz', label: t('colVirt'), num: true, width: 78, cell: (p) => <span className="dim">{formatBytes(p.vsz)}</span> },
    ...(detail.diskIo !== 'none'
      ? ([
          { id: 'read', sort: 'disk', label: t('colRead'), num: true, width: 88, cell: (p) => rate(p.diskRead) },
          { id: 'write', label: t('colWrite'), num: true, width: 88, cell: (p) => rate(p.diskWrite) }
        ] satisfies Column<ProcessRow, ProcSortKey>[])
      : []),
    ...(detail.net !== 'none'
      ? ([
          { id: 'net', sort: 'net', label: '↓ ' + t('colNet'), num: true, width: 92, cell: (p) => rate(p.netRx) },
          { id: 'netTx', label: '↑', num: true, width: 84, cell: (p) => rate(p.netTx) }
        ] satisfies Column<ProcessRow, ProcSortKey>[])
      : []),
    { id: 'state', sort: 'state', label: t('colState'), width: 44, cell: (p) => <span className="dim">{p.state}</span> },
    { id: 'elapsed', sort: 'elapsed', label: t('colElapsed'), num: true, width: 84, cell: (p) => <span className="dim">{formatDuration(p.elapsed)}</span> },
    {
      id: 'name',
      sort: 'name',
      label: t('colCommand'),
      cell: (p) => (
        <span className="cell-command" title={p.command}>
          {prefixes.get(p.pid) && <span className="tree-guide">{prefixes.get(p.pid)}</span>}
          <b>{p.name}</b> <span className="dim">{argsOf(p)}</span>
        </span>
      )
    }
  ]

  return (
    <>
      <div className="mon-table-scroll">
        <SortTable
          columns={columns}
          rows={shown}
          rowKey={(p) => p.pid}
          sort={sort}
          onSort={onSort}
          onRowClick={(p) => setOpenPid(openPid === p.pid ? null : p.pid)}
          isSelected={(p) => p.pid === openPid}
          renderExpansion={(p) =>
            p.pid === openPid ? (
              <div className="proc-more">
                <span className="field-label">{t('procFull')}</span>
                <code>{p.command}</code>
                <span className="dim">
                  {[t('procParent', { pid: p.ppid }), p.threads !== null ? t('procThreads', { n: p.threads }) : '', t('procNice', { n: p.nice })].filter(Boolean).join(' · ')}
                </span>
              </div>
            ) : null
          }
        />
      </div>
      <div className="mon-foot">{t('monShownOf', { shown: shown.length, total: rows.length })}</div>
    </>
  )
}
