import { describe, expect, it } from 'vitest'
import { buildFindScript, parseFindOutput, shellQuote } from './remoteSearch'

describe('shellQuote', () => {
  it('wraps in single quotes and escapes embedded quotes', () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`)
    expect(shellQuote('$(rm -rf /)')).toBe(`'$(rm -rf /)'`)
  })
})

describe('buildFindScript', () => {
  it('wraps plain queries in wildcards and quotes everything', () => {
    const script = buildFindScript('/var/www', 'nginx', 13)
    expect(script).toContain(`find '/var/www' -xdev -maxdepth 2 \\( -name 'node_modules' -o -name '.git'`)
    expect(script).toContain(`find '/var/www' -xdev -maxdepth 12 \\(`)
    expect(script).toContain(`-prune -o -iname '*nginx*'`)
    expect(script).toContain('( sleep 13; kill 0 )')
    expect(script).toContain('-exec printf "d %s\\n" {} \\;')
  })

  it('keeps explicit glob patterns', () => {
    expect(buildFindScript('/', '*.log', 10)).toContain(`-iname '*.log'`)
  })

  it('neutralises injection attempts', () => {
    const script = buildFindScript("/tmp/x'; reboot; '", "a'$(id)", 10)
    expect(script).toContain(`'/tmp/x'\\''; reboot; '\\'''`)
    expect(script).toContain(`'*a'\\''$(id)*'`)
  })

  it('refuses relative directories that find could parse as options', () => {
    expect(() => buildFindScript('-delete', 'x', 10)).toThrow(/absolute/)
    expect(() => buildFindScript('etc', 'x', 10)).toThrow(/absolute/)
  })

  it('rejects control characters', () => {
    expect(() => buildFindScript('/tmp', 'a\nb', 10)).toThrow()
  })
})

describe('parseFindOutput', () => {
  it('parses type markers and skips junk', () => {
    expect(parseFindOutput('d /srv/app\nf /srv/app/main.py\nnoise\nf /srv/with space.txt\nd /srv/app\n')).toEqual([
      { path: '/srv/app', name: 'app', isDir: true },
      { path: '/srv/app/main.py', name: 'main.py', isDir: false },
      { path: '/srv/with space.txt', name: 'with space.txt', isDir: false }
    ])
  })
})
