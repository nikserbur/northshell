import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { HttpRequestSpec } from '@shared/httpRequest'
import { HttpStore } from './httpStore'

const spec: HttpRequestSpec = { method: 'GET', url: '/x', headers: '', body: '', followRedirects: false }

describe('HttpStore', () => {
  const dir = mkdtempSync(join(tmpdir(), 'http-store-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  const store = (name: string): HttpStore => new HttpStore(join(dir, name))

  it('saves, updates and removes requests', () => {
    const s = store('a.json')
    const { id, workspace } = s.saveRequest({ name: ' List ', folder: ' Orders ', spec })
    expect(workspace.requests[0]).toMatchObject({ id, name: 'List', folder: 'Orders' })
    expect(s.saveRequest({ id, name: 'Renamed', folder: '', spec }).workspace.requests).toHaveLength(1)
    expect(s.workspace().requests[0].name).toBe('Renamed')
    expect(s.removeRequest(id).requests).toEqual([])
  })

  it('writes owner-only: requests can hold tokens', () => {
    const s = store('perm.json')
    s.saveRequest({ name: 'x', folder: '', spec })
    expect(statSync(join(dir, 'perm.json')).mode & 0o777).toBe(0o600)
  })

  it('keeps recent history per environment and shrinks big entries', () => {
    const s = store('b.json')
    for (let i = 0; i < 105; i++) s.addHistory('env', { id: String(i), spec, status: 200, timeMs: 1, at: i })
    const history = s.workspace().history.env
    expect(history).toHaveLength(100)
    expect(history[0].id).toBe('104')
    const big = s.addHistory('env', { id: 'big', spec: { ...spec, body: 'x'.repeat(70000) }, status: 200, timeMs: 1, at: 1 })
    expect(big.history.env[0].spec.body).toBe('')
    expect(s.clearHistory('env').history.env).toEqual([])
  })

  it('imports a collection without overwriting variables already set', () => {
    const s = store('c.json')
    s.setVars('env', { host: 'mine' })
    const w = s.addImported('env', { name: 'C', requests: [{ name: 'R', folder: 'C', spec }], variables: { host: 'theirs', other: '1' } })
    expect(w.vars.env).toEqual({ host: 'mine', other: '1' })
    expect(w.requests[0]).toMatchObject({ name: 'R', sessionId: 'env' })
  })

  it('copies requests and variables to a duplicated environment', () => {
    const s = store('copy.json')
    s.saveRequest({ name: 'own', folder: '', sessionId: 'a', spec })
    s.saveRequest({ name: 'shared', folder: '', spec })
    s.setVars('a', { v: '1' })
    const w = s.copySession('a', 'b')
    expect(w.requests.filter((r) => r.sessionId === 'b').map((r) => r.name)).toEqual(['own'])
    expect(w.vars.b).toEqual({ v: '1' })
    expect(new Set(w.requests.map((r) => r.id)).size).toBe(3)
  })

  it('forgets a deleted environment but keeps shared requests', () => {
    const s = store('d.json')
    s.saveRequest({ name: 'shared', folder: '', spec })
    s.saveRequest({ name: 'own', folder: '', sessionId: 'env', spec })
    s.setVars('env', { a: '1' })
    const w = s.removeSession('env')
    expect(w.requests.map((r) => r.name)).toEqual(['shared'])
    expect(w.vars).toEqual({})
  })

  it('starts empty on a file with the wrong shape, without crashing', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    writeFileSync(join(dir, 'e.json'), '{"requests":"nope"}')
    expect(store('e.json').workspace().requests).toEqual([])
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  it('keeps every valid entry and a copy of the file when one entry is bad', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const good = { id: 'keep', name: 'Good', folder: '', spec, updatedAt: 1 }
    const item = { id: 'h1', spec, status: 200, timeMs: 1, at: 1 }
    writeFileSync(
      join(dir, 'bad-entry.json'),
      JSON.stringify({ requests: [good, { id: 'broken', name: 'Bad', folder: '', spec: { method: 'NOPE' }, updatedAt: 1 }], vars: { env: { a: '1' }, bad: 7 }, history: { env: [item, { id: 'x' }] } })
    )
    const s = store('bad-entry.json')
    const w = s.workspace()
    expect(w.requests.map((r) => r.id)).toEqual(['keep'])
    expect(w.vars).toEqual({ env: { a: '1' } })
    expect(w.history.env.map((h) => h.id)).toEqual(['h1'])
    expect(readdirSync(dir).some((f) => f.startsWith('bad-entry.json.invalid-'))).toBe(true)
    expect(s.saveRequest({ name: 'New', folder: '', spec }).workspace.requests.map((r) => r.name)).toEqual(['Good', 'New'])
    error.mockRestore()
  })
})
