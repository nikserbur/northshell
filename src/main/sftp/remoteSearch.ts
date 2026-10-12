import { posix } from 'node:path'
import type { SearchHit } from '@shared/types'

/** Heavy directories that make recursive search crawl; matches inside them are skipped. */
const PRUNED_DIRS = ['node_modules', '.git', '.cache', '.npm', 'Library', '__pycache__']

/** POSIX single-quote escaping: safe for any byte except NUL. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Builds a POSIX sh script (fed via stdin to `sh -s`, so the login shell never parses it)
 * that streams matches as "d <path>" / "f <path>" lines. A watchdog kills the whole
 * process group after `budgetSec`, so an abandoned search never keeps running on the server.
 */
export function buildFindScript(dir: string, query: string, budgetSec: number): string {
  if (/[\0-\x1f]/.test(dir + query)) throw new Error('Invalid characters in search')
  // An unanchored dir such as "-delete" would be parsed by find as an expression.
  if (!dir.startsWith('/')) throw new Error('Search directory must be an absolute path')
  const pattern = /[*?[]/.test(query) ? query : `*${query}*`
  const prune = PRUNED_DIRS.map((d) => `-name ${shellQuote(d)}`).join(' -o ')
  return [
    'export LC_ALL=C',
    `( sleep ${Math.max(1, Math.floor(budgetSec))}; kill 0 ) >/dev/null 2>&1 &`,
    'WATCHDOG=$!',
    // Shallow pass first so nearby matches show up even if the deep pass runs out of time.
    ...[2, 12].map(
      (depth) =>
        `find ${shellQuote(dir)} -xdev -maxdepth ${depth} \\( ${prune} \\) -prune -o -iname ${shellQuote(pattern)}` +
        ` \\( -type d -exec printf "d %s\\n" {} \\; -o -exec printf "f %s\\n" {} \\; \\) 2>/dev/null`
    ),
    'kill $WATCHDOG 2>/dev/null',
    ''
  ].join('\n')
}

export function parseFindOutput(output: string): SearchHit[] {
  const hits: SearchHit[] = []
  const seen = new Set<string>()
  for (const line of output.split('\n')) {
    const m = /^([df]) (\/.*)$/.exec(line)
    if (!m || seen.has(m[2])) continue
    seen.add(m[2])
    hits.push({ path: m[2], name: posix.basename(m[2]), isDir: m[1] === 'd' })
  }
  return hits
}
