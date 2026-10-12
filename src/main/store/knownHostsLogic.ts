import { createHash } from 'node:crypto'

export interface KnownHostEntry {
  fingerprint: string
  keyType: string
  addedAt: number
}

export type KnownHostsMap = Record<string, KnownHostEntry>

export type HostKeyCheck = { status: 'match' } | { status: 'new' } | { status: 'changed'; previous: string }

export function hostKeyId(host: string, port: number): string {
  return `${host.toLowerCase()}:${port}`
}

export function fingerprintOf(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`
}

/** Reads the algorithm name from an SSH wire-format public key blob. */
export function keyTypeOf(key: Buffer): string {
  if (key.length < 4) return 'unknown'
  const len = key.readUInt32BE(0)
  if (len <= 0 || len > 64 || key.length < 4 + len) return 'unknown'
  return key.subarray(4, 4 + len).toString('ascii')
}

export function checkHostKey(store: KnownHostsMap, id: string, fingerprint: string): HostKeyCheck {
  const entry = store[id]
  if (!entry) return { status: 'new' }
  return entry.fingerprint === fingerprint ? { status: 'match' } : { status: 'changed', previous: entry.fingerprint }
}
