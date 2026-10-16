import type { Language, SessionConfig } from '@shared/types'

export function monogram(name: string): string {
  const words = name.trim().split(/[\s._@-]+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2)
  return words[0][0] + words[1][0]
}

export function levelClass(percent: number): string {
  if (percent >= 85) return 'lvl-crit'
  if (percent >= 60) return 'lvl-warn'
  return 'lvl-ok'
}

export function relativeTime(ts: number, lang: Language): string {
  if (!ts) return ''
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'short' })
  const diff = (ts - Date.now()) / 1000
  const abs = Math.abs(diff)
  if (abs < 60) return rtf.format(Math.round(diff), 'second')
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
  return rtf.format(Math.round(diff / 86400), 'day')
}

export function formatDate(ts: number, lang: Language): string {
  if (!ts) return ''
  const d = new Date(ts)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(lang, sameYear ? { day: '2-digit', month: 'short' } : { year: '2-digit', month: 'short' })
}

export function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** Second line under a session name: user@host:port, or the base URL of an HTTP environment. */
export function sessionSubtitle(s: SessionConfig): string {
  if (s.kind === 'http') return s.baseUrl.replace(/^https?:\/\//, '')
  return `${s.username ? `${s.username}@` : ''}${s.host}${s.port !== 22 ? `:${s.port}` : ''}`
}
