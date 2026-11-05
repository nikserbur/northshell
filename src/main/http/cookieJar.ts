import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CookieEntry } from '@shared/httpWorkspace'

/** Cookie file of one HTTP environment. The id comes from the interface, so it is never used as a path as is. */
export function cookieJarPath(dir: string, sessionId: string): string {
  return join(dir, `${sessionId.replace(/[^\w-]/g, '_')}.txt`)
}

const HTTP_ONLY = '#HttpOnly_'

/** Netscape cookie file, as curl writes it: domain, subdomains, path, secure, expires, name, value. */
export function parseCookieFile(text: string): CookieEntry[] {
  const out: CookieEntry[] = []
  for (const raw of text.split('\n')) {
    const line = raw.startsWith(HTTP_ONLY) ? raw.slice(HTTP_ONLY.length) : raw
    if (!line.trim() || line.startsWith('#')) continue
    const f = line.split('\t')
    if (f.length < 7) continue
    out.push({ domain: f[0], path: f[2], secure: f[3] === 'TRUE', expires: Number(f[4]) || 0, name: f[5], value: f.slice(6).join('\t') })
  }
  return out
}

export async function listCookies(path: string): Promise<CookieEntry[]> {
  return parseCookieFile(await readFile(path, 'utf8').catch(() => ''))
}

/** Removes one cookie, or the whole jar when none is named. */
export async function removeCookies(path: string, cookie?: { domain: string; path: string; name: string }): Promise<CookieEntry[]> {
  if (!cookie) {
    await rm(path, { force: true })
    return []
  }
  const text = await readFile(path, 'utf8').catch(() => '')
  const kept = text.split('\n').filter((raw) => {
    const line = raw.startsWith(HTTP_ONLY) ? raw.slice(HTTP_ONLY.length) : raw
    const f = line.split('\t')
    return line.startsWith('#') || f.length < 7 || f[0] !== cookie.domain || f[2] !== cookie.path || f[5] !== cookie.name
  })
  await writeFile(path, kept.join('\n'), { mode: 0o600 })
  return parseCookieFile(kept.join('\n'))
}
