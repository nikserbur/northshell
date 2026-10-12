import { describe, expect, it } from 'vitest'
import { formatBytes, formatDuration, formatPercent, formatRate, clampPercent } from './format'

describe('formatBytes', () => {
  it('formats small and large values', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(10 * 1024 * 1024)).toBe('10 MB')
    expect(formatBytes(3.25 * 1024 ** 3)).toBe('3.3 GB')
    expect(formatBytes(2 * 1024 ** 4)).toBe('2.0 TB')
  })

  it('handles invalid input', () => {
    expect(formatBytes(-5)).toBe('0 B')
    expect(formatBytes(Number.NaN)).toBe('0 B')
  })
})

describe('formatRate', () => {
  it('appends per-second suffix', () => {
    expect(formatRate(2048)).toBe('2.0 KB/s')
  })
})

describe('formatDuration', () => {
  it('formats seconds into compact units', () => {
    expect(formatDuration(42)).toBe('42s')
    expect(formatDuration(125)).toBe('2m 5s')
    expect(formatDuration(3 * 3600 + 7 * 60)).toBe('3h 7m')
    expect(formatDuration(2 * 86400 + 5 * 3600)).toBe('2d 5h')
    expect(formatDuration(-1)).toBe('0s')
  })
})

describe('percent helpers', () => {
  it('clamps and formats', () => {
    expect(clampPercent(140)).toBe(100)
    expect(clampPercent(-3)).toBe(0)
    expect(clampPercent(Number.NaN)).toBe(0)
    expect(formatPercent(33.333)).toBe('33%')
    expect(formatPercent(4.25)).toBe('4.3%')
  })
})
