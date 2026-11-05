import { FolderOpen, X } from 'lucide-react'
import { useId } from 'react'
import { useT } from '../../lib/useT'

export interface KeyValueRow {
  name: string
  value: string
  enabled: boolean
  file?: boolean
}

interface Props {
  rows: KeyValueRow[]
  onChange: (rows: KeyValueRow[]) => void
  /** Suggestions for the name column. */
  names?: readonly string[]
  /** Multipart forms: each row is text or a local file. */
  allowFiles?: boolean
  /** No on/off switch, for lists where a row is simply there or not. */
  noToggle?: boolean
  onPickFile?: () => Promise<string | null>
}

const BLANK: KeyValueRow = { name: '', value: '', enabled: true }

/** Editable name/value rows with a switch per row, and always one blank row to type into. */
export function KeyValueTable({ rows, onChange, names, allowFiles, noToggle, onPickFile }: Props) {
  const t = useT()
  const listId = useId()
  const setRow = (index: number, patch: Partial<KeyValueRow>): void => {
    onChange(index === rows.length ? [...rows, { ...BLANK, ...patch }] : rows.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }
  const remove = (index: number): void => onChange(rows.filter((_, i) => i !== index))
  const pick = async (index: number): Promise<void> => {
    const path = await onPickFile?.()
    if (path) setRow(index, { value: path, file: true })
  }

  return (
    <div className={`kv-table ${noToggle ? 'no-toggle' : ''} ${allowFiles ? 'with-kind' : ''}`}>
      {names && (
        <datalist id={listId}>
          {names.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      )}
      {[...rows, BLANK].map((row, i) => {
        const blank = i === rows.length
        return (
          <div key={i} className={`kv-row ${row.enabled ? '' : 'off'}`}>
            {!noToggle && (
              <input
                type="checkbox"
                checked={row.enabled}
                disabled={blank}
                aria-label={row.name}
                onChange={(e) => setRow(i, { enabled: e.target.checked })}
              />
            )}
            <input
              className="input mono"
              value={row.name}
              placeholder={t('paramName')}
              spellCheck={false}
              list={names ? listId : undefined}
              onChange={(e) => setRow(i, { name: e.target.value })}
            />
            {allowFiles && (
              <select
                className="input kv-kind"
                value={row.file ? 'file' : 'text'}
                aria-label={t('bodyFileRow')}
                onChange={(e) => setRow(i, { file: e.target.value === 'file', value: '' })}
              >
                <option value="text">{t('bodyTextRow')}</option>
                <option value="file">{t('bodyFileRow')}</option>
              </select>
            )}
            {row.file ? (
              <button className="btn sm kv-file" onClick={() => void pick(i)} title={row.value || t('bodyPickFile')}>
                <FolderOpen size={13} />
                <span className="truncate">{row.value || t('bodyPickFile')}</span>
              </button>
            ) : (
              <input
                className="input mono"
                value={row.value}
                placeholder={t('paramValue')}
                spellCheck={false}
                onChange={(e) => setRow(i, { value: e.target.value })}
              />
            )}
            {blank ? (
              <span />
            ) : (
              <button className="icon-btn sm" onClick={() => remove(i)} title={t('paramDelete')}>
                <X size={13} />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
