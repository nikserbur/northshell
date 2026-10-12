import { useEffect, useRef, useState } from 'react'

interface Tip {
  label: string
  keys: string | null
  x: number
  y: number
  below: boolean
}

const DELAY_MS = 380
const SHORTCUT_RE = /\s+((?:[⌘⇧⌃⌥]+\S*|↩|⇧↩|esc))$/

/** Splits "Close tab ⌘W" into a label and a keycap. */
function parse(text: string): Pick<Tip, 'label' | 'keys'> {
  const m = SHORTCUT_RE.exec(text)
  return m ? { label: text.slice(0, m.index), keys: m[1] } : { label: text, keys: null }
}

/**
 * App-wide hover hints. Any element with a `title` gets a fast, styled tooltip instead of the
 * slow native one: the title is moved to `data-tip` (and `aria-label` when missing) on first hover.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null)
  const timer = useRef<number | null>(null)
  const current = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const clear = (): void => {
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = null
      current.current = null
      setTip(null)
    }

    const onOver = (e: MouseEvent): void => {
      const target = e.target instanceof Element ? e.target.closest<HTMLElement>('[title],[data-tip]') : null
      if (target === current.current) return
      clear()
      if (!target) return
      const title = target.getAttribute('title')
      if (title) {
        target.dataset.tip = title
        target.removeAttribute('title')
        if (!target.hasAttribute('aria-label') && !target.textContent?.trim()) target.setAttribute('aria-label', title)
      }
      const text = target.dataset.tip
      if (!text) return
      current.current = target
      timer.current = window.setTimeout(() => {
        if (!target.isConnected) return
        const r = target.getBoundingClientRect()
        const below = r.bottom + 40 < window.innerHeight
        setTip({ ...parse(text), x: r.left + r.width / 2, y: below ? r.bottom + 6 : r.top - 6, below })
      }, DELAY_MS)
    }

    window.addEventListener('mouseover', onOver, true)
    window.addEventListener('mousedown', clear, true)
    window.addEventListener('keydown', clear, true)
    window.addEventListener('wheel', clear, { capture: true, passive: true })
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('mouseover', onOver, true)
      window.removeEventListener('mousedown', clear, true)
      window.removeEventListener('keydown', clear, true)
      window.removeEventListener('wheel', clear, true)
      window.removeEventListener('blur', clear)
    }
  }, [])

  if (!tip) return null
  const left = Math.min(Math.max(tip.x, 90), window.innerWidth - 90)
  return (
    <div
      className={`tooltip ${tip.below ? 'below' : 'above'}`}
      style={{ left, top: tip.y }}
      role="tooltip"
    >
      <span>{tip.label}</span>
      {tip.keys && <span className="kbd">{tip.keys}</span>}
    </div>
  )
}
