import { describe, expect, it } from 'vitest'
import {
  buildCurlCommand,
  emptyRequest,
  formatJson,
  isCurlCommand,
  looksLikeJson,
  parseCurlCommand,
  prettyBody,
  resolveRequestUrl,
  shellWords,
  type HttpRequestSpec
} from './httpRequest'

const BASE = 'https://api.example.com/v1'
const spec = (patch: Partial<HttpRequestSpec>): HttpRequestSpec => ({ ...emptyRequest(), ...patch })

describe('resolveRequestUrl', () => {
  it('appends paths to the base URL', () => {
    expect(resolveRequestUrl(BASE, '/users?limit=10')).toBe('https://api.example.com/v1/users?limit=10')
    expect(resolveRequestUrl(BASE, 'users')).toBe('https://api.example.com/v1/users')
    expect(resolveRequestUrl(BASE, '')).toBe('https://api.example.com/v1')
    expect(resolveRequestUrl(BASE, '?q=1')).toBe('https://api.example.com/v1?q=1')
  })

  it('expands $BASE_URL and ${BASE_URL}', () => {
    expect(resolveRequestUrl(BASE, '$BASE_URL/health')).toBe('https://api.example.com/v1/health')
    expect(resolveRequestUrl(BASE, '${BASE_URL}/health')).toBe('https://api.example.com/v1/health')
  })

  it('accepts absolute http(s) URLs and encodes spaces', () => {
    expect(resolveRequestUrl(BASE, 'http://other.local:8080/a b')).toBe('http://other.local:8080/a%20b')
  })

  it('rejects other schemes, credentials and control characters', () => {
    expect(resolveRequestUrl(BASE, 'file:///etc/passwd')).toBeNull()
    expect(resolveRequestUrl(BASE, 'gopher://x')).toBeNull()
    expect(resolveRequestUrl(BASE, 'https://user:pw@host/')).toBeNull()
    expect(resolveRequestUrl(BASE, '/a\nb')).toBeNull()
  })
})

describe('shellWords', () => {
  it('handles quotes, escapes, ANSI-C strings and line continuations', () => {
    expect(shellWords(`curl 'a b' "c \\"d\\" \\$e" f\\ g \\\n  $'h\\nI\\'s' ''`)).toEqual([
      'curl',
      'a b',
      'c "d" $e',
      'f g',
      "h\nI's",
      ''
    ])
  })

  it('reports an unterminated quote', () => {
    expect(shellWords(`curl 'oops`)).toBeNull()
  })
})

describe('parseCurlCommand', () => {
  it('reads a "Copy as cURL" command from browser dev tools', () => {
    const res = parseCurlCommand(
      `curl 'https://api.example.com/v1/users?limit=5' \\
  -H 'accept: application/json' \\
  -H 'content-type: application/json' \\
  --data-raw $'{"name":"O\\'Neil"}' \\
  --compressed`,
      BASE
    )
    expect(res?.spec).toEqual({
      method: 'POST',
      url: '/users?limit=5',
      headers: 'accept: application/json\ncontent-type: application/json',
      body: '{"name":"O\'Neil"}',
      followRedirects: false
    })
    expect(res?.warnings).toEqual([])
  })

  it('understands -X, -L, -I, -G, combined flags and $BASE_URL', () => {
    expect(parseCurlCommand('curl -sSL -XDELETE "$BASE_URL/users/7"', BASE)?.spec).toMatchObject({
      method: 'DELETE',
      url: '/users/7',
      followRedirects: true
    })
    expect(parseCurlCommand('curl -I https://x.test/', BASE)?.spec.method).toBe('HEAD')
    expect(parseCurlCommand('curl -G https://x.test/s -d q=a -d page=2', BASE)?.spec).toMatchObject({
      method: 'GET',
      url: 'https://x.test/s?q=a&page=2',
      body: ''
    })
  })

  it('turns --json, -u, -A, -e and -b into body and headers', () => {
    const res = parseCurlCommand(`curl --json '{"a":1}' -u bob:secret -A ua -e https://ref -b 'sid=1' https://x.test/`, BASE)
    expect(res?.spec.method).toBe('POST')
    expect(res?.spec.body).toBe('{"a":1}')
    expect(res?.spec.headers.split('\n')).toEqual([
      'Content-Type: application/json',
      'Accept: application/json',
      `Authorization: Basic ${Buffer.from('bob:secret').toString('base64')}`,
      'User-Agent: ua',
      'Referer: https://ref',
      'Cookie: sid=1'
    ])
  })

  it('joins several -d values with & and url-encodes --data-urlencode', () => {
    expect(parseCurlCommand(`curl https://x.test -d a=1 --data-urlencode 'q=hello world'`, BASE)?.spec.body).toBe('a=1&q=hello%20world')
  })

  it('warns about options it cannot carry over', () => {
    const res = parseCurlCommand('curl -k -F file=@a.txt -o out.json --max-time 5 https://x.test/', BASE)
    expect(res?.spec.url).toBe('https://x.test/')
    expect(res?.warnings).toEqual(['-F @file', '-o'])
    expect(res?.spec).toMatchObject({ insecure: true, timeoutSec: 5, bodyKind: 'multipart', method: 'POST' })
    // The path of a pasted command is not trusted: the file has to be picked in the form.
    expect(res?.spec.form).toEqual([{ name: 'file', value: '', enabled: true, file: true }])
  })

  it('rejects text that is not a curl command or has no URL', () => {
    expect(parseCurlCommand('wget https://x.test', BASE)).toBeNull()
    expect(parseCurlCommand('curl -s', BASE)).toBeNull()
    expect(parseCurlCommand(`curl 'unterminated`, BASE)).toBeNull()
  })

  it('recognises curl commands', () => {
    expect(isCurlCommand('  curl $BASE_URL/x')).toBe(true)
    expect(isCurlCommand('/usr/bin/curl -s x')).toBe(true)
    expect(isCurlCommand('curly')).toBe(false)
  })
})

describe('buildCurlCommand', () => {
  it('keeps $BASE_URL and $TOKEN for the shell and quotes everything else', () => {
    const cmd = buildCurlCommand(
      spec({ method: 'POST', url: '/users?a=1&b=2', headers: 'Authorization: Bearer $TOKEN\nX-Note: it\'s', body: '{"name":"x"}' })
    )
    expect(cmd).toBe(
      `curl -sS -X POST "$BASE_URL"'/users?a=1&b=2' -H 'Authorization: Bearer '"$TOKEN" -H 'X-Note: it'\\''s' -H 'Content-Type: application/json' --data-raw '{"name":"x"}'`
    )
  })

  it('omits -X for GET, uses -I for HEAD and adds -L when following redirects', () => {
    expect(buildCurlCommand(spec({ url: '/health' }))).toBe(`curl -sS "$BASE_URL"'/health'`)
    expect(buildCurlCommand(spec({ method: 'HEAD', url: '', followRedirects: true }))).toBe(`curl -sS -I -L "$BASE_URL"`)
    expect(buildCurlCommand(spec({ url: 'https://other.test/x' }))).toBe(`curl -sS 'https://other.test/x'`)
  })

  it('does not add a JSON content type when one is set or the body is not JSON', () => {
    expect(buildCurlCommand(spec({ method: 'PUT', url: '/x', headers: 'content-type: text/plain', body: '{}' }))).not.toContain(
      'application/json'
    )
    expect(buildCurlCommand(spec({ method: 'POST', url: '/x', body: 'a=1' }))).toBe(`curl -sS -X POST "$BASE_URL"'/x' --data-raw 'a=1'`)
  })

  it('turns off curl URL globbing for [] and {} in the address', () => {
    expect(buildCurlCommand(spec({ url: '/x?filter[status]=a' }))).toBe(`curl -sS -g "$BASE_URL"'/x?filter[status]=a'`)
  })

  it('round-trips through parseCurlCommand', () => {
    const original = spec({ method: 'PATCH', url: '/items/{{id}}', headers: 'X-Trace: 1', body: '{"done":true}', followRedirects: true })
    const parsed = parseCurlCommand(buildCurlCommand(original), BASE)?.spec
    expect(parsed).toEqual({ ...original, headers: 'X-Trace: 1\nContent-Type: application/json' })
  })
})

describe('formatJson', () => {
  it('keeps big integers and key order exactly as sent', () => {
    expect(formatJson('{"id":9007199254740993,"b":1,"2":2,"1":3}')).toBe(
      '{\n  "id": 9007199254740993,\n  "b": 1,\n  "2": 2,\n  "1": 3\n}'
    )
  })

  it('handles strings with braces, escaped quotes, empty containers and nesting', () => {
    expect(formatJson(' [ {"s":"a,{b}:\\"c\\"" , "e":{}, "f":[ ]}, 1.5e3 ] ')).toBe(
      '[\n  {\n    "s": "a,{b}:\\"c\\"",\n    "e": {},\n    "f": []\n  },\n  1.5e3\n]'
    )
  })

  it('returns null for anything that is not a JSON object or array', () => {
    expect(formatJson('42')).toBeNull()
    expect(formatJson('{oops')).toBeNull()
  })
})

describe('body helpers', () => {
  it('detects JSON bodies', () => {
    expect(looksLikeJson('{"a":1}')).toBe(true)
    expect(looksLikeJson(' [1,2] ')).toBe(true)
    expect(looksLikeJson('a=1')).toBe(false)
    expect(looksLikeJson('{oops')).toBe(false)
  })

  it('pretty-prints JSON objects and arrays whatever the content type, and leaves other text alone', () => {
    expect(prettyBody('{"a":[1,2]}')).toEqual({ text: '{\n  "a": [\n    1,\n    2\n  ]\n}', json: true })
    expect(prettyBody('{"a":1}')).toEqual({ text: '{\n  "a": 1\n}', json: true })
    expect(prettyBody('<b>hi</b>')).toEqual({ text: '<b>hi</b>', json: false })
    expect(prettyBody('{broken')).toEqual({ text: '{broken', json: false })
  })
})

describe('buildCurlCommand with the structured form', () => {
  const base = { method: 'POST' as const, url: '/x', headers: '', body: '', followRedirects: false }

  it('sends form fields urlencoded with their content type', () => {
    const cmd = buildCurlCommand({ ...base, bodyKind: 'form', form: [{ name: 'a b', value: 'c&d', enabled: true }, { name: 'off', value: '1', enabled: false }] })
    expect(cmd).toContain("--data-raw 'a%20b=c%26d'")
    expect(cmd).toContain("-H 'Content-Type: application/x-www-form-urlencoded'")
    expect(cmd).not.toContain('off')
  })

  it('never lets a multipart text value read a file, and quotes file paths', () => {
    const cmd = buildCurlCommand({ ...base, bodyKind: 'multipart', form: [{ name: 'note', value: '@/etc/passwd', enabled: true }, { name: 'up', value: '/tmp/a;b.png', enabled: true, file: true }] })
    expect(cmd).toContain("--form-string 'note=@/etc/passwd'")
    expect(cmd).toContain(`-F 'up=@"/tmp/a;b.png"'`)
    expect(cmd).not.toContain('Content-Type')
  })

  it('sends a file as the whole body', () => {
    expect(buildCurlCommand({ ...base, bodyKind: 'file', filePath: '/tmp/x.bin' })).toContain("--data-binary '@/tmp/x.bin'")
  })

  it('wraps a GraphQL query and its variables as JSON', () => {
    const cmd = buildCurlCommand({ ...base, bodyKind: 'graphql', body: '{ me { id } }', graphqlVariables: '{"a":1}' })
    expect(cmd).toContain(`--data-raw '{"query":"{ me { id } }","variables":{"a":1}}'`)
    expect(cmd).toContain("-H 'Content-Type: application/json'")
    expect(() => buildCurlCommand({ ...base, bodyKind: 'graphql', body: 'q', graphqlVariables: '{nope' })).toThrow('variables')
  })

  it('turns auth settings into a header, -u or a query parameter', () => {
    expect(buildCurlCommand({ ...base, auth: { type: 'bearer', token: '$TOKEN' } })).toContain(`-H 'Authorization: Bearer '"$TOKEN"`)
    expect(buildCurlCommand({ ...base, auth: { type: 'basic', username: 'ann', password: '$TOKEN' } })).toContain(`-u 'ann:'"$TOKEN"`)
    expect(buildCurlCommand({ ...base, auth: { type: 'apikey', name: 'X-Key', value: 'k', in: 'header' } })).toContain(`-H 'X-Key: k'`)
    expect(buildCurlCommand({ ...base, url: '/x?a=1', auth: { type: 'apikey', name: 'key', value: 'k k', in: 'query' } })).toContain("/x?a=1&key=k%20k'")
  })

  it('keeps a header typed by hand over the auth setting', () => {
    const cmd = buildCurlCommand({ ...base, headers: 'Authorization: Custom 1', auth: { type: 'bearer', token: 't' } })
    expect(cmd).toContain('Custom 1')
    expect(cmd).not.toContain('Bearer')
  })

  it('leaves switched-off headers out and passes -k and the timeout on', () => {
    const cmd = buildCurlCommand({ ...base, headers: '# X-Off: 1\nX-On: 2', insecure: true, timeoutSec: 9 })
    expect(cmd).not.toContain('X-Off')
    expect(cmd).toContain("-H 'X-On: 2'")
    expect(cmd).toContain('-k --max-time 9')
  })

  it('lets a chosen body kind outrank the environment default Content-Type, but not a guessed one', () => {
    const picked = buildCurlCommand({ ...base, bodyKind: 'json', body: '{}' }, ['Content-Type'])
    expect(picked).toContain("-H 'Content-Type: application/json'")
    const guessed = buildCurlCommand({ ...base, body: '{}' }, ['Content-Type'])
    expect(guessed).not.toContain('Content-Type')
  })
})

