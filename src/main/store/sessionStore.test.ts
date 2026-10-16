import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SessionStore, type SecretCipher } from './sessionStore'

const cipher: SecretCipher = {
  isAvailable: () => true,
  encrypt: (plain) => `enc:${plain}`,
  decrypt: (c) => c.slice(4)
}

function setup(): { store: SessionStore; path: string } {
  const path = join(mkdtempSync(join(tmpdir(), 'sessions-')), 'sessions.json')
  return { store: new SessionStore(path, cipher), path }
}

const base = {
  name: 'api',
  folder: '',
  host: '',
  port: 443,
  username: '',
  auth: 'password' as const,
  keyPath: '',
  color: '#5eead4',
  startupCommand: '',
  monitoring: true,
  sftp: true,
  baseUrl: '',
  headers: '',
  insecure: false
}

describe('SessionStore — HTTP environments', () => {
  it('saves an HTTP environment with host and port taken from the base URL', () => {
    const { store } = setup()
    const saved = store.save({
      ...base,
      kind: 'http',
      baseUrl: 'https://api.example.com:8443/v1/',
      headers: 'Authorization: Bearer $TOKEN',
      secret: 'tok'
    })
    expect(saved).toMatchObject({
      kind: 'http',
      host: 'api.example.com',
      port: 8443,
      baseUrl: 'https://api.example.com:8443/v1',
      monitoring: false,
      sftp: false,
      hasSecret: true
    })
    expect(store.getSecret(saved.id)).toBe('tok')
  })

  it('rejects an HTTP environment without a valid base URL or with a bad header', () => {
    const { store } = setup()
    expect(() => store.save({ ...base, kind: 'http', baseUrl: 'ftp://x' })).toThrow()
    expect(() => store.save({ ...base, kind: 'http', baseUrl: 'https://x.org', headers: 'oops' })).toThrow()
  })

  it('still requires a host for SSH sessions', () => {
    const { store } = setup()
    expect(() => store.save({ ...base, kind: 'ssh' })).toThrow()
    expect(store.save({ ...base, kind: 'ssh', host: '10.0.0.1', port: 22, baseUrl: 'https://ignored' })).toMatchObject({
      kind: 'ssh',
      host: '10.0.0.1',
      baseUrl: ''
    })
  })

  it('reads sessions saved before HTTP environments existed as SSH', () => {
    const { store, path } = setup()
    writeFileSync(path, JSON.stringify({ version: 1, sessions: [{ id: 'old', name: 'web', host: 'h', port: 22 }] }))
    expect(store.list()[0]).toMatchObject({ kind: 'ssh', baseUrl: '', headers: '', insecure: false, hasSecret: false })
  })
})
