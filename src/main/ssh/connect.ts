import { Client } from 'ssh2'
import type { AuthMethod } from '@shared/types'
import type { PromptBroker } from '../prompts'
import type { KnownHostsStore } from '../store/knownHosts'
import { fingerprintOf, hostKeyId, keyTypeOf } from '../store/knownHostsLogic'
import { createAuthHandler, type AuthState } from './auth'

export interface ConnectOptions {
  host: string
  port: number
  username: string
  auth: AuthMethod
  keyPath: string
  secret?: string
  canRemember: boolean
  timeoutSec: number
  keepaliveSec: number
  prompts: PromptBroker
  knownHosts: KnownHostsStore
  /** Tab id that owns the prompts of this attempt. */
  owner: string
  /** Receives a function that aborts this attempt (tab closed, window closed). */
  onCancelable?: (cancel: () => void) => void
}

export interface ConnectResult {
  client: Client
  rememberSecret?: string
}

export class ConnectCancelled extends Error {
  constructor() {
    super('Connection cancelled')
    this.name = 'ConnectCancelled'
  }
}

/** Timer that stops while the user is answering a prompt, so typing a password never times out. */
class PausableTimer {
  private handle: NodeJS.Timeout | null = null
  private paused = 0

  constructor(
    private readonly ms: number,
    private readonly onFire: () => void
  ) {}

  start(): void {
    this.stop()
    if (this.paused === 0) this.handle = setTimeout(this.onFire, this.ms)
  }

  pause(): void {
    this.paused++
    this.stop()
  }

  resume(): void {
    this.paused = Math.max(0, this.paused - 1)
    if (this.paused === 0) this.start()
  }

  stop(): void {
    if (this.handle) clearTimeout(this.handle)
    this.handle = null
  }
}

export function connectSsh(opts: ConnectOptions): Promise<ConnectResult> {
  return new Promise((resolve, reject) => {
    const client = new Client()
    const state: AuthState = { aborted: false }
    let settled = false
    let hostRejected = false

    const fail = (err: Error): void => {
      if (settled) return
      settled = true
      timer.stop()
      client.destroy()
      reject(err)
    }
    const timer = new PausableTimer(opts.timeoutSec * 1000, () =>
      fail(new Error(`Connection timed out after ${opts.timeoutSec}s`))
    )
    const target = `${opts.username}@${opts.host}:${opts.port}`

    client.on('ready', () => {
      if (settled) return
      settled = true
      timer.stop()
      resolve({ client, rememberSecret: state.rememberSecret })
    })
    client.on('error', (err: Error & { level?: string }) => {
      if (state.aborted || hostRejected) return fail(new ConnectCancelled())
      if (err.level === 'client-authentication') {
        const detail = state.lastError ? ` (${state.lastError})` : ''
        return fail(new Error(`Authentication failed for ${target}${detail}`))
      }
      fail(err)
    })
    client.on('close', () => fail(new Error('Connection closed by remote host')))

    opts.onCancelable?.(() => {
      state.aborted = true
      fail(new ConnectCancelled())
    })
    timer.start()
    try {
      client.connect({
        host: opts.host,
        port: opts.port,
        username: opts.username,
        readyTimeout: 0,
        keepaliveInterval: opts.keepaliveSec * 1000,
        keepaliveCountMax: 3,
        tryKeyboard: true,
        hostVerifier: (key: Buffer, verify: (ok: boolean) => void) => {
          const fingerprint = fingerprintOf(key)
          const keyType = keyTypeOf(key)
          const id = hostKeyId(opts.host, opts.port)
          const check = opts.knownHosts.check(id, fingerprint)
          if (check.status === 'match') return verify(true)
          timer.pause()
          const request =
            check.status === 'new'
              ? { kind: 'hostkey-new' as const, host: opts.host, port: opts.port, keyType, fingerprint }
              : {
                  kind: 'hostkey-changed' as const,
                  host: opts.host,
                  port: opts.port,
                  keyType,
                  fingerprint,
                  previous: check.previous
                }
          void opts.prompts.ask(request, opts.owner).then((res) => {
            timer.resume()
            if (res.accepted) opts.knownHosts.remember(id, fingerprint, keyType)
            else hostRejected = true
            verify(res.accepted)
          })
        },
        authHandler: createAuthHandler(
          {
            username: opts.username,
            auth: opts.auth,
            keyPath: opts.keyPath,
            secret: opts.secret,
            canRemember: opts.canRemember,
            target,
            owner: opts.owner,
            prompts: opts.prompts,
            onPromptStart: () => timer.pause(),
            onPromptEnd: () => timer.resume()
          },
          state
        )
      })
    } catch (err) {
      fail(err instanceof Error ? err : new Error(String(err)))
    }
  })
}
