import { describe, expect, it } from 'vitest'
import { parseQuickConnect } from './quickConnect'

describe('parseQuickConnect', () => {
  it('parses user@host', () => {
    expect(parseQuickConnect('root@10.0.0.5', 'me')).toEqual({ host: '10.0.0.5', port: 22, username: 'root' })
  })

  it('parses user@host:port', () => {
    expect(parseQuickConnect('deploy@example.com:2222', '')).toEqual({ host: 'example.com', port: 2222, username: 'deploy' })
  })

  it('uses the default username when none is given', () => {
    expect(parseQuickConnect('example.com', 'admin')).toEqual({ host: 'example.com', port: 22, username: 'admin' })
  })

  it('accepts an ssh command line with -p and -l', () => {
    expect(parseQuickConnect('ssh -p 2200 -l bob host.local', '')).toEqual({ host: 'host.local', port: 2200, username: 'bob' })
  })

  it('accepts ssh user@host -p port', () => {
    expect(parseQuickConnect('ssh alice@srv -p 2022', '')).toEqual({ host: 'srv', port: 2022, username: 'alice' })
  })

  it('parses bracketed IPv6 with port', () => {
    expect(parseQuickConnect('u@[::1]:2201', '')).toEqual({ host: '::1', port: 2201, username: 'u' })
  })

  it('treats bare IPv6 as host without port', () => {
    expect(parseQuickConnect('u@fe80::1', '')).toEqual({ host: 'fe80::1', port: 22, username: 'u' })
  })

  it('returns null for empty or invalid input', () => {
    expect(parseQuickConnect('   ', 'x')).toBeNull()
    expect(parseQuickConnect('user@', 'x')).toBeNull()
    expect(parseQuickConnect('host:99999', 'x')).toBeNull()
    expect(parseQuickConnect('bad host name', 'x')).toBeNull()
  })

  it('returns null when username cannot be determined', () => {
    expect(parseQuickConnect('example.com', '')).toBeNull()
  })
})
