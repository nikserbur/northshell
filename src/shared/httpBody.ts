import type { HttpRequestSpec } from './httpRequest'

/** How the request body is written in the form. `none` and the inferred kinds keep old saved requests working. */
export const BODY_KINDS = ['none', 'json', 'xml', 'text', 'form', 'multipart', 'file', 'graphql'] as const
export type BodyKind = (typeof BODY_KINDS)[number]

/** One row of a form body. In multipart forms `file` makes `value` a local file path. */
export interface FormField {
  name: string
  value: string
  enabled: boolean
  file?: boolean
}

export type RequestAuth =
  | { type: 'none' }
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'apikey'; name: string; value: string; in: 'header' | 'query' }

export interface QueryParam {
  name: string
  value: string
}

export interface HeaderRow {
  name: string
  value: string
  enabled: boolean
}

export type RequestData =
  | { kind: 'none' }
  | { kind: 'raw'; text: string }
  | { kind: 'file'; path: string }
  | { kind: 'multipart'; parts: { name: string; value: string; file: boolean }[] }

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

/** Requests saved before body kinds existed have only text: JSON is recognised, the rest is sent as is. */
export function bodyKindOf(spec: HttpRequestSpec): BodyKind {
  if (spec.method === 'HEAD') return 'none'
  if (spec.bodyKind) return spec.bodyKind
  if (!spec.body) return 'none'
  return looksLikeJson(spec.body) ? 'json' : 'text'
}

function graphqlBody(spec: HttpRequestSpec): string {
  const text = spec.graphqlVariables?.trim()
  let variables: unknown
  if (text) {
    try {
      variables = JSON.parse(text)
    } catch {
      throw new Error('GraphQL variables are not valid JSON')
    }
  }
  return JSON.stringify(variables === undefined ? { query: spec.body } : { query: spec.body, variables })
}

/** `name=value` pairs, percent-encoded the way a browser form is. */
export function encodeForm(fields: { name: string; value: string }[]): string {
  return fields.map((f) => `${encodeURIComponent(f.name)}=${encodeURIComponent(f.value)}`).join('&')
}

const enabledFields = (spec: HttpRequestSpec): FormField[] => (spec.form ?? []).filter((f) => f.enabled && f.name)

/** What actually goes on the wire for the request's body. */
export function requestData(spec: HttpRequestSpec): RequestData {
  switch (bodyKindOf(spec)) {
    case 'none':
      return { kind: 'none' }
    case 'form': {
      const fields = enabledFields(spec)
      return fields.length > 0 ? { kind: 'raw', text: encodeForm(fields) } : { kind: 'none' }
    }
    case 'multipart': {
      const parts = enabledFields(spec).filter((f) => !f.file || f.value)
      return parts.length > 0 ? { kind: 'multipart', parts: parts.map((f) => ({ name: f.name, value: f.value, file: f.file === true })) } : { kind: 'none' }
    }
    case 'file':
      return spec.filePath ? { kind: 'file', path: spec.filePath } : { kind: 'none' }
    case 'graphql':
      return { kind: 'raw', text: graphqlBody(spec) }
    default:
      return spec.body ? { kind: 'raw', text: spec.body } : { kind: 'none' }
  }
}

/** The Content-Type a body needs when nobody set one. Multipart has none: curl adds it with the boundary. */
export function autoContentType(spec: HttpRequestSpec): string | null {
  const data = requestData(spec)
  if (data.kind === 'none' || data.kind === 'multipart') return null
  switch (bodyKindOf(spec)) {
    case 'json':
    case 'graphql':
      return 'application/json'
    case 'xml':
      return 'application/xml'
    case 'form':
      return 'application/x-www-form-urlencoded'
    case 'file':
      return 'application/octet-stream'
    case 'text':
      return spec.bodyKind === 'text' ? 'text/plain' : null
    default:
      return null
  }
}

export function base64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  return btoa(String.fromCharCode(...bytes))
}

/** The header line an auth setting adds; an API key sent in the query adds none. */
export function authHeaderLine(auth: RequestAuth | undefined): string | null {
  switch (auth?.type) {
    case 'bearer':
      return auth.token ? `Authorization: Bearer ${auth.token}` : null
    case 'basic':
      return auth.username || auth.password ? `Authorization: Basic ${base64(`${auth.username}:${auth.password}`)}` : null
    case 'apikey':
      return auth.in === 'header' && auth.name ? `${auth.name}: ${auth.value}` : null
    default:
      return null
  }
}

/** Adds an API key that belongs in the query string. */
export function withAuthQuery(url: string, auth: RequestAuth | undefined): string {
  if (auth?.type !== 'apikey' || auth.in !== 'query' || !auth.name) return url
  const { base, params, hash } = parseQuery(url)
  return withQuery(base, [...params, { name: encodeURIComponent(auth.name), value: encodeURIComponent(auth.value) }], hash)
}

/** Splits a URL for the parameter table. Values stay as typed, so `{{id}}` and existing escapes survive. */
export function parseQuery(url: string): { base: string; params: QueryParam[]; hash: string } {
  const hashAt = url.indexOf('#')
  const hash = hashAt >= 0 ? url.slice(hashAt) : ''
  const rest = hashAt >= 0 ? url.slice(0, hashAt) : url
  const q = rest.indexOf('?')
  if (q < 0) return { base: rest, params: [], hash }
  const params = rest
    .slice(q + 1)
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf('=')
      return eq < 0 ? { name: pair, value: '' } : { name: pair.slice(0, eq), value: pair.slice(eq + 1) }
    })
  return { base: rest.slice(0, q), params, hash }
}

export function withQuery(base: string, params: QueryParam[], hash = ''): string {
  const query = params
    .filter((p) => p.name || p.value)
    .map((p) => (p.value ? `${p.name}=${p.value}` : p.name))
    .join('&')
  return `${base}${query ? `?${query}` : ''}${hash}`
}

/** Header text ⇄ table rows; a disabled header is a `# Name: value` line, which curl-style parsing skips. */
export function parseHeaderRows(text: string): HeaderRow[] {
  const rows: HeaderRow[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const enabled = !line.startsWith('#')
    const body = enabled ? line : line.replace(/^#\s*/, '')
    const colon = body.indexOf(':')
    rows.push(colon < 0 ? { name: body, value: '', enabled } : { name: body.slice(0, colon).trim(), value: body.slice(colon + 1).trim(), enabled })
  }
  return rows
}

export function headerRowsText(rows: HeaderRow[]): string {
  return rows
    .filter((r) => r.name || r.value)
    .map((r) => `${r.enabled ? '' : '# '}${r.name}: ${r.value}`)
    .join('\n')
}
