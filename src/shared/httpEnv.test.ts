import { describe, expect, it } from 'vitest'
import { buildCurlrc, endpointOf, expandToken, normalizeBaseUrl, parseHeaders, usesToken } from './httpEnv'

describe('parseHeaders', () => {
  it('parses Name: value lines and skips blanks and comments', () => {
    const { headers, invalid } = parseHeaders('Accept: application/json\n\n# note\r\nAuthorization:Bearer $TOKEN  \nX-Empty:')
    expect(invalid).toEqual([])
    expect(headers).toEqual([
      { name: 'Accept', value: 'application/json' },
      { name: 'Authorization', value: 'Bearer $TOKEN' },
      { name: 'X-Empty', value: '' }
    ])
  })

  it('reports malformed lines by 1-based number', () => {
    expect(parseHeaders('Good: 1\nno colon here\n: missing name\nBad Name: x').invalid).toEqual([2, 3, 4])
  })

  it('rejects control characters in values', () => {
    expect(parseHeaders('X-A: a\u0007b').invalid).toEqual([1])
  })
})

describe('normalizeBaseUrl', () => {
  it('accepts http(s) and strips the trailing slash', () => {
    expect(normalizeBaseUrl(' https://api.example.com/v1/ ')).toBe('https://api.example.com/v1')
    expect(normalizeBaseUrl('http://10.0.0.5:8080')).toBe('http://10.0.0.5:8080')
  })

  it('rejects other schemes and garbage', () => {
    expect(normalizeBaseUrl('ftp://x.org')).toBeNull()
    expect(normalizeBaseUrl('file:///etc/passwd')).toBeNull()
    expect(normalizeBaseUrl('api.example.com')).toBeNull()
    expect(normalizeBaseUrl('')).toBeNull()
    expect(normalizeBaseUrl('https://user:pass@api.example.com')).toBeNull()
  })
})

describe('endpointOf', () => {
  it('derives host and default ports', () => {
    expect(endpointOf('https://api.example.com/v1')).toEqual({ host: 'api.example.com', port: 443 })
    expect(endpointOf('http://localhost')).toEqual({ host: 'localhost', port: 80 })
    expect(endpointOf('http://localhost:3000')).toEqual({ host: 'localhost', port: 3000 })
    expect(endpointOf('nope')).toBeNull()
  })
})

describe('token expansion', () => {
  it('detects and replaces $TOKEN and ${TOKEN}', () => {
    expect(usesToken('Bearer $TOKEN')).toBe(true)
    expect(usesToken('X $TOKENS')).toBe(false)
    expect(expandToken('Bearer $TOKEN / ${TOKEN}', 'abc')).toBe('Bearer abc / abc')
  })

  it('returns null when the token is needed but missing', () => {
    expect(expandToken('Bearer $TOKEN', undefined)).toBeNull()
    expect(expandToken('application/json', undefined)).toBe('application/json')
  })

  it('does not treat $ patterns in the token as replacement syntax', () => {
    expect(expandToken('Bearer $TOKEN', 'a$&b')).toBe('Bearer a$&b')
  })
})

describe('buildCurlrc', () => {
  it('writes quoted headers, escapes quotes and backslashes, and keeps the user config', () => {
    const { text, skipped } = buildCurlrc({
      headers: [
        { name: 'Authorization', value: 'Bearer $TOKEN' },
        { name: 'X-Json', value: '{"a":"b\\c"}' }
      ],
      token: 'secret',
      insecure: true,
      userConfig: 'silent\n'
    })
    expect(skipped).toEqual([])
    expect(text).toContain('silent')
    expect(text).toContain('header = "Authorization: Bearer secret"')
    expect(text).toContain('header = "X-Json: {\\"a\\":\\"b\\\\c\\"}"')
    expect(text.trimEnd().endsWith('insecure')).toBe(true)
  })

  it('leaves out headers whose token is missing', () => {
    const { text, skipped } = buildCurlrc({
      headers: [
        { name: 'Accept', value: 'application/json' },
        { name: 'Authorization', value: 'Bearer $TOKEN' }
      ],
      insecure: false
    })
    expect(skipped).toEqual(['Authorization'])
    expect(text).toContain('header = "Accept: application/json"')
    expect(text).not.toContain('Authorization')
    expect(text).not.toContain('insecure')
  })
})
