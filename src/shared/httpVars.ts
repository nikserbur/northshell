import type { HttpRequestSpec } from './httpRequest'
import { fillPlaceholders, placeholders, type Placeholder } from './snippets'

/** Applies a text transformation to every field of a request that may hold {{variables}}. */
function mapRequestText(spec: HttpRequestSpec, fn: (text: string) => string): HttpRequestSpec {
  const auth = spec.auth
  return {
    ...spec,
    url: fn(spec.url),
    headers: fn(spec.headers),
    body: fn(spec.body),
    ...(spec.form ? { form: spec.form.map((f) => ({ ...f, name: fn(f.name), value: fn(f.value) })) } : {}),
    ...(spec.filePath ? { filePath: fn(spec.filePath) } : {}),
    ...(spec.graphqlVariables ? { graphqlVariables: fn(spec.graphqlVariables) } : {}),
    ...(spec.tests ? { tests: spec.tests.map((r) => ({ ...r, path: fn(r.path), value: fn(r.value) })) } : {}),
    ...(auth?.type === 'bearer' ? { auth: { ...auth, token: fn(auth.token) } } : {}),
    ...(auth?.type === 'basic' ? { auth: { ...auth, username: fn(auth.username), password: fn(auth.password) } } : {}),
    ...(auth?.type === 'apikey' ? { auth: { ...auth, name: fn(auth.name), value: fn(auth.value) } } : {})
  }
}

/** Fills {{placeholders}} in every field of a request. */
export function fillRequest(spec: HttpRequestSpec, vars: Record<string, string>): HttpRequestSpec {
  return mapRequestText(spec, (text) => fillPlaceholders(text, vars))
}

const DYNAMIC_RE = /\{\{\s*\$(uuid|guid|timestamp|isoTimestamp|randomInt)\s*\}\}/g

function dynamicValue(name: string): string {
  switch (name) {
    case 'timestamp':
      return String(Math.floor(Date.now() / 1000))
    case 'isoTimestamp':
      return new Date().toISOString()
    case 'randomInt':
      return String(Math.floor(Math.random() * 1000))
    default:
      return crypto.randomUUID()
  }
}

/** Replaces {{$uuid}}, {{$timestamp}} and the like: a new value for every send. */
export function withDynamicValues(spec: HttpRequestSpec): HttpRequestSpec {
  return mapRequestText(spec, (text) => text.replace(DYNAMIC_RE, (_m, name: string) => dynamicValue(name)))
}

/** Every {{placeholder}} the request uses, for the variables row of the form. */
export function requestPlaceholders(spec: HttpRequestSpec): Placeholder[] {
  const texts: string[] = []
  mapRequestText(spec, (text) => {
    texts.push(text)
    return text
  })
  return placeholders(texts.join('\n'))
}
