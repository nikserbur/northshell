import { spawn, spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Client } from 'ssh2'
import { CwdFollower, CwdLines, cwdFollowCommand } from './cwdFollow'

describe('cwdFollowCommand', () => {
  const body = cwdFollowCommand().slice("exec sh -c '".length, -1)

  it('keeps single quotes out of the body and is valid POSIX shell', () => {
    expect(body).not.toContain("'")
    const res = spawnSync('/bin/sh', ['-n', '-c', body], { encoding: 'utf8' })
    expect(res.stderr).toBe('')
    expect(res.status).toBe(0)
  })
})

describe('cwdFollowCommand on a Linux-like /proc', () => {
  let root = ''
  let child: ReturnType<typeof spawn> | null = null

  afterEach(() => {
    child?.kill()
    child = null
    if (root) rmSync(root, { recursive: true, force: true })
  })

  /** Fake /proc: sshd 4242 with three children — a tty shell (this test process, so it is alive), sftp-server and the exec channel. */
  function fakeProc(): { proc: string; dirs: Record<string, string> } {
    root = mkdtempSync(join(tmpdir(), 'cwd-follow-'))
    const proc = join(root, 'proc')
    // A backslash in a name must come through as is (dash's echo would turn \t into a tab).
    const dirs = { home: join(root, 'home\\tab'), logs: join(root, 'var log'), other: join(root, 'other') }
    for (const d of Object.values(dirs)) mkdirSync(d)
    const shell = process.pid
    const entry = (pid: number | string, stat: string, cwd?: string): void => {
      mkdirSync(join(proc, String(pid)), { recursive: true })
      writeFileSync(join(proc, String(pid), 'stat'), `${stat}\n`)
      if (cwd) symlinkSync(cwd, join(proc, String(pid), 'cwd'))
    }
    // The parent must be alive for the script to keep running: this test runner stands in for sshd.
    entry(4242, '4242 (sshd) S 1 4242 4242 0 -1')
    entry(555, '555 (sftp-server) S 4242 555 555 0 -1', dirs.other)
    entry(556, '556 (sh -c x) y) S 4242 556 556 0 -1', dirs.other)
    // tpgid 777: `vim` running in /var log while the shell itself sits in home.
    entry(shell, `${shell} (bash) S 4242 ${shell} ${shell} 34817 777`, dirs.home)
    entry(777, '777 (vim) S 1 777 777 34817 777', dirs.logs)
    return { proc, dirs }
  }

  /** Starts the script; `next()` resolves with each directory it reports. */
  function run(proc: string): { next: () => Promise<string> } {
    child = spawn('/bin/sh', ['-c', cwdFollowCommand({ procRoot: `"${proc}"`, parent: '4242' }).replace('kill -0 "$P"', `kill -0 ${process.pid}`)])
    const lines = new CwdLines()
    const queue: string[] = []
    const waiters: ((dir: string) => void)[] = []
    child.stdout?.on('data', (c: Buffer) => {
      for (const dir of lines.push(c.toString('utf8'))) {
        const waiter = waiters.shift()
        if (waiter) waiter(dir)
        else queue.push(dir)
      }
    })
    return {
      next: () =>
        new Promise((resolve) => {
          const dir = queue.shift()
          if (dir !== undefined) resolve(dir)
          else waiters.push(resolve)
        })
    }
  }

  it('finds the tty shell among the sshd children and follows its foreground process', async () => {
    const { proc, dirs } = fakeProc()
    const follow = run(proc)
    expect(await follow.next()).toBe(dirs.logs)
    unlinkSync(join(proc, '777', 'cwd'))
    symlinkSync(dirs.other, join(proc, '777', 'cwd'))
    expect(await follow.next()).toBe(dirs.other)
  }, 8000)

  it('falls back to the shell directory when the foreground process cannot be read', async () => {
    const { proc, dirs } = fakeProc()
    rmSync(join(proc, '777'), { recursive: true })
    expect(await run(proc).next()).toBe(dirs.home)
  }, 8000)
})

describe('CwdLines', () => {
  it('returns complete absolute paths across chunks and ignores other output', () => {
    const lines = new CwdLines()
    expect(lines.push('@@cwd /var/l')).toEqual([])
    expect(lines.push('og\n@@nocwd\n@@cwd relative\n@@cwd /home/a b\n')).toEqual(['/var/log', '/home/a b'])
  })
})

describe('CwdFollower', () => {
  it('runs the script on its own exec channel and reports each directory until stopped', () => {
    const channel = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), close: () => channel.emit('close') })
    let command = ''
    const client = {
      exec: (cmd: string, cb: (err: Error | undefined, ch: typeof channel) => void) => {
        command = cmd
        cb(undefined, channel)
      }
    } as unknown as Client
    const dirs: string[] = []
    const follower = new CwdFollower(client, (dir) => dirs.push(dir))
    follower.start()
    channel.emit('data', Buffer.from('@@cwd /srv/app\n@@cwd /tmp\n'))
    expect(command).toBe(cwdFollowCommand())
    expect(dirs).toEqual(['/srv/app', '/tmp'])
    let closed = false
    channel.on('close', () => (closed = true))
    follower.stop()
    expect(closed).toBe(true)
  })
})
