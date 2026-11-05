// Screenshots of features that need no SSH server: the HTTP request panel and video memory in the monitor.
// Usage: npm run build && node e2e/feature-shots.mjs   (XMT_DEMO_OUT changes the output folder, XMT_DEMO_LANG the language)
// Like e2e/demo-shots.mjs it runs with a throw-away HOME and data folder and a neutral shell; the API is a local
// demo server started here, and the Mac's own name, user and processes are masked before anything is captured.
import { randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir, hostname, tmpdir, userInfo } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'
import sharp from 'sharp'

const root = resolve(import.meta.dirname, '..')
const out = process.env.XMT_DEMO_OUT ?? join(root, 'docs', 'screenshots')
mkdirSync(out, { recursive: true })

const orders = [
  { id: 10482, customer: 'Ada Lovelace', total: 129.9, currency: 'EUR', status: 'paid', items: 3 },
  { id: 10481, customer: 'Grace Hopper', total: 54.0, currency: 'EUR', status: 'shipped', items: 1 },
  { id: 10480, customer: 'Alan Turing', total: 310.5, currency: 'EUR', status: 'pending', items: 6 },
  { id: 10479, customer: 'Katherine Johnson', total: 18.25, currency: 'EUR', status: 'paid', items: 2 }
]
const api = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://demo')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('X-Request-Id', 'req_7f3c9a12')
  if (url.pathname === '/v1/orders') {
    const limit = Number(url.searchParams.get('limit') ?? 10)
    res.end(JSON.stringify({ data: orders.slice(0, limit), page: { limit, next: '/v1/orders?cursor=10479' } }))
  } else {
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'not_found' }))
  }
})
await new Promise((r) => api.listen(0, '127.0.0.1', r))
const apiBase = `http://127.0.0.1:${api.address().port}`

const now = Date.now()
const dataDir = mkdtempSync(join(tmpdir(), 'xmt-shots-'))
const session = (name, folder, extra) => ({
  id: randomUUID(),
  kind: 'ssh',
  name,
  folder,
  host: '10.0.4.21',
  port: 22,
  username: 'deploy',
  auth: 'agent',
  keyPath: '',
  color: '#5eead4',
  startupCommand: '',
  monitoring: true,
  sftp: true,
  baseUrl: '',
  headers: '',
  insecure: false,
  createdAt: now,
  lastUsedAt: 0,
  useCount: 0,
  ...extra
})
const sessions = [
  session('prod-web-01', 'production', { lastUsedAt: now - 60_000 }),
  session('db-primary', 'production', { host: '10.0.3.4', username: 'postgres', color: '#a78bfa' }),
  session('staging-api', 'staging', { host: 'staging.example.com', color: '#fbbf24' }),
  session('api-prod', 'api', {
    kind: 'http',
    host: '',
    username: '',
    port: 443,
    auth: 'password',
    monitoring: false,
    sftp: false,
    baseUrl: `${apiBase}/v1`,
    headers: 'Accept: application/json',
    lastUsedAt: now - 1_800_000
  })
]
writeFileSync(join(dataDir, 'sessions.json'), JSON.stringify({ version: 1, sessions }))

const homeDir = mkdtempSync(join(tmpdir(), 'xmt-home-'))
const localShell = join(homeDir, 'demo-shell.sh')
writeFileSync(
  localShell,
  [
    '#!/bin/sh',
    'set --',
    '[ -n "$BASE_URL" ] && set -- "BASE_URL=$BASE_URL"',
    '[ -n "$CURL_HOME" ] && set -- "$@" "CURL_HOME=$CURL_HOME"',
    `exec /usr/bin/env -i HOME='${homeDir}' USER=demo LOGNAME=demo HOSTNAME=northshell SHELL=/bin/bash TERM=xterm-256color LANG=en_US.UTF-8 PATH=/usr/bin:/bin:/usr/sbin:/sbin BASH_SILENCE_DEPRECATION_WARNING=1 PS1='demo@northshell:~$ ' "$@" /bin/bash --norc --noprofile`,
    ''
  ].join('\n')
)
chmodSync(localShell, 0o755)
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ monitorInterval: 2, language: process.env.XMT_DEMO_LANG ?? 'en', localShell }))

const app = await electron.launch({
  args: [join(root, 'e2e', 'launch-main.cjs')],
  env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: homeDir, USER: 'demo', LANG: 'en_US.UTF-8', TMPDIR: tmpdir(), XMT_E2E_DATA: dataDir }
})
const page = await app.firstWindow()

const apiHost = new URL(apiBase).host
const masks = [
  [`${apiBase}`, 'https://api.example.com'],
  [apiHost, 'api.example.com'],
  [hostname(), 'demo-mac'],
  [hostname().replace(/\.local$/, ''), 'demo-mac'],
  [userInfo().username, 'demo']
]
const procs = ['ollama', 'node', 'postgres', 'python3', 'Code Helper', 'redis-server', 'nginx']
const personal = [hostname(), hostname().replace(/\.local$/, ''), userInfo().username, homedir(), apiHost].filter((v) => v.length > 3)

async function shot(name) {
  await page.evaluate(
    ({ masks, procs }) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.parentElement?.closest('.xterm')) continue
        let v = n.nodeValue ?? ''
        for (const [from, to] of masks) v = v.split(from).join(to)
        if (v !== n.nodeValue) n.nodeValue = v
      }
      document.querySelectorAll('.proc-table td.name').forEach((td, i) => (td.textContent = procs[i % procs.length]))
      document.querySelectorAll('[title]').forEach((el) => el.removeAttribute('title'))
      // Mounted disk images and USB sticks of the machine running this are not part of the demo.
      document.querySelectorAll('.bar-line').forEach((bar) => {
        if (bar.querySelector('.top span')?.textContent?.startsWith('/Volumes/')) bar.remove()
      })
      document.querySelectorAll('.sb-disk').forEach((d) => !d.textContent?.startsWith('/:') && d.remove())
    },
    { masks, procs }
  )
  const leaked = await page.evaluate((needles) => needles.filter((n) => document.body.innerText.includes(n)), personal)
  if (leaked.length > 0) throw new Error(`${name}: personal details still visible after masking`)
  await page.waitForTimeout(150)
  await sharp(await page.screenshot())
    .resize(1600)
    .png({ compressionLevel: 9, palette: false })
    .toFile(join(out, `${name}.png`))
  console.log(`  ✓ ${name}`)
}

/** Clears the active terminal (⌘K) so the canvas holds nothing that DOM masking cannot reach. */
const clearTerminal = () =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu:action', 'clear'))

await page.waitForSelector('.welcome h1')

// HTTP request panel: a saved environment, a request with a {{limit}} parameter, the JSON response beside the terminal.
await page.dblclick('.session-row:has-text("api-prod")')
await page.waitForSelector('.http-panel')
await page.waitForTimeout(800)
await page.click('.cmd-panel .sftp-head .icon-btn:last-child')
await page.fill('.http-panel .http-line input', '/orders?limit={{limit:3}}')
await page.fill('.http-panel .http-param input', '3')
await page.fill('.http-panel textarea', 'X-Request-Id: 7f3c9a12')
await page.click('.http-panel .http-line .btn.primary')
await page.waitForSelector('.http-status:has-text("200")', { timeout: 10000 })
await clearTerminal()
await page.click('.term-host.active')
await page.keyboard.type('# ⇧⌘R request panel · ⇧⌘L saved requests\n')
await page.waitForTimeout(400)
await shot('http-request')

// Video memory: this Mac's GPU next to CPU and memory in the monitor (Apple Silicon only).
if (process.arch === 'arm64') {
  await page.click('.welcome-actions .btn:nth-child(2)').catch(async () => {
    await page.click('.tab.home')
    await page.click('.welcome-actions .btn:nth-child(2)')
  })
  await page.waitForSelector('.term-host.active .xterm-screen')
  await page.waitForTimeout(800)
  await page.keyboard.type('echo "GPU memory in the status bar and the monitor (⇧⌘M)"\n')
  await page.click('.sb-toggle')
  await page.waitForSelector('.monitor.has-gpu .mon-gpu .bar-line', { timeout: 10000 })
  await page.waitForTimeout(8000)
  await shot('monitor-gpu')
}

await app.close()
api.close()
