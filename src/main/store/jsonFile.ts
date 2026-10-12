import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** Small JSON document persisted atomically (tmp file + rename) with owner-only permissions. */
export class JsonFile<T> {
  constructor(
    private readonly path: string,
    private readonly fallback: () => T
  ) {}

  read(): T {
    if (!existsSync(this.path)) return this.fallback()
    try {
      return JSON.parse(readFileSync(this.path, 'utf8')) as T
    } catch (err) {
      const backup = `${this.path}.corrupt-${Date.now()}.bak`
      try {
        copyFileSync(this.path, backup)
      } catch {
        /* best effort */
      }
      console.error(`[store] failed to read ${this.path}; saved a copy to ${backup}, using defaults`, err)
      return this.fallback()
    }
  }

  write(data: T): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 })
    renameSync(tmp, this.path)
  }
}
