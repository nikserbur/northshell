import { homedir } from 'node:os'
import * as pty from 'node-pty'
import type { Client, ClientChannel } from 'ssh2'
import { APP_NAME } from '@shared/brand'
import type { AppSettings, MonitorSnapshot, OpenTarget, TabStatusEvent } from '@shared/types'
import { DataBatcher } from './dataBatcher'
import { RemoteMonitor } from './monitor/remoteMonitor'
import type { PromptBroker } from './prompts'
import { ConnectCancelled, connectSsh } from './ssh/connect'
import type { KnownHostsStore } from './store/knownHosts'
import type { SessionStore } from './store/sessionStore'

interface Backend {
  write(data: string): void
  resize(cols: number, rows: number): void
  dispose(): void
}

export interface TerminalDeps {
  sessions: SessionStore
  knownHosts: KnownHostsStore
  prompts: PromptBroker
  settings: () => AppSettings
  sendData: (tabId: string, data: Uint8Array) => void
  sendStatus: (event: TabStatusEvent) => void
  sendMonitor: (tabId: string, snapshot: MonitorSnapshot) => void
  onSshClosed: (tabId: string) => void
}

function clampSize(cols: number, rows: number): [number, number] {
  const c = Number.isFinite(cols) ? Math.min(1000, Math.max(2, Math.floor(cols))) : 80
  const r = Number.isFinite(rows) ? Math.min(500, Math.max(1, Math.floor(rows))) : 24
  return [c, r]
}

function loginEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') env[k] = v
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.TERM_PROGRAM = APP_NAME
  if (!env.LANG) env.LANG = 'en_US.UTF-8'
  return env
}

export class TerminalService {
  private backends = new Map<string, Backend>()
  private clients = new Map<string, Client>()
  private generation = new Map<string, number>()
  /** Aborts for SSH attempts still connecting (host-key / password prompts may be open). */
  private connecting = new Map<string, () => void>()
  private batcher: DataBatcher

  constructor(private readonly deps: TerminalDeps) {
    this.batcher = new DataBatcher((id, data) => deps.sendData(id, data))
  }

  private status(event: TabStatusEvent): void {
    this.batcher.flushNow(event.tabId)
    this.deps.sendStatus(event)
  }

  clientFor(tabId: string): Client | undefined {
    return this.clients.get(tabId)
  }

  write(tabId: string, data: string): void {
    this.backends.get(tabId)?.write(data)
  }

  resize(tabId: string, cols: number, rows: number): void {
    const [c, r] = clampSize(cols, rows)
    this.backends.get(tabId)?.resize(c, r)
  }

  close(tabId: string): void {
    this.generation.set(tabId, (this.generation.get(tabId) ?? 0) + 1)
    this.connecting.get(tabId)?.()
    this.connecting.delete(tabId)
    this.deps.prompts.cancelOwner(tabId)
    this.backends.get(tabId)?.dispose()
    this.backends.delete(tabId)
    this.clients.delete(tabId)
    this.batcher.discard(tabId)
  }

  closeAll(): void {
    for (const id of new Set([...this.backends.keys(), ...this.connecting.keys()])) this.close(id)
  }

  private isCurrent(tabId: string, gen: number): boolean {
    return (this.generation.get(tabId) ?? 0) === gen
  }

  async open(tabId: string, target: OpenTarget, cols: number, rows: number): Promise<void> {
    this.close(tabId)
    const gen = this.generation.get(tabId) ?? 0
    const [c, r] = clampSize(cols, rows)
    if (target.kind === 'local') return this.openLocal(tabId, gen, c, r)
    return this.openSsh(tabId, gen, target, c, r)
  }

  private openLocal(tabId: string, gen: number, cols: number, rows: number): void {
    const settings = this.deps.settings()
    const shell = settings.localShell || process.env.SHELL || '/bin/zsh'
    const proc = pty.spawn(shell, ['-l'], { name: 'xterm-256color', cols, rows, cwd: homedir(), env: loginEnv() })
    let disposed = false
    proc.onData((d) => {
      if (!disposed && this.isCurrent(tabId, gen)) this.batcher.push(tabId, d)
    })
    proc.onExit(({ exitCode }) => {
      if (disposed) return
      this.backends.delete(tabId)
      this.status({ tabId, status: 'closed', message: `Process exited with code ${exitCode}` })
    })
    this.backends.set(tabId, {
      write: (d) => proc.write(d),
      resize: (c, r) => proc.resize(c, r),
      dispose: () => {
        disposed = true
        try {
          proc.kill()
        } catch {
          /* already exited */
        }
      }
    })
    this.status({ tabId, status: 'connected', endpoint: shell })
  }

  private async openSsh(
    tabId: string,
    gen: number,
    target: Exclude<OpenTarget, { kind: 'local' }>,
    cols: number,
    rows: number
  ): Promise<void> {
    const settings = this.deps.settings()
    const session = target.kind === 'session' ? this.deps.sessions.get(target.sessionId) : undefined
    if (target.kind === 'session' && !session) {
      this.status({ tabId, status: 'error', message: 'Session not found' })
      return
    }
    const host = session?.host ?? (target.kind === 'quick' ? target.target.host : '')
    const port = session?.port ?? (target.kind === 'quick' ? target.target.port : 22)
    const username =
      session?.username || (target.kind === 'quick' ? target.target.username : '') || settings.defaultUsername || 'root'
    const endpoint = `${username}@${host}:${port}`
    this.status({ tabId, status: 'connecting', endpoint })

    try {
      const { client, rememberSecret } = await connectSsh({
        host,
        port,
        username,
        auth: session?.auth ?? 'agent',
        keyPath: session?.keyPath ?? '',
        secret: session ? this.deps.sessions.getSecret(session.id) : undefined,
        canRemember: Boolean(session),
        timeoutSec: settings.connectTimeout,
        keepaliveSec: settings.keepaliveInterval,
        prompts: this.deps.prompts,
        knownHosts: this.deps.knownHosts,
        owner: tabId,
        onCancelable: (cancel) => this.connecting.set(tabId, cancel)
      })
      if (this.isCurrent(tabId, gen)) this.connecting.delete(tabId)
      if (this.generation.get(tabId) !== gen) {
        client.end()
        return
      }
      if (session) {
        if (rememberSecret) this.deps.sessions.setSecret(session.id, rememberSecret)
        this.deps.sessions.touch(session.id)
      }
      const stream = await new Promise<ClientChannel>((res, rej) =>
        client.shell({ term: 'xterm-256color', cols, rows }, (err, ch) => (err ? rej(err) : res(ch)))
      )
      if (this.generation.get(tabId) !== gen) {
        client.end()
        return
      }
      this.attachSsh(tabId, gen, client, stream, endpoint, session?.startupCommand ?? '', session?.monitoring ?? true)
    } catch (err) {
      if (this.isCurrent(tabId, gen)) this.connecting.delete(tabId)
      if (this.generation.get(tabId) !== gen) return
      if (err instanceof ConnectCancelled) {
        this.status({ tabId, status: 'closed', message: err.message, endpoint })
      } else {
        this.status({ tabId, status: 'error', message: err instanceof Error ? err.message : String(err), endpoint })
      }
    }
  }

  private attachSsh(
    tabId: string,
    gen: number,
    client: Client,
    stream: ClientChannel,
    endpoint: string,
    startupCommand: string,
    monitoring: boolean
  ): void {
    const settings = this.deps.settings()
    let monitor: RemoteMonitor | null = null
    if (monitoring && settings.monitorEnabled) {
      monitor = new RemoteMonitor(client, settings.monitorInterval, (snap) => this.deps.sendMonitor(tabId, snap))
      monitor.start()
    }
    let finished = false
    const finish = (message: string): void => {
      monitor?.stop()
      if (finished || this.generation.get(tabId) !== gen) return
      finished = true
      this.backends.delete(tabId)
      this.clients.delete(tabId)
      this.deps.onSshClosed(tabId)
      this.status({ tabId, status: 'closed', message, endpoint })
    }
    const push = (d: Buffer): void => {
      if (!finished && this.isCurrent(tabId, gen)) this.batcher.push(tabId, d)
    }
    stream.on('data', push)
    stream.stderr.on('data', push)
    stream.on('close', () => {
      finish('Session closed')
      client.end()
    })
    client.on('error', (err: Error) => finish(err.message))
    client.on('close', () => finish('Connection closed'))

    this.clients.set(tabId, client)
    this.backends.set(tabId, {
      write: (d) => stream.write(d),
      resize: (c, r) => stream.setWindow(r, c, 0, 0),
      dispose: () => {
        monitor?.stop()
        this.deps.onSshClosed(tabId)
        client.end()
      }
    })
    this.status({ tabId, status: 'connected', endpoint })
    if (startupCommand.trim()) stream.write(`${startupCommand.trim()}\n`)
  }
}
