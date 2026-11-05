import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { Client } from 'ssh2'
import { afterAll, describe, expect, it } from 'vitest'
import type { MonitorSnapshot } from '@shared/types'
import { buildDiskOwnersScript, parseDiskOwners, scanDiskOwners } from './diskOwners'
import { RemoteMonitor } from './remoteMonitor'

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

const { XMT_E2E_SSH_HOST: host, XMT_E2E_SSH_PORT: port, XMT_E2E_SSH_USER: username, XMT_E2E_SSH_KEY: key } = process.env

describe.skipIf(!host || !username || !key)('against a real SSH server (XMT_E2E_SSH_*)', () => {
  const connect = (): Promise<Client> =>
    new Promise((resolve, reject) => {
      const client = new Client()
      client.on('ready', () => resolve(client)).on('error', reject)
      client.connect({ host, port: Number(port ?? 22), username, privateKey: readFileSync(key as string) })
    })

  it('walks a folder over the connection', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'northshell-owners-ssh-'))
    writeFileSync(join(dir, 'a.bin'), Buffer.alloc(32 * 1024))
    const client = await connect()
    try {
      const result = await scanDiskOwners(client, dir)
      expect(result.users[0].bytes).toBeGreaterThanOrEqual(32 * 1024)
    } finally {
      client.end()
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)

  it('sends process details only after they are asked for, and keeps streaming', async () => {
    const client = await connect()
    const snapshots: MonitorSnapshot[] = []
    const monitor = new RemoteMonitor(client, 1, (s) => snapshots.push(s))
    const until = async (done: () => boolean): Promise<void> => {
      for (let i = 0; i < 200 && !done(); i++) await new Promise((r) => setTimeout(r, 100))
      expect(done()).toBe(true)
    }
    try {
      monitor.start()
      await until(() => snapshots.length > 0)
      expect(snapshots[0].detail).toBeUndefined()
      monitor.setDetail(true)
      await until(() => snapshots.filter((s) => s.detail).length >= 2)
      const last = snapshots.at(-1) as MonitorSnapshot
      expect(last.detail?.processes.length).toBeGreaterThan(0)
      expect(last.detail?.users.length).toBeGreaterThan(0)
      monitor.setDetail(false)
      const count = snapshots.length
      await until(() => snapshots.length > count + 1 && !snapshots.at(-1)?.detail)
    } finally {
      monitor.stop()
      client.end()
    }
  }, 60_000)
})

