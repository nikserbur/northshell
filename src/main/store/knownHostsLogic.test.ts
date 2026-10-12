import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { checkHostKey, fingerprintOf, hostKeyId, keyTypeOf } from './knownHostsLogic'

function fakeKey(type: string): Buffer {
  const t = Buffer.from(type)
  const len = Buffer.alloc(4)
  len.writeUInt32BE(t.length)
  return Buffer.concat([len, t, Buffer.from('keydata')])
}

describe('knownHostsLogic', () => {
  it('builds stable ids', () => {
    expect(hostKeyId('Example.COM', 22)).toBe('example.com:22')
  })

  it('computes OpenSSH-style SHA256 fingerprints', () => {
    const key = fakeKey('ssh-ed25519')
    const expected = createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
    expect(fingerprintOf(key)).toBe(`SHA256:${expected}`)
  })

  it('extracts the key type', () => {
    expect(keyTypeOf(fakeKey('ssh-ed25519'))).toBe('ssh-ed25519')
    expect(keyTypeOf(Buffer.from([0, 0]))).toBe('unknown')
    expect(keyTypeOf(Buffer.from([0, 0, 1, 0, 65]))).toBe('unknown')
  })

  it('classifies keys as new, match or changed', () => {
    const store = { 'h:22': { fingerprint: 'SHA256:a', keyType: 'ssh-ed25519', addedAt: 1 } }
    expect(checkHostKey(store, 'h:22', 'SHA256:a')).toEqual({ status: 'match' })
    expect(checkHostKey(store, 'h:22', 'SHA256:b')).toEqual({ status: 'changed', previous: 'SHA256:a' })
    expect(checkHostKey(store, 'x:22', 'SHA256:a')).toEqual({ status: 'new' })
  })
})
