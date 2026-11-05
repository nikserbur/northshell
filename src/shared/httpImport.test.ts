import { describe, expect, it } from 'vitest'
import { parseCollectionFile, toPostmanCollection } from './httpImport'
import type { SavedRequest } from './httpWorkspace'

const POSTMAN = {
  info: { name: 'Shop', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{tok}}' }] },
  variable: [{ key: 'host', value: 'https://api.shop' }],
  item: [
    {
      name: 'Orders',
      item: [
        {
          name: 'List',
          request: {
            method: 'GET',
            url: { raw: '{{host}}/orders?limit=5', query: [{ key: 'limit', value: '5' }, { key: 'off', value: '1', disabled: true }] },
            header: [{ key: 'X-A', value: '1' }, { key: 'X-Off', value: '2', disabled: true }]
          }
        },
        {
          name: 'Create',
          request: {
            method: 'POST',
            url: '{{host}}/orders',
            auth: { type: 'basic', basic: [{ key: 'username', value: 'ann' }, { key: 'password', value: 'pw' }] },
            body: { mode: 'raw', raw: '{"id":"{{$guid}}"}', options: { raw: { language: 'json' } } }
          }
        }
      ]
    },
    {
      name: 'Upload',
      request: {
        method: 'POST',
        url: '/up',
        auth: { type: 'noauth' },
        body: { mode: 'formdata', formdata: [{ key: 'note', value: 'hi', type: 'text' }, { key: 'file', type: 'file', src: '/Users/x/.ssh/id_rsa' }] }
      }
    },
    { name: 'Form', request: { method: 'PATCH', url: '/f', body: { mode: 'urlencoded', urlencoded: [{ key: 'a', value: 'b' }] } } },
    { name: 'Graph', request: { method: 'POST', url: '/g', body: { mode: 'graphql', graphql: { query: '{ me }', variables: '{"a":1}' } } } }
  ]
}

const INSOMNIA = {
  _type: 'export',
  __export_format: 4,
  resources: [
    { _id: 'wrk', _type: 'workspace', name: 'Team API' },
    { _id: 'fld', _type: 'request_group', parentId: 'wrk', name: 'Users' },
    { _id: 'env', _type: 'environment', parentId: 'wrk', data: { base: 'https://x.test', n: 5, skip: {} } },
    {
      _id: 'r1',
      _type: 'request',
      parentId: 'fld',
      name: 'Get user',
      method: 'get',
      url: '{{ _.base }}/users',
      parameters: [{ name: 'a', value: '1' }, { name: 'b', value: '2', disabled: true }],
      headers: [{ name: 'Accept', value: '*/*' }],
      authentication: { type: 'apikey', key: 'k', value: 'v', addTo: 'queryParams' },
      body: {}
    },
    { _id: 'r2', _type: 'request', parentId: 'wrk', name: 'Make', method: 'POST', url: '/m', body: { mimeType: 'application/xml', text: '<a/>' }, authentication: { type: 'bearer', token: 't', disabled: true } },
    { _id: 'r3', _type: 'request', parentId: 'wrk', name: 'Q', method: 'POST', url: '/q', body: { mimeType: 'application/graphql', text: '{"query":"{ a }","variables":{"x":1}}' } }
  ]
}

describe('parseCollectionFile: Postman', () => {
  const parsed = parseCollectionFile(JSON.stringify(POSTMAN))
  const byName = (name: string) => parsed.requests.find((r) => r.name === name)

  it('keeps folders and variables', () => {
    expect(parsed.name).toBe('Shop')
    expect(parsed.variables).toEqual({ host: 'https://api.shop' })
    expect(byName('List')?.folder).toBe('Shop / Orders')
    expect(byName('Upload')?.folder).toBe('Shop')
  })

  it('reads URLs, headers and switched-off rows', () => {
    expect(byName('List')?.spec).toMatchObject({ method: 'GET', url: '{{host}}/orders?limit=5', headers: 'X-A: 1\n# X-Off: 2', disabledParams: [{ name: 'off', value: '1' }] })
  })

  it('applies the collection auth unless the request has its own', () => {
    expect(byName('List')?.spec.auth).toEqual({ type: 'bearer', token: '{{tok}}' })
    expect(byName('Create')?.spec.auth).toEqual({ type: 'basic', username: 'ann', password: 'pw' })
    expect(byName('Upload')?.spec.auth).toBeUndefined()
  })

  it('maps every body kind and dynamic variables', () => {
    expect(byName('Create')?.spec).toMatchObject({ bodyKind: 'json', body: '{"id":"{{$uuid}}"}' })
    expect(byName('Form')?.spec).toMatchObject({ bodyKind: 'form', form: [{ name: 'a', value: 'b', enabled: true }] })
    expect(byName('Graph')?.spec).toMatchObject({ bodyKind: 'graphql', body: '{ me }', graphqlVariables: '{"a":1}' })
  })

  it('never takes a local file path from a collection file', () => {
    expect(byName('Upload')?.spec.form).toEqual([
      { name: 'note', value: 'hi', enabled: true },
      { name: 'file', value: '', enabled: true, file: true }
    ])
    expect(JSON.stringify(parsed)).not.toContain('id_rsa')
  })
})

describe('parseCollectionFile: Insomnia', () => {
  const parsed = parseCollectionFile(JSON.stringify(INSOMNIA))
  const byName = (name: string) => parsed.requests.find((r) => r.name === name)

  it('reads folders, environment data and Insomnia variables', () => {
    expect(parsed.name).toBe('Team API')
    expect(parsed.variables).toEqual({ base: 'https://x.test', n: '5' })
    expect(byName('Get user')?.folder).toBe('Team API / Users')
    expect(byName('Make')?.folder).toBe('Team API')
  })

  it('merges query parameters into the URL and keeps the rest', () => {
    expect(byName('Get user')?.spec).toMatchObject({
      method: 'GET',
      url: '{{base}}/users?a=1',
      disabledParams: [{ name: 'b', value: '2' }],
      auth: { type: 'apikey', name: 'k', value: 'v', in: 'query' }
    })
  })

  it('maps bodies and ignores disabled auth', () => {
    expect(byName('Make')?.spec).toMatchObject({ bodyKind: 'xml', body: '<a/>' })
    expect(byName('Make')?.spec.auth).toBeUndefined()
    expect(byName('Q')?.spec).toMatchObject({ bodyKind: 'graphql', body: '{ a }', graphqlVariables: '{"x":1}' })
  })
})

describe('parseCollectionFile: other files', () => {
  it('explains what is wrong', () => {
    expect(() => parseCollectionFile('nope')).toThrow('not JSON')
    expect(() => parseCollectionFile('{"a":1}')).toThrow('neither')
  })
})

describe('toPostmanCollection', () => {
  const saved = (over: Partial<SavedRequest>): SavedRequest => ({
    id: '1',
    name: 'R',
    folder: '',
    updatedAt: 0,
    spec: { method: 'GET', url: '/x', headers: '', body: '', followRedirects: false },
    ...over
  })

  it('survives a round trip through the importer', () => {
    const requests = [
      saved({ name: 'A', folder: 'Top / Inner', spec: { method: 'POST', url: '/a', headers: 'X: 1\n# Y: 2', body: '{"a":1}', followRedirects: false, bodyKind: 'json', auth: { type: 'bearer', token: '$TOKEN' } } }),
      saved({ name: 'B', spec: { method: 'PUT', url: 'https://other/b', headers: '', body: '', followRedirects: false, bodyKind: 'form', form: [{ name: 'k', value: 'v', enabled: true }] } })
    ]
    const back = parseCollectionFile(toPostmanCollection('Mine', requests, { v: '1' }, 'https://api.test'))
    expect(back.name).toBe('Mine')
    expect(back.variables).toEqual({ baseUrl: 'https://api.test', v: '1' })
    const a = back.requests.find((r) => r.name === 'A')
    expect(a?.folder).toBe('Mine / Top / Inner')
    expect(a?.spec).toMatchObject({ method: 'POST', url: '{{baseUrl}}/a', headers: 'X: 1\n# Y: 2', bodyKind: 'json', body: '{"a":1}', auth: { type: 'bearer', token: '$TOKEN' } })
    expect(back.requests.find((r) => r.name === 'B')?.spec).toMatchObject({ url: 'https://other/b', bodyKind: 'form' })
  })
})
