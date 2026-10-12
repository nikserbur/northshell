import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export interface MenuItem {
  label: string
  icon?: ReactNode
  danger?: boolean
  onClick: () => void
}

export type MenuEntry = MenuItem | 'separator'

interface ContextMenuProps {
  x: number
  y: number
  items: MenuEntry[]
  onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({
      left: Math.min(x, window.innerWidth - r.width - 8),
      top: Math.min(y, window.innerHeight - r.height - 8)
    })
  }, [x, y])

  useEffect(() => {
    const close = (e: Event): void => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', close, true)
    window.addEventListener('blur', onClose)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', close, true)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  return (
    <div className="ctx-menu" ref={ref} style={pos} role="menu">
      {items.map((item, i) =>
        item === 'separator' ? (
          <hr key={`sep-${i}`} />
        ) : (
          <button
            key={item.label}
            className={item.danger ? 'danger' : ''}
            role="menuitem"
            onClick={() => {
              onClose()
              item.onClick()
            }}
          >
            {item.icon}
            {item.label}
          </button>
        )
      )}
    </div>
  )
}
