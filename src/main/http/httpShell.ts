import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildCurlrc, normalizeBaseUrl, parseHeaders } from '@shared/httpEnv'
import type { SessionConfig } from '@shared/types'

export interface HttpShell {
  /** Extra environment for the local shell: $BASE_URL, $TOKEN and $CURL_HOME. */
  env: Record<string, string>
  endpoint: string
  /** Removes the generated curl config (it may contain the token). Safe to call twice. */
  dispose: () => void
}

/** Temp dirs are named after the owning process, so leftovers of a crashed run can be told apart. */
const DIR_PREFIX = 'northshell-http-'

/** The user's own curl config (same lookup order as curl), so their defaults survive our $CURL_HOME override. */
function userCurlrc(): string {
  const { CURL_HOME, XDG_CONFIG_HOME } = process.env
  const candidates = [
    CURL_HOME && join(CURL_HOME, '.curlrc'),
    XDG_CONFIG_HOME && join(XDG_CONFIG_HOME, 'curlrc'),
    join(homedir(), '.curlrc')
  ].filter((p): p is string => Boolean(p))
  const found = candidates.find((p) => existsSync(p))
  if (!found) return ''
  try {
    return readFileSync(found, 'utf8')
  } catch {
    return ''
  }
}

/**
 * Prepares an HTTP environment: a private temp dir with a .curlrc holding the default headers,
 * picked up by every `curl` in the shell through $CURL_HOME.
 */
export function prepareHttpShell(session: SessionConfig, token: string | undefined): HttpShell {
  const baseUrl = normalizeBaseUrl(session.baseUrl)
  if (!baseUrl) throw new Error(`Invalid base URL: ${session.baseUrl || '(empty)'}`)
  const { text } = buildCurlrc({
    headers: parseHeaders(session.headers).headers,
    token,
    insecure: session.insecure,
    userConfig: userCurlrc()
  })
  const dir = mkdtempSync(join(tmpdir(), `${DIR_PREFIX}${process.pid}-`))
  let disposed = false
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    rmSync(dir, { recursive: true, force: true })
  }
  try {
    writeFileSync(join(dir, '.curlrc'), text, { encoding: 'utf8', mode: 0o600 })
  } catch (err) {
    dispose()
    throw err
  }
  return {
    env: { BASE_URL: baseUrl, CURL_HOME: dir, ...(token ? { TOKEN: token } : {}) },
    endpoint: baseUrl,
    dispose
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Removes curl configs (they may hold a token) left behind by a run that crashed or was killed.
 * Directories of other live Northshell processes are kept.
 */
export function sweepStaleHttpShells(dir = tmpdir()): number {
  let removed = 0
  let names: string[] = []
  try {
    names = readdirSync(dir)
  } catch {
    return 0
  }
  const uid = process.getuid?.()
  for (const name of names) {
    const pid = name.startsWith(DIR_PREFIX) ? Number(/^(\d+)-/.exec(name.slice(DIR_PREFIX.length))?.[1]) : 0
    if (!pid || pid === process.pid || isAlive(pid)) continue
    const path = join(dir, name)
    try {
      const st = lstatSync(path)
      if (!st.isDirectory() || (uid !== undefined && st.uid !== uid)) continue
      rmSync(path, { recursive: true, force: true })
      removed++
    } catch (err) {
      console.error('[http] cannot remove stale environment', path, err)
    }
  }
  return removed
}
