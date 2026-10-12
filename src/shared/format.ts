const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  let unit = 0
  let n = value
  while (n >= 1024 && unit < UNITS.length - 1) {
    n /= 1024
    unit++
  }
  if (unit === 0) return `${Math.round(n)} B`
  const text = n >= 9.95 ? String(Math.round(n)) : n.toFixed(1)
  return `${text} ${UNITS[unit]}`
}

export function formatRate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

export function formatPercent(value: number): string {
  const v = clampPercent(value)
  return v >= 10 ? `${Math.round(v)}%` : `${v.toFixed(1)}%`
}
