type FlushFn = (id: string, data: Uint8Array) => void

/**
 * Coalesces high-frequency terminal output into fewer IPC messages.
 * Data is flushed every `intervalMs`, or immediately once `maxBytes` is buffered for an id.
 */
export class DataBatcher {
  private pending = new Map<string, Buffer[]>()
  private sizes = new Map<string, number>()
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly flush: FlushFn,
    private readonly intervalMs = 8,
    private readonly maxBytes = 256 * 1024
  ) {}

  push(id: string, chunk: Buffer | string): void {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
    const list = this.pending.get(id) ?? []
    list.push(buf)
    this.pending.set(id, list)
    const size = (this.sizes.get(id) ?? 0) + buf.length
    this.sizes.set(id, size)
    if (size >= this.maxBytes) {
      this.flushOne(id)
      return
    }
    if (!this.timer) this.timer = setTimeout(() => this.flushAll(), this.intervalMs)
  }

  /** Delivers anything buffered for `id` right away (e.g. before a status message). */
  flushNow(id: string): void {
    this.flushOne(id)
  }

  discard(id: string): void {
    this.pending.delete(id)
    this.sizes.delete(id)
  }

  private flushOne(id: string): void {
    const list = this.pending.get(id)
    this.pending.delete(id)
    this.sizes.delete(id)
    if (list && list.length > 0) this.flush(id, list.length === 1 ? list[0] : Buffer.concat(list))
  }

  private flushAll(): void {
    this.timer = null
    for (const id of [...this.pending.keys()]) this.flushOne(id)
  }
}
