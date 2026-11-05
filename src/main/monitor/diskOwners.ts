import type { Client } from 'ssh2'
import type { DiskOwners } from '@shared/types'
import { shellQuote } from '../sftp/remoteSearch'

/** A walk over a big file system takes minutes; the watchdog stops an abandoned one on the server. */
const BUDGET_SEC = 900
const CHANNEL_GRACE_MS = 15_000

/**
 * Builds a POSIX sh script (fed via stdin to `sh -s`, so the login shell never parses it) that adds up
 * the allocated blocks of every file on one file system per owner, at the lowest CPU and disk priority.
 * Output: `@@uid <n>`, `u <user> <bytes>` per owner, then `@@done` if the walk finished.
 */
export function buildDiskOwnersScript(mount: string, budgetSec = BUDGET_SEC): string {
  if (/[\0-\x1f]/.test(mount)) throw new Error('Invalid characters in the mount point')
  // An unanchored path such as "-delete" would be parsed by find as an expression.
  if (!mount.startsWith('/')) throw new Error('The mount point must be an absolute path')
  const dir = shellQuote(mount)
  return [
    'export LC_ALL=C',
    `( sleep ${Math.max(1, Math.floor(budgetSec))}; kill 0 ) >/dev/null 2>&1 &`,
    'WATCHDOG=$!',
    'echo "@@uid $(id -u)"',
    'L=',
    'command -v nice >/dev/null 2>&1 && L="nice -n 19"',
    'command -v ionice >/dev/null 2>&1 && L="$L ionice -c 3"',
    `D=${dir}`,
    'if [ "$(uname -s)" = Darwin ]; then',
    // On modern macOS "/" is the sealed system volume; people's files live on the data volume shown as "/".
    '  [ "$D" = / ] && D=/System/Volumes/Data',
    '  $L find "$D" -xdev -type f -exec stat -f "%Su %b" {} + 2>/dev/null',
    'elif find / -maxdepth 0 -printf "" >/dev/null 2>&1; then',
    '  $L find "$D" -xdev -type f -printf "%u %b\\n" 2>/dev/null',
    'else',
    // BusyBox find has no -printf.
    '  $L find "$D" -xdev -type f -exec stat -c "%U %b" {} + 2>/dev/null',
    `fi | awk '{ s[$1] += $2 } END { for (u in s) printf "u %s %.0f\\n", u, s[u] * 512 }'`,
    'echo @@done',
    'kill $WATCHDOG 2>/dev/null',
    ''
  ].join('\n')
}

/** Null when the walk did not reach its end (stopped by the watchdog or the connection). */
export function parseDiskOwners(mount: string, output: string, at: number): DiskOwners | null {
  const lines = output.split('\n')
  if (!lines.includes('@@done')) return null
  const users: DiskOwners['users'] = []
  let uid = ''
  for (const line of lines) {
    const owner = /^u (\S+) (\d+)$/.exec(line)
    if (owner) users.push({ user: owner[1], bytes: Number(owner[2]) })
    const id = /^@@uid (\d+)$/.exec(line)
    if (id) uid = id[1]
  }
  return { mount, at, users: users.sort((a, b) => b.bytes - a.bytes), partial: uid !== '0' }
}

/** Walks one file system of the server to see who owns how much of it. */
export function scanDiskOwners(client: Client, mount: string, budgetSec = BUDGET_SEC): Promise<DiskOwners> {
  const script = buildDiskOwnersScript(mount, budgetSec)
  return new Promise((resolve, reject) => {
    client.exec('sh -s', (err, channel) => {
      if (err) return reject(err)
      let out = ''
      const timer = setTimeout(() => channel.close(), budgetSec * 1000 + CHANNEL_GRACE_MS)
      channel.on('data', (chunk: Buffer) => {
        out += chunk.toString('utf8')
      })
      channel.stderr.on('data', () => undefined)
      channel.on('close', () => {
        clearTimeout(timer)
        const result = parseDiskOwners(mount, out, Date.now())
        if (result) resolve(result)
        else reject(new Error('The scan did not finish in time'))
      })
      channel.end(script)
    })
  })
}
