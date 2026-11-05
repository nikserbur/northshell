import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { cookieJarPath, listCookies, parseCookieFile, removeCookies } from './cookieJar'

const FILE = ['# Netscape HTTP Cookie File', '', '#HttpOnly_api.test\tFALSE\t/\tTRUE\t1893456000\tsid\tabc', 'api.test\tFALSE\t/x\tFALSE\t0\ttheme\tdark', 'other\tFALSE'].join('\n')

describe('cookieJar', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cookies-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('reads HttpOnly and plain cookies and skips the rest', () => {
    expect(parseCookieFile(FILE)).toEqual([
      { domain: 'api.test', path: '/', secure: true, expires: 1893456000, name: 'sid', value: 'abc' },
      { domain: 'api.test', path: '/x', secure: false, expires: 0, name: 'theme', value: 'dark' }
    ])
  })

  it('never turns a session id into a path outside the folder', () => {
    expect(cookieJarPath('/data', '../../etc/passwd')).toBe('/data/______etc_passwd.txt')
  })

  it('removes one cookie or the whole jar', async () => {
    const path = join(dir, 'a.txt')
    writeFileSync(path, FILE)
    const left = await removeCookies(path, { domain: 'api.test', path: '/', name: 'sid' })
    expect(left.map((c) => c.name)).toEqual(['theme'])
    expect(readFileSync(path, 'utf8')).toContain('theme')
    expect(statSync(path).mode & 0o777).toBeLessThanOrEqual(0o644)
    expect(await removeCookies(path)).toEqual([])
    expect(await listCookies(path)).toEqual([])
  })
})
