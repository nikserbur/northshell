import type { Client, SFTPWrapper, Stats } from 'ssh2'
import type { RemoteFile, SearchResult } from '@shared/types'
import { buildFindScript, parseFindOutput } from './remoteSearch'

export const MAX_EDIT_BYTES = 5 * 1024 * 1024
const SEARCH_LIMIT = 500
const SEARCH_BUDGET_SEC = 13
const SEARCH_TIMEOUT_MS = (SEARCH_BUDGET_SEC + 2) * 1000
export const CONFLICT_ERROR = 'REMOTE_CHANGED'

function call<T>(fn: (cb: (err: Error | null | undefined, value: T) => void) => void): Promise<T> {
  return new Promise((res, rej) => fn((err, value) => (err ? rej(err) : res(value))))
}

function looksBinary(buf: Buffer): boolean {
  return buf.subarray(0, 8000).includes(0)
}

export async function readRemoteFile(sftp: SFTPWrapper, path: string): Promise<RemoteFile> {
  const st = await call<Stats>((cb) => sftp.stat(path, cb))
  if (st.isDirectory()) throw new Error('This is a directory')
  if (st.size > MAX_EDIT_BYTES) throw new Error(`File is larger than ${MAX_EDIT_BYTES / 1024 / 1024} MB — download it instead`)
  const buf = await call<Buffer>((cb) => sftp.readFile(path, cb))
  if (looksBinary(buf)) throw new Error('Binary file — download it instead')
  const utf8 = buf.toString('utf8')
  const isUtf8 = Buffer.from(utf8, 'utf8').equals(buf)
  return {
    path,
    content: isUtf8 ? utf8 : buf.toString('latin1'),
    encoding: isUtf8 ? 'utf8' : 'latin1',
    mtime: st.mtime * 1000,
    size: buf.length
  }
}

/** Writes the file; refuses when the remote copy changed since `expectedMtime` (unless it is null). */
export async function writeRemoteFile(
  sftp: SFTPWrapper,
  path: string,
  content: string,
  encoding: RemoteFile['encoding'],
  expectedMtime: number | null
): Promise<number> {
  if (encoding === 'latin1' && /[^\u0000-\u00ff]/.test(content)) {
    throw new Error('The file uses a legacy 8-bit encoding and the new text has characters it cannot store')
  }
  if (expectedMtime !== null) {
    const current = await call<Stats>((cb) => sftp.stat(path, cb)).catch(() => null)
    if (current && current.mtime * 1000 !== expectedMtime) throw new Error(CONFLICT_ERROR)
  }
  await call<void>((cb) => sftp.writeFile(path, Buffer.from(content, encoding), cb))
  const after = await call<Stats>((cb) => sftp.stat(path, cb))
  return after.mtime * 1000
}

export async function createRemoteFile(sftp: SFTPWrapper, path: string): Promise<void> {
  const handle = await call<Buffer>((cb) => sftp.open(path, 'wx', cb))
  await call<void>((cb) => sftp.close(handle, cb))
}

export async function chmodRemote(sftp: SFTPWrapper, path: string, mode: number): Promise<void> {
  await call<void>((cb) => sftp.chmod(path, mode, cb))
}

/** Recursive name search using `find` on the server, fed through `sh -s` stdin. */
export function searchRemote(client: Client, dir: string, query: string): Promise<SearchResult> {
  const script = buildFindScript(dir, query, SEARCH_BUDGET_SEC)
  return new Promise((resolve, reject) => {
    client.exec('sh -s', (err, channel) => {
      if (err) return reject(err)
      let out = ''
      let lines = 0
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        channel.close()
      }, SEARCH_TIMEOUT_MS)
      const started = Date.now()
      channel.on('data', (chunk: Buffer) => {
        if (lines >= SEARCH_LIMIT) return
        const text = chunk.toString('utf8')
        out += text
        lines += text.split('\n').length - 1
        if (lines >= SEARCH_LIMIT) channel.close()
      })
      channel.stderr.on('data', () => undefined)
      channel.on('close', () => {
        clearTimeout(timer)
        const hits = parseFindOutput(out).slice(0, SEARCH_LIMIT)
        const hitBudget = Date.now() - started >= SEARCH_BUDGET_SEC * 1000
        resolve({ hits, truncated: timedOut || hitBudget || hits.length >= SEARCH_LIMIT })
      })
      channel.end(script)
    })
  })
}
