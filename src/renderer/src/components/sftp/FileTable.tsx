import { ArrowDown, ArrowUp, File, FileCode2, FileSymlink, Folder } from 'lucide-react'
import type { MouseEvent, ReactNode } from 'react'
import { formatBytes } from '@shared/format'
import type { SortDir, SortKey } from '@shared/fileSort'
import type { SearchHit, SftpEntry } from '@shared/types'
import { useT } from '../../lib/useT'
import { formatDate } from '../../lib/util'
import { useApp } from '../../store/appStore'
import { languageFor } from '../editor/languages'

interface SortHeaderProps {
  sortKey: SortKey
  sortDir: SortDir
  onSort: (key: SortKey) => void
}

function SortHeader({ sortKey, sortDir, onSort }: SortHeaderProps) {
  const t = useT()
  const arrow = sortDir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />
  const col = (key: SortKey, label: string) => (
    <button className={sortKey === key ? 'on' : ''} onClick={() => onSort(key)}>
      {label}
      {sortKey === key && arrow}
    </button>
  )
  return (
    <div className="sftp-cols">
      {col('name', t('name'))}
      {col('size', t('size'))}
      {col('mtime', t('modified'))}
    </div>
  )
}

function EntryIcon({ entry }: { entry: Pick<SftpEntry, 'isDir' | 'isLink' | 'name'> }) {
  if (entry.isDir) return <Folder size={14} className="dir" />
  if (entry.isLink) return <FileSymlink size={14} />
  if (languageFor(entry.name)) return <FileCode2 size={14} className="code" />
  return <File size={14} />
}

interface FileTableProps extends SortHeaderProps {
  entries: SftpEntry[]
  selected: Set<string>
  onRowClick: (e: MouseEvent, idx: number, entry: SftpEntry) => void
  onRowOpen: (entry: SftpEntry) => void
  onRowMenu: (idx: number, entry: SftpEntry) => void
  /** Shown under the header when there are no rows (empty folder, no filter match, error). */
  placeholder?: ReactNode
}

export function FileTable({ entries, selected, onRowClick, onRowOpen, onRowMenu, placeholder, ...sort }: FileTableProps) {
  const lang = useApp((s) => s.settings.language)
  return (
    <>
      <SortHeader {...sort} />
      {placeholder}
      {entries.map((entry, idx) => (
        <div
          key={entry.path}
          className={`file-row ${selected.has(entry.path) ? 'sel' : ''}`}
          onClick={(e) => onRowClick(e, idx, entry)}
          onDoubleClick={() => onRowOpen(entry)}
          onContextMenu={() => onRowMenu(idx, entry)}
          title={`${entry.mode}  ${entry.name}`}
        >
          <span className="file-name">
            <EntryIcon entry={entry} />
            <span className="truncate">{entry.name}</span>
          </span>
          <span className="file-size">{entry.isDir ? '' : formatBytes(entry.size)}</span>
          <span className="file-date">{formatDate(entry.mtime, lang)}</span>
        </div>
      ))}
    </>
  )
}

interface SearchListProps {
  root: string
  hits: SearchHit[]
  onOpen: (hit: SearchHit) => void
  onReveal: (hit: SearchHit) => void
}

export function SearchList({ root, hits, onOpen, onReveal }: SearchListProps) {
  const t = useT()
  const prefix = root.endsWith('/') ? root : `${root}/`
  return (
    <>
      {hits.length === 0 && <div className="sftp-empty">{t('nothingFound')}</div>}
      {hits.map((hit) => {
        const rel = hit.path.startsWith(prefix) ? hit.path.slice(prefix.length) : hit.path
        const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
        return (
          <div
            key={hit.path}
            className="file-row search-hit"
            onDoubleClick={() => onOpen(hit)}
            onContextMenu={(e) => {
              e.preventDefault()
              onReveal(hit)
            }}
            title={hit.path}
          >
            <span className="file-name">
              <EntryIcon entry={{ ...hit, isLink: false }} />
              <span className="truncate">
                {hit.name}
                {dir && <span className="hit-dir"> — {dir}</span>}
              </span>
            </span>
          </div>
        )
      })}
    </>
  )
}
