import { ArrowDown, ArrowUp } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'
import { firstDirection, type SortState } from '@shared/procTable'

export interface Column<T, K extends string> {
  /** Sort key; columns without one cannot be sorted. */
  sort?: K
  id: string
  label: string
  title?: string
  num?: boolean
  /** Column width in pixels; a column without one takes the remaining space. */
  width?: number
  cell: (row: T) => ReactNode
}

interface Props<T, K extends string> {
  columns: Column<T, K>[]
  rows: T[]
  rowKey: (row: T) => string | number
  sort: SortState<K>
  onSort: (sort: SortState<K>) => void
  onRowClick?: (row: T) => void
  isSelected?: (row: T) => boolean
  /** Extra full-width row under a row, e.g. its details. */
  renderExpansion?: (row: T) => ReactNode
}

/** A value with a bar behind it, so the heaviest rows stand out at a glance. */
export function MeterCell({ text, pct }: { text: string; pct: number }) {
  return (
    <span className="meter-cell">
      <i style={{ transform: `scaleX(${Math.min(100, Math.max(0, pct)) / 100})` }} />
      <span>{text}</span>
    </span>
  )
}

/** Table with a sticky header whose columns sort on click: a second click flips the direction. */
export function SortTable<T, K extends string>({ columns, rows, rowKey, sort, onSort, onRowClick, isSelected, renderExpansion }: Props<T, K>) {
  const toggle = (key: K): void => onSort(sort.key === key ? { key, desc: !sort.desc } : { key, desc: firstDirection(key) })
  return (
    <table className="sort-table">
      <colgroup>
        {columns.map((c) => (
          <col key={c.id} style={c.width ? { width: c.width } : undefined} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {columns.map((c) => {
            const key = c.sort
            const active = key !== undefined && sort.key === key
            return (
              <th key={c.id} className={c.num ? 'num' : ''} title={c.title} aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : undefined}>
                {key === undefined ? (
                  c.label
                ) : (
                  <button className={active ? 'on' : ''} onClick={() => toggle(key)}>
                    {c.label}
                    {active && (sort.desc ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
                  </button>
                )}
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const expansion = renderExpansion?.(row)
          return (
            <Fragment key={rowKey(row)}>
              <tr className={`${onRowClick ? 'clickable' : ''} ${isSelected?.(row) ? 'selected' : ''}`} onClick={onRowClick ? () => onRowClick(row) : undefined}>
                {columns.map((c) => (
                  <td key={c.id} className={c.num ? 'num' : ''}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
              {expansion && (
                <tr className="sort-expansion">
                  <td colSpan={columns.length}>{expansion}</td>
                </tr>
              )}
            </Fragment>
          )
        })}
      </tbody>
    </table>
  )
}
