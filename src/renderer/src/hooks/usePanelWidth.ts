import { useCallback, useState, type MouseEvent } from 'react'

function read(key: string, fallback: number, min: number, max: number): number {
  try {
    const v = Number(localStorage.getItem(key))
    return Number.isFinite(v) && v >= min && v <= max ? v : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: number | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, String(value))
  } catch {
    /* storage unavailable — width just won't persist */
  }
}

/**
 * Drag-to-resize width for a side panel, remembered per viewer; double-click resets.
 * `side` is where the panel sits: a right-hand panel grows when dragged to the left.
 */
export function usePanelWidth(key: string, initial: number, min: number, max: number, side: 'left' | 'right' = 'left') {
  const [width, setWidth] = useState(() => read(key, initial, min, max))

  const startResize = useCallback(
    (e: MouseEvent): void => {
      if (e.button !== 0) return
      e.preventDefault()
      const startX = e.clientX
      const startW = width
      let latest = startW
      document.body.classList.add('resizing')
      const move = (ev: globalThis.MouseEvent): void => {
        const delta = side === 'left' ? ev.clientX - startX : startX - ev.clientX
        latest = Math.round(Math.min(max, Math.max(min, startW + delta)))
        setWidth(latest)
      }
      const up = (): void => {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
        document.body.classList.remove('resizing')
        write(key, latest)
      }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    },
    [width, key, min, max, side]
  )

  const reset = useCallback((): void => {
    setWidth(initial)
    write(key, null)
  }, [key, initial])

  return { width, startResize, reset }
}
