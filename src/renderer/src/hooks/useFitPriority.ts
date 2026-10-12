import { useLayoutEffect, type DependencyList, type RefObject } from 'react'

function outerWidth(el: HTMLElement): number {
  const cs = getComputedStyle(el)
  return el.getBoundingClientRect().width + parseFloat(cs.marginLeft) + parseFloat(cs.marginRight)
}

/**
 * Keeps a row of children inside its container. Children with `data-priority="0"` (or none)
 * always stay; the rest are placed greedily from the lowest priority number up — each one is
 * shown if it still fits, so a wide low-priority item never pushes out smaller ones after it.
 * Hidden children get the `hidden` attribute. Re-runs on resize and when `deps` change.
 */
export function useFitPriority(ref: RefObject<HTMLElement | null>, deps: DependencyList): void {
  useLayoutEffect(() => {
    const row = ref.current
    if (!row) return
    const fit = (): void => {
      const items = [...row.children].filter((c): c is HTMLElement => c instanceof HTMLElement)
      items.forEach((item) => (item.hidden = false))
      const widths = new Map(items.map((item) => [item, outerWidth(item)]))
      const rank = (item: HTMLElement): number => Number(item.dataset.priority ?? 0)
      let used = items.filter((item) => rank(item) <= 0).reduce((sum, item) => sum + (widths.get(item) ?? 0), 0)
      const available = row.clientWidth
      for (const item of items.filter((i) => rank(i) > 0).sort((a, b) => rank(a) - rank(b))) {
        const w = widths.get(item) ?? 0
        if (w === 0) continue
        if (used + w <= available) used += w
        else item.hidden = true
      }
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(row)
    return () => ro.disconnect()
    // Callers pass the values that change the row's content.
  }, deps)
}
