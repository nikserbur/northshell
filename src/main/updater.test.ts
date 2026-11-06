import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { UpdateStatus } from '@shared/types'
import { Updater, bundleOf, checksumFor, installFromDmg, isNewer, replaceableBundle, swapBundles, sweepOldBundles, versionFromTag, type UpdaterDeps } from './updater'

const root = mkdtempSync(join(tmpdir(), 'northshell-updater-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
let counter = 0
const freshDir = (): string => {
  const dir = join(root, String(counter++))
  mkdirSync(dir, { recursive: true })
  return dir
}

/** A folder that looks like the app bundle as far as the installer checks. */
function fakeBundle(dir: string, version: string, id = 'com.northshell.app'): string {
  const bundle = join(dir, 'Northshell.app')
  mkdirSync(join(bundle, 'Contents', 'MacOS'), { recursive: true })
  writeFileSync(join(bundle, 'Contents', 'MacOS', 'Northshell'), version)
  writeFileSync(
    join(bundle, 'Contents', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${id}</string><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>`
  )
  return bundle
}

function fakeDmg(version: string, id?: string): string {
  const src = freshDir()
  fakeBundle(src, version, id)
  const dmg = join(freshDir(), `Northshell-${version}-arm64.dmg`)
  const made = spawnSync('/usr/bin/hdiutil', ['create', '-quiet', '-fs', 'HFS+', '-srcfolder', src, '-ov', '-format', 'UDZO', dmg], { encoding: 'utf8' })
  expect(made.status, made.stderr).toBe(0)
  return dmg
}

const versionOf = (bundle: string): string => readFileSync(join(bundle, 'Contents', 'MacOS', 'Northshell'), 'utf8')

describe('versions and checksums', () => {
  it('compares x.y.z numerically', () => {
    expect(isNewer('1.6.1', '1.6.0')).toBe(true)
    expect(isNewer('1.10.0', '1.9.9')).toBe(true)
    expect(isNewer('2.0.0', '1.99.99')).toBe(true)
    expect(isNewer('1.6.0', '1.6.0')).toBe(false)
    expect(isNewer('1.5.9', '1.6.0')).toBe(false)
  })

  it('reads the version only from a release tag', () => {
    expect(versionFromTag('v1.6.1')).toBe('1.6.1')
    expect(versionFromTag('nightly')).toBeNull()
    expect(versionFromTag('v1.6.1/../../evil')).toBeNull()
    expect(versionFromTag(undefined)).toBeNull()
  })

  it('finds a file in SHA256SUMS.txt', () => {
    const sum = 'a'.repeat(64)
    expect(checksumFor(`${'b'.repeat(64)}  other.dmg\n${sum}  app.dmg\n`, 'app.dmg')).toBe(sum)
    expect(checksumFor(`${sum}  other.dmg\n`, 'app.dmg')).toBeNull()
    expect(checksumFor('garbage', 'app.dmg')).toBeNull()
  })
})

describe('where the app runs from', () => {
  it('finds the bundle of the running binary', () => {
    expect(bundleOf('/Applications/Northshell.app/Contents/MacOS/Northshell')).toBe('/Applications/Northshell.app')
    expect(bundleOf('/usr/local/bin/electron')).toBeNull()
  })

  it('refuses disk images, translocated copies and folders it cannot write to', async () => {
    expect(await replaceableBundle('/Volumes/Northshell 1.6.0/Northshell.app/Contents/MacOS/Northshell')).toBeNull()
    expect(await replaceableBundle('/private/var/folders/x/AppTranslocation/y/d/Northshell.app/Contents/MacOS/Northshell')).toBeNull()
    expect(await replaceableBundle('/nonexistent/Northshell.app/Contents/MacOS/Northshell')).toBeNull()
    const dir = freshDir()
    const bundle = fakeBundle(dir, '1.0.0')
    expect(await replaceableBundle(join(bundle, 'Contents', 'MacOS', 'Northshell'))).toBe(bundle)
  })
})

describe('swapBundles', () => {
  it('replaces the bundle and keeps the old files for the app that is still running from them', async () => {
    const dir = freshDir()
    const bundle = fakeBundle(dir, '1.0.0')
    const fresh = fakeBundle(freshDir(), '2.0.0')
    await swapBundles(bundle, fresh)
    expect(versionOf(bundle)).toBe('2.0.0')
    expect(readdirSync(dir).sort()).toEqual([`.Northshell.app.old-${process.pid}`, 'Northshell.app'])
    await sweepOldBundles(bundle)
    expect(readdirSync(dir)).toEqual(['Northshell.app'])
  })

  it('sweeps only its own leftovers', async () => {
    const dir = freshDir()
    const bundle = fakeBundle(dir, '1.0.0')
    for (const name of ['.Northshell.app.old-12', '.Northshell.app.old-x', 'Other.app', '.Other.app.old-12']) mkdirSync(join(dir, name))
    await sweepOldBundles(bundle)
    expect(readdirSync(dir).sort()).toEqual(['.Northshell.app.old-x', '.Other.app.old-12', 'Northshell.app', 'Other.app'])
  })

  it('puts the old bundle back when the new one cannot be moved in', async () => {
    const bundle = fakeBundle(freshDir(), '1.0.0')
    await expect(swapBundles(bundle, join(root, 'missing.app'))).rejects.toThrow()
    expect(versionOf(bundle)).toBe('1.0.0')
  })
})

describe('sweepOldBundles with a copy that will not go', () => {
  it('still removes the others, and removes a real bundle with an asar in it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const dir = freshDir()
    const bundle = fakeBundle(dir, '1.0.0')
    const stuck = join(dir, '.Northshell.app.old-1', 'locked')
    mkdirSync(stuck, { recursive: true })
    writeFileSync(join(stuck, 'file'), 'x')
    chmodSync(stuck, 0o500)
    const real = join(dir, '.Northshell.app.old-2', 'Contents', 'Resources')
    mkdirSync(real, { recursive: true })
    writeFileSync(join(real, 'app.asar'), 'not a folder')
    try {
      await sweepOldBundles(bundle)
      expect(readdirSync(dir).sort()).toEqual(['.Northshell.app.old-1', 'Northshell.app'])
      expect(error).toHaveBeenCalled()
    } finally {
      chmodSync(stuck, 0o700)
      error.mockRestore()
    }
  })
})

describe.runIf(process.platform === 'darwin')('installFromDmg', () => {
  it('installs the app from a real disk image', async () => {
    const bundle = fakeBundle(freshDir(), '1.0.0')
    await installFromDmg(fakeDmg('2.0.0'), bundle, '2.0.0', freshDir())
    expect(versionOf(bundle)).toBe('2.0.0')
  }, 60_000)

  it('keeps the old app when the image holds another version or another app', async () => {
    const dir = freshDir()
    const bundle = fakeBundle(dir, '1.0.0')
    await expect(installFromDmg(fakeDmg('1.5.0'), bundle, '2.0.0', freshDir())).rejects.toThrow('not com.northshell.app 2.0.0')
    await expect(installFromDmg(fakeDmg('2.0.0', 'com.evil.app'), bundle, '2.0.0', freshDir())).rejects.toThrow('com.evil.app')
    expect(versionOf(bundle)).toBe('1.0.0')
    expect(readdirSync(dir)).toEqual(['Northshell.app'])
  }, 60_000)
})

function fakeFetch(routes: Record<string, () => Response>): typeof globalThis.fetch {
  return vi.fn(async (input: Parameters<typeof globalThis.fetch>[0]) => {
    const url = String(input)
    const route = routes[url]
    if (!route) throw new Error(`no route for ${url}`)
    return route()
  }) as unknown as typeof globalThis.fetch
}

const latestIs = (version: string): Response => Response.json({ tag_name: `v${version}` })

const LATEST = 'https://api.github.com/repos/nikserbur/northshell/releases/latest'

function updater(over: Partial<UpdaterDeps>): { updater: Updater; seen: UpdateStatus[]; relaunch: ReturnType<typeof vi.fn> } {
  const seen: UpdateStatus[] = []
  const relaunch = vi.fn()
  const instance = new Updater({
    currentVersion: '1.0.0',
    execPath: '/nonexistent/Northshell.app/Contents/MacOS/Northshell',
    fetch: fakeFetch({ [LATEST]: () => latestIs('2.0.0') }),
    enabled: () => true,
    emit: (s) => seen.push(s),
    relaunch,
    ...over
  })
  return { updater: instance, seen, relaunch }
}

describe('Updater.check', () => {
  it('offers a newer release, and says when it cannot install it itself', async () => {
    const { updater: u } = updater({})
    await u.check()
    expect(u.current()).toEqual({ state: 'available', version: '2.0.0', url: 'https://github.com/nikserbur/northshell/releases/tag/v2.0.0', canInstall: false })
  })

  it('stays quiet when up to date, turned off or offline', async () => {
    const same = updater({ currentVersion: '2.0.0' })
    await same.updater.check()
    expect(same.seen).toEqual([])

    const off = updater({ enabled: () => false })
    await off.updater.check()
    expect(off.seen).toEqual([])
    expect(off.updater.current()).toEqual({ state: 'idle' })

    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const offline = updater({ fetch: fakeFetch({}) })
    await offline.updater.check()
    expect(offline.seen).toEqual([])

    const limited = updater({ fetch: fakeFetch({ [LATEST]: () => new Response('rate limit', { status: 403 }) }) })
    await limited.updater.check()
    expect(limited.seen).toEqual([])
    error.mockRestore()
  })
})

describe.runIf(process.platform === 'darwin')('Updater.install', () => {
  const FILE = 'Northshell-2.0.0-arm64.dmg'
  const BASE = 'https://github.com/nikserbur/northshell/releases/download/v2.0.0'
  const setup = (sumsFor: (dmg: Buffer) => string) => {
    const dmg = readFileSync(fakeDmg('2.0.0'))
    const bundle = fakeBundle(freshDir(), '1.0.0')
    return {
      bundle,
      ...updater({
        execPath: join(bundle, 'Contents', 'MacOS', 'Northshell'),
        fetch: fakeFetch({
          [LATEST]: () => latestIs('2.0.0'),
          [`${BASE}/SHA256SUMS.txt`]: () => new Response(sumsFor(dmg)),
          [`${BASE}/${FILE}`]: () => new Response(dmg, { headers: { 'content-length': String(dmg.length) } })
        })
      })
    }
  }

  it('downloads, checks, installs and restarts', async () => {
    const { bundle, updater: u, seen, relaunch } = setup((dmg) => `${createHash('sha256').update(dmg).digest('hex')}  ${FILE}\n`)
    await u.check()
    await u.install()
    expect(versionOf(bundle)).toBe('2.0.0')
    expect(relaunch).toHaveBeenCalledOnce()
    expect(seen.map((s) => s.state)).toContain('downloading')
    expect(seen.at(-1)?.state).toBe('installing')
    expect(seen.some((s) => s.state === 'downloading' && s.progress === 100)).toBe(true)
  }, 60_000)

  it('refuses a download that does not match its checksum, and stays on the old version', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { bundle, updater: u, relaunch } = setup(() => `${'0'.repeat(64)}  ${FILE}\n`)
    await u.check()
    await u.install()
    expect(u.current()).toMatchObject({ state: 'error', message: expect.stringContaining('checksum'), canInstall: true })
    expect(versionOf(bundle)).toBe('1.0.0')
    expect(relaunch).not.toHaveBeenCalled()
    error.mockRestore()
  }, 60_000)

  it('explains a location it cannot replace itself from', async () => {
    const { updater: u } = updater({})
    await u.check()
    await u.install()
    expect(u.current()).toMatchObject({ state: 'error', canInstall: false })
  })
})

describe('scripts/install.sh', () => {
  const script = resolve(__dirname, '../../scripts/install.sh')

  it('is valid bash', () => {
    const res = spawnSync('/bin/bash', ['-n', script], { encoding: 'utf8' })
    expect(res.stderr).toBe('')
    expect(res.status).toBe(0)
  })

  it('runs only once it is complete, so a cut-off download does nothing', () => {
    const lines = readFileSync(script, 'utf8').trim().split('\n')
    expect(lines.at(-1)).toBe('main "$@"')
    expect(existsSync(script)).toBe(true)
  })
})
