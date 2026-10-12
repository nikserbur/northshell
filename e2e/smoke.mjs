// End-to-end smoke test against the built app (run `npm run build` first).
// Optional SSH flow: set XMT_E2E_SSH_HOST, XMT_E2E_SSH_PORT, XMT_E2E_SSH_USER, XMT_E2E_SSH_KEY.
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

const root = resolve(import.meta.dirname, '..')
const shots = join(root, 'e2e', 'screenshots')
mkdirSync(shots, { recursive: true })
const dataDir = mkdtempSync(join(tmpdir(), 'xmt-e2e-'))
const ssh = {
  host: process.env.XMT_E2E_SSH_HOST,
  port: process.env.XMT_E2E_SSH_PORT ?? '22',
  user: process.env.XMT_E2E_SSH_USER,
  key: process.env.XMT_E2E_SSH_KEY
}

let failures = 0
let page = null
async function step(name, fn) {
  const started = Date.now()
  try {
    await fn()
    console.log(`  ✓ ${name} (${Date.now() - started}ms)`)
  } catch (err) {
    failures++
    await page?.screenshot({ path: join(shots, `fail-${name.replace(/[^a-z0-9]+/gi, '-')}.png`) }).catch(() => undefined)
    console.log(`  ✗ ${name}\n    ${err instanceof Error ? err.message.split('\n')[0] : err}`)
  }
}

const app = await electron.launch({
  args: [join(root, 'e2e', 'launch-main.cjs')],
  env: { ...process.env, XMT_E2E_DATA: dataDir }
})
page = await app.firstWindow()
if (process.env.XMT_E2E_DEBUG) {
  app.process().stdout?.on('data', (d) => process.stdout.write(`[main] ${d}`))
  app.process().stderr?.on('data', (d) => process.stdout.write(`[main:err] ${d}`))
  page.on('console', (m) => console.log(`[renderer:${m.type()}] ${m.text()}`))
  page.on('crash', () => console.log('[renderer] CRASHED'))
}
const shot = (name) => page.screenshot({ path: join(shots, `${name}.png`) })
async function waitForFile(path, expected, timeout = 10000) {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    if (existsSync(path) && readFileSync(path, 'utf8').includes(expected)) return
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`${path} did not contain ${expected}`)
}

console.log('Northshell E2E')

await step('welcome screen renders', async () => {
  await page.waitForSelector('.welcome h1', { timeout: 15000 })
  await page.waitForTimeout(600)
  await shot('01-welcome')
})

await step('local terminal runs a command (UTF-8 round trip)', async () => {
  await page.click('.welcome-actions .btn:nth-child(2)')
  await page.waitForSelector('.term-host.active .xterm-screen', { timeout: 10000 })
  await page.waitForSelector('.tab.active', { timeout: 5000 })
  await page.waitForTimeout(1500)
  const marker = join(dataDir, 'local-marker.txt')
  await page.keyboard.type(`echo "hello-$((40+2)) Привет" > '${marker}'; echo "Привет, мир ✓"\n`)
  await waitForFile(marker, 'hello-42 Привет')
})

await step('status bar shows local stats', async () => {
  await page.waitForFunction(() => document.querySelector('.statusbar')?.textContent?.includes('%'), null, { timeout: 15000 })
  await shot('02-local-terminal')
})

await step('monitor panel opens', async () => {
  await page.click('.sb-toggle')
  await page.waitForSelector('.monitor .mon-card', { timeout: 5000 })
  await page.waitForTimeout(3500)
  await shot('03-monitor-local')
  await page.click('.sb-toggle')
})

await step('command palette filters actions', async () => {
  await page.click('.titlebar-actions .icon-btn:nth-child(3)')
  await page.waitForSelector('.palette input')
  await page.keyboard.type('set')
  await page.waitForSelector('.palette-item:has-text("Настройки")', { timeout: 3000 })
  await page.waitForTimeout(250)
  await shot('04-palette')
  await page.keyboard.press('Escape')
})

if (ssh.host && ssh.key && ssh.user) {
  await step('create SSH session with key auth', async () => {
    await page.click('.sidebar-top .icon-btn:nth-child(2)')
    await page.waitForSelector('.modal')
    await page.fill('.modal input.input.mono >> nth=0', ssh.host)
    await page.fill('.modal input[inputmode="numeric"]', ssh.port)
    await page.fill('.modal .grid-2 input >> nth=0', ssh.user)
    await page.fill('.modal .grid-2 input >> nth=1', 'Test server')
    await page.click('.modal .segmented button:nth-child(2)')
    await page.fill('.modal input[placeholder="~/.ssh/id_ed25519"]', ssh.key)
    await page.fill('.modal input[list="xmt-folders"]', 'staging')
    await shot('05-session-editor')
    await page.click('.modal-foot .btn.primary')
  })

  await step('host key prompt → trust', async () => {
    await page.waitForSelector('.fingerprint', { timeout: 15000 })
    await page.waitForTimeout(400)
    await shot('06-hostkey')
    await page.click('.modal-foot .btn.primary')
  })

    await step('SSH shell connects and runs a command', async () => {
    await page.waitForSelector('.tab.active .dot.connected', { timeout: 20000 })
    await page.waitForTimeout(800)
    await page.click('.term-host.active')
    await page.keyboard.type('echo "ssh-$((6*7))" > xmt-e2e-marker.txt\n')
    await page.waitForTimeout(800)
  })

  await step('SFTP panel lists remote home (sees file created in shell)', async () => {
    await page.waitForSelector('.sftp .file-row', { timeout: 15000 })
    await page.click('.sftp-head .icon-btn:nth-child(4)')
    await page.waitForSelector('.file-row:has-text("xmt-e2e-marker.txt")', { timeout: 10000 })
  })

  await step('SFTP upload and remote stats', async () => {
    const local = join(dataDir, 'xmt-upload-test.txt')
    writeFileSync(local, 'uploaded by e2e\n'.repeat(1000))
    const tabId = await page.evaluate(() => document.querySelector('.tab.active')?.getAttribute('data-id'))
    const dir = await page.evaluate((id) => window.xmt.sftp.home(id), tabId)
    await page.evaluate(([id, d, p]) => window.xmt.sftp.upload(id, d, [p]), [tabId, dir, local])
    await page.waitForSelector('.file-row:has-text("xmt-upload-test.txt")', { timeout: 15000 })
    await page.waitForFunction(() => document.querySelector('.statusbar')?.textContent?.includes('%'), null, { timeout: 20000 })
    await page.click('.file-row:has-text("xmt-upload-test.txt")')
    await shot('07-ssh-sftp')
  })

  await step('SFTP deep search finds the uploaded file', async () => {
    await page.fill('.sftp-search input', 'xmt-upload')
    await page.press('.sftp-search input', 'Enter')
    await page.waitForSelector('.search-banner', { timeout: 20000 })
    await page.waitForSelector('.search-hit:has-text("xmt-upload-test.txt")', { timeout: 5000 })
    await shot('12-sftp-search')
    await page.click('.search-banner .icon-btn')
    await page.fill('.sftp-search input', '')
  })

  await step('SFTP sort by size', async () => {
    await page.click('.sftp-cols button:nth-child(2)')
    await page.waitForSelector('.sftp-cols button.on:has-text("Размер")', { timeout: 3000 })
    await page.click('.sftp-cols button:nth-child(1)')
  })

  await step('edit remote file and save (⌘S)', async () => {
    await page.dblclick('.file-row:has-text("xmt-upload-test.txt")')
    await page.waitForSelector('.editor-window .cm-content', { timeout: 10000 })
    await page.click('.editor-window .cm-content')
    await page.keyboard.press('Meta+ArrowUp')
    await page.keyboard.type('EDITED-BY-E2E\n')
    await page.waitForSelector('.dirty-dot', { timeout: 3000 })
    await shot('13-editor')
    await page.keyboard.press('Meta+s')
    await page.waitForSelector('.dirty-dot', { state: 'detached', timeout: 10000 })
    await waitForFile(join(homedir(), 'xmt-upload-test.txt'), 'EDITED-BY-E2E')
    await page.click('.editor-head .icon-btn')
    await page.waitForSelector('.editor-window', { state: 'detached', timeout: 3000 })
  })

  await step('chmod via context menu', async () => {
    await page.click('.file-row:has-text("xmt-upload-test.txt")', { button: 'right' })
    await page.click('.ctx-menu button:has-text("Права доступа")')
    await page.fill('.modal input', '600')
    await page.press('.modal input', 'Enter')
    const file = join(homedir(), 'xmt-upload-test.txt')
    const until = Date.now() + 5000
    while ((statSync(file).mode & 0o777) !== 0o600 && Date.now() < until) await new Promise((r) => setTimeout(r, 150))
    if ((statSync(file).mode & 0o777) !== 0o600) throw new Error('mode not applied')
  })

  await step('SFTP delete', async () => {
    for (const name of ['xmt-upload-test.txt', 'xmt-e2e-marker.txt']) {
      await page.click(`.file-row:has-text("${name}")`, { button: 'right' })
      await page.click('.ctx-menu button.danger')
      await page.click('.modal-foot .btn.danger')
      await page.waitForSelector(`.file-row:has-text("${name}")`, { state: 'detached', timeout: 10000 })
    }
  })

  await step('deleting a symlink to a folder keeps the target contents', async () => {
    const target = join(homedir(), 'xmt-e2e-target')
    const link = join(homedir(), 'xmt-e2e-link')
    rmSync(target, { recursive: true, force: true })
    rmSync(link, { force: true })
    mkdirSync(target)
    writeFileSync(join(target, 'keep.txt'), 'keep')
    symlinkSync(target, link)
    try {
      await page.click('.sftp-head .icon-btn:nth-child(4)')
      await page.click('.file-row:has-text("xmt-e2e-link")', { button: 'right' })
      await page.click('.ctx-menu button.danger')
      await page.click('.modal-foot .btn.danger')
      await page.waitForSelector('.file-row:has-text("xmt-e2e-link")', { state: 'detached', timeout: 10000 })
      if (!existsSync(join(target, 'keep.txt'))) throw new Error('symlink target contents were deleted')
      let linkGone = false
      try {
        lstatSync(link)
      } catch {
        linkGone = true
      }
      if (!linkGone) throw new Error('symlink was not removed')
    } finally {
      rmSync(target, { recursive: true, force: true })
      rmSync(link, { force: true })
    }
  })

  await step('remote monitor panel', async () => {
    await page.click('.sb-toggle')
    await page.waitForTimeout(2500)
    await shot('08-monitor-remote')
    await page.click('.sb-toggle')
  })

  await step('reconnect after remote exit', async () => {
    await page.click('.term-host.active')
    await page.keyboard.type('exit\n')
    await page.waitForSelector('.term-overlay', { timeout: 10000 })
    await shot('09-disconnected')
    await page.click('.term-overlay .btn.primary')
    await page.waitForSelector('.tab.active .dot.connected', { timeout: 20000 })
  })
}

await step('hover tooltip explains icon buttons', async () => {
  await page.hover('.titlebar-actions .icon-btn:nth-child(4)')
  await page.waitForSelector('.tooltip:has-text("Настройки")', { timeout: 3000 })
  await page.mouse.move(700, 500)
})

await step('sessions sidebar can be resized by dragging', async () => {
  const before = (await page.locator('.sidebar').boundingBox()).width
  const handle = await page.locator('.sidebar .resize-handle').boundingBox()
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 200)
  await page.mouse.down()
  await page.mouse.move(handle.x + 90, handle.y + 200, { steps: 6 })
  await page.mouse.up()
  const after = (await page.locator('.sidebar').boundingBox()).width
  if (after - before < 60) throw new Error(`sidebar width ${before} → ${after}`)
  await page.dblclick('.sidebar .resize-handle')
})

await step('settings dialog and light theme', async () => {
  await page.click('.titlebar-actions .icon-btn:nth-child(4)')
  await page.waitForSelector('.settings')
  await page.waitForTimeout(400)
  await shot('10-settings')
  await page.click('.ui-theme-card:has-text("Светлая")')
  await page.click('.theme-chip:has-text("Paper")')
  await page.waitForTimeout(400)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await shot('11-light-theme')
})

await app.close()
console.log(failures === 0 ? '\nAll E2E steps passed' : `\n${failures} step(s) failed`)
process.exit(failures === 0 ? 0 : 1)
