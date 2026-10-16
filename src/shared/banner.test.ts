import { describe, expect, it } from 'vitest'
import { buildBanner, buildHttpBanner } from './banner'

const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '')

describe('buildBanner', () => {
  const banner = buildBanner({ app: 'Northshell', version: '1.2.0', target: 'root@10.0.0.5:22', sftp: true, monitoring: false })
  const lines = strip(banner).split('\r\n').filter(Boolean)

  it('draws a closed box with equal-width lines', () => {
    expect(lines[0].startsWith('┌')).toBe(true)
    expect(lines.at(-1)?.startsWith('└')).toBe(true)
    const widths = new Set(lines.map((l) => [...l].length))
    expect(widths.size).toBe(1)
  })

  it('names the app, the target and the enabled features', () => {
    const text = lines.join('\n')
    expect(text).toContain('• Northshell 1.2.0 •')
    expect(text).toContain('SSH session to root@10.0.0.5:22')
    expect(text).toMatch(/SFTP browser\s+:\s+✓/)
    expect(text).toMatch(/Server monitoring\s+:\s+✗/)
  })

  it('colours the target magenta and check marks green', () => {
    expect(banner).toContain('\x1b[38;5;213mroot@10.0.0.5:22')
    expect(banner).toContain('\x1b[38;5;77m✓')
  })
})

describe('buildHttpBanner', () => {
  const info = {
    name: 'api-prod',
    baseUrl: 'https://api.example.com',
    token: 'none' as const,
    headerNames: ['Accept', 'Authorization'],
    skippedHeaders: ['Authorization'],
    insecure: true
  }
  const lines = strip(buildHttpBanner(info)).split('\r\n').filter(Boolean)
  const text = lines.join('\n')

  it('draws an even box', () => {
    expect(new Set(lines.map((l) => [...l].length)).size).toBe(1)
  })

  it('shows the variables, header names, missing token and TLS warning', () => {
    expect(text).toContain('HTTP environment · api-prod')
    expect(text).toMatch(/\$BASE_URL\s+https:\/\/api\.example\.com/)
    expect(text).toMatch(/\$TOKEN\s+✗ not set/)
    expect(text).toContain('Accept, Authorization')
    expect(text).toContain('Authorization (needs $TOKEN)')
    expect(text).toContain('certificate not checked')
  })

  it('omits optional lines when everything is in place', () => {
    const ok = strip(buildHttpBanner({ ...info, token: 'keychain', skippedHeaders: [], insecure: false }))
    expect(ok).toContain('✓ from Keychain')
    expect(ok).not.toContain('skipped')
    expect(ok).not.toContain('TLS')
  })

  it('says when a saved token cannot be read', () => {
    expect(strip(buildHttpBanner({ ...info, token: 'unreadable' }))).toContain('cannot read from Keychain')
  })
})
