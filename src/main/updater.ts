import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, constants, mkdir, mkdtemp, open, readdir, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { APP_NAME } from '@shared/brand'
import type { UpdateStatus } from '@shared/types'

const run = promisify(execFile)

const RELEASES_URL = 'https://github.com/nikserbur/northshell/releases'
const LATEST_API_URL = 'https://api.github.com/repos/nikserbur/northshell/releases/latest'
const BUNDLE_ID = 'com.northshell.app'
const MAX_DMG_BYTES = 1024 ** 3
const FIRST_CHECK_DELAY_MS = 5_000
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000
const PROGRESS_STEP = 2

/** True when `candidate` is a later x.y.z than `current`. */
export function isNewer(candidate: string, current: string): boolean {
  const a = candidate.split('.').map(Number)
  const b = current.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}

/** `v1.6.1` → `1.6.1`; anything else is not a release of ours. */
export function versionFromTag(tag: unknown): string | null {
  return typeof tag === 'string' ? (/^v(\d+\.\d+\.\d+)$/.exec(tag)?.[1] ?? null) : null
}

/** The hash of one file in a SHA256SUMS.txt. */
export function checksumFor(sums: string, file: string): string | null {
  for (const line of sums.split('\n')) {
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim())
    if (m && m[2] === file) return m[1].toLowerCase()
  }
  return null
}

/** `/x/Northshell.app/Contents/MacOS/Northshell` → `/x/Northshell.app`. */
export function bundleOf(execPath: string): string | null {
  const bundle = resolve(execPath, '../../..')
  return bundle.endsWith('.app') ? bundle : null
}

/** The bundle to replace, or null where that cannot work: a disk image, a translocated copy, a folder we cannot write to. */
export async function replaceableBundle(execPath: string): Promise<string | null> {
  const bundle = bundleOf(execPath)
  if (!bundle || bundle.startsWith('/Volumes/') || bundle.includes('/AppTranslocation/')) return null
  try {
    await access(dirname(bundle), constants.W_OK)
    return bundle
  } catch {
    return null
  }
}

async function plistValue(bundle: string, key: string): Promise<string> {
  const { stdout } = await run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, join(bundle, 'Contents', 'Info.plist')])
  return stdout.trim()
}

/**
 * Puts the new bundle in place of the old one; if that fails half way, the old one goes back. The old one
 * stays on disk: the running app still needs its files, and deleting them takes it down before it can
 * restart. The new version removes it on launch.
 */
export async function swapBundles(current: string, fresh: string): Promise<void> {
  const old = join(dirname(current), `.${basename(current)}.old-${process.pid}`)
  await rename(current, old)
  try {
    await rename(fresh, current)
  } catch (err) {
    await rename(old, current)
    throw err
  }
}

/** Removes what the previous update left beside the running bundle. */
export async function sweepOldBundles(bundle: string): Promise<void> {
  const dir = dirname(bundle)
  const prefix = `.${basename(bundle)}.old-`
  for (const name of await readdir(dir)) {
    if (name.startsWith(prefix) && /^\d+$/.test(name.slice(prefix.length))) await rm(join(dir, name), { recursive: true, force: true })
  }
}

/** Copies the app out of a downloaded disk image and swaps it in, after making sure it is the expected app and version. */
export async function installFromDmg(dmg: string, bundle: string, version: string, workDir: string): Promise<void> {
  const mount = join(workDir, 'mnt')
  await mkdir(mount, { recursive: true })
  await run('/usr/bin/hdiutil', ['attach', dmg, '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount])
  // Beside the old bundle, so the final rename stays on one volume; the dot keeps it out of Launchpad meanwhile.
  const fresh = join(dirname(bundle), `.${APP_NAME}-${version}.app`)
  try {
    await rm(fresh, { recursive: true, force: true })
    await run('/usr/bin/ditto', [join(mount, `${APP_NAME}.app`), fresh])
    const id = await plistValue(fresh, 'CFBundleIdentifier')
    const got = await plistValue(fresh, 'CFBundleShortVersionString')
    if (id !== BUNDLE_ID || got !== version) throw new Error(`The download holds ${id} ${got}, not ${BUNDLE_ID} ${version}`)
    await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', fresh]).catch(() => undefined)
    await swapBundles(bundle, fresh)
  } catch (err) {
    await rm(fresh, { recursive: true, force: true })
    throw err
  } finally {
    await run('/usr/bin/hdiutil', ['detach', mount, '-force']).catch((err: unknown) => console.error('[update] could not detach the image', err))
  }
}

export interface UpdaterDeps {
  currentVersion: string
  execPath: string
  fetch: typeof globalThis.fetch
  /** The setting, read at every check. */
  enabled: () => boolean
  emit: (status: UpdateStatus) => void
  relaunch: () => void
}

/**
 * Finds a newer release on GitHub and installs it on request. A file this app downloads itself gets no
 * quarantine flag, which is the point: an update never needs the terminal or "Open Anyway" again.
 */
export class Updater {
  private status: UpdateStatus = { state: 'idle' }
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly deps: UpdaterDeps) {}

  current(): UpdateStatus {
    return this.status
  }

  private set(status: UpdateStatus): void {
    this.status = status
    this.deps.emit(status)
  }

  start(): void {
    if (this.timer) return
    const bundle = bundleOf(this.deps.execPath)
    if (bundle) void sweepOldBundles(bundle).catch((err: unknown) => console.error('[update] could not remove the previous version', err))
    const tick = (): void => void this.check()
    setTimeout(tick, FIRST_CHECK_DELAY_MS)
    this.timer = setInterval(tick, CHECK_EVERY_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Quiet by design: being offline is not worth a message. */
  async check(): Promise<void> {
    if (!this.deps.enabled() || this.status.state === 'downloading' || this.status.state === 'installing') return
    try {
      // The API, not the /releases/latest redirect: Electron's fetch doesn't report where a redirect ended up.
      const res = await this.deps.fetch(LATEST_API_URL, { headers: { Accept: 'application/vnd.github+json' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const release = (await res.json()) as { tag_name?: unknown }
      const version = versionFromTag(release.tag_name)
      if (!version || !isNewer(version, this.deps.currentVersion)) return
      const canInstall = (await replaceableBundle(this.deps.execPath)) !== null
      this.set({ state: 'available', version, url: `${RELEASES_URL}/tag/v${version}`, canInstall })
    } catch (err) {
      console.error('[update] check failed', err)
    }
  }

  private async download(url: string, path: string, onProgress: (share: number | null) => void): Promise<string> {
    const res = await this.deps.fetch(url)
    if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`)
    const total = Number(res.headers.get('content-length')) || 0
    if (total > MAX_DMG_BYTES) throw new Error('The download is unexpectedly large')
    const hash = createHash('sha256')
    const file = await open(path, 'w', 0o600)
    let received = 0
    let reported = -PROGRESS_STEP
    try {
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.length
        if (received > MAX_DMG_BYTES) throw new Error('The download is unexpectedly large')
        hash.update(value)
        await file.write(value)
        const share = total > 0 ? Math.min(100, Math.floor((received / total) * 100)) : null
        if (share === null || share >= reported + PROGRESS_STEP) {
          onProgress(share)
          reported = share ?? reported
        }
      }
    } finally {
      await file.close()
    }
    return hash.digest('hex')
  }

  /** Downloads, verifies and installs the version on offer, then restarts into it. The app stays as it was on any failure. */
  async install(): Promise<void> {
    const offer = this.status
    if (offer.state !== 'available' && offer.state !== 'error') return
    const { version, url } = offer
    const bundle = await replaceableBundle(this.deps.execPath)
    if (!bundle) {
      this.set({ state: 'error', version, url, message: 'The app cannot replace itself from this location', canInstall: false })
      return
    }
    const file = `${APP_NAME}-${version}-arm64.dmg`
    const base = `${RELEASES_URL}/download/v${version}`
    const workDir = await mkdtemp(join(tmpdir(), 'northshell-update-'))
    try {
      this.set({ state: 'downloading', version, url, progress: null })
      const sums = await this.deps.fetch(`${base}/SHA256SUMS.txt`)
      if (!sums.ok) throw new Error(`Could not get the checksums: HTTP ${sums.status}`)
      const expected = checksumFor(await sums.text(), file)
      if (!expected) throw new Error(`The release has no checksum for ${file}`)
      const dmg = join(workDir, file)
      const actual = await this.download(`${base}/${file}`, dmg, (progress) => this.set({ state: 'downloading', version, url, progress }))
      if (actual !== expected) throw new Error('The download does not match its checksum')
      this.set({ state: 'installing', version, url })
      await installFromDmg(dmg, bundle, version, workDir)
      this.deps.relaunch()
    } catch (err) {
      console.error('[update] install failed', err)
      this.set({ state: 'error', version, url, message: err instanceof Error ? err.message : String(err), canInstall: true })
    } finally {
      await rm(workDir, { recursive: true, force: true })
    }
  }
}
