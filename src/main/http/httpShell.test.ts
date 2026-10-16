import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SessionConfig } from '@shared/types'
import { prepareHttpShell, sweepStaleHttpShells } from './httpShell'

const session = (patch: Partial<SessionConfig> = {}): SessionConfig => ({
  id: 'a',
  kind: 'http',
  name: 'api',
  folder: '',
  host: 'api.example.com',
  port: 443,
  username: '',
  auth: 'password',
  keyPath: '',
  color: '#5eead4',
  startupCommand: '',
  monitoring: false,
  sftp: false,
  baseUrl: 'https://api.example.com/v1',
  headers: 'Authorization: Bearer $TOKEN',
  insecure: false,
  hasSecret: true,
  createdAt: 0,
  lastUsedAt: 0,
  useCount: 0,
  ...patch
})

describe('prepareHttpShell', () => {
  it('exports the variables and writes a private curl config that dispose removes', () => {
    const http = prepareHttpShell(session(), 'tok')
    const rc = join(http.env.CURL_HOME, '.curlrc')
    expect(http.env.BASE_URL).toBe('https://api.example.com/v1')
    expect(http.env.TOKEN).toBe('tok')
    expect(readFileSync(rc, 'utf8')).toContain('header = "Authorization: Bearer tok"')
    expect(statSync(rc).mode & 0o777).toBe(0o600)
    http.dispose()
    http.dispose()
    expect(existsSync(http.env.CURL_HOME)).toBe(false)
  })

  it('omits $TOKEN when none is saved and refuses a bad base URL', () => {
    const http = prepareHttpShell(session(), undefined)
    expect(http.env.TOKEN).toBeUndefined()
    http.dispose()
    expect(() => prepareHttpShell(session({ baseUrl: 'ftp://x' }), undefined)).toThrow(/base URL/)
  })
})

describe('sweepStaleHttpShells', () => {
  it('removes leftovers of dead processes and keeps live ones and unrelated folders', () => {
    const root = mkdtempSync(join(tmpdir(), 'sweep-'))
    const dead = join(root, 'northshell-http-999999-abc')
    const live = join(root, `northshell-http-${process.pid}-abc`)
    const other = join(root, 'something-else')
    for (const dir of [dead, live, other]) mkdirSync(dir)
    expect(sweepStaleHttpShells(root)).toBe(1)
    expect(existsSync(dead)).toBe(false)
    expect(existsSync(live)).toBe(true)
    expect(existsSync(other)).toBe(true)
  })
})
