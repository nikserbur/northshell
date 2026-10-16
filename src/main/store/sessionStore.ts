import { randomUUID } from 'node:crypto'
import { SESSION_COLORS } from '@shared/defaults'
import { endpointOf, normalizeBaseUrl } from '@shared/httpEnv'
import type { SessionConfig, SessionInput } from '@shared/types'
import type { SshConfigHost } from '../ssh/sshConfig'
import { JsonFile } from './jsonFile'
import { sessionInputSchema } from './schemas'

export interface SecretCipher {
  isAvailable(): boolean
  encrypt(plain: string): string
  decrypt(cipher: string): string
}

type StoredSession = Omit<SessionConfig, 'hasSecret' | 'kind' | 'baseUrl' | 'headers' | 'insecure'> &
  Partial<Pick<SessionConfig, 'kind' | 'baseUrl' | 'headers' | 'insecure'>> & { secret?: string }

interface SessionsFile {
  version: 1
  sessions: StoredSession[]
}

/** Sessions saved before HTTP environments existed have no kind and are SSH. */
function toPublic({ secret, ...rest }: StoredSession): SessionConfig {
  return {
    ...rest,
    kind: rest.kind ?? 'ssh',
    baseUrl: rest.baseUrl ?? '',
    headers: rest.headers ?? '',
    insecure: rest.insecure ?? false,
    hasSecret: Boolean(secret)
  }
}

/** HTTP environments take host and port from the base URL; SSH-only options are switched off. */
function connectionFields(input: SessionInput): Pick<
  StoredSession,
  'kind' | 'host' | 'port' | 'username' | 'auth' | 'keyPath' | 'monitoring' | 'sftp' | 'baseUrl' | 'headers' | 'insecure'
> {
  if (input.kind === 'http') {
    const baseUrl = normalizeBaseUrl(input.baseUrl) ?? input.baseUrl
    const endpoint = endpointOf(baseUrl)
    return {
      kind: 'http',
      host: endpoint?.host ?? '',
      port: endpoint?.port ?? 443,
      username: '',
      auth: 'password',
      keyPath: '',
      monitoring: false,
      sftp: false,
      baseUrl,
      headers: input.headers,
      insecure: input.insecure
    }
  }
  return {
    kind: 'ssh',
    host: input.host,
    port: input.port,
    username: input.username,
    auth: input.auth,
    keyPath: input.keyPath,
    monitoring: input.monitoring,
    sftp: input.sftp,
    baseUrl: '',
    headers: '',
    insecure: false
  }
}

export class SessionStore {
  private file: JsonFile<SessionsFile>

  constructor(
    path: string,
    private readonly cipher: SecretCipher
  ) {
    this.file = new JsonFile(path, () => ({ version: 1, sessions: [] }))
  }

  private all(): StoredSession[] {
    const data = this.file.read()
    return Array.isArray(data.sessions) ? data.sessions : []
  }

  private persist(sessions: StoredSession[]): void {
    this.file.write({ version: 1, sessions })
  }

  list(): SessionConfig[] {
    return this.all().map(toPublic)
  }

  get(id: string): SessionConfig | undefined {
    const s = this.all().find((x) => x.id === id)
    return s ? toPublic(s) : undefined
  }

  getSecret(id: string): string | undefined {
    const s = this.all().find((x) => x.id === id)
    if (!s?.secret) return undefined
    try {
      return this.cipher.decrypt(s.secret)
    } catch (err) {
      console.error('[sessions] cannot decrypt stored secret', err)
      return undefined
    }
  }

  private encrypt(secret: string): string {
    if (!this.cipher.isAvailable()) throw new Error('Secure storage (Keychain) is not available')
    return this.cipher.encrypt(secret)
  }

  save(raw: unknown): SessionConfig {
    const input: SessionInput = sessionInputSchema.parse(raw)
    const sessions = this.all()
    const existing = input.id ? sessions.find((s) => s.id === input.id) : undefined
    const now = Date.now()

    let secret = existing?.secret
    if (input.clearSecret) secret = undefined
    if (input.secret) secret = this.encrypt(input.secret)

    const next: StoredSession = {
      id: existing?.id ?? randomUUID(),
      name: input.name,
      folder: input.folder,
      ...connectionFields(input),
      color: input.color,
      startupCommand: input.startupCommand,
      createdAt: existing?.createdAt ?? now,
      lastUsedAt: existing?.lastUsedAt ?? 0,
      useCount: existing?.useCount ?? 0,
      ...(secret ? { secret } : {})
    }
    const updated = existing ? sessions.map((s) => (s.id === next.id ? next : s)) : [...sessions, next]
    this.persist(updated)
    return toPublic(next)
  }

  setSecret(id: string, secret: string): void {
    const encrypted = this.encrypt(secret)
    this.persist(this.all().map((s) => (s.id === id ? { ...s, secret: encrypted } : s)))
  }

  remove(id: string): void {
    this.persist(this.all().filter((s) => s.id !== id))
  }

  duplicate(id: string): SessionConfig | undefined {
    const sessions = this.all()
    const src = sessions.find((s) => s.id === id)
    if (!src) return undefined
    const copy: StoredSession = {
      ...src,
      id: randomUUID(),
      name: `${src.name} copy`,
      createdAt: Date.now(),
      lastUsedAt: 0,
      useCount: 0
    }
    this.persist([...sessions, copy])
    return toPublic(copy)
  }

  touch(id: string): void {
    const now = Date.now()
    this.persist(this.all().map((s) => (s.id === id ? { ...s, lastUsedAt: now, useCount: s.useCount + 1 } : s)))
  }

  importHosts(hosts: SshConfigHost[], defaultUser: string): number {
    const sessions = this.all()
    const known = new Set(sessions.map((s) => `${s.host}:${s.port}:${s.username}`))
    const now = Date.now()
    const added: StoredSession[] = []
    hosts.forEach((h, i) => {
      const username = h.username || defaultUser
      const key = `${h.host}:${h.port}:${username}`
      if (known.has(key)) return
      known.add(key)
      added.push({
        id: randomUUID(),
        kind: 'ssh',
        name: h.alias,
        folder: 'ssh config',
        host: h.host,
        port: h.port,
        username,
        auth: h.identityFile ? 'key' : 'agent',
        keyPath: h.identityFile,
        color: SESSION_COLORS[i % SESSION_COLORS.length],
        startupCommand: '',
        monitoring: true,
        sftp: true,
        createdAt: now,
        lastUsedAt: 0,
        useCount: 0
      })
    })
    if (added.length > 0) this.persist([...sessions, ...added])
    return added.length
  }
}
