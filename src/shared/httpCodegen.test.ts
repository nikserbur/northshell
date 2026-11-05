import { describe, expect, it } from 'vitest'
import { generateCode } from './httpCodegen'
import type { HttpRequestSpec } from './httpRequest'

const ctx = { baseUrl: 'https://api.test/v1', envHeaders: 'Accept: application/json\nAuthorization: Bearer $TOKEN' }
const spec = (over: Partial<HttpRequestSpec> = {}): HttpRequestSpec => ({ method: 'POST', url: '/u?a=1', headers: 'X-A: 1', body: '{"n":1}', followRedirects: true, bodyKind: 'json', ...over })

describe('generateCode', () => {
  it('uses the full URL and the environment headers, and never a token value', () => {
    for (const target of ['fetch', 'python', 'httpie'] as const) {
      const code = generateCode(target, spec(), ctx)
      expect(code, target).toContain('https://api.test/v1/u?a=1')
      expect(code, target).toContain('X-A')
      expect(code, target).toContain('Accept')
    }
  })

  it('reads the token from the environment of the snippet', () => {
    expect(generateCode('fetch', spec(), ctx)).toContain('`Bearer ${process.env.TOKEN}`')
    const py = generateCode('python', spec(), ctx)
    expect(py).toContain('import os')
    expect(py).toContain(`f"Bearer {os.environ['TOKEN']}"`)
    expect(generateCode('httpie', spec(), ctx)).toContain(`'Authorization:Bearer '"$TOKEN"`)
  })

  it('reads a token in the URL from the environment too', () => {
    const inQuery = spec({ url: '/u', auth: { type: 'apikey', name: 'key', value: '$TOKEN', in: 'query' } })
    const noEnv = { ...ctx, envHeaders: '' }
    expect(generateCode('fetch', inQuery, noEnv)).toContain('fetch(`https://api.test/v1/u?key=${process.env.TOKEN}`')
    const py = generateCode('python', inQuery, noEnv)
    expect(py).toContain('import os')
    expect(py).toContain(`f"https://api.test/v1/u?key={os.environ['TOKEN']}"`)
    expect(generateCode('httpie', inQuery, noEnv)).toContain(`'https://api.test/v1/u?key='"$TOKEN"`)
  })

  it('writes valid fetch and python structure', () => {
    const js = generateCode('fetch', spec({ followRedirects: false }), { ...ctx, envHeaders: '' })
    expect(js).toContain(`method: "POST"`)
    expect(js).toContain(`body: "{\\"n\\":1}"`)
    expect(js).toContain(`redirect: 'manual'`)
    const py = generateCode('python', spec({ insecure: true, timeoutSec: 5 }), { ...ctx, envHeaders: '' })
    expect(py).toContain('allow_redirects=True')
    expect(py).toContain('verify=False')
    expect(py).toContain('timeout=5')
    expect(py).not.toContain('import os')
  })

  it('handles multipart and file bodies', () => {
    const form = spec({ bodyKind: 'multipart', form: [{ name: 'a', value: 'b', enabled: true }, { name: 'f', value: '/tmp/x', enabled: true, file: true }] })
    expect(generateCode('python', form, ctx)).toContain(`files={"f": open("/tmp/x", "rb")}`)
    expect(generateCode('httpie', form, ctx)).toContain(`--multipart`)
    expect(generateCode('httpie', form, ctx)).toContain(`'f@/tmp/x'`)
    expect(generateCode('fetch', form, ctx)).toContain('form.append("a", "b")')
    expect(generateCode('python', spec({ bodyKind: 'file', filePath: '/tmp/y' }), ctx)).toContain(`data=open("/tmp/y", "rb")`)
  })

  it('reuses the curl builder', () => {
    expect(generateCode('curl', spec(), ctx)).toMatch(/^curl -sS -X POST -L/)
  })
})
