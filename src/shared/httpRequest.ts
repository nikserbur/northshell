/**
 * Request builder for HTTP environments: a form ⇄ curl command converter, so nobody has to type curl.
 * `$BASE_URL` and `$TOKEN` stay shell variables in generated commands; the main process expands them itself.
 */

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const
export type HttpMethod = (typeof HTTP_METHODS)[number]

export interface HttpRequestSpec {
  method: HttpMethod
  /** Path relative to $BASE_URL (`/users?id=1`), `$BASE_URL/…`, or an absolute http(s) URL. */
  url: string
  /** Extra headers, `Name: value` per line, on top of the environment's defaults. */
  headers: string
  body: string
  followRedirects: boolean
}

export function emptyRequest(): HttpRequestSpec {
  return { method: 'GET', url: '', headers: '', body: '', followRedirects: false }
}

const CONTROL_RE = /[\x00-\x1f\x7f]/
const BASE_VAR_RE = /^\$(?:\{BASE_URL\}|BASE_URL\b)/
const SHELL_VAR_RE = /\$(?:\{(TOKEN|BASE_URL)\}|(TOKEN|BASE_URL)\b)/g

function isAbsolute(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(url)
}

/** `/x`, `x`, `?q` or `` → `$BASE_URL/x`, `$BASE_URL/x`, `$BASE_URL?q`, `$BASE_URL`. */
function withBaseVar(url: string): string {
  if (BASE_VAR_RE.test(url) || isAbsolute(url)) return url
  if (url === '' || url.startsWith('/') || url.startsWith('?') || url.startsWith('#')) return `$BASE_URL${url}`
  return `$BASE_URL/${url}`
}

/** The URL curl will request, or null for anything but http(s) without credentials. */
export function resolveRequestUrl(baseUrl: string, url: string): string | null {
  const raw = url.trim()
  if (CONTROL_RE.test(raw)) return null
  const full = withBaseVar(raw).replace(BASE_VAR_RE, baseUrl.replace(/\/+$/, ''))
  let parsed: URL
  try {
    parsed = new URL(full)
  } catch {
    return null
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) return null
  // new URL() adds a "/" to a bare origin; keep the base URL exactly as configured.
  return full === baseUrl.replace(/\/+$/, '') && parsed.pathname === '/' && !full.endsWith('/') ? full : parsed.href
}

export function looksLikeJson(body: string): boolean {
  const text = body.trim()
  if (!/^[[{]/.test(text)) return false
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

function headerNames(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.slice(0, l.indexOf(':')).trim().toLowerCase())
    .filter(Boolean)
}

/** Request headers plus `Content-Type: application/json` for JSON bodies when nobody set a content type. */
export function effectiveHeaders(spec: HttpRequestSpec, envHeaderNames: string[] = []): string[] {
  const lines = spec.headers
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
  const known = new Set([...headerNames(spec.headers), ...envHeaderNames.map((n) => n.toLowerCase())])
  if (spec.method !== 'HEAD' && spec.body && !known.has('content-type') && looksLikeJson(spec.body)) {
    lines.push('Content-Type: application/json')
  }
  return lines
}

function sq(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`
}

/** Single-quotes text but leaves $TOKEN / $BASE_URL to the shell: `'Bearer '"$TOKEN"`. */
function shellArg(text: string): string {
  let out = ''
  let last = 0
  for (const m of text.matchAll(SHELL_VAR_RE)) {
    const at = m.index ?? 0
    if (at > last) out += sq(text.slice(last, at))
    out += `"$${m[1] ?? m[2]}"`
    last = at + m[0].length
  }
  if (last < text.length) out += sq(text.slice(last))
  return out || "''"
}

/** A curl command for the HTTP environment's shell (or the command library). */
export function buildCurlCommand(spec: HttpRequestSpec, envHeaderNames: string[] = []): string {
  const head = spec.method === 'HEAD'
  const body = head ? '' : spec.body
  const parts = ['curl', '-sS']
  if (head) parts.push('-I')
  else if (spec.method !== 'GET' || body) parts.push('-X', spec.method)
  if (spec.followRedirects) parts.push('-L')
  // Without -g curl reads [] and {} in URLs (filter[status]=…) as glob patterns.
  if (/[[\]{}]/.test(spec.url)) parts.push('-g')
  parts.push(shellArg(withBaseVar(spec.url.trim())))
  for (const h of effectiveHeaders({ ...spec, body }, envHeaderNames)) parts.push('-H', shellArg(h))
  if (body) parts.push('--data-raw', sq(body))
  return parts.join(' ')
}

/** Splits a POSIX shell command line into words (quotes, escapes, $'…', line continuations); null if a quote is open. */
export function shellWords(text: string): string[] | null {
  const words: string[] = []
  let word = ''
  let inWord = false
  let i = 0
  const ansi: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', e: '\x1b', a: '\x07', b: '\b', f: '\f', v: '\v', '0': '\0' }
  while (i < text.length) {
    const c = text[i]
    if (c === '\\') {
      if (text[i + 1] === '\n') i += 2
      else if (text[i + 1] === '\r' && text[i + 2] === '\n') i += 3
      else {
        word += text[i + 1] ?? ''
        inWord = true
        i += 2
      }
    } else if (c === "'") {
      const end = text.indexOf("'", i + 1)
      if (end < 0) return null
      word += text.slice(i + 1, end)
      inWord = true
      i = end + 1
    } else if (c === '$' && text[i + 1] === "'") {
      i += 2
      for (;;) {
        if (i >= text.length) return null
        if (text[i] === "'") break
        if (text[i] === '\\') {
          const e = text[i + 1] ?? ''
          if (e === 'x' && /^[0-9a-f]{2}/i.test(text.slice(i + 2, i + 4))) {
            word += String.fromCharCode(parseInt(text.slice(i + 2, i + 4), 16))
            i += 4
          } else if (e === 'u' && /^[0-9a-f]{4}/i.test(text.slice(i + 2, i + 6))) {
            word += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16))
            i += 6
          } else {
            word += ansi[e] ?? `\\${e}`
            i += 2
          }
        } else word += text[i++]
      }
      inWord = true
      i++
    } else if (c === '"') {
      i++
      for (;;) {
        if (i >= text.length) return null
        if (text[i] === '"') break
        if (text[i] === '\\' && '"\\$`\n'.includes(text[i + 1] ?? '')) {
          if (text[i + 1] !== '\n') word += text[i + 1]
          i += 2
        } else word += text[i++]
      }
      inWord = true
      i++
    } else if (/\s/.test(c)) {
      if (inWord) words.push(word)
      word = ''
      inWord = false
      i++
    } else {
      word += c
      inWord = true
      i++
    }
  }
  if (inWord) words.push(word)
  return words
}

export function isCurlCommand(text: string): boolean {
  return /^\s*(?:\S*\/)?curl(?:\.exe)?(?:\s|$)/.test(text)
}

/** Options that are dropped without a word: output formatting, timeouts, protocol tweaks. */
const IGNORED_FLAGS = new Set(['-s', '-S', '-v', '-i', '-f', '-N', '-g', '-#', '--silent', '--show-error', '--verbose', '--include', '--compressed', '--fail', '--fail-with-body', '--no-buffer', '--globoff', '--http1.1', '--http2', '--location-trusted', '--progress-bar'])
const IGNORED_WITH_ARG = new Set(['-m', '-w', '--max-time', '--connect-timeout', '--retry', '--retry-delay', '--retry-max-time', '--write-out', '--limit-rate', '--expect100-timeout'])
/** Options that change the request in ways the panel cannot carry over (files, TLS, proxies). */
const WARN_FLAGS = new Set(['-k', '-O', '-J', '-n', '--insecure', '--remote-name', '--remote-header-name', '--netrc'])
const WARN_WITH_ARG = new Set(['-o', '-F', '-T', '-x', '-K', '-c', '-D', '-E', '-r', '-U', '--output', '--form', '--upload-file', '--proxy', '--config', '--cookie-jar', '--dump-header', '--cert', '--key', '--cacert', '--resolve', '--range', '--proxy-user', '--form-string'])
const DATA_OPTS = new Set(['-d', '--data', '--data-ascii', '--data-binary', '--data-raw', '--data-urlencode', '--json'])
const ARG_OPTS = new Set(['-X', '-H', '-u', '-A', '-e', '-b', '--request', '--header', '--user', '--user-agent', '--referer', '--cookie', '--url', ...DATA_OPTS, ...IGNORED_WITH_ARG, ...WARN_WITH_ARG])
const SHORT_WITH_ARG = new Set([...ARG_OPTS].filter((o) => /^-[a-zA-Z#]$/.test(o)).map((o) => o[1]))

/** Splits `-sSLXPOST` into `-s -S -L -X POST`; long options and plain words pass through. */
function expandShort(words: string[]): string[] {
  const out: string[] = []
  for (const w of words) {
    if (!/^-[a-zA-Z#]{2,}/.test(w)) {
      out.push(w)
      continue
    }
    for (let i = 1; i < w.length; i++) {
      out.push(`-${w[i]}`)
      if (SHORT_WITH_ARG.has(w[i])) {
        if (i + 1 < w.length) out.push(w.slice(i + 1))
        break
      }
    }
  }
  return out
}

function base64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  return btoa(String.fromCharCode(...bytes))
}

function urlEncodeData(value: string): string {
  const eq = value.indexOf('=')
  if (eq < 0) return encodeURIComponent(value)
  return `${value.slice(0, eq + 1)}${encodeURIComponent(value.slice(eq + 1))}`
}

/** URL relative to the environment when it points inside it; `$BASE_URL/x` → `/x`. */
function relativeUrl(url: string, baseUrl: string): string {
  if (BASE_VAR_RE.test(url)) return url.replace(BASE_VAR_RE, '')
  const base = baseUrl.replace(/\/+$/, '')
  if (base && url.startsWith(base) && /^($|[/?#])/.test(url.slice(base.length))) return url.slice(base.length)
  return url
}

export interface ParsedCurl {
  spec: HttpRequestSpec
  /** Options that were left out (e.g. `-k`, `-F`), for a hint in the UI. */
  warnings: string[]
}

/** Reads a curl command (e.g. "Copy as cURL" from browser dev tools) into a request; null if it is not one. */
export function parseCurlCommand(text: string, baseUrl: string): ParsedCurl | null {
  if (!isCurlCommand(text)) return null
  const raw = shellWords(text.trim())
  if (!raw) return null
  const words = expandShort(raw.slice(1))
  const headers: string[] = []
  const data: string[] = []
  const warnings: string[] = []
  let method: string | null = null
  let url = ''
  let head = false
  let get = false
  let follow = false
  let hasData = false
  const warn = (opt: string): void => {
    if (!warnings.includes(opt)) warnings.push(opt)
  }
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    const arg = (): string => words[++i] ?? ''
    if (!w.startsWith('-') || w === '-') {
      if (!url) url = w
      continue
    }
    switch (w) {
      case '-X':
      case '--request':
        method = arg().toUpperCase()
        break
      case '-H':
      case '--header':
        headers.push(arg())
        break
      case '-L':
      case '--location':
        follow = true
        break
      case '-I':
      case '--head':
        head = true
        break
      case '-G':
      case '--get':
        get = true
        break
      case '-u':
      case '--user':
        headers.push(`Authorization: Basic ${base64(arg())}`)
        break
      case '-A':
      case '--user-agent':
        headers.push(`User-Agent: ${arg()}`)
        break
      case '-e':
      case '--referer':
        headers.push(`Referer: ${arg()}`)
        break
      case '-b':
      case '--cookie': {
        const value = arg()
        if (value.includes('=')) headers.push(`Cookie: ${value}`)
        else warn(w)
        break
      }
      case '--url':
        url = arg()
        break
      case '--json':
        headers.push('Content-Type: application/json', 'Accept: application/json')
        data.push(arg())
        hasData = true
        break
      default:
        if (DATA_OPTS.has(w)) {
          const value = arg()
          if (value.startsWith('@') && w !== '--data-raw') warn(`${w} @file`)
          data.push(w === '--data-urlencode' ? urlEncodeData(value) : value)
          hasData = true
        } else if (WARN_WITH_ARG.has(w)) {
          warn(w)
          i++
        } else if (IGNORED_WITH_ARG.has(w)) {
          i++
        } else if (WARN_FLAGS.has(w)) {
          warn(w)
        } else if (!IGNORED_FLAGS.has(w)) {
          warn(w)
        }
    }
  }
  if (!url) return null
  let body = data.join('&')
  if (get && body) {
    url += (url.includes('?') ? '&' : '?') + body
    body = ''
  }
  const chosen = head ? 'HEAD' : (method ?? (hasData && !get ? 'POST' : 'GET'))
  return {
    spec: {
      method: (HTTP_METHODS as readonly string[]).includes(chosen) ? (chosen as HttpMethod) : 'GET',
      url: relativeUrl(url, baseUrl),
      headers: headers.join('\n'),
      body,
      followRedirects: follow
    },
    warnings: method && !(HTTP_METHODS as readonly string[]).includes(method) ? [...warnings, `-X ${method}`] : warnings
  }
}

/**
 * Re-indents a JSON object or array token by token instead of parse + stringify, so big integer IDs
 * and key order come out exactly as the server sent them. Null when the text is not JSON.
 */
export function formatJson(text: string): string | null {
  if (!looksLikeJson(text)) return null
  const src = text.trim()
  let out = ''
  let depth = 0
  const newline = (): string => `\n${'  '.repeat(depth)}`
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === '"') {
      let end = i + 1
      while (end < src.length && src[end] !== '"') end += src[end] === '\\' ? 2 : 1
      out += src.slice(i, end + 1)
      i = end
    } else if (c === '{' || c === '[') {
      let next = i + 1
      while (/\s/.test(src[next] ?? '')) next++
      if (src[next] === (c === '{' ? '}' : ']')) {
        out += c + src[next]
        i = next
      } else {
        depth++
        out += c + newline()
      }
    } else if (c === '}' || c === ']') {
      depth--
      out += newline() + c
    } else if (c === ',') out += `,${newline()}`
    else if (c === ':') out += ': '
    else if (!/\s/.test(c)) out += c
  }
  return out
}

/** Pretty-printed JSON when the body is a JSON object or array; other text is returned as is. */
export function prettyBody(body: string): { text: string; json: boolean } {
  const formatted = formatJson(body)
  return formatted === null ? { text: body, json: false } : { text: formatted, json: true }
}

export interface HttpResponseInfo {
  /** 0 when no response arrived (DNS, refused connection, timeout…); see `error`. */
  status: number
  /** Reason phrase from the status line; empty for HTTP/2 and later. */
  statusText: string
  httpVersion: string
  headers: { name: string; value: string }[]
  /** Body as text (cut at the display limit); empty for binary bodies. */
  body: string
  bodyBytes: number
  truncated: boolean
  binary: boolean
  contentType: string
  timeMs: number
  /** Final URL after redirects. */
  url: string
  redirects: number
  /** curl's own message when the request failed, e.g. "Could not resolve host: api.example". */
  error?: string
}
