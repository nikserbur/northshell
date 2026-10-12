import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import { IPC } from '@shared/ipc'
import type { PromptRequest, PromptResponse } from '@shared/types'

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never
export type PromptInput = WithoutId<PromptRequest>

/** Routes interactive questions (host keys, passwords, 2FA) from main to the renderer and awaits answers. */
interface Pending {
  owner?: string
  resolve: (res: PromptResponse) => void
}

export class PromptBroker {
  private pending = new Map<string, Pending>()

  constructor(private readonly target: () => WebContents | null) {}

  /** `owner` (a tab id) lets all questions of a tab be withdrawn when the tab goes away. */
  ask(req: PromptInput, owner?: string): Promise<PromptResponse> {
    const wc = this.target()
    const id = randomUUID()
    if (!wc || wc.isDestroyed()) return Promise.resolve({ id, accepted: false })
    return new Promise((resolve) => {
      this.pending.set(id, { owner, resolve })
      wc.send(IPC.promptRequest, { ...req, id })
    })
  }

  respond(res: PromptResponse): void {
    const entry = this.pending.get(res.id)
    if (!entry) return
    this.pending.delete(res.id)
    entry.resolve(res)
  }

  cancelOwner(owner: string): void {
    for (const [id, entry] of this.pending) {
      if (entry.owner !== owner) continue
      this.pending.delete(id)
      entry.resolve({ id, accepted: false })
      const wc = this.target()
      if (wc && !wc.isDestroyed()) wc.send(IPC.promptCancel, id)
    }
  }

  cancelAll(): void {
    for (const [id, entry] of this.pending) entry.resolve({ id, accepted: false })
    this.pending.clear()
  }
}
