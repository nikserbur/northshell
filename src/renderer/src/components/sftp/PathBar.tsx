import { ChevronRight, FolderSync, PencilLine, SquareTerminal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useT } from '../../lib/useT'

interface PathBarProps {
  path: string
  onNavigate: (path: string) => void
  /** Whether the panel follows `cd` in the terminal, and the toggle for it. */
  follow?: { on: boolean; toggle: () => void }
  /** Runs `cd` to this folder in the terminal. */
  onCdHere?: () => void
}

/** Clickable breadcrumbs; click the pencil (or double-click) to type a path. */
export function PathBar({ path, onNavigate, follow, onCdHere }: PathBarProps) {
  const t = useT()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(path)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => setDraft(path), [path])
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [path, editing])

  const parts = path.split('/').filter(Boolean)

  if (editing) {
    return (
      <form
        className="sftp-path"
        onSubmit={(e) => {
          e.preventDefault()
          setEditing(false)
          const next = draft.trim()
          if (next.startsWith('/')) onNavigate(next.replace(/(.)\/+$/, '$1'))
        }}
      >
        <input
          autoFocus
          value={draft}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
        />
      </form>
    )
  }

  return (
    <div className="sftp-path" onDoubleClick={() => setEditing(true)}>
      <div className="crumbs" ref={scrollRef}>
        <button className="crumb" onClick={() => onNavigate('/')}>
          /
        </button>
        {parts.map((part, i) => (
          <span key={`${i}-${part}`} className="crumb-wrap">
            {i > 0 && <ChevronRight size={11} className="crumb-sep" />}
            <button
              className={`crumb ${i === parts.length - 1 ? 'last' : ''}`}
              onClick={() => onNavigate(`/${parts.slice(0, i + 1).join('/')}`)}
            >
              {part}
            </button>
          </span>
        ))}
      </div>
      <button className="icon-btn sm" onClick={() => setEditing(true)} title={t('editPath')}>
        <PencilLine size={12} />
      </button>
      {onCdHere && (
        <button className="icon-btn sm" onClick={onCdHere} title={t('cdInTerminal')}>
          <SquareTerminal size={12} />
        </button>
      )}
      {follow && (
        <button
          className={`icon-btn sm ${follow.on ? 'on' : ''}`}
          onClick={follow.toggle}
          title={follow.on ? t('followTerminalOn') : t('followTerminalOff')}
          aria-pressed={follow.on}
        >
          <FolderSync size={12} />
        </button>
      )}
    </div>
  )
}
