import { describe, expect, it } from 'vitest'
import { commandText, fillPlaceholders, groupSnippets, placeholders, splitPlaceholders } from './snippets'
import type { CommandSnippet } from './types'

describe('placeholders', () => {
  it('lists unique placeholders in order with their defaults', () => {
    expect(placeholders('curl $BASE_URL/users/{{id}}?limit={{ limit:20 }}&from={{id}}')).toEqual([
      { name: 'id', fallback: '' },
      { name: 'limit', fallback: '20' }
    ])
  })

  it('ignores shell syntax that only looks similar', () => {
    expect(placeholders('echo ${HOME} {{}} {{1abc}} {not}')).toEqual([])
  })

  it('accepts names in any script', () => {
    expect(placeholders('ping {{хост}} -c {{число:3}}')).toEqual([
      { name: 'хост', fallback: '' },
      { name: 'число', fallback: '3' }
    ])
  })

  it('treats \\{{ as literal braces (Go templates)', () => {
    const cmd = "kubectl get po -o go-template='\\{{range .items}}\\{{.metadata.name}}\\{{end}}' -n {{ns}}"
    expect(placeholders(cmd)).toEqual([{ name: 'ns', fallback: '' }])
    expect(fillPlaceholders(cmd, { ns: 'prod' })).toBe("kubectl get po -o go-template='{{range .items}}{{.metadata.name}}{{end}}' -n prod")
    expect(splitPlaceholders('\\{{end}} {{x}}').filter((p) => p.placeholder).map((p) => p.text)).toEqual(['{{x}}'])
  })

  it('keeps defaults that contain colons and slashes', () => {
    expect(placeholders('open {{url:http://localhost:8080/x}}')).toEqual([{ name: 'url', fallback: 'http://localhost:8080/x' }])
  })
})

describe('fillPlaceholders', () => {
  it('substitutes values and falls back to defaults', () => {
    expect(fillPlaceholders('get /u/{{id}}?n={{n:5}}', { id: '42' })).toBe('get /u/42?n=5')
  })

  it('replaces every occurrence of a name', () => {
    expect(fillPlaceholders('{{a}}-{{a}}', { a: 'x' })).toBe('x-x')
  })

  it('leaves a missing value without default empty', () => {
    expect(fillPlaceholders('rm {{file}}', {})).toBe('rm ')
  })
})

describe('splitPlaceholders', () => {
  it('splits text around placeholders', () => {
    expect(splitPlaceholders('a {{b}} c')).toEqual([
      { text: 'a ', placeholder: false },
      { text: '{{b}}', placeholder: true },
      { text: ' c', placeholder: false }
    ])
  })
})

describe('commandText', () => {
  it('drops trailing newlines so inserted commands do not run', () => {
    expect(commandText('ls -la\n\n  ')).toBe('ls -la')
    expect(commandText('  echo hi')).toBe('  echo hi')
  })

  it('drops control characters that could end a bracketed paste early', () => {
    expect(commandText('ls\x1b[201~ evil\x07\x00')).toBe('ls[201~ evil')
    expect(commandText('a\tb\r\nc')).toBe('a\tb\r\nc')
  })
})

describe('groupSnippets', () => {
  const c = (id: string, name: string, scope: Partial<CommandSnippet> = {}): CommandSnippet => ({ id, name, command: name, ...scope })
  const list = [
    c('1', 'zeta'),
    c('2', 'alpha'),
    c('3', 'logs', { sessionId: 'web' }),
    c('4', 'health', { sessionId: 'api' }),
    c('5', 'old', { sessionName: 'gone' }),
    c('6', 'orphan', { sessionId: 'deleted' })
  ]
  const names = new Map([
    ['web', 'Web'],
    ['api', 'API']
  ])

  it('separates the active connection, shared commands and the rest', () => {
    const g = groupSnippets(list, 'web', names)
    expect(g.own.map((x) => x.id)).toEqual(['3'])
    expect(g.shared.map((x) => x.name)).toEqual(['alpha', 'zeta'])
    expect(g.others).toEqual([
      ['', [list[5]]],
      ['API', [list[3]]],
      ['gone', [list[4]]]
    ])
  })

  it('puts every scoped command into others when no connection is active', () => {
    const g = groupSnippets(list, undefined, names)
    expect(g.own).toEqual([])
    expect(g.others.map(([label]) => label)).toEqual(['', 'API', 'gone', 'Web'])
  })
})
