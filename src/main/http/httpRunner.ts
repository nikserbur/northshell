import { execFile } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { requestData, withAuthQuery, type RequestAuth, type RequestData } from '@shared/httpBody'
import { parseHeaders } from '@shared/httpEnv'
import {
  effectiveHeaders,
  formFilePath,
  resolveRequestUrl,
  type HttpMethod,
  type HttpRequestSpec,
  type HttpResponseInfo,
  type ResponseTiming
} from '@shared/httpRequest'

/** What a request needs from its HTTP environment tab. */
export interface HttpEnvironment {
  /** Shell environment of the tab: $BASE_URL, $TOKEN and $CURL_HOME with the default headers. */
  env: Record<string, string>
  baseUrl: string
  token?: string
  /** Names of the environment's default headers (already applied through $CURL_HOME/.curlrc). */
  defaultHeaderNames: string[]
  /** Saved environment, for its cookie jar. */
  sessionId?: string
}

export interface RunOptions {
  signal?: AbortSignal
  timeoutSec?: number
  curl?: string
  /** Keep the files of this run in a folder the caller owns, instead of a temporary one. */
  workDir?: string
  onBodyFile?: (path: string) => void
  /** Netscape-format cookie file to send from and save to. */
  cookieJar?: string
}

/** Bodies above this are cut for display; the full size is still reported. */
export const MAX_BODY_BYTES = 2 * 1024 * 1024
const BINARY_SNIFF_BYTES = 8000
const MAX_TIMELINE_CHARS = 256 * 1024
/** Named like the shell folders, so what a crash leaves behind is swept with them. */
const WORK_DIR_PREFIX = `northshell-http-${process.pid}-req-`
const RC_HEADER_RE = /^\s*header\s*=\s*"\s*([^:"\s]+)\s*:/i
/** How curl logs a request header on HTTP/2 and HTTP/3, next to the `> Name: value` form. */
const STREAM_HEADER_RE = /^\* \[HTTP\/\d\] \[\d+\] \[([^:\]\s]+): /
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

/**
 * Expands $TOKEN and $BASE_URL like the tab's shell does, so Send and "Run in terminal" match. The token is
 * for the environment's own host only: a request from an imported file must not be able to carry it elsewhere.
 */
function expandVars(text: string, environment: HttpEnvironment, what: string, home: boolean): string {
  return text.replace(VAR_RE, (_m, braced: string | undefined, bare: string | undefined) => {
    if ((braced ?? bare) === 'BASE_URL') return environment.baseUrl
    if (!home) throw new Error(`${what} uses $TOKEN, which is sent only to ${originOf(environment.baseUrl)}`)
    if (!environment.token) throw new Error(`${what} uses $TOKEN, but this environment has no token`)
    return environment.token
  })
}

/** The token as typed and as it looks in a query string; the interface gets neither. */
function maskToken(text: string, token: string | undefined): string {
  if (!token) return text
  return [token, encodeURIComponent(token)].reduce((out, secret) => out.split(secret).join('••••'), text)
}

/** Basic auth is encoded while the header is built, so its $TOKEN has to be expanded before that. */
function expandedAuth(auth: RequestAuth | undefined, environment: HttpEnvironment, home: boolean): RequestAuth | undefined {
  if (auth?.type === 'basic') {
    return { ...auth, username: expandVars(auth.username, environment, 'The user name', home), password: expandVars(auth.password, environment, 'The password', home) }
  }
  if (auth?.type === 'apikey' && auth.in === 'query') return { ...auth, value: expandVars(auth.value, environment, 'The API key', home) }
  return auth
}

function requestHeaders(spec: HttpRequestSpec, environment: HttpEnvironment, home: boolean): RequestHeader[] {
  const lines = effectiveHeaders(spec, environment.defaultHeaderNames)
  const { headers, invalid } = parseHeaders(lines.join('\n'))
  if (invalid.length > 0) throw new Error(`Invalid header: ${lines[invalid[0] - 1]}`)
  const apiKey = spec.auth?.type === 'apikey' && spec.auth.in === 'header' ? spec.auth.name.toLowerCase() : ''
  return headers.map((h) => ({
    name: h.name,
    value: expandVars(h.value, environment, h.name, home),
    secret: CREDENTIAL_HEADER_RE.test(h.name) || new RegExp(VAR_RE.source).test(h.value) || h.name.toLowerCase() === apiKey
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
    execFile(curl, args, { env: { ...process.env, ...env }, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, signal }, (err, stdout, stderr) => {
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
  data: RequestData
  headers: RequestHeader[]
}

interface HopContext {
  dir: string
  environment: HttpEnvironment
  timeoutSec: number
  insecure: boolean
  opts: RunOptions
}

/** A value for a curl config file. */
function configValue(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`
}

/**
 * Which curl config applies. Inside the environment's own origin the tab's $CURL_HOME/.curlrc adds the
 * default headers and -k; for any other host `-q` skips it, so those headers never leave home. A request
 * that sets one of the defaults itself gets a copy of the config without it: curl would send both.
 */
async function configArgs(index: number, hop: Hop, ctx: HopContext): Promise<string[]> {
  if (originOf(hop.url) !== originOf(ctx.environment.baseUrl)) return ['-q']
  const defaults = new Set(ctx.environment.defaultHeaderNames.map((n) => n.toLowerCase()))
  const overridden = new Set(hop.headers.map((h) => h.name.toLowerCase()).filter((n) => defaults.has(n)))
  // curl has to write the multipart Content-Type itself, with the boundary.
  if (hop.data.kind === 'multipart' && defaults.has('content-type')) overridden.add('content-type')
  const home = ctx.environment.env.CURL_HOME
  if (overridden.size === 0 || !home) return []
  const rc = await readFile(join(home, '.curlrc'), 'utf8').catch(() => '')
  const kept = rc.split('\n').filter((line) => !overridden.has(RC_HEADER_RE.exec(line)?.[1]?.toLowerCase() ?? ''))
  const path = join(ctx.dir, `${index}-curlrc`)
  await writeFile(path, kept.join('\n'), { mode: 0o600 })
  return ['-q', '-K', path]
}

async function dataArgs(index: number, data: RequestData, dir: string): Promise<string[]> {
  const file = (name: string): string => join(dir, `${index}-${name}`)
  switch (data.kind) {
    case 'none':
      return []
    case 'raw':
      await writeFile(file('request-body'), data.text, { encoding: 'utf8', mode: 0o600 })
      return ['--data-binary', `@${file('request-body')}`]
    case 'file':
      if (!data.path.startsWith('/')) throw new Error('Pick the file to send again')
      return ['--data-binary', `@${data.path}`]
    case 'multipart': {
      // --form-string keeps a value starting with @ from reading a file; the values stay off the command line.
      const lines = data.parts.map((p) => {
        if (p.file && !p.value.startsWith('/')) throw new Error(`Pick the file for "${p.name}" again`)
        return p.file ? `form = ${configValue(`${p.name}=${formFilePath(p.value)}`)}` : `form-string = ${configValue(`${p.name}=${p.value}`)}`
      })
      await writeFile(file('form'), `${lines.join('\n')}\n`, { mode: 0o600 })
      return ['-K', file('form')]
    }
  }
}

const curlSeconds = (v: unknown): number => Math.max(0, Math.round(num(v) * 1000))

function timingOf(info: Record<string, unknown>): ResponseTiming {
  const dns = curlSeconds(info.time_namelookup)
  const connect = curlSeconds(info.time_connect)
  const tls = curlSeconds(info.time_appconnect)
  const sent = curlSeconds(info.time_pretransfer)
  const first = curlSeconds(info.time_starttransfer)
  const total = curlSeconds(info.time_total)
  return {
    dns,
    connect: Math.max(0, connect - dns),
    tls: tls > 0 ? Math.max(0, tls - connect) : 0,
    wait: Math.max(0, first - sent),
    download: Math.max(0, total - first)
  }
}

/** curl's own message for a failed run: in verbose mode it comes after the log. */
function curlError(stderr: string, exitCode: number): string | undefined {
  if (exitCode === 0) return undefined
  const line = stderr
    .split('\n')
    .reverse()
    .find((l) => l.startsWith('curl: ('))
  return line?.replace(/^curl: \(\d+\)\s*/, '') || stderr.trim().split('\n').pop() || `curl exited with code ${exitCode}`
}

/** The verbose log for the Timeline tab: no transfer noise, and no secrets, which the interface never gets. */
export function redactTimeline(stderr: string, secretHeaders: string[], token: string | undefined): string {
  const names = new Set(secretHeaders.map((n) => n.toLowerCase()))
  const out: string[] = []
  for (const raw of stderr.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (!/^[*<>] /.test(line)) continue
    const header = /^> ([^:\s]+):/.exec(line)
    const stream = STREAM_HEADER_RE.exec(line)
    const name = (header?.[1] ?? stream?.[1] ?? '').toLowerCase()
    const secret = names.has(name) || CREDENTIAL_HEADER_RE.test(name)
    if (secret && header) out.push(`> ${header[1]}: ••••`)
    else if (secret && stream) out.push(`${stream[0]}••••]`)
    else out.push(line)
  }
  return maskToken(out.join('\n').slice(0, MAX_TIMELINE_CHARS), token)
}

/** One curl run without -L. Headers go through a 0600 file, so the token never shows up in `ps`. */
async function curlOnce(index: number, hop: Hop, ctx: HopContext): Promise<HttpResponseInfo> {
  const file = (name: string): string => join(ctx.dir, `${index}-${name}`)
  const head = hop.method === 'HEAD'
  const args = await configArgs(index, hop, ctx)
  args.push('-sS', '-v', '--compressed', '--globoff', '--proto', '=http,https', '--max-time', String(ctx.timeoutSec))
  args.push('-o', file('body'), '-D', file('headers'), '-w', '%{json}', ...(head ? ['-I'] : ['-X', hop.method]))
  if (ctx.insecure) args.push('-k')
  if (ctx.opts.cookieJar) args.push('-b', ctx.opts.cookieJar, '-c', ctx.opts.cookieJar)
  if (hop.headers.length > 0) {
    await writeFile(file('request-headers'), hop.headers.map((h) => `${h.name}: ${h.value}\n`).join(''), { mode: 0o600 })
    args.push('-H', `@${file('request-headers')}`)
  }
  if (!head) args.push(...(await dataArgs(index, hop.data, ctx.dir)))
  // The URL may hold the token or an API key, and argv is visible in `ps`.
  await writeFile(file('url'), `url = ${configValue(hop.url)}\n`, { mode: 0o600 })
  args.push('-K', file('url'))

  const res = await runCurl(ctx.opts.curl ?? CURL, args, ctx.environment.env, (ctx.timeoutSec + 5) * 1000, ctx.opts.signal)
  const info = writeOut(res.stdout)
  const dump = parseHeaderDump(await readFile(file('headers'), 'utf8').catch(() => ''))
  const { bytes, size } = head ? { bytes: Buffer.alloc(0), size: 0 } : await readBody(file('body'))
  const binary = bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)
  const error = curlError(res.stderr, res.exitCode)
  const contentType = str(info.content_type) || (dump?.headers.find((h) => h.name.toLowerCase() === 'content-type')?.value ?? '')
  const image = /^image\//i.test(contentType) && size === bytes.length && size > 0
  return {
    status: dump?.status ?? num(info.response_code ?? info.http_code),
    statusText: dump?.statusText ?? '',
    httpVersion: dump?.httpVersion ?? str(info.http_version),
    headers: dump?.headers ?? [],
    body: binary ? '' : bytes.toString('utf8'),
    bodyBytes: size,
    truncated: size > bytes.length,
    binary,
    contentType,
    timeMs: Math.round(num(info.time_total) * 1000),
    url: str(info.url_effective) || hop.url,
    redirects: 0,
    timing: timingOf(info),
    remoteIp: str(info.remote_ip),
    uploadBytes: num(info.size_upload),
    timeline: redactTimeline(res.stderr, hop.headers.filter((h) => h.secret).map((h) => h.name), ctx.environment.token),
    ...(image ? { bodyBase64: bytes.toString('base64') } : {}),
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
  return { url, method: toGet ? 'GET' : hop.method, data: toGet ? { kind: 'none' } : hop.data, headers }
}

/** Sends one request with the system curl (no shell), following redirects itself when asked. */
export async function runHttpRequest(spec: HttpRequestSpec, environment: HttpEnvironment, opts: RunOptions = {}): Promise<HttpResponseInfo> {
  // Where the request goes decides whether the token may be used, so that comes before any expansion.
  const target = resolveRequestUrl(environment.baseUrl, spec.url.trim())
  if (!target) throw new Error('Use a path like /users or a full http(s):// URL')
  const home = originOf(target) === originOf(environment.baseUrl)
  const auth = expandedAuth(spec.auth, environment, home)
  const url = resolveRequestUrl(environment.baseUrl, expandVars(withAuthQuery(spec.url.trim(), auth), environment, 'The URL', home))
  if (!url) throw new Error('Use a path like /users or a full http(s):// URL')
  let hop: Hop = { url, method: spec.method, data: requestData(spec), headers: requestHeaders({ ...spec, auth }, environment, home) }
  const dir = opts.workDir ?? (await mkdtemp(join(tmpdir(), WORK_DIR_PREFIX)))
  const ctx: HopContext = { dir, environment, timeoutSec: spec.timeoutSec ?? opts.timeoutSec ?? DEFAULT_TIMEOUT_SEC, insecure: spec.insecure === true, opts }
  try {
    let totalMs = 0
    const timeline: string[] = []
    for (let redirects = 0; ; redirects++) {
      const res = await curlOnce(redirects, hop, ctx)
      totalMs += res.timeMs
      if (res.timeline) timeline.push(res.timeline)
      const next = spec.followRedirects && redirects < MAX_REDIRECTS ? redirectTarget(res, hop.url) : null
      if (!next) {
        opts.onBodyFile?.(join(dir, `${redirects}-body`))
        return {
          ...res,
          timeMs: totalMs,
          redirects,
          timeline: timeline.join('\n\n'),
          url: maskToken(res.url, environment.token),
          headers: res.headers.map((h) => ({ ...h, value: maskToken(h.value, environment.token) })),
          ...(res.error ? { error: maskToken(res.error, environment.token) } : {})
        }
      }
      hop = nextHop(hop, res.status, next)
    }
  } finally {
    if (!opts.workDir) await rm(dir, { recursive: true, force: true })
  }
}

/** One request at a time per tab; a new one (or closing the tab) cancels the previous. */
export class HttpRequests {
  private running = new Map<string, AbortController>()
  /** The last response of each tab stays on disk, so it can be saved whole: only part of a big body reaches the UI. */
  private last = new Map<string, { dir: string; bodyFile: string }>()

  constructor(
    private readonly environmentFor: (tabId: string) => HttpEnvironment | undefined,
    private readonly cookieJarFor?: (sessionId: string) => string
  ) {}

  async send(tabId: string, spec: HttpRequestSpec): Promise<HttpResponseInfo> {
    const environment = this.environmentFor(tabId)
    if (!environment) throw new Error('The HTTP environment is not open — reconnect the tab')
    this.cancel(tabId)
    this.forgetResponse(tabId)
    const controller = new AbortController()
    this.running.set(tabId, controller)
    const dir = await mkdtemp(join(tmpdir(), WORK_DIR_PREFIX))
    try {
      const cookieJar = spec.saveCookies !== false && environment.sessionId ? this.cookieJarFor?.(environment.sessionId) : undefined
      if (cookieJar) await ensureCookieJar(cookieJar)
      let bodyFile = ''
      const res = await runHttpRequest(spec, environment, {
        signal: controller.signal,
        workDir: dir,
        cookieJar,
        onBodyFile: (path) => (bodyFile = path)
      })
      if (this.running.get(tabId) === controller) this.last.set(tabId, { dir, bodyFile })
      else rmSync(dir, { recursive: true, force: true })
      return res
    } catch (err) {
      rmSync(dir, { recursive: true, force: true })
      throw err
    } finally {
      if (this.running.get(tabId) === controller) this.running.delete(tabId)
    }
  }

  /** Copies the whole body of the tab's last response to a file. */
  async saveResponse(tabId: string, target: string): Promise<void> {
    const last = this.last.get(tabId)
    if (!last) throw new Error('There is no response to save')
    await copyFile(last.bodyFile, target)
  }

  private forgetResponse(tabId: string): void {
    const last = this.last.get(tabId)
    if (last) rmSync(last.dir, { recursive: true, force: true })
    this.last.delete(tabId)
  }

  cancel(tabId: string): void {
    this.running.get(tabId)?.abort()
    this.running.delete(tabId)
  }

  /** The tab is gone: stop its request and delete what its last response left on disk. */
  dispose(tabId: string): void {
    this.cancel(tabId)
    this.forgetResponse(tabId)
  }

  cancelAll(): void {
    for (const id of new Set([...this.running.keys(), ...this.last.keys()])) this.dispose(id)
  }
}

/** The jar is created by hand first: curl would leave it readable by others. */
async function ensureCookieJar(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const handle = await open(path, 'a', 0o600)
  await handle.close()
}
