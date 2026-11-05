import { describe, expect, it } from 'vitest'
import type { HttpResponseInfo } from './httpRequest'
import { extractVariables, jsonPath, runTests, type TestRule } from './httpTests'
import { fillRequest, requestPlaceholders, withDynamicValues } from './httpVars'

const response = (over: Partial<HttpResponseInfo> = {}): HttpResponseInfo => ({
  status: 201,
  statusText: 'Created',
  httpVersion: '1.1',
  headers: [{ name: 'X-Request-Id', value: 'abc' }],
  body: JSON.stringify({ data: [{ id: 7, name: 'Ann' }], token: 'tk', 'odd.key': 1 }),
  bodyBytes: 60,
  truncated: false,
  binary: false,
  contentType: 'application/json',
  timeMs: 120,
  url: 'http://x/',
  redirects: 0,
  ...over
})

const rule = (over: Partial<TestRule>): TestRule => ({ target: 'status', path: '', op: 'eq', value: '', enabled: true, ...over })

describe('jsonPath', () => {
  const doc = { data: [{ id: 7 }], 'odd.key': 1 }
  it('follows dots, indexes and bracketed keys, with or without $', () => {
    expect(jsonPath(doc, '$.data[0].id')).toBe(7)
    expect(jsonPath(doc, 'data[0].id')).toBe(7)
    expect(jsonPath(doc, `$['odd.key']`)).toBe(1)
  })
  it('returns undefined when the path leads nowhere', () => {
    expect(jsonPath(doc, 'data[5].id')).toBeUndefined()
    expect(jsonPath(doc, 'data[0].id.more')).toBeUndefined()
    expect(jsonPath(undefined, 'a')).toBeUndefined()
  })
})

describe('runTests', () => {
  it('checks status, time, size, headers, JSON values and the body', () => {
    const results = runTests(
      [
        rule({ value: '201' }),
        rule({ target: 'time', op: 'lt', value: '500' }),
        rule({ target: 'size', op: 'gt', value: '10' }),
        rule({ target: 'header', path: 'x-request-id', value: 'abc' }),
        rule({ target: 'json', path: '$.data[0].name', op: 'contains', value: 'An' }),
        rule({ target: 'body', op: 'matches', value: 'token.*tk' }),
        rule({ target: 'json', path: 'token', op: 'exists' })
      ],
      response()
    )
    expect(results.map((r) => r.pass)).toEqual([true, true, true, true, true, true, true])
  })

  it('reports what the response really had when a check fails', () => {
    const [r] = runTests([rule({ value: '200' })], response())
    expect(r).toMatchObject({ pass: false, actual: '201' })
  })

  it('treats a missing value and a bad pattern as failures', () => {
    const results = runTests(
      [rule({ target: 'json', path: 'nope', op: 'exists' }), rule({ target: 'json', path: 'nope', value: '1' }), rule({ target: 'body', op: 'matches', value: '(' })],
      response()
    )
    expect(results.map((r) => r.pass)).toEqual([false, false, false])
    expect(runTests([rule({ target: 'json', path: 'nope', op: 'ne', value: '1' })], response())[0].pass).toBe(true)
  })

  it('skips rules that are off and survives a body that is not JSON', () => {
    expect(runTests([rule({ enabled: false })], response())).toEqual([])
    expect(runTests([rule({ target: 'json', path: 'a', op: 'exists' })], response({ body: '<html>' }))[0].pass).toBe(false)
  })
})

describe('extractVariables', () => {
  it('captures JSON values and headers; objects become JSON text', () => {
    const vars = extractVariables(
      [
        { source: 'json', path: 'token', variable: 'authToken', enabled: true },
        { source: 'json', path: 'data[0]', variable: 'first', enabled: true },
        { source: 'header', path: 'X-Request-Id', variable: 'rid', enabled: true },
        { source: 'json', path: 'nope', variable: 'missing', enabled: true },
        { source: 'json', path: 'token', variable: 'off', enabled: false }
      ],
      response()
    )
    expect(vars).toEqual({ authToken: 'tk', first: '{"id":7,"name":"Ann"}', rid: 'abc' })
  })
})

describe('request variables', () => {
  const spec = {
    method: 'POST' as const,
    url: '/u/{{id}}',
    headers: 'X-A: {{a}}',
    body: '{{b:def}}',
    followRedirects: false,
    bodyKind: 'form' as const,
    form: [{ name: 'f', value: '{{c}}', enabled: true }],
    auth: { type: 'bearer' as const, token: '{{tok}}' }
  }

  it('finds placeholders in every field', () => {
    expect(requestPlaceholders(spec).map((p) => p.name)).toEqual(['id', 'a', 'b', 'c', 'tok'])
  })

  it('fills every field, defaults included', () => {
    const filled = fillRequest(spec, { id: '1', a: '2', c: '3', tok: '4' })
    expect(filled).toMatchObject({ url: '/u/1', headers: 'X-A: 2', body: 'def', form: [{ value: '3' }], auth: { token: '4' } })
  })

  it('makes a new dynamic value for every send and leaves them alone until then', () => {
    const dynamic = { ...spec, url: '/{{$uuid}}/{{$timestamp}}/{{ $randomInt }}/{{$isoTimestamp}}' }
    expect(fillRequest(dynamic, {}).url).toBe(dynamic.url)
    const first = withDynamicValues(dynamic).url
    expect(first).toMatch(/^\/[0-9a-f-]{36}\/\d+\/\d+\/\d{4}-\d{2}-\d{2}T/)
    expect(withDynamicValues(dynamic).url).not.toBe(first)
  })
})
