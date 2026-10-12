import { describe, expect, it } from 'vitest'
import { parseSshConfig } from './sshConfig'

const sample = `
# comment
Host *
  ServerAliveInterval 30

Host web prod-web
  HostName 10.0.0.10
  User deploy
  Port 2222
  IdentityFile ~/.ssh/id_web

Host db
    hostname=db.internal
    user = postgres

Host bastion-?
  User root

Match host foo
  User nobody

Host plain
`

describe('parseSshConfig', () => {
  const hosts = parseSshConfig(sample, '/Users/me')

  it('skips wildcard and match blocks', () => {
    expect(hosts.map((h) => h.alias)).toEqual(['web', 'db', 'plain'])
  })

  it('reads host details and expands ~ in IdentityFile', () => {
    expect(hosts[0]).toEqual({ alias: 'web', host: '10.0.0.10', port: 2222, username: 'deploy', identityFile: '/Users/me/.ssh/id_web' })
  })

  it('supports = separators and case-insensitive keys', () => {
    expect(hosts[1]).toEqual({ alias: 'db', host: 'db.internal', port: 22, username: 'postgres', identityFile: '' })
  })

  it('uses the alias as host name when HostName is missing', () => {
    expect(hosts[2]).toEqual({ alias: 'plain', host: 'plain', port: 22, username: '', identityFile: '' })
  })

  it('ignores invalid ports', () => {
    expect(parseSshConfig('Host x\n Port 99999\n', '/h')[0].port).toBe(22)
  })
})
