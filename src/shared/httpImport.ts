import type { BodyKind, FormField, RequestAuth } from './httpBody'
import { HTTP_METHODS, type HttpMethod, type HttpRequestSpec } from './httpRequest'
import type { ImportedCollection, SavedRequest } from './httpWorkspace'

type Json = Record<string, unknown>

const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '')

const METHODS = HTTP_METHODS as readonly string[]
const POSTMAN_DYNAMIC: Record<string, string> = { $guid: '$uuid', $randomUUID: '$uuid', $isoTimestamp: '$isoTimestamp', $timestamp: '$timestamp', $randomInt: '$randomInt' }

function methodOf(value: unknown): HttpMethod {
  const m = str(value).toUpperCase()
  return METHODS.includes(m) ? (m as HttpMethod) : 'GET'
}

/** Postman and Insomnia variables to ours: `{{$guid}}` → `{{$uuid}}`, `{{ _.host }}` → `{{host}}`. */
function vars(text: string): string {
  return text
    .replace(/\{\{\s*_\.([\w-]+)\s*\}\}/g, '{{$1}}')
    .replace(/\{\{\s*(\$\w+)\s*\}\}/g, (m, name: string) => (POSTMAN_DYNAMIC[name] ? `{{${POSTMAN_DYNAMIC[name]}}}` : m))
}

/** Paths in a collection file are not trusted: a file to send has to be picked on this Mac. */
function formField(name: unknown, value: unknown, disabled: unknown, isFile: boolean): FormField {
  return { name: vars(str(name)), value: isFile ? '' : vars(str(value)), enabled: disabled !== true, ...(isFile ? { file: true } : {}) }
}

function rawKind(language: string, contentType: string): BodyKind {
  const hint = `${language} ${contentType}`.toLowerCase()
  if (hint.includes('json')) return 'json'
  if (hint.includes('xml')) return 'xml'
  return 'text'
}

function headerLines(list: unknown[], key: string, valueKey: string): string {
  return list
    .map(obj)
    .filter((h) => str(h[key]))
    .map((h) => `${h.disabled === true ? '# ' : ''}${vars(str(h[key]))}: ${vars(str(h[valueKey]))}`)
    .join('\n')
}

// ── Postman collection v2.x ──────────────────────────────────────────────────

function postmanPairs(list: unknown): Json {
  return Object.fromEntries(arr(list).map(obj).map((p) => [str(p.key), p.value]))
}

function postmanAuth(auth: Json): RequestAuth | undefined {
  switch (str(auth.type)) {
    case 'bearer':
      return { type: 'bearer', token: vars(str(postmanPairs(auth.bearer).token)) }
    case 'basic': {
      const p = postmanPairs(auth.basic)
      return { type: 'basic', username: vars(str(p.username)), password: vars(str(p.password)) }
    }
    case 'apikey': {
      const p = postmanPairs(auth.apikey)
      return { type: 'apikey', name: vars(str(p.key)), value: vars(str(p.value)), in: str(p.in) === 'query' ? 'query' : 'header' }
    }
    default:
      return undefined
  }
}

function postmanUrl(url: unknown): { url: string; disabled: { name: string; value: string }[] } {
  const o = obj(url)
  const raw = typeof url === 'string' ? url : str(o.raw)
  const disabled = arr(o.query).map(obj).filter((q) => q.disabled === true)
  return { url: vars(raw), disabled: disabled.map((q) => ({ name: vars(str(q.key)), value: vars(str(q.value)) })) }
}

function postmanBody(body: Json, headers: string): Partial<HttpRequestSpec> {
  switch (str(body.mode)) {
    case 'raw':
      return { body: vars(str(body.raw)), bodyKind: rawKind(str(obj(obj(body.options).raw).language), /content-type:\s*(.*)/i.exec(headers)?.[1] ?? '') }
    case 'urlencoded':
      return { bodyKind: 'form', form: arr(body.urlencoded).map(obj).map((f) => formField(f.key, f.value, f.disabled, false)) }
    case 'formdata':
      return { bodyKind: 'multipart', form: arr(body.formdata).map(obj).map((f) => formField(f.key, f.value, f.disabled, str(f.type) === 'file')) }
    case 'file':
      return { bodyKind: 'file' }
    case 'graphql': {
      const g = obj(body.graphql)
      return { bodyKind: 'graphql', body: vars(str(g.query)), graphqlVariables: vars(str(g.variables)) }
    }
    default:
      return {}
  }
}

function parsePostman(root: Json): ImportedCollection {
  const name = str(obj(root.info).name) || 'Postman'
  const requests: ImportedCollection['requests'] = []
  const walk = (items: unknown[], folder: string, inherited: RequestAuth | undefined): void => {
    for (const raw of items.map(obj)) {
      if (Array.isArray(raw.item)) {
        const auth = raw.auth ? postmanAuth(obj(raw.auth)) : inherited
        walk(raw.item, `${folder} / ${str(raw.name)}`, auth)
        continue
      }
      if (!raw.request) continue
      const req = typeof raw.request === 'string' ? { url: raw.request, method: 'GET' } : obj(raw.request)
      const headers = headerLines(arr(req.header), 'key', 'value')
      const { url, disabled } = postmanUrl(req.url)
      const auth = req.auth ? postmanAuth(obj(req.auth)) : inherited
      requests.push({
        name: str(raw.name) || url,
        folder,
        spec: {
          method: methodOf(req.method),
          url,
          headers,
          body: '',
          followRedirects: true,
          ...postmanBody(obj(req.body), headers),
          ...(auth ? { auth } : {}),
          ...(disabled.length > 0 ? { disabledParams: disabled } : {})
        }
      })
    }
  }
  walk(arr(root.item), name, root.auth ? postmanAuth(obj(root.auth)) : undefined)
  const variables = Object.fromEntries(arr(root.variable).map(obj).filter((v) => str(v.key)).map((v) => [str(v.key), vars(str(v.value))]))
  return { name, requests, variables }
}

// ── Insomnia export v4 ───────────────────────────────────────────────────────

function insomniaAuth(auth: Json): RequestAuth | undefined {
  if (auth.disabled === true) return undefined
  switch (str(auth.type)) {
    case 'bearer':
      return { type: 'bearer', token: vars(str(auth.token)) }
    case 'basic':
      return { type: 'basic', username: vars(str(auth.username)), password: vars(str(auth.password)) }
    case 'apikey':
      return { type: 'apikey', name: vars(str(auth.key)), value: vars(str(auth.value)), in: str(auth.addTo) === 'queryParams' ? 'query' : 'header' }
    default:
      return undefined
  }
}

function insomniaBody(body: Json): Partial<HttpRequestSpec> {
  const mime = str(body.mimeType)
  if (mime === 'application/x-www-form-urlencoded') return { bodyKind: 'form', form: arr(body.params).map(obj).map((f) => formField(f.name, f.value, f.disabled, false)) }
  if (mime === 'multipart/form-data') return { bodyKind: 'multipart', form: arr(body.params).map(obj).map((f) => formField(f.name, f.value, f.disabled, str(f.type) === 'file')) }
  if (mime === 'application/octet-stream') return { bodyKind: 'file' }
  if (mime === 'application/graphql') {
    try {
      const g = obj(JSON.parse(str(body.text)))
      return { bodyKind: 'graphql', body: vars(str(g.query)), ...(g.variables ? { graphqlVariables: vars(JSON.stringify(g.variables)) } : {}) }
    } catch {
      return { bodyKind: 'graphql', body: vars(str(body.text)) }
    }
  }
  return str(body.text) ? { body: vars(str(body.text)), bodyKind: rawKind(mime, '') } : {}
}

function parseInsomnia(root: Json): ImportedCollection {
  const resources = arr(root.resources).map(obj)
  const byId = new Map(resources.map((r) => [str(r._id), r]))
  const workspace = resources.find((r) => r._type === 'workspace')
  const name = str(workspace?.name) || 'Insomnia'
  const folderOf = (parentId: unknown): string => {
    const parts: string[] = []
    let current = byId.get(str(parentId))
    while (current && current._type === 'request_group') {
      parts.unshift(str(current.name))
      current = byId.get(str(current.parentId))
    }
    return [name, ...parts].join(' / ')
  }
  const requests = resources
    .filter((r) => r._type === 'request')
    .map((r) => {
      const url = vars(str(r.url))
      const query = arr(r.parameters).map(obj).filter((p) => str(p.name))
      const on = query.filter((p) => p.disabled !== true).map((p) => `${vars(str(p.name))}=${vars(str(p.value))}`)
      const off = query.filter((p) => p.disabled === true).map((p) => ({ name: vars(str(p.name)), value: vars(str(p.value)) }))
      const auth = insomniaAuth(obj(r.authentication))
      return {
        name: str(r.name) || url,
        folder: folderOf(r.parentId),
        spec: {
          method: methodOf(r.method),
          url: on.length > 0 ? `${url}${url.includes('?') ? '&' : '?'}${on.join('&')}` : url,
          headers: headerLines(arr(r.headers), 'name', 'value'),
          body: '',
          followRedirects: true,
          ...insomniaBody(obj(r.body)),
          ...(auth ? { auth } : {}),
          ...(off.length > 0 ? { disabledParams: off } : {})
        } satisfies HttpRequestSpec
      }
    })
  const variables: Record<string, string> = {}
  for (const env of resources.filter((r) => r._type === 'environment')) {
    for (const [key, value] of Object.entries(obj(env.data))) if (typeof value === 'string' || typeof value === 'number') variables[key] = vars(String(value))
  }
  return { name, requests, variables }
}

/** Reads a Postman collection (v2.x) or an Insomnia export (v4). Throws on anything else. */
export function parseCollectionFile(text: string): ImportedCollection {
  let root: Json
  try {
    root = obj(JSON.parse(text))
  } catch {
    throw new Error('This file is not JSON')
  }
  if (str(obj(root.info).schema).includes('collection')) return parsePostman(root)
  if (root._type === 'export' || Array.isArray(root.resources)) return parseInsomnia(root)
  throw new Error('This is neither a Postman collection nor an Insomnia export')
}

function postmanAuthOf(auth: RequestAuth | undefined): Json | undefined {
  const pairs = (o: Record<string, string>): Json[] => Object.entries(o).map(([key, value]) => ({ key, value, type: 'string' }))
  switch (auth?.type) {
    case 'bearer':
      return { type: 'bearer', bearer: pairs({ token: auth.token }) }
    case 'basic':
      return { type: 'basic', basic: pairs({ username: auth.username, password: auth.password }) }
    case 'apikey':
      return { type: 'apikey', apikey: pairs({ key: auth.name, value: auth.value, in: auth.in }) }
    default:
      return undefined
  }
}

function postmanBodyOf(spec: HttpRequestSpec): Json | undefined {
  const kind = spec.bodyKind ?? (spec.body ? 'text' : 'none')
  const fields = (spec.form ?? []).map((f) => ({ key: f.name, value: f.value, disabled: !f.enabled, ...(f.file ? { type: 'file', src: f.value } : { type: 'text' }) }))
  switch (kind) {
    case 'json':
    case 'xml':
    case 'text':
      return { mode: 'raw', raw: spec.body, options: { raw: { language: kind === 'text' ? 'text' : kind } } }
    case 'form':
      return { mode: 'urlencoded', urlencoded: fields }
    case 'multipart':
      return { mode: 'formdata', formdata: fields }
    case 'file':
      return { mode: 'file', file: { src: spec.filePath ?? '' } }
    case 'graphql':
      return { mode: 'graphql', graphql: { query: spec.body, variables: spec.graphqlVariables ?? '' } }
    default:
      return undefined
  }
}

/** A Postman v2.1 collection: folders from the requests' folder names, `/` nesting included. */
export function toPostmanCollection(name: string, requests: SavedRequest[], variables: Record<string, string>, baseUrl: string): string {
  const root: Json[] = []
  const folders = new Map<string, Json[]>([['', root]])
  const folderItems = (path: string): Json[] => {
    const found = folders.get(path)
    if (found) return found
    const at = path.lastIndexOf(' / ')
    const parent = folderItems(at < 0 ? '' : path.slice(0, at))
    const item: Json[] = []
    parent.push({ name: at < 0 ? path : path.slice(at + 3), item })
    folders.set(path, item)
    return item
  }
  for (const r of requests) {
    const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(r.spec.url) ? r.spec.url : `{{baseUrl}}${r.spec.url.startsWith('/') || !r.spec.url ? '' : '/'}${r.spec.url}`
    const auth = postmanAuthOf(r.spec.auth)
    const body = postmanBodyOf(r.spec)
    folderItems(r.folder).push({
      name: r.name,
      request: {
        method: r.spec.method,
        url,
        header: r.spec.headers
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => {
            const line = l.replace(/^#\s*/, '')
            const colon = line.indexOf(':')
            return { key: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim(), ...(l.startsWith('#') ? { disabled: true } : {}) }
          }),
        ...(auth ? { auth } : {}),
        ...(body ? { body } : {})
      }
    })
  }
  const variable = Object.entries({ baseUrl, ...variables }).map(([key, value]) => ({ key, value }))
  return JSON.stringify({ info: { name, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: root, variable }, null, 2)
}
