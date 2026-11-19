import type { Client } from 'ssh2'
import { MAX_SIGNAL_TARGETS, classifySignalError, type ProcessSignal, type SignalResult } from '@shared/signals'

const CHANNEL_TIMEOUT_MS = 15_000
/** Linux's highest possible pid; macOS stays far below it. */
const MAX_PID = 4_194_304

/** Pids worth sending anything to: whole numbers above 1, no repeats. Pid 1 is init or launchd. */
export function validPids(pids: number[]): number[] {
  const out = [...new Set(pids)].filter((p) => Number.isInteger(p) && p > 1 && p <= MAX_PID)
  if (out.length === 0) throw new Error('No processes to signal')
  if (out.length > MAX_SIGNAL_TARGETS) throw new Error(`At most ${MAX_SIGNAL_TARGETS} processes at a time`)
  return out
}

/**
 * A POSIX sh script (fed via stdin to `sh -s`, so the login shell never parses it) that signals each pid
 * and reports `ok <pid>` or `err <pid> <message>`. Pids and the signal name are checked before they get
 * here, so nothing in the script comes from the server or the user as text. `sudo -n` never asks for a
 * password: without passwordless sudo it fails, and says so.
 */
export function buildSignalScript(pids: number[], signal: ProcessSignal, sudo: boolean): string {
  const targets = validPids(pids)
  if (!/^[A-Z]+$/.test(signal)) throw new Error('Unknown signal')
  return [
    'export LC_ALL=C',
    sudo ? 'S="sudo -n"' : 'S=',
    `for p in ${targets.join(' ')}; do`,
    `  if out=$($S kill -s ${signal} "$p" 2>&1); then echo "ok $p"; else echo "err $p $(echo "$out" | tr "\\n" " ")"; fi`,
    'done',
    'echo @@done',
    ''
  ].join('\n')
}

/** Results in the order asked; a pid the script never reported on counts as an error. */
export function parseSignalOutput(pids: number[], output: string): SignalResult[] {
  const seen = new Map<number, SignalResult>()
  for (const line of output.split('\n')) {
    const m = /^(ok|err) (\d+)(?: (.*))?$/.exec(line.trim())
    if (!m) continue
    const pid = Number(m[2])
    const message = m[3]?.trim() ?? ''
    seen.set(pid, m[1] === 'ok' ? { pid, outcome: 'ok' } : { pid, outcome: classifySignalError(message), message })
  }
  return pids.map((pid) => seen.get(pid) ?? { pid, outcome: 'error', message: 'No answer from the server' })
}

export function signalRemote(client: Client, pids: number[], signal: ProcessSignal, sudo: boolean): Promise<SignalResult[]> {
  const targets = validPids(pids)
  const script = buildSignalScript(targets, signal, sudo)
  return new Promise((resolve, reject) => {
    client.exec('sh -s', (err, channel) => {
      if (err) return reject(err)
      let out = ''
      const timer = setTimeout(() => channel.close(), CHANNEL_TIMEOUT_MS)
      channel.on('data', (chunk: Buffer) => {
        out += chunk.toString('utf8')
      })
      channel.stderr.on('data', () => undefined)
      channel.on('close', () => {
        clearTimeout(timer)
        resolve(parseSignalOutput(targets, out))
      })
      channel.end(script)
    })
  })
}

/** This Mac's processes. The app's own main process is left alone: that would only close the window. */
export function signalLocal(pids: number[], signal: ProcessSignal, ownPid = process.pid): SignalResult[] {
  return validPids(pids).map((pid) => {
    if (pid === ownPid) return { pid, outcome: 'refused', message: 'This is Northshell itself' }
    try {
      process.kill(pid, `SIG${signal}`)
      return { pid, outcome: 'ok' }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { pid, outcome: classifySignalError(`${(err as NodeJS.ErrnoException).code ?? ''} ${message}`), message }
    }
  })
}
