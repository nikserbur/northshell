// Finds buttons that overflow or get clipped by their panel at various window and panel widths.
// Usage (after npm run build): node e2e/layout-check.mjs   (optional SSH env as in smoke.mjs to include the SFTP panel)
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

const root = resolve(import.meta.dirname, '..')
const env = process.env
const dataDir = mkdtempSync(join(tmpdir(), 'xmt-layout-'))
if (env.XMT_LAYOUT_THEME) writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ uiTheme: env.XMT_LAYOUT_THEME }))
const app = await electron.launch({
  args: [join(root, 'e2e', 'launch-main.cjs')],
  env: { ...env, XMT_E2E_DATA: dataDir }
})
const page = await app.firstWindow()
await page.waitForSelector('.welcome h1')

const setSize = (w, h) =>
  app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h), [w, h])

if (env.XMT_E2E_SSH_HOST) {
  await page.evaluate(
    ([host, port, user, key]) =>
      window.xmt.sessions.save({
        name: 'layout', folder: '', host, port: Number(port), username: user, auth: 'key', keyPath: key,
        color: '#5eead4', startupCommand: '', monitoring: true, sftp: true
      }),
    [env.XMT_E2E_SSH_HOST, env.XMT_E2E_SSH_PORT ?? '22', env.XMT_E2E_SSH_USER, env.XMT_E2E_SSH_KEY]
  )
  await page.reload()
  await page.waitForSelector('.welcome h1')
}

async function audit(label) {
  const problems = await page.evaluate(() => {
    const panels = '.sidebar, .sftp, .titlebar, .statusbar, .welcome-inner, .modal, .editor-head, .sftp-head, .sidebar-footer, .sidebar-top'
    const out = []
    for (const el of document.querySelectorAll('button, .btn, .icon-btn, .sb-seg, .sb-toggle')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || getComputedStyle(el).visibility === 'hidden') continue
      const panel = el.parentElement?.closest(panels)
      const p = panel ? panel.getBoundingClientRect() : { left: 0, right: innerWidth, top: 0, bottom: innerHeight }
      const clipped = r.right > p.right + 1 || r.left < p.left - 1 || r.right > innerWidth + 1
      const squashed = el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow !== 'visible'
      if (clipped || squashed) {
        const name = (el.getAttribute('data-tip') || el.getAttribute('title') || el.textContent || el.className).trim().slice(0, 40)
        out.push(`${panel?.className.split(' ')[0] ?? 'window'} › ${name} ${clipped ? '[clipped]' : '[squashed]'}`)
      }
    }
    return [...new Set(out)]
  })
  console.log(`\n${label}: ${problems.length ? '' : 'OK'}`)
  problems.forEach((p) => console.log('  ✗', p))
}

for (const [w, h] of [[1440, 900], [1100, 760], [900, 600]]) {
  await setSize(w, h)
  await page.waitForTimeout(300)
  await audit(`welcome ${w}px`)
}
if (env.XMT_E2E_SSH_HOST) {
  await setSize(1440, 900)
  await page.dblclick('.session-row:has-text("layout")')
  await page.waitForSelector('.fingerprint', { timeout: 15000 })
  await page.click('.modal-foot .btn.primary')
  await page.waitForSelector('.sftp .file-row', { timeout: 20000 })
  await page.click('.sb-toggle')
  await page.waitForTimeout(3000)
  for (const [w, h] of [[1440, 900], [1100, 760], [900, 600]]) {
    await setSize(w, h)
    await page.waitForTimeout(400)
    await audit(`ssh tab ${w}px`)
  }
  // narrowest panels
  for (const sel of ['.sidebar', '.sftp']) {
    const box = await page.locator(`${sel} > .resize-handle`).boundingBox()
    await page.mouse.move(box.x + 5, box.y + 150)
    await page.mouse.down()
    await page.mouse.move(box.x - 400, box.y + 150, { steps: 5 })
    await page.mouse.up()
  }
  await page.waitForTimeout(300)
  await audit('ssh tab 900px, narrowest panels')
  await page.screenshot({ path: join(root, 'e2e', 'screenshots', `layout-narrow-${env.XMT_LAYOUT_THEME ?? 'dark'}.png`) })
}
await app.close()
