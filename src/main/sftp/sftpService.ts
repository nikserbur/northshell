import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { basename, extname, join, posix, resolve, sep } from 'node:path'
import type { Client, FileEntryWithStats, SFTPWrapper, Stats } from 'ssh2'
import type { RemoteFile, SearchResult, SftpEntry, TransferDirection, TransferInfo } from '@shared/types'
import { chmodRemote, createRemoteFile, readRemoteFile, searchRemote, writeRemoteFile } from './fileOps'

const S_IFMT = 0o170000
const S_IFDIR = 0o040000
const S_IFLNK = 0o120000
const PROGRESS_THROTTLE_MS = 150
const MAX_DOWNLOAD_DEPTH = 32

function modeString(mode: number): string {
  const type = (mode & S_IFMT) === S_IFDIR ? 'd' : (mode & S_IFMT) === S_IFLNK ? 'l' : '-'
  const bits = 'rwxrwxrwx'
  let out = type
  for (let i = 0; i < 9; i++) out += mode & (1 << (8 - i)) ? bits[i] : '-'
  return out
}

/** Rejects server-supplied names that could escape the target directory. */
function safeName(name: string): boolean {
  return name !== '.' && name !== '..' && name.length > 0 && !/[/\\\0]/.test(name)
}

function uniqueLocalPath(dir: string, name: string): string {
  let candidate = join(dir, name)
  const ext = extname(name)
  const stem = ext ? name.slice(0, -ext.length) : name
  for (let i = 1; existsSync(candidate); i++) candidate = join(dir, `${stem} (${i})${ext}`)
  return candidate
}

function call<T>(fn: (cb: (err: Error | null | undefined, value: T) => void) => void): Promise<T> {
  return new Promise((res, rej) => fn((err, value) => (err ? rej(err) : res(value))))
}

interface Job {
  info: TransferInfo
  run(progress: (transferred: number, total: number) => void): Promise<void>
}

export class SftpService {
  private sessions = new Map<string, Promise<SFTPWrapper>>()
  private queues = new Map<string, Promise<void>>()

  constructor(
    private readonly clientFor: (tabId: string) => Client | undefined,
    private readonly emitTransfer: (info: TransferInfo) => void
  ) {}

  private sftp(tabId: string): Promise<SFTPWrapper> {
    const cached = this.sessions.get(tabId)
    if (cached) return cached
    const client = this.clientFor(tabId)
    if (!client) return Promise.reject(new Error('SSH session is not connected'))
    const pending = call<SFTPWrapper>((cb) => client.sftp(cb)).then((sftp) => {
      sftp.on('close', () => this.sessions.delete(tabId))
      return sftp
    })
    pending.catch(() => this.sessions.delete(tabId))
    this.sessions.set(tabId, pending)
    return pending
  }

  dispose(tabId: string): void {
    void this.sessions.get(tabId)?.then((s) => s.end()).catch(() => undefined)
    this.sessions.delete(tabId)
    this.queues.delete(tabId)
  }

  async home(tabId: string): Promise<string> {
    const sftp = await this.sftp(tabId)
    return call<string>((cb) => sftp.realpath('.', cb))
  }

  async list(tabId: string, dir: string): Promise<SftpEntry[]> {
    const sftp = await this.sftp(tabId)
    const items = await call<FileEntryWithStats[]>((cb) => sftp.readdir(dir, cb))
    const entries = await Promise.all(
      items
        .filter((it) => safeName(it.filename))
        .map(async (it): Promise<SftpEntry> => {
          const path = posix.join(dir, it.filename)
          const mode = it.attrs.mode ?? 0
          const isLink = (mode & S_IFMT) === S_IFLNK
          let isDir = (mode & S_IFMT) === S_IFDIR
          let size = it.attrs.size ?? 0
          if (isLink) {
            const target = await call<Stats>((cb) => sftp.stat(path, cb)).catch(() => null)
            if (target) {
              isDir = target.isDirectory()
              size = target.size
            }
          }
          return { name: it.filename, path, isDir, isLink, size, mtime: (it.attrs.mtime ?? 0) * 1000, mode: modeString(mode) }
        })
    )
    return entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
  }

  async readFile(tabId: string, path: string): Promise<RemoteFile> {
    return readRemoteFile(await this.sftp(tabId), path)
  }

  async writeFile(tabId: string, path: string, content: string, encoding: RemoteFile['encoding'], expectedMtime: number | null): Promise<number> {
    return writeRemoteFile(await this.sftp(tabId), path, content, encoding, expectedMtime)
  }

  async createFile(tabId: string, path: string): Promise<void> {
    return createRemoteFile(await this.sftp(tabId), path)
  }

  async chmod(tabId: string, path: string, mode: number): Promise<void> {
    return chmodRemote(await this.sftp(tabId), path, mode)
  }

  search(tabId: string, dir: string, query: string): Promise<SearchResult> {
    const client = this.clientFor(tabId)
    if (!client) return Promise.reject(new Error('SSH session is not connected'))
    return searchRemote(client, dir, query)
  }

  async mkdir(tabId: string, path: string): Promise<void> {
    const sftp = await this.sftp(tabId)
    await call<void>((cb) => sftp.mkdir(path, cb))
  }

  async rename(tabId: string, from: string, to: string): Promise<void> {
    const sftp = await this.sftp(tabId)
    await call<void>((cb) => sftp.rename(from, to, cb))
  }

  /**
   * Deletes a file or a directory tree. Uses lstat, so a symlink is removed itself and is
   * never followed — deleting a link to a directory must not wipe the target's contents.
   */
  async remove(tabId: string, path: string): Promise<void> {
    const sftp = await this.sftp(tabId)
    const st = await call<Stats>((cb) => sftp.lstat(path, cb))
    if (!st.isDirectory()) return call<void>((cb) => sftp.unlink(path, cb))
    const items = await call<FileEntryWithStats[]>((cb) => sftp.readdir(path, cb))
    for (const it of items.filter((x) => safeName(x.filename))) {
      const child = posix.join(path, it.filename)
      if (((it.attrs.mode ?? 0) & S_IFMT) === S_IFDIR) await this.remove(tabId, child)
      else await call<void>((cb) => sftp.unlink(child, cb))
    }
    await call<void>((cb) => sftp.rmdir(path, cb))
  }

  private enqueue(tabId: string, job: Job): void {
    this.emitTransfer(job.info)
    let last = 0
    const progress = (transferred: number, total: number): void => {
      const now = Date.now()
      if (now - last < PROGRESS_THROTTLE_MS) return
      last = now
      job.info = { ...job.info, transferred, total, state: 'running' }
      this.emitTransfer(job.info)
    }
    const prev = this.queues.get(tabId) ?? Promise.resolve()
    const next = prev.then(async () => {
      job.info = { ...job.info, state: 'running', startedAt: Date.now() }
      this.emitTransfer(job.info)
      try {
        await job.run(progress)
        job.info = { ...job.info, state: 'done', transferred: job.info.total, finishedAt: Date.now() }
      } catch (err) {
        job.info = { ...job.info, state: 'error', error: err instanceof Error ? err.message : String(err), finishedAt: Date.now() }
      }
      this.emitTransfer(job.info)
    })
    this.queues.set(tabId, next)
  }

  private newInfo(tabId: string, direction: TransferDirection, name: string, localPath: string, remotePath: string, total: number): TransferInfo {
    return { id: randomUUID(), tabId, direction, name, localPath, remotePath, total, transferred: 0, state: 'queued', startedAt: Date.now() }
  }

  async upload(tabId: string, remoteDir: string, localPaths: string[]): Promise<void> {
    for (const local of localPaths) {
      const st = await stat(local)
      const remote = posix.join(remoteDir, basename(local))
      if (st.isDirectory()) {
        await this.mkdir(tabId, remote).catch(() => undefined)
        const children = await readdir(local)
        await this.upload(tabId, remote, children.map((c) => join(local, c)))
      } else if (st.isFile()) {
        const info = this.newInfo(tabId, 'upload', basename(local), local, remote, st.size)
        this.enqueue(tabId, {
          info,
          run: async (progress) => {
            const sftp = await this.sftp(tabId)
            await call<void>((cb) => sftp.fastPut(local, remote, { step: (t, _n, total) => progress(t, total) }, cb))
          }
        })
      }
    }
  }

  /**
   * Downloads files and directory trees. Explicitly selected symlinks are followed once;
   * links found while recursing are skipped to avoid cycles such as `loop -> ..`.
   */
  async download(tabId: string, remotePaths: string[], localDir: string, depth = 0): Promise<void> {
    if (depth > MAX_DOWNLOAD_DEPTH) return
    const sftp = await this.sftp(tabId)
    const root = resolve(localDir)
    const prefix = root.endsWith(sep) ? root : root + sep
    for (const remote of remotePaths) {
      const name = posix.basename(remote)
      if (!safeName(name)) continue
      if (depth > 0) {
        const own = await call<Stats>((cb) => sftp.lstat(remote, cb))
        if (own.isSymbolicLink()) continue
      }
      const st = await call<Stats>((cb) => sftp.stat(remote, cb))
      const local = uniqueLocalPath(root, name)
      if (!resolve(local).startsWith(prefix)) continue
      if (st.isDirectory()) {
        await mkdir(local, { recursive: true })
        const items = await call<FileEntryWithStats[]>((cb) => sftp.readdir(remote, cb))
        await this.download(
          tabId,
          items.filter((it) => safeName(it.filename)).map((it) => posix.join(remote, it.filename)),
          local,
          depth + 1
        )
      } else {
        const info = this.newInfo(tabId, 'download', name, local, remote, st.size)
        this.enqueue(tabId, {
          info,
          run: async (progress) => {
            const s = await this.sftp(tabId)
            await call<void>((cb) => s.fastGet(remote, local, { step: (t, _n, total) => progress(t, total) }, cb))
          }
        })
      }
    }
  }
}
