import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { migrateLegacyData } from './migrate'

function setup(): { legacy: string; target: string } {
  const root = mkdtempSync(join(tmpdir(), 'migrate-'))
  const legacy = join(root, 'Termora')
  const target = join(root, 'Northshell')
  mkdirSync(legacy)
  writeFileSync(
    join(legacy, 'sessions.json'),
    JSON.stringify({ version: 1, sessions: [{ id: 'a', name: 'web', secret: 'ENCRYPTED' }, { id: 'b', name: 'db' }] })
  )
  writeFileSync(join(legacy, 'settings.json'), JSON.stringify({ uiTheme: 'moba' }))
  writeFileSync(join(legacy, 'known_hosts.json'), JSON.stringify({ 'h:22': { fingerprint: 'SHA256:x' } }))
  return { legacy, target }
}

describe('migrateLegacyData', () => {
  it('copies sessions, settings and known hosts and drops secrets it cannot decrypt', () => {
    const { legacy, target } = setup()
    expect(migrateLegacyData([legacy], target)).toBe(true)
    const sessions = JSON.parse(readFileSync(join(target, 'sessions.json'), 'utf8'))
    expect(sessions.sessions).toEqual([{ id: 'a', name: 'web' }, { id: 'b', name: 'db' }])
    expect(JSON.parse(readFileSync(join(target, 'settings.json'), 'utf8'))).toEqual({ uiTheme: 'moba' })
    expect(existsSync(join(target, 'known_hosts.json'))).toBe(true)
    expect(existsSync(join(legacy, 'sessions.json'))).toBe(true)
  })

  it('does nothing when the new profile already has data', () => {
    const { legacy, target } = setup()
    mkdirSync(target)
    writeFileSync(join(target, 'sessions.json'), '{"version":1,"sessions":[]}')
    expect(migrateLegacyData([legacy], target)).toBe(false)
    expect(readFileSync(join(target, 'sessions.json'), 'utf8')).toBe('{"version":1,"sessions":[]}')
  })

  it('does nothing without a legacy profile', () => {
    const root = mkdtempSync(join(tmpdir(), 'migrate-'))
    expect(migrateLegacyData([join(root, 'missing')], join(root, 'new'))).toBe(false)
  })
})
