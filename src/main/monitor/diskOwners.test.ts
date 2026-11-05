import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { buildDiskOwnersScript, parseDiskOwners } from './diskOwners'

describe('buildDiskOwnersScript', () => {
  it('quotes the mount point and refuses anything but an absolute path', () => {
    expect(buildDiskOwnersScript("/mnt/o'neil")).toContain(`D='/mnt/o'\\''neil'`)
    expect(() => buildDiskOwnersScript('-delete')).toThrow('absolute')
    expect(() => buildDiskOwnersScript('/mnt\nreboot')).toThrow('Invalid')
  })

  it('stays on one file system at the lowest priority, with a watchdog', () => {
    const script = buildDiskOwnersScript('/data', 60)
    expect(script).toContain('-xdev')
    expect(script).toContain('nice -n 19')
    expect(script).toContain('ionice -c 3')
    expect(script).toContain('( sleep 60; kill 0 )')
  })

  it('is valid POSIX shell', () => {
    const res = spawnSync('/bin/sh', ['-n'], { input: buildDiskOwnersScript('/data'), encoding: 'utf8' })
    expect(res.stderr).toBe('')
    expect(res.status).toBe(0)
  })

  describe('on this machine', () => {
    const dir = mkdtempSync(join(tmpdir(), 'northshell-owners-'))
    afterAll(() => rmSync(dir, { recursive: true, force: true }))

    it('adds up the files of their owner', () => {
      writeFileSync(join(dir, 'a.bin'), Buffer.alloc(64 * 1024))
      writeFileSync(join(dir, 'b.bin'), Buffer.alloc(64 * 1024))
      const res = spawnSync('/bin/sh', ['-s'], { input: buildDiskOwnersScript(dir), encoding: 'utf8' })
      expect(res.status).toBe(0)
      const parsed = parseDiskOwners(dir, res.stdout, 1)
      expect(parsed?.users.map((u) => u.user)).toEqual([userInfo().username])
      expect(parsed?.users[0].bytes).toBeGreaterThanOrEqual(128 * 1024)
    })
  })
})

describe('parseDiskOwners', () => {
  it('sorts owners by size and knows when only root sees everything', () => {
    const root = parseDiskOwners('/', '@@uid 0\nu alice 100\nu bob 900\n@@done\n', 5)
    expect(root).toEqual({ mount: '/', at: 5, partial: false, users: [{ user: 'bob', bytes: 900 }, { user: 'alice', bytes: 100 }] })
    expect(parseDiskOwners('/', '@@uid 1000\n@@done\n', 5)?.partial).toBe(true)
  })

  it('refuses a walk that did not finish', () => {
    expect(parseDiskOwners('/', '@@uid 0\nu alice 100\n', 5)).toBeNull()
  })
})
