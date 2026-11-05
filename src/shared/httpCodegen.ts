import { requestData, withAuthQuery } from './httpBody'
import { buildCurlCommand, effectiveHeaders, resolveRequestUrl, type HttpRequestSpec } from './httpRequest'
import { parseHeaders } from './httpEnv'

export const CODE_TARGETS = ['curl', 'fetch', 'python', 'httpie'] as const
export type CodeTarget = (typeof CODE_TARGETS)[number]

export const CODE_TARGET_LABELS: Record<CodeTarget, string> = {
  curl: 'cURL',
  fetch: 'JavaScript fetch',
  python: 'Python requests',
  httpie: 'HTTPie'
}

/** What the snippet needs from the HTTP environment; the token stays a reference, its value is never here. */
export interface CodeContext {
  baseUrl: string
  /** The environment's default headers, `Name: value` per line. */
  envHeaders: string
}

const TOKEN_RE = /\$\{TOKEN\}|\$TOKEN\b/g

function sq(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`
}

/** A JS string; `$TOKEN` becomes an environment lookup, so the snippet holds no secret. */
function jsString(text: string): string {
  if (!new RegExp(TOKEN_RE.source).test(text)) return JSON.stringify(text)
  const body = text.replace(/[\\`$]/g, '\\$&').replace(/\\\$\{TOKEN\}|\\\$TOKEN\b/g, '${process.env.TOKEN}')
  return `\`${body}\``
}

function pyString(text: string): string {
  if (!new RegExp(TOKEN_RE.source).test(text)) return JSON.stringify(text)
  const body = JSON.stringify(text).slice(1, -1).replace(/[{}]/g, '$&$&').replace(/\$\{\{TOKEN\}\}|\$TOKEN\b/g, `{os.environ['TOKEN']}`)
  return `f"${body}"`
}

function headersOf(spec: HttpRequestSpec, ctx: CodeContext): [string, string][] {
  const env = parseHeaders(ctx.envHeaders).headers
  const lines = effectiveHeaders(spec, env.map((h) => h.name))
  const own = parseHeaders(lines.join('\n')).headers
  const ownNames = new Set(own.map((h) => h.name.toLowerCase()))
  return [...env.filter((h) => !ownNames.has(h.name.toLowerCase())), ...own].map((h) => [h.name, h.value])
}

function fullUrl(spec: HttpRequestSpec, ctx: CodeContext): string {
  const url = withAuthQuery(spec.url.trim(), spec.auth)
  return resolveRequestUrl(ctx.baseUrl, url) ?? url
}

function fetchCode(spec: HttpRequestSpec, ctx: CodeContext): string {
  const headers = headersOf(spec, ctx)
  const data = requestData(spec)
  const lines: string[] = []
  if (data.kind === 'multipart') {
    lines.push('const form = new FormData()')
    for (const p of data.parts) {
      lines.push(p.file ? `form.append(${JSON.stringify(p.name)}, await openAsBlob(${JSON.stringify(p.value)}))` : `form.append(${JSON.stringify(p.name)}, ${JSON.stringify(p.value)})`)
    }
    lines.push('')
  }
  const opts = [`  method: ${JSON.stringify(spec.method)}`]
  if (headers.length > 0) opts.push(`  headers: {\n${headers.map(([n, v]) => `    ${JSON.stringify(n)}: ${jsString(v)}`).join(',\n')}\n  }`)
  if (data.kind === 'raw') opts.push(`  body: ${JSON.stringify(data.text)}`)
  if (data.kind === 'multipart') opts.push('  body: form')
  if (data.kind === 'file') opts.push(`  body: await openAsBlob(${JSON.stringify(data.path)})`)
  if (!spec.followRedirects) opts.push(`  redirect: 'manual'`)
  lines.push(`const response = await fetch(${JSON.stringify(fullUrl(spec, ctx))}, {\n${opts.join(',\n')}\n})`, 'console.log(response.status, await response.text())')
  if (data.kind === 'file' || (data.kind === 'multipart' && data.parts.some((p) => p.file))) lines.unshift(`import { openAsBlob } from 'node:fs'`, '')
  return lines.join('\n')
}

function pythonCode(spec: HttpRequestSpec, ctx: CodeContext): string {
  const headers = headersOf(spec, ctx)
  const data = requestData(spec)
  const usesToken = headers.some(([, v]) => new RegExp(TOKEN_RE.source).test(v))
  const lines = [usesToken ? 'import os\n' : '', 'import requests', '']
  const args = [JSON.stringify(spec.method), JSON.stringify(fullUrl(spec, ctx))]
  if (headers.length > 0) {
    lines.push(`headers = {\n${headers.map(([n, v]) => `    ${JSON.stringify(n)}: ${pyString(v)}`).join(',\n')}\n}`)
    args.push('headers=headers')
  }
  if (data.kind === 'raw') {
    lines.push(`data = ${JSON.stringify(data.text)}`)
    args.push('data=data.encode("utf-8")')
  }
  if (data.kind === 'file') args.push(`data=open(${JSON.stringify(data.path)}, "rb")`)
  if (data.kind === 'multipart') {
    const text = data.parts.filter((p) => !p.file)
    const files = data.parts.filter((p) => p.file)
    if (text.length > 0) args.push(`data={${text.map((p) => `${JSON.stringify(p.name)}: ${JSON.stringify(p.value)}`).join(', ')}}`)
    if (files.length > 0) args.push(`files={${files.map((p) => `${JSON.stringify(p.name)}: open(${JSON.stringify(p.value)}, "rb")`).join(', ')}}`)
  }
  args.push(`allow_redirects=${spec.followRedirects ? 'True' : 'False'}`)
  if (spec.insecure) args.push('verify=False')
  if (spec.timeoutSec) args.push(`timeout=${spec.timeoutSec}`)
  lines.push(`response = requests.request(${args.join(', ')})`, 'print(response.status_code, response.text)')
  return lines.filter((l, i) => l !== '' || i > 0).join('\n')
}

/** A word for the shell that leaves $TOKEN to the shell. */
function shellWord(text: string): string {
  return text
    .split(/(\$\{TOKEN\}|\$TOKEN\b)/)
    .map((part) => (part === '$TOKEN' || part === '${TOKEN}' ? '"$TOKEN"' : part ? sq(part) : ''))
    .join('')
}

function httpieCode(spec: HttpRequestSpec, ctx: CodeContext): string {
  const data = requestData(spec)
  const parts = ['http']
  if (spec.followRedirects) parts.push('--follow')
  if (spec.insecure) parts.push('--verify=no')
  if (spec.timeoutSec) parts.push(`--timeout=${spec.timeoutSec}`)
  if (data.kind === 'multipart') parts.push('--multipart')
  if (data.kind === 'raw') parts.push(`--raw ${sq(data.text)}`)
  parts.push(spec.method, sq(fullUrl(spec, ctx)))
  for (const [name, value] of headersOf(spec, ctx)) parts.push(shellWord(`${name}:${value}`))
  if (data.kind === 'file') parts.push(`@${sq(data.path)}`)
  if (data.kind === 'multipart') for (const p of data.parts) parts.push(sq(p.file ? `${p.name}@${p.value}` : `${p.name}=${p.value}`))
  return parts.join(' ')
}

/** A snippet that does the same request outside the app; variables must be filled in first. */
export function generateCode(target: CodeTarget, spec: HttpRequestSpec, ctx: CodeContext): string {
  switch (target) {
    case 'curl':
      return buildCurlCommand(spec, parseHeaders(ctx.envHeaders).headers.map((h) => h.name))
    case 'fetch':
      return fetchCode(spec, ctx)
    case 'python':
      return pythonCode(spec, ctx)
    case 'httpie':
      return httpieCode(spec, ctx)
  }
}


