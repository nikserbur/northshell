import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseHeaders } from '@shared/httpEnv'
import { effectiveHeaders, resolveRequestUrl, type HttpMethod, type HttpRequestSpec, type HttpResponseInfo } from '@shared/httpRequest'

/** What a request needs from its HTTP environment tab. */
export interface HttpEnvironment {
  /** Shell environment of the tab: $BASE_URL, $TOKEN and $CURL_HOME with the default headers. */
  env: Record<string, string>
  baseUrl: string
  token?: string
  /** Names of the environment's default headers (already applied through $CURL_HOME/.curlrc). */
  defaultHeaderNames: string[]
}

export interface RunOptions {
  signal?: AbortSignal
  timeoutSec?: number
  curl?: string
}

/** Bodies above this are cut for display; the full size is still reported. */
export const MAX_BODY_BYTES = 2 * 1024 * 1024
const BINARY_SNIFF_BYTES = 8000
const DEFAULT_TIMEOUT_SEC = 60
const MAX_REDIRECTS = 10
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308])
/** Never carried to another host on a redirect (browsers drop them too). */
const CREDENTIAL_HEADER_RE = /^(authorization|proxy-authorization|cookie)$/i
const VAR_RE = /\$(?:\{(TOKEN|BASE_URL)\}|(TOKEN|BASE_URL)\b)/g
const CURL = existsSync('/usr/bin/curl') ? '/usr/bin/curl' : 'curl'

interface RequestHeader {
  name: string
  value: string
  /** Holds the token or other credentials: dropped when a redirect leaves the host. */
  secret: boolean
}

/** Expands $TOKEN and $BASE_URL like the tab's shell does, so Send and "Run in terminal" match. */
function expandVars(text: string, environment: HttpEnvironment, what: string): string {
  return text.replace(VAR_RE, (_m, braced: string | undefined, bare: string | undefined) => {
    if ((braced ?? bare) === 'BASE_URL') return environment.baseUrl
    if (!environment.token) throw new Error(`${what} uses $TOKEN, but this environment has no token`)
    return environment.token
  })
}

function requestHeaders(spec: HttpRequestSpec, environment: HttpEnvironment): RequestHeader[] {
  const lines = effectiveHeaders(spec, environment.defaultHeaderNames)
  const { headers, invalid } = parseHeaders(lines.join('\n'))
  if (invalid.length > 0) throw new Error(`Invalid header: ${lines[invalid[0] - 1]}`)
  return headers.map((h) => ({
    name: h.name,
    value: expandVars(h.value, environment, h.name),
    secret: CREDENTIAL_HEADER_RE.test(h.name) || new RegExp(VAR_RE.source).test(h.value)
  }))
}

interface StatusBlock {
  httpVersion: string
  status: number
  statusText: string
  headers: { name: string; value: string }[]
}

/** The last response in a `curl -D` dump (earlier ones are `100 Continue` and the like). */
export function parseHeaderDump(dump: string): StatusBlock | null {
  let last: StatusBlock | null = null
  for (const block of dump.replace(/\r/g, '').split(/\n\n+/)) {
    const [first, ...rest] = block.split('\n')
    const m = /^HTTP\/([\d.]+)\s+(\d{3})\s*(.*)$/.exec(first?.trim() ?? '')
    if (!m) continue
    const headers = rest
      .map((l) => {
        const at = l.indexOf(':')
        return at > 0 ? { name: l.slice(0, at).trim(), value: l.slice(at + 1).trim() } : null
      })
      .filter((h): h is { name: string; value: string } => h !== null)
    const status = Number(m[2])
    if (status >= 100 && status < 200 && status !== 101) continue
    last = { httpVersion: m[1], status, statusText: m[3].trim(), headers }
  }
  return last
}

interface CurlResult {
  stdout: string
  stderr: string
  exitCode: number
}

function runCurl(curl: string, args: string[], env: Record<string, string>, timeoutMs: number, signal?: AbortSignal): Promise<CurlResult> {
  return new Promise((resolve, reject) => {
    execFile(curl, args, { env: { ...process.env, ...env }, timeout: timeoutMs, maxBuffer: 1024 * 1024, signal }, (err, stdout, stderr) => {
      if (err && (err.name === 'AbortError' || (err as NodeJS.ErrnoException).code === 'ABORT_ERR')) {
        reject(new Error('Request cancelled'))
        return
      }
      if (err && typeof (err as { code?: unknown }).code !== 'number') {
        reject(err.killed ? new Error('Request timed out') : err)
        return
      }
      resolve({ stdout, stderr, exitCode: err ? Number((err as { code?: unknown }).code) : 0 })
    })
  })
}

async function readBody(path: string): Promise<{ bytes: Buffer; size: number }> {
  const file = await open(path, 'r').catch(() => null)
  if (!file) return { bytes: Buffer.alloc(0), size: 0 }
  try {
    const { size } = await file.stat()
    const bytes = Buffer.alloc(Math.min(size, MAX_BODY_BYTES))
    await file.read(bytes, 0, bytes.length, 0)
    return { bytes, size }
  } finally {
    await file.close()
  }
}

function writeOut(stdout: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(stdout.trim() || '{}')
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

interface Hop {
  url: string
  method: HttpMethod
  body: string
  headers: RequestHeader[]
}

interface HopContext {
  dir: string
  environment: HttpEnvironment
  timeoutSec: number
  opts: RunOptions
}

/**
 * One curl run without -L. Inside the environment's own origin the tab's $CURL_HOME/.curlrc adds
 * the default headers and -k; for any other host `-q` skips it, so those headers never leave home.
 * Headers go through a 0600 file, so the token never shows up in `ps`.
 */
async function curlOnce(index: number, hop: Hop, ctx: HopContext): Promise<HttpResponseInfo> {
  const file = (name: string): string => join(ctx.dir, `${index}-${name}`)
  const head = hop.method === 'HEAD'
  const home = originOf(hop.url) === originOf(ctx.environment.baseUrl)
  const args = home ? [] : ['-q']
  args.push('-sS', '--compressed', '--globoff', '--proto', '=http,https', '--max-time', String(ctx.timeoutSec))
  args.push('-o', file('body'), '-D', file('headers'), '-w', '%{json}', ...(head ? ['-I'] : ['-X', hop.method]))
  if (hop.headers.length > 0) {
    await writeFile(file('request-headers'), hop.headers.map((h) => `${h.name}: ${h.value}\n`).join(''), { mode: 0o600 })
    args.push('-H', `@${file('request-headers')}`)
  }
  if (!head && hop.body) {
    await writeFile(file('request-body'), hop.body, { encoding: 'utf8', mode: 0o600 })
    args.push('--data-binary', `@${file('request-body')}`)
  }
  args.push('--url', hop.url)

  const res = await runCurl(ctx.opts.curl ?? CURL, args, ctx.environment.env, (ctx.timeoutSec + 5) * 1000, ctx.opts.signal)
  const info = writeOut(res.stdout)
  const dump = parseHeaderDump(await readFile(file('headers'), 'utf8').catch(() => ''))
  const { bytes, size } = head ? { bytes: Buffer.alloc(0), size: 0 } : await readBody(file('body'))
  const binary = bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)
  const error = res.exitCode !== 0 ? res.stderr.trim().replace(/^curl: \(\d+\)\s*/, '') || `curl exited with code ${res.exitCode}` : undefined
  return {
    status: dump?.status ?? num(info.response_code ?? info.http_code),
    statusText: dump?.statusText ?? '',
    httpVersion: dump?.httpVersion ?? str(info.http_version),
    headers: dump?.headers ?? [],
    body: binary ? '' : bytes.toString('utf8'),
    bodyBytes: size,
    truncated: size > bytes.length,
    binary,
    contentType: str(info.content_type) || (dump?.headers.find((h) => h.name.toLowerCase() === 'content-type')?.value ?? ''),
    timeMs: Math.round(num(info.time_total) * 1000),
    url: str(info.url_effective) || hop.url,
    redirects: 0,
    ...(error ? { error } : {})
  }
}

/** Where a redirect leads, or null when it should not be followed. */
function redirectTarget(res: HttpResponseInfo, from: string): string | null {
  const location = res.headers.find((h) => h.name.toLowerCase() === 'location')?.value
  if (!REDIRECT_CODES.has(res.status) || !location) return null
  try {
    const next = new URL(location, from)
    return next.protocol === 'http:' || next.protocol === 'https:' ? next.href : null
  } catch {
    return null
  }
}

/** The next hop of a redirect, with browser rules: 303 (and 301/302 after POST) become GET, credentials stay home. */
function nextHop(hop: Hop, status: number, url: string): Hop {
  const toGet = hop.method !== 'HEAD' && (status === 303 || ((status === 301 || status === 302) && hop.method === 'POST'))
  const sameOrigin = originOf(url) === originOf(hop.url)
  const headers = hop.headers.filter((h) => (sameOrigin || !h.secret) && !(toGet && h.name.toLowerCase() === 'content-type'))
  return { url, method: toGet ? 'GET' : hop.method, body: toGet ? '' : hop.body, headers }
}

/** Sends one request with the system curl (no shell), following redirects itself when asked. */
export async function runHttpRequest(spec: HttpRequestSpec, environment: HttpEnvironment, opts: RunOptions = {}): Promise<HttpResponseInfo> {
  const url = resolveRequestUrl(environment.baseUrl, expandVars(spec.url.trim(), environment, 'The URL'))
  if (!url) throw new Error('Use a path like /users or a full http(s):// URL')
  let hop: Hop = { url, method: spec.method, body: spec.body, headers: requestHeaders(spec, environment) }
  const dir = await mkdtemp(join(tmpdir(), 'northshell-req-'))
  const ctx: HopContext = { dir, environment, timeoutSec: opts.timeoutSec ?? DEFAULT_TIMEOUT_SEC, opts }
  try {
    let totalMs = 0
    for (let redirects = 0; ; redirects++) {
      const res = await curlOnce(redirects, hop, ctx)
      totalMs += res.timeMs
      const next = spec.followRedirects && redirects < MAX_REDIRECTS ? redirectTarget(res, hop.url) : null
      if (!next) return { ...res, timeMs: totalMs, redirects }
      hop = nextHop(hop, res.status, next)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** One request at a time per tab; a new one (or closing the tab) cancels the previous. */
export class HttpRequests {
  private running = new Map<string, AbortController>()

  constructor(private readonly environmentFor: (tabId: string) => HttpEnvironment | undefined) {}

  async send(tabId: string, spec: HttpRequestSpec): Promise<HttpResponseInfo> {
    const environment = this.environmentFor(tabId)
    if (!environment) throw new Error('The HTTP environment is not open — reconnect the tab')
    this.cancel(tabId)
    const controller = new AbortController()
    this.running.set(tabId, controller)
    try {
      return await runHttpRequest(spec, environment, { signal: controller.signal })
    } finally {
      if (this.running.get(tabId) === controller) this.running.delete(tabId)
    }
  }

  cancel(tabId: string): void {
    this.running.get(tabId)?.abort()
    this.running.delete(tabId)
  }

  cancelAll(): void {
    for (const id of [...this.running.keys()]) this.cancel(id)
  }
}
