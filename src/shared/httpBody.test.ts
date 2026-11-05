import { describe, expect, it } from 'vitest'
import { bodyKindOf, headerRowsText, parseHeaderRows, parseQuery, requestData, withAuthQuery, withQuery } from './httpBody'
import type { HttpRequestSpec } from './httpRequest'

const spec = (over: Partial<HttpRequestSpec>): HttpRequestSpec => ({ method: 'POST', url: '/', headers: '', body: '', followRedirects: false, ...over })

describe('query table', () => {
  it('splits and joins a URL without re-encoding what was typed', () => {
    const parsed = parseQuery('/users?q=a%20b&id={{id}}&flag#top')
    expect(parsed).toEqual({
      base: '/users',
      hash: '#top',
      params: [
        { name: 'q', value: 'a%20b' },
        { name: 'id', value: '{{id}}' },
        { name: 'flag', value: '' }
      ]
    })
    expect(withQuery(parsed.base, parsed.params, parsed.hash)).toBe('/users?q=a%20b&id={{id}}&flag#top')
  })

  it('drops the question mark with the last parameter', () => {
    expect(withQuery('/x', [{ name: '', value: '' }])).toBe('/x')
  })

  it('adds an API key to the query, encoded', () => {
    expect(withAuthQuery('/x#h', { type: 'apikey', name: 'api key', value: 'a/b', in: 'query' })).toBe('/x?api%20key=a%2Fb#h')
    expect(withAuthQuery('/x', { type: 'bearer', token: 't' })).toBe('/x')
    expect(withAuthQuery('/x', { type: 'apikey', name: 'k', value: 'a b$TOKEN', in: 'query' })).toBe('/x?k=a%20b$TOKEN')
  })
})

describe('header table', () => {
  it('reads switched-off headers from # lines and writes them back', () => {
    const rows = parseHeaderRows('X-A: 1\n# X-B: 2\n\nBroken')
    expect(rows).toEqual([
      { name: 'X-A', value: '1', enabled: true },
      { name: 'X-B', value: '2', enabled: false },
      { name: 'Broken', value: '', enabled: true }
    ])
    expect(headerRowsText(rows.slice(0, 2))).toBe('X-A: 1\n# X-B: 2')
  })
})

describe('body kinds', () => {
  it('infers the kind of requests saved before kinds existed', () => {
    expect(bodyKindOf(spec({}))).toBe('none')
    expect(bodyKindOf(spec({ body: '{"a":1}' }))).toBe('json')
    expect(bodyKindOf(spec({ body: 'plain' }))).toBe('text')
    expect(bodyKindOf(spec({ method: 'HEAD', body: 'x', bodyKind: 'json' }))).toBe('none')
  })

  it('has no body when a form has no usable rows', () => {
    expect(requestData(spec({ bodyKind: 'form', form: [{ name: 'a', value: '1', enabled: false }] }))).toEqual({ kind: 'none' })
    expect(requestData(spec({ bodyKind: 'multipart', form: [{ name: 'f', value: '', enabled: true, file: true }] }))).toEqual({ kind: 'none' })
    expect(requestData(spec({ bodyKind: 'file' }))).toEqual({ kind: 'none' })
  })
})
