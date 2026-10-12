import { describe, expect, it } from 'vitest'
import { buildBanner } from './banner'

const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '')

describe('buildBanner', () => {
  const banner = buildBanner({ app: 'Termora', version: '1.2.0', target: 'root@10.0.0.5:22', sftp: true, monitoring: false })
  const lines = strip(banner).split('\r\n').filter(Boolean)

  it('draws a closed box with equal-width lines', () => {
    expect(lines[0].startsWith('┌')).toBe(true)
    expect(lines.at(-1)?.startsWith('└')).toBe(true)
    const widths = new Set(lines.map((l) => [...l].length))
    expect(widths.size).toBe(1)
  })

  it('names the app, the target and the enabled features', () => {
    const text = lines.join('\n')
    expect(text).toContain('• Termora 1.2.0 •')
    expect(text).toContain('SSH session to root@10.0.0.5:22')
    expect(text).toMatch(/SFTP browser\s+:\s+✓/)
    expect(text).toMatch(/Server monitoring\s+:\s+✗/)
  })

  it('colours the target magenta and check marks green', () => {
    expect(banner).toContain('\x1b[38;5;213mroot@10.0.0.5:22')
    expect(banner).toContain('\x1b[38;5;77m✓')
  })
})
