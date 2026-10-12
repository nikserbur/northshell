import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { utils, type AnyAuthMethod, type AuthenticationType, type AuthHandlerMiddleware, type Prompt } from 'ssh2'
import type { AuthMethod } from '@shared/types'
import type { PromptBroker } from '../prompts'

export interface AuthContext {
  username: string
  auth: AuthMethod
  keyPath: string
  /** Stored password (auth=password) or key passphrase (auth=key). */
  secret?: string
  canRemember: boolean
  target: string
  /** Tab id the prompts belong to, so they can be withdrawn if the tab closes. */
  owner: string
  prompts: PromptBroker
  onPromptStart(): void
  onPromptEnd(): void
}

export interface AuthState {
  aborted: boolean
  /** Secret the user asked to remember; persisted only after successful login. */
  rememberSecret?: string
  lastError?: string
}

type StepResult = AnyAuthMethod | null | 'abort'

interface Step {
  method: AuthenticationType
  run(): Promise<StepResult>
}

const DEFAULT_KEYS = ['id_ed25519', 'id_ecdsa', 'id_rsa']
const MAX_PASSWORD_PROMPTS = 3

export function expandHome(path: string): string {
  return path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : path
}

function isPassphraseError(err: Error): boolean {
  return /passphrase|encrypted|decrypt|integrity/i.test(err.message)
}

export function createAuthHandler(ctx: AuthContext, state: AuthState): AuthHandlerMiddleware {
  const { username } = ctx
  let knownPassword = ctx.auth === 'password' ? ctx.secret : undefined
  let autoAnsweredKi = false

  const ask = async (...args: Parameters<PromptBroker['ask']>): ReturnType<PromptBroker['ask']> => {
    ctx.onPromptStart()
    try {
      return await ctx.prompts.ask(args[0], ctx.owner)
    } finally {
      ctx.onPromptEnd()
    }
  }

  const keyStep = (path: string, interactive: boolean): Step => ({
    method: 'publickey',
    async run() {
      let data: Buffer
      try {
        data = await readFile(expandHome(path))
      } catch {
        state.lastError = `Cannot read private key: ${path}`
        return null
      }
      let passphrase = ctx.auth === 'key' ? ctx.secret : undefined
      for (let attempt = 0; attempt <= MAX_PASSWORD_PROMPTS; attempt++) {
        const parsed = utils.parseKey(data, passphrase)
        if (!(parsed instanceof Error)) return { type: 'publickey', username, key: data, passphrase }
        if (!interactive || !isPassphraseError(parsed) || attempt === MAX_PASSWORD_PROMPTS) {
          state.lastError = parsed.message
          return null
        }
        const res = await ask({
          kind: 'secret',
          purpose: 'passphrase',
          target: path,
          canRemember: ctx.canRemember && ctx.auth === 'key',
          retry: Boolean(passphrase)
        })
        if (!res.accepted) return 'abort'
        passphrase = res.values?.[0] ?? ''
        if (res.remember) state.rememberSecret = passphrase
      }
      return null
    }
  })

  const passwordPrompt = (retry: boolean): Step => ({
    method: 'password',
    async run() {
      // Only password sessions store a password; key sessions keep their passphrase slot.
      const canRemember = ctx.canRemember && ctx.auth === 'password'
      const res = await ask({ kind: 'secret', purpose: 'password', target: ctx.target, canRemember, retry })
      if (!res.accepted) return 'abort'
      const password = res.values?.[0] ?? ''
      knownPassword = password
      state.rememberSecret = res.remember ? password : undefined
      return { type: 'password', username, password }
    }
  })

  const keyboardInteractive: Step = {
    method: 'keyboard-interactive',
    async run() {
      return {
        type: 'keyboard-interactive',
        username,
        prompt: (name: string, instructions: string, _lang: string, prompts: Prompt[], finish: (answers: string[]) => void) => {
          if (prompts.length === 0) return finish([])
          if (knownPassword && !autoAnsweredKi && prompts.length === 1 && !prompts[0].echo) {
            autoAnsweredKi = true
            return finish([knownPassword])
          }
          void ask({
            kind: 'keyboard-interactive',
            title: name || ctx.target,
            instructions,
            prompts: prompts.map((p) => ({ prompt: p.prompt, echo: Boolean(p.echo) }))
          }).then((res) => {
            if (!res.accepted) state.aborted = true
            finish(res.accepted ? (res.values ?? []) : prompts.map(() => ''))
          })
        }
      }
    }
  }

  const steps: Step[] = [{ method: 'none', run: async () => ({ type: 'none', username }) }]
  if (ctx.auth === 'key') {
    if (ctx.keyPath) steps.push(keyStep(ctx.keyPath, true))
    else DEFAULT_KEYS.forEach((k) => steps.push(keyStep(join(homedir(), '.ssh', k), true)))
  }
  if (ctx.auth === 'agent') {
    const sock = process.env.SSH_AUTH_SOCK
    if (sock) steps.push({ method: 'publickey', run: async () => ({ type: 'agent', username, agent: sock }) })
    DEFAULT_KEYS.map((k) => join(homedir(), '.ssh', k))
      .filter((p) => existsSync(p))
      .forEach((p) => steps.push(keyStep(p, false)))
  }
  if (ctx.auth === 'password' && ctx.secret) {
    const password = ctx.secret
    steps.push({ method: 'password', run: async () => ({ type: 'password', username, password }) })
  }
  steps.push(keyboardInteractive)
  const storedPasswordFailed = ctx.auth === 'password' && Boolean(ctx.secret)
  for (let i = 0; i < MAX_PASSWORD_PROMPTS; i++) steps.push(passwordPrompt(i > 0 || storedPasswordFailed))

  return (methodsLeft, _partialSuccess, next) => {
    const done = next as (auth: AuthenticationType | AnyAuthMethod | false) => void
    void (async () => {
      while (steps.length > 0 && !state.aborted) {
        const step = steps.shift() as Step
        if (methodsLeft && !methodsLeft.includes(step.method)) continue
        const result = await step.run()
        if (result === 'abort') {
          state.aborted = true
          break
        }
        if (result) return done(result)
      }
      done(false)
    })().catch((err: unknown) => {
      state.lastError = err instanceof Error ? err.message : String(err)
      done(false)
    })
  }
}
