import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const FILES = ['settings.json', 'known_hosts.json']

/**
 * One-time import of data from a previous app name (e.g. Termora → Northshell).
 * Saved passwords are dropped: they were encrypted with the old app's Keychain key and
 * cannot be decrypted under the new name, so the user is simply asked again on connect.
 * Returns true when something was imported.
 */
export function migrateLegacyData(legacyDirs: string[], targetDir: string): boolean {
  if (existsSync(join(targetDir, 'sessions.json'))) return false
  const legacy = legacyDirs.find((dir) => existsSync(join(dir, 'sessions.json')))
  if (!legacy) return false
  mkdirSync(targetDir, { recursive: true })
  try {
    const data = JSON.parse(readFileSync(join(legacy, 'sessions.json'), 'utf8')) as { sessions?: Record<string, unknown>[] }
    const sessions = (data.sessions ?? []).map(({ secret: _secret, ...rest }) => rest)
    writeFileSync(join(targetDir, 'sessions.json'), JSON.stringify({ ...data, sessions }, null, 2), { mode: 0o600 })
  } catch (err) {
    console.error('[migrate] could not import sessions', err)
    return false
  }
  for (const file of FILES) {
    if (existsSync(join(legacy, file))) copyFileSync(join(legacy, file), join(targetDir, file))
  }
  return true
}
