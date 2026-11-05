import type { HttpResponseInfo } from './httpRequest'

/** Checks and variable capture without running code: Postman's scripts cover the same needs with a sandbox. */
export const TEST_TARGETS = ['status', 'time', 'size', 'header', 'json', 'body'] as const
export type TestTarget = (typeof TEST_TARGETS)[number]

export const TEST_OPS = ['eq', 'ne', 'gt', 'lt', 'contains', 'exists', 'matches'] as const
export type TestOp = (typeof TEST_OPS)[number]

export interface TestRule {
  target: TestTarget
  /** Header name or JSON path; ignored for the other targets. */
  path: string
  op: TestOp
  value: string
  enabled: boolean
}

/** After a response: copy a value into an environment variable, so the next request can use it as {{name}}. */
export interface ExtractRule {
  source: 'json' | 'header'
  path: string
  variable: string
  enabled: boolean
}

export interface TestResult {
  rule: TestRule
  pass: boolean
  /** What the response really had; empty if the value is not there. */
  actual: string
}

const SEGMENT_RE = /[^.[\]]+|\[(\d+)\]|\[["']([^"']+)["']\]/g

/** `$.data[0].id` or `data[0].id`. Undefined when the path leads nowhere. */
export function jsonPath(value: unknown, path: string): unknown {
  let current = value
  const clean = path.trim().replace(/^\$\.?/, '')
  for (const m of clean.matchAll(SEGMENT_RE)) {
    if (current === null || typeof current !== 'object') return undefined
    const key = m[1] ?? m[2] ?? m[0]
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

function parsedBody(response: HttpResponseInfo): unknown {
  try {
    return JSON.parse(response.body)
  } catch {
    return undefined
  }
}

function asText(value: unknown): string {
  if (value === undefined) return ''
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function headerValue(response: HttpResponseInfo, name: string): string | undefined {
  return response.headers.find((h) => h.name.toLowerCase() === name.trim().toLowerCase())?.value
}

function targetValue(rule: TestRule, response: HttpResponseInfo, json: unknown): unknown {
  switch (rule.target) {
    case 'status':
      return response.status
    case 'time':
      return response.timeMs
    case 'size':
      return response.bodyBytes
    case 'header':
      return headerValue(response, rule.path)
    case 'json':
      return jsonPath(json, rule.path)
    case 'body':
      return response.body
  }
}

function compare(actual: unknown, op: TestOp, expected: string): boolean {
  if (op === 'exists') return actual !== undefined && actual !== null
  if (actual === undefined) return op === 'ne'
  const text = asText(actual)
  switch (op) {
    case 'eq':
      return text === expected
    case 'ne':
      return text !== expected
    case 'gt':
      return Number(text) > Number(expected)
    case 'lt':
      return Number(text) < Number(expected)
    case 'contains':
      return text.includes(expected)
    case 'matches':
      try {
        return new RegExp(expected).test(text)
      } catch {
        return false
      }
  }
}

export function runTests(rules: TestRule[] | undefined, response: HttpResponseInfo): TestResult[] {
  const active = (rules ?? []).filter((r) => r.enabled)
  if (active.length === 0) return []
  const json = parsedBody(response)
  return active.map((rule) => {
    const actual = targetValue(rule, response, json)
    return { rule, pass: compare(actual, rule.op, rule.value), actual: asText(actual) }
  })
}

/** Values the rules found; a rule whose value is missing changes nothing. */
export function extractVariables(rules: ExtractRule[] | undefined, response: HttpResponseInfo): Record<string, string> {
  const active = (rules ?? []).filter((r) => r.enabled && r.variable.trim())
  if (active.length === 0) return {}
  const json = parsedBody(response)
  const out: Record<string, string> = {}
  for (const rule of active) {
    const value = rule.source === 'json' ? jsonPath(json, rule.path) : headerValue(response, rule.path)
    if (value !== undefined && value !== null) out[rule.variable.trim()] = asText(value)
  }
  return out
}
