/** Signals the monitor can send: the ones htop's F9 menu puts first, and nothing that needs an argument. */
export const PROCESS_SIGNALS = ['TERM', 'KILL', 'INT', 'HUP', 'STOP', 'CONT'] as const
export type ProcessSignal = (typeof PROCESS_SIGNALS)[number]

/** One call stops at this many processes: a bigger selection is most likely a mistake. */
export const MAX_SIGNAL_TARGETS = 500

/** What happened to one process. */
export type SignalOutcome = 'ok' | 'gone' | 'denied' | 'sudo' | 'refused' | 'error'

export interface SignalResult {
  pid: number
  outcome: SignalOutcome
  /** The system's own words, for anything but `ok`. */
  message?: string
}

/** `kill` and `sudo` say the same few things in many ways; the UI only needs to know which. */
export function classifySignalError(message: string): SignalOutcome {
  if (/no such process|ESRCH/i.test(message)) return 'gone'
  if (/password is required|a terminal is required|not in the sudoers|sudo: .*not found/i.test(message)) return 'sudo'
  if (/not permitted|permission denied|EPERM/i.test(message)) return 'denied'
  return 'error'
}
