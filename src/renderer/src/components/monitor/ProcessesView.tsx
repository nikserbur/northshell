import { CircleSlash, ListChecks, Loader2, OctagonX, Skull, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { formatBytes, formatDuration, formatRate } from '@shared/format'
import { compareProcs, filterProcs, processTree, type ProcSortKey, type SortState } from '@shared/procTable'
import { MAX_SIGNAL_TARGETS, PROCESS_SIGNALS, type ProcessSignal, type SignalResult } from '@shared/signals'
import type { MonitorDetail, ProcessRow } from '@shared/types'
import type { I18nKey } from '../../lib/i18n'
import { useT } from '../../lib/useT'
import { errorMessage } from '../../lib/util'
import { useApp } from '../../store/appStore'
import { ContextMenu, type MenuEntry } from '../ContextMenu'
import { MeterCell, SortTable, type Column } from './SortTable'

/** Rows actually rendered: a table with thousands of them, redrawn every few seconds, would stutter. */
const MAX_ROWS = 500
/** Processes named in the confirmation; the rest are counted. */
const CONFIRM_NAMES = 8

const rate = (value: number): string => (value > 0 ? formatRate(value) : '—')

/** The arguments after the program name; an app bundle's path repeats the name, so skip past it first. */
function argsOf(p: ProcessRow): string {
  const bundle = p.command.indexOf('.app/Contents/MacOS/')
  const at = p.command.indexOf(p.name, Math.max(0, bundle))
  return at < 0 ? p.command : p.command.slice(at + p.name.length)
}

/**
 * A pid alone is not enough to remember a pick: once the process ends, its number can come back as another
 * program. Together with the command line it can't pass for something else.
 */
const keyOf = (p: ProcessRow): string => `${p.pid}\0${p.command}`

/** The process and everything started under it, from the parent links of the list. */
function withDescendants(root: ProcessRow, all: ProcessRow[]): ProcessRow[] {
  const children = new Map<number, ProcessRow[]>()
  for (const p of all) if (p.ppid !== p.pid) children.set(p.ppid, [...(children.get(p.ppid) ?? []), p])
  const out: ProcessRow[] = []
  const walk = (p: ProcessRow): void => {
    out.push(p)
    for (const c of children.get(p.pid) ?? []) walk(c)
  }
  walk(root)
  return out
}

/** How long the outcome of a send stays in the footer. */
const RESULT_MS = 10_000

const SIGNAL_HINTS: Record<ProcessSignal, I18nKey> = {
  TERM: 'sigTerm',
  KILL: 'sigKill',
  INT: 'sigInt',
  HUP: 'sigHup',
  STOP: 'sigStop',
  CONT: 'sigCont'
}

interface Props {
  monitorKey: string
  remote: boolean
  detail: MonitorDetail
  user: string | null
  query: string
  tree: boolean
  cores: number
  sort: SortState<ProcSortKey>
  onSort: (sort: SortState<ProcSortKey>) => void
}

/** The htop-like table: every process, sortable by any column, the full command line a click away, and signals for any selection. */
export function ProcessesView({ monitorKey, remote, detail, user, query, tree, cores, sort, onSort }: Props) {
  const t = useT()
  const toast = useApp((s) => s.toast)
  // Shown in the footer, not as a toast: a toast would sit right on top of the buttons of the next send.
  const [result, setResult] = useState<{ text: string; tone: 'ok' | 'mixed' | 'bad' } | null>(null)
  const [openPid, setOpenPid] = useState<number | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; row: ProcessRow } | null>(null)
  const [confirm, setConfirm] = useState<{ signal: ProcessSignal; rows: ProcessRow[] } | null>(null)
  const [sudo, setSudo] = useState(false)
  const [sending, setSending] = useState(false)
  const headerBox = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => filterProcs(detail.processes, user, query), [detail.processes, user, query])
  const order = useMemo(() => compareProcs(sort), [sort])
  const rows = useMemo(() => {
    if (tree) return processTree(filtered, order)
    return [...filtered].sort(order).map((row) => ({ row, prefix: '' }))
  }, [filtered, order, tree])
  const prefixes = useMemo(() => new Map(rows.map((r) => [r.row.pid, r.prefix])), [rows])
  const ordered = useMemo(() => rows.map((r) => r.row), [rows])
  const shown = useMemo(() => ordered.slice(0, MAX_ROWS), [ordered])
  /** Picks that are still running; ones that ended drop out on their own. */
  const selection = useMemo(() => detail.processes.filter((p) => picked.has(keyOf(p))), [detail.processes, picked])
  const visiblePicked = ordered.filter((p) => picked.has(keyOf(p))).length

  useEffect(() => {
    if (!result) return
    const timer = setTimeout(() => setResult(null), RESULT_MS)
    return () => clearTimeout(timer)
  }, [result])

  useEffect(() => {
    if (headerBox.current) headerBox.current.indeterminate = visiblePicked > 0 && visiblePicked < ordered.length
  }, [visiblePicked, ordered.length])

  const setMany = (list: ProcessRow[], on: boolean): void => {
    const next = new Set(picked)
    for (const p of list) {
      if (on) next.add(keyOf(p))
      else next.delete(keyOf(p))
    }
    setPicked(next)
  }

  /** A click picks one; a shift-click picks everything between it and the last click, as in Finder. */
  const toggle = (row: ProcessRow, range: boolean): void => {
    const key = keyOf(row)
    const on = !picked.has(key)
    const from = anchor ? ordered.findIndex((p) => keyOf(p) === anchor) : -1
    const to = ordered.findIndex((p) => keyOf(p) === key)
    if (range && from >= 0 && to >= 0) setMany(ordered.slice(Math.min(from, to), Math.max(from, to) + 1), on)
    else setMany([row], on)
    setAnchor(key)
  }

  const ask = (signal: ProcessSignal, list: ProcessRow[]): void => {
    if (list.length === 0) return
    if (list.length > MAX_SIGNAL_TARGETS) {
      toast({ kind: 'error', text: t('killTooMany', { max: MAX_SIGNAL_TARGETS }) })
      return
    }
    setResult(null)
    setConfirm({ signal, rows: list })
  }

  const report = (signal: ProcessSignal, results: SignalResult[]): void => {
    const count = (outcome: SignalResult['outcome']): number => results.filter((r) => r.outcome === outcome).length
    const ok = count('ok')
    const parts = [t('killDone', { signal: `SIG${signal}`, ok, total: results.length })]
    if (count('denied')) parts.push(t(remote ? 'killDeniedRemote' : 'killDenied', { n: count('denied') }))
    if (count('sudo')) parts.push(t('killSudoFailed', { n: count('sudo') }))
    if (count('gone')) parts.push(t('killGone', { n: count('gone') }))
    if (count('refused')) parts.push(t('killRefused'))
    if (count('error')) parts.push(t('killFailed', { n: count('error'), message: results.find((r) => r.outcome === 'error')?.message ?? '' }))
    setResult({ text: parts.join(' · '), tone: ok === results.length ? 'ok' : ok > 0 ? 'mixed' : 'bad' })
  }

  const send = (): void => {
    if (!confirm) return
    const { signal, rows: targets } = confirm
    setSending(true)
    window.xmt.monitor
      .signal(
        monitorKey,
        targets.map((p) => p.pid),
        signal,
        remote && sudo
      )
      .then((results) => {
        report(signal, results)
        // What could not be signalled stays picked, ready for another try with sudo or KILL.
        const failed = new Set(results.filter((r) => r.outcome !== 'ok' && r.outcome !== 'gone').map((r) => r.pid))
        setMany(
          targets.filter((p) => !failed.has(p.pid)),
          false
        )
      })
      .catch((err: unknown) => setResult({ text: errorMessage(err), tone: 'bad' }))
      .finally(() => {
        setSending(false)
        setConfirm(null)
      })
  }

  const openMenu = (row: ProcessRow, e: MouseEvent): void => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, row })
  }

  /** The menu acts on the selection when the row is part of it, and on the row alone otherwise. */
  const menuItems = (row: ProcessRow): MenuEntry[] => {
    const targets = picked.has(keyOf(row)) && selection.length > 1 ? selection : [row]
    const many = targets.length > 1 ? ` (${targets.length})` : ''
    const family = withDescendants(row, detail.processes)
    return [
      { label: `${t('killTerm')}${many}`, icon: <OctagonX size={14} />, onClick: () => ask('TERM', targets) },
      { label: `${t('killKill')}${many}`, icon: <Skull size={14} />, danger: true, onClick: () => ask('KILL', targets) },
      'separator',
      { label: t('selectUser', { user: row.user }), icon: <ListChecks size={14} />, onClick: () => setMany(detail.processes.filter((p) => p.user === row.user), true) },
      ...(family.length > 1
        ? [{ label: t('selectTree', { n: family.length - 1 }), icon: <ListChecks size={14} />, onClick: () => setMany(family, true) }]
        : []),
      ...(selection.length > 0 ? [{ label: t('killClear'), icon: <CircleSlash size={14} />, onClick: () => setPicked(new Set()) }] : [])
    ]
  }

  // Percent of one core, as in the CPU column: three busy processes can add up to 300%.
  const totalCpu = selection.reduce((sum, p) => sum + p.cpu, 0)
  const totalMem = selection.reduce((sum, p) => sum + p.rss, 0)

  const columns: Column<ProcessRow, ProcSortKey>[] = [
    {
      id: 'pick',
      label: '',
      width: 34,
      header: (
        <input
          ref={headerBox}
          type="checkbox"
          className="proc-check"
          aria-label={t('selectAllFound')}
          title={t('selectAllFound')}
          checked={ordered.length > 0 && visiblePicked === ordered.length}
          onChange={(e) => setMany(ordered, e.target.checked)}
        />
      ),
      cell: (p) => (
        <input
          type="checkbox"
          className="proc-check"
          aria-label={`${p.name} ${p.pid}`}
          checked={picked.has(keyOf(p))}
          onClick={(e) => {
            e.stopPropagation()
            toggle(p, e.shiftKey)
          }}
          onChange={() => undefined}
        />
      )
    },
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
          onRowContextMenu={openMenu}
          isSelected={(p) => p.pid === openPid}
          isChecked={(p) => picked.has(keyOf(p))}
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

      {confirm ? (
        <div className="kill-bar confirm" role="alertdialog" aria-label={t('killConfirm', { signal: `SIG${confirm.signal}`, n: confirm.rows.length })}>
          <div className="kill-what">
            <b>{t('killConfirm', { signal: `SIG${confirm.signal}`, n: confirm.rows.length })}</b>
            <span className="kill-names">
              {confirm.rows
                .slice(0, CONFIRM_NAMES)
                .map((p) => `${p.name} (${p.pid}, ${p.user})`)
                .join(', ')}
              {confirm.rows.length > CONFIRM_NAMES && ` ${t('killMore', { n: confirm.rows.length - CONFIRM_NAMES })}`}
            </span>
            <span className="dim">{t(SIGNAL_HINTS[confirm.signal])}</span>
          </div>
          <button className="btn sm ghost" autoFocus disabled={sending} onClick={() => setConfirm(null)}>
            {t('cancel')}
          </button>
          <button className={`btn sm ${confirm.signal === 'KILL' || confirm.signal === 'TERM' ? 'danger' : 'primary'}`} disabled={sending} onClick={send}>
            {sending ? <Loader2 size={13} className="spin" /> : null}
            {sending ? t('killSending') : t('killSend', { signal: `SIG${confirm.signal}` })}
          </button>
        </div>
      ) : selection.length > 0 ? (
        <div className="kill-bar">
          <span className="kill-count">
            <b>{t('killSelected', { n: selection.length })}</b>
            {result ? (
              <span className={`kill-result ${result.tone}`}>{result.text}</span>
            ) : (
              <span className="dim">
                CPU {totalCpu.toFixed(totalCpu >= 10 ? 0 : 1)}% · RAM {formatBytes(totalMem)}
              </span>
            )}
          </span>
          {remote && (
            <label className="http-check" title={t('killSudoHint')}>
              <input type="checkbox" checked={sudo} onChange={(e) => setSudo(e.target.checked)} />
              sudo
            </label>
          )}
          <select
            className="input kill-other"
            value=""
            aria-label={t('killOther')}
            onChange={(e) => e.target.value && ask(e.target.value as ProcessSignal, selection)}
          >
            <option value="">{t('killOther')}</option>
            {PROCESS_SIGNALS.filter((s) => s !== 'TERM' && s !== 'KILL').map((s) => (
              <option key={s} value={s}>
                SIG{s} — {t(SIGNAL_HINTS[s])}
              </option>
            ))}
          </select>
          <button className="btn sm" onClick={() => ask('TERM', selection)} title={t('sigTerm')}>
            <OctagonX size={13} /> {t('killTerm')}
          </button>
          <button className="btn sm danger" onClick={() => ask('KILL', selection)} title={t('sigKill')}>
            <Skull size={13} /> {t('killKill')}
          </button>
          <button className="icon-btn sm" onClick={() => setPicked(new Set())} title={t('killClear')}>
            <X size={13} />
          </button>
        </div>
      ) : (
        <div className="mon-foot">
          {t('monShownOf', { shown: shown.length, total: rows.length })}
          {result ? <span className={`kill-result ${result.tone}`}>{result.text}</span> : <span className="mon-foot-hint">{t('killHint')}</span>}
        </div>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.row)} onClose={() => setMenu(null)} />}
    </>
  )
}
