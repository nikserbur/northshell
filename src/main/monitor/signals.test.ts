import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { Client } from 'ssh2'
import { describe, expect, it } from 'vitest'
import { classifySignalError } from '@shared/signals'
import { buildSignalScript, parseSignalOutput, signalLocal, signalRemote, validPids } from './signals'

/** A process that does nothing until it is signalled; resolves with the signal that ended it. */
function victim(): { pid: number; ended: Promise<NodeJS.Signals | null> } {
  const child = spawn('/bin/sleep', ['600'], { stdio: 'ignore' })
  const ended = new Promise<NodeJS.Signals | null>((resolve) => child.on('exit', (_code, signal) => resolve(signal)))
  return { pid: child.pid as number, ended }
}

describe('validPids', () => {
  it('keeps whole pids above 1, once each', () => {
    expect(validPids([5, 5, 1, 0, -3, 2.5, 7, Number.NaN])).toEqual([5, 7])
  })

  it('refuses an empty or huge selection', () => {
    expect(() => validPids([1])).toThrow('No processes')
    expect(() => validPids(Array.from({ length: 501 }, (_, i) => i + 2))).toThrow('At most 500')
  })
})

describe('buildSignalScript', () => {
  it('lists only checked pids and is valid POSIX shell', () => {
    const script = buildSignalScript([12, 34], 'TERM', false)
    expect(script).toContain('for p in 12 34; do')
    expect(script).toContain('kill -s TERM "$p"')
    expect(script).toContain('S=\n')
    const res = spawnSync('/bin/sh', ['-n'], { input: script, encoding: 'utf8' })
    expect(res.status).toBe(0)
  })

  it('uses sudo without ever asking for a password', () => {
    expect(buildSignalScript([12], 'KILL', true)).toContain('S="sudo -n"')
  })

  it('refuses anything but a signal name', () => {
    expect(() => buildSignalScript([12], 'TERM; reboot' as never, false)).toThrow('Unknown signal')
  })

  it('reports what happened to each process when run', () => {
    const alive = victim()
    const res = spawnSync('/bin/sh', ['-s'], { input: buildSignalScript([alive.pid, 3999999], 'TERM', false), encoding: 'utf8' })
    const results = parseSignalOutput([alive.pid, 3999999], res.stdout)
    expect(results[0]).toEqual({ pid: alive.pid, outcome: 'ok' })
    expect(results[1]).toMatchObject({ pid: 3999999, outcome: 'gone' })
    return expect(alive.ended).resolves.toBe('SIGTERM')
  })

  it('cannot touch processes of other users without rights', () => {
    if (process.getuid?.() === 0) return
    const res = spawnSync('/bin/sh', ['-s'], { input: buildSignalScript([2], 'CONT', false), encoding: 'utf8' })
    // pid 2 is a kernel thread on Linux and a root daemon or nothing on macOS.
    expect(['denied', 'gone']).toContain(parseSignalOutput([2], res.stdout)[0].outcome)
  })
})

describe('parseSignalOutput', () => {
  it('keeps the order asked and notices pids with no answer', () => {
    const out = 'ok 7\nerr 5 sh: kill: (5) - Operation not permitted\ngarbage\n@@done\n'
    expect(parseSignalOutput([5, 7, 9], out)).toEqual([
      { pid: 5, outcome: 'denied', message: 'sh: kill: (5) - Operation not permitted' },
      { pid: 7, outcome: 'ok' },
      { pid: 9, outcome: 'error', message: 'No answer from the server' }
    ])
  })
})

describe('classifySignalError', () => {
  it('recognises what kill and sudo say on Linux and macOS', () => {
    expect(classifySignalError('sh: 1: kill: No such process')).toBe('gone')
    expect(classifySignalError('kill: kill 123 failed: no such process')).toBe('gone')
    expect(classifySignalError('sh: kill: (123) - Operation not permitted')).toBe('denied')
    expect(classifySignalError('sudo: a password is required')).toBe('sudo')
    expect(classifySignalError('deploy is not in the sudoers file.')).toBe('sudo')
    expect(classifySignalError('something else')).toBe('error')
  })
})

describe('signalLocal', () => {
  it('signals processes of this Mac and leaves the app itself alone', async () => {
    const alive = victim()
    expect(signalLocal([alive.pid, 3999999, 4242], 'KILL', 4242)).toEqual([
      { pid: alive.pid, outcome: 'ok' },
      { pid: 3999999, outcome: 'gone', message: expect.any(String) },
      { pid: 4242, outcome: 'refused', message: 'This is Northshell itself' }
    ])
    await expect(alive.ended).resolves.toBe('SIGKILL')
  })
})

const { XMT_E2E_SSH_HOST: host, XMT_E2E_SSH_PORT: port, XMT_E2E_SSH_USER: username, XMT_E2E_SSH_KEY: key } = process.env

describe.skipIf(!host || !username || !key)('signalRemote against a real SSH server (XMT_E2E_SSH_*)', () => {
  it('ends processes over the connection and says which were already gone', async () => {
    const alive = [victim(), victim()]
    const client = await new Promise<Client>((resolve, reject) => {
      const c = new Client()
      c.on('ready', () => resolve(c)).on('error', reject)
      c.connect({ host, port: Number(port ?? 22), username, privateKey: readFileSync(key as string) })
    })
    try {
      const results = await signalRemote(client, [...alive.map((a) => a.pid), 3999999], 'TERM', false)
      expect(results.map((r) => r.outcome)).toEqual(['ok', 'ok', 'gone'])
      await expect(Promise.all(alive.map((a) => a.ended))).resolves.toEqual(['SIGTERM', 'SIGTERM'])
      const sudo = await signalRemote(client, [3999999], 'TERM', true)
      expect(['sudo', 'gone']).toContain(sudo[0].outcome)
    } finally {
      client.end()
    }
  }, 30_000)
})
