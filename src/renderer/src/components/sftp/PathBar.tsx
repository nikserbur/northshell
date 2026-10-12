import { ChevronRight, PencilLine } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

interface PathBarProps {
  path: string
  onNavigate: (path: string) => void
}

/** Clickable breadcrumbs; click the pencil (or double-click) to type a path. */
export function PathBar({ path, onNavigate }: PathBarProps) {
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
      <button className="icon-btn sm" onClick={() => setEditing(true)} aria-label="Edit path">
        <PencilLine size={12} />
      </button>
    </div>
  )
}
