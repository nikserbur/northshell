import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CommandStore, type SessionRef } from './commandStore'

function setup(sessions: SessionRef[] = [{ id: 's1', name: 'web' }]): { store: CommandStore; path: string } {
  const path = join(mkdtempSync(join(tmpdir(), 'commands-')), 'commands.json')
  return { store: new CommandStore(path, () => sessions), path }
}

const readFile = (path: string): { help: string; commands: Record<string, unknown>[] } => JSON.parse(readFileSync(path, 'utf8'))

describe('CommandStore', () => {
  it('starts empty without creating a file', () => {
    const { store, path } = setup()
    expect(store.library()).toEqual({ path, commands: [] })
    expect(existsSync(path)).toBe(false)
  })

  it('saves shared and per-connection commands in a readable file', () => {
    const { store, path } = setup()
    store.save({ name: 'Disk', command: 'df -h' })
    const lib = store.save({ name: 'Logs', command: 'journalctl -f', sessionId: 's1' })
    expect(lib.commands.map((c) => [c.name, c.sessionId])).toEqual([
      ['Disk', undefined],
      ['Logs', 's1']
    ])
    const file = readFile(path)
    expect(file.help).toContain('{{name}}')
    expect(file.commands[1]).toMatchObject({ name: 'Logs', command: 'journalctl -f', session: 'web', sessionId: 's1' })
    expect(file.commands[0]).not.toHaveProperty('session')
  })

  it('updates in place by id and removes', () => {
    const { store } = setup()
    const id = store.save({ name: 'a', command: 'ls' }).commands[0].id
    expect(store.save({ id, name: 'b', command: 'ls -la' }).commands).toEqual([{ id, name: 'b', command: 'ls -la' }])
    expect(store.remove(id).commands).toEqual([])
  })

  it('rejects empty commands and control characters', () => {
    const { store } = setup()
    expect(() => store.save({ name: 'x', command: '   ' })).toThrow()
    expect(() => store.save({ name: 'x', command: 'ls\u001b[201~\rrm -rf ~' })).toThrow(/control/)
    expect(() => store.importText(JSON.stringify([{ name: 'x', command: 'a\u001bb' }]))).toThrow(/control/)
  })

  it('reads hand-written entries: links by connection name and gives stable ids', () => {
    const { store, path } = setup()
    writeFileSync(path, JSON.stringify({ commands: [{ name: 'Health', command: 'curl $BASE_URL/health', session: 'web' }, { name: 'Up', command: 'uptime' }] }))
    const first = store.library().commands
    expect(first[0]).toMatchObject({ name: 'Health', sessionId: 's1' })
    expect(first[0].sessionName).toBeUndefined()
    expect(first[1]).toMatchObject({ name: 'Up' })
    expect(first[1].sessionId).toBeUndefined()
    expect(store.library().commands.map((c) => c.id)).toEqual(first.map((c) => c.id))
  })

  it('keeps fields added by hand when the app rewrites the file', () => {
    const { store, path } = setup()
    writeFileSync(path, JSON.stringify({ commands: [{ id: 'k', name: 'Up', command: 'uptime', note: 'ask Bob', tags: ['ops'] }] }))
    store.save({ name: 'New', command: 'pwd' })
    expect(readFile(path).commands[0]).toMatchObject({ id: 'k', note: 'ask Bob', tags: ['ops'] })
  })

  it('keeps commands of unknown connections labelled by name', () => {
    const { store, path } = setup()
    writeFileSync(path, JSON.stringify({ commands: [{ name: 'x', command: 'y', session: 'other-laptop-host' }] }))
    expect(store.library().commands[0]).toMatchObject({ sessionName: 'other-laptop-host' })
  })

  it('reports a broken file, keeps the last good list and refuses edits', () => {
    const { store, path } = setup()
    store.save({ name: 'a', command: 'ls' })
    writeFileSync(path, '{ "commands": [ { "name": "a", ')
    const lib = store.library()
    expect(lib.error).toBeTruthy()
    expect(lib.commands.map((c) => c.name)).toEqual(['a'])
    expect(() => store.save({ name: 'b', command: 'pwd' })).toThrow(/fix the file/)
    expect(readFileSync(path, 'utf8')).toBe('{ "commands": [ { "name": "a", ')
  })

  it('treats an invalid entry as an error instead of silently dropping it', () => {
    const { store, path } = setup()
    writeFileSync(path, JSON.stringify({ commands: [{ name: 'ok', command: 'ls' }, { name: 'no command' }] }))
    expect(store.library().error).toMatch(/#2/)
  })

  it('drops and copies commands together with their connection', () => {
    const { store } = setup([
      { id: 's1', name: 'web' },
      { id: 's2', name: 'web copy' }
    ])
    store.save({ name: 'shared', command: 'ls' })
    store.save({ name: 'own', command: 'ps', sessionId: 's1' })
    store.copySession('s1', 's2')
    expect(store.library().commands.filter((c) => c.sessionId === 's2').map((c) => c.name)).toEqual(['own'])
    store.removeForSession('s1')
    expect(store.library().commands.map((c) => `${c.name}:${c.sessionId ?? ''}`)).toEqual(['shared:', 'own:s2'])
  })

  it('removes entries linked only by connection name while the connection still exists', () => {
    const { store, path } = setup()
    writeFileSync(path, JSON.stringify({ commands: [{ name: 'Logs', command: 'tail x', session: 'web' }, { name: 'Up', command: 'uptime' }] }))
    store.removeForSession('s1')
    expect(store.library().commands.map((c) => c.name)).toEqual(['Up'])
  })

  it('imports without duplicates and re-links connections by name', () => {
    const { store } = setup()
    store.save({ name: 'Disk', command: 'df -h' })
    const exported = JSON.stringify({
      commands: [
        { name: 'Disk', command: 'df -h' },
        { name: 'Logs', command: 'tail -f x.log', session: 'web', sessionId: 'id-from-another-mac' },
        { name: 'Top', command: 'top' }
      ]
    })
    const { added, library } = store.importText(exported)
    expect(added).toBe(2)
    expect(library.commands.find((c) => c.name === 'Logs')?.sessionId).toBe('s1')
    expect(store.importText(exported).added).toBe(0)
  })

  it('rejects files that are not a command library', () => {
    const { store } = setup()
    expect(() => store.importText('not json')).toThrow(/JSON/)
    expect(() => store.importText('{"foo": 1}')).toThrow(/list/)
  })

  it('exports the same readable format it stores', () => {
    const { store } = setup()
    store.save({ name: 'Logs', command: 'journalctl -f', sessionId: 's1' })
    const exported = JSON.parse(store.exportText())
    expect(exported.commands[0]).toMatchObject({ name: 'Logs', session: 'web' })
  })

  it('creates an empty library file on request', () => {
    const { store, path } = setup()
    store.ensureFile()
    expect(readFile(path).commands).toEqual([])
  })
})
