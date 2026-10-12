// Generates the README screenshots against a demo project on a test SSH server.
// Usage: XMT_E2E_SSH_HOST=… XMT_E2E_SSH_PORT=… XMT_E2E_SSH_USER=… XMT_E2E_SSH_KEY=… XMT_DEMO_DIR=… node e2e/demo-shots.mjs
// Personal details of the machine running the demo (hostname, user, paths, process names) are masked in the DOM.
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { hostname, tmpdir, userInfo } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'
import sharp from 'sharp'

const root = resolve(import.meta.dirname, '..')
const out = join(root, 'docs', 'screenshots')
mkdirSync(out, { recursive: true })
const env = process.env
const demoDir = env.XMT_DEMO_DIR
if (!env.XMT_E2E_SSH_HOST || !env.XMT_E2E_SSH_KEY || !demoDir) throw new Error('SSH env and XMT_DEMO_DIR are required')

const dataDir = mkdtempSync(join(tmpdir(), 'xmt-demo-'))
const now = Date.now()
const session = (name, folder, host, username, color, extra = {}) => ({
  id: randomUUID(),
  name,
  folder,
  host,
  port: 22,
  username,
  auth: 'agent',
  keyPath: '',
  color,
  startupCommand: '',
  monitoring: true,
  sftp: true,
  createdAt: now,
  lastUsedAt: 0,
  useCount: 0,
  ...extra
})
const prompt = 'deploy@prod-web-01:/srv/www/app$ '
const demoParts = demoDir.split('/').filter(Boolean)
const demo = session('prod-web-01', 'production', env.XMT_E2E_SSH_HOST, env.XMT_E2E_SSH_USER, '#5eead4', {
  port: Number(env.XMT_E2E_SSH_PORT ?? 22),
  auth: 'key',
  keyPath: env.XMT_E2E_SSH_KEY,
  startupCommand: `cd '${demoDir}' && export PS1='${prompt}' PROMPT='${prompt}' && clear && ls -G && cat deploy.log`,
  lastUsedAt: now - 60_000
})
const sessions = [
  demo,
  session('prod-web-02', 'production', '10.0.4.22', 'deploy', '#5eead4', { lastUsedAt: now - 3_600_000 }),
  session('db-primary', 'production', '10.0.3.4', 'postgres', '#a78bfa', { lastUsedAt: now - 7_200_000 }),
  session('staging-api', 'staging', 'staging.example.com', 'deploy', '#fbbf24', { lastUsedAt: now - 86_400_000 }),
  session('k8s-node-1', 'staging', '10.1.0.11', 'ops', '#60a5fa'),
  session('bastion', 'infra', 'bastion.example.com', 'ops', '#f472b6', { lastUsedAt: now - 172_800_000 }),
  session('raspberry-pi', 'home lab', '192.168.1.50', 'pi', '#4ade80'),
  session('web-03', 'production', env.XMT_E2E_SSH_HOST, env.XMT_E2E_SSH_USER, '#fbbf24', {
    port: Number(env.XMT_E2E_SSH_PORT ?? 22),
    auth: 'key',
    keyPath: env.XMT_E2E_SSH_KEY,
    startupCommand: `cd '${demoDir}' && export PS1='deploy@web-03:~$ ' PROMPT='deploy@web-03:~$ ' && clear && cat .motd`
  })
]
writeFileSync(join(dataDir, 'sessions.json'), JSON.stringify({ version: 1, sessions }))
const hostKey = readFileSync(`${env.XMT_E2E_SSH_KEY.replace(/user_ed25519$/, 'host_ed25519')}.pub`, 'utf8').split(' ')[1]
const fingerprint = `SHA256:${createHash('sha256').update(Buffer.from(hostKey, 'base64')).digest('base64').replace(/=+$/, '')}`
writeFileSync(
  join(dataDir, 'known_hosts.json'),
  JSON.stringify({ [`${env.XMT_E2E_SSH_HOST}:${demo.port}`]: { fingerprint, keyType: 'ssh-ed25519', addedAt: now } })
)
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ monitorInterval: 2 }))

const app = await electron.launch({ args: [join(root, 'e2e', 'launch-main.cjs')], env: { ...env, XMT_E2E_DATA: dataDir } })
const page = await app.firstWindow()

const masks = [
  [hostname(), 'prod-web-01'],
  [hostname().replace(/\.local$/, ''), 'prod-web-01'],
  [`${userInfo().username}@${env.XMT_E2E_SSH_HOST}`, 'deploy@10.0.4.21'],
  [userInfo().username, 'deploy'],
  [env.XMT_E2E_SSH_HOST, '10.0.4.21'],
  [`:${demo.port}`, '']
]
const procs = ['nginx', 'node', 'postgres', 'redis-server', 'python3', 'dockerd', 'sshd', 'containerd']

async function mask() {
  await page.evaluate(
    ({ masks, procs, demoDir, demoParts }) => {
      document.querySelectorAll('.editor-path').forEach((el) => (el.textContent = (el.textContent ?? '').replace(demoDir, '/srv/www/app')))
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.parentElement?.closest('.cm-editor, .xterm')) continue
        let v = n.nodeValue ?? ''
        if (!masks.some(([from]) => v.includes(from))) continue
        for (const [from, to] of masks) v = v.split(from).join(to)
        n.nodeValue = v
      }
      document.querySelectorAll('.proc-table td.name').forEach((td, i) => (td.textContent = procs[i % procs.length]))
      // Breadcrumbs: hide the scratch prefix and show /srv/www/… instead (text/style only — React owns these nodes).
      const wraps = [...document.querySelectorAll('.sftp-path .crumb-wrap')]
      if (wraps.length >= demoParts.length && wraps[0].textContent === demoParts[0]) {
        wraps.forEach((w, i) => {
          if (i < demoParts.length - 3) w.style.display = 'none'
          const crumb = w.querySelector('.crumb')
          if (i === demoParts.length - 3) {
            crumb.textContent = 'srv'
            w.querySelector('.crumb-sep')?.setAttribute('style', 'display:none')
          }
          if (i === demoParts.length - 2) crumb.textContent = 'www'
        })
      }
    },
    { masks, procs, demoDir, demoParts }
  )
}

async function shot(name) {
  await mask()
  await page.waitForTimeout(150)
  const buf = await page.screenshot()
  await sharp(buf).resize(1600).png({ compressionLevel: 9, palette: false }).toFile(join(out, `${name}.png`))
  console.log(`  ✓ ${name}`)
}

await page.waitForSelector('.welcome h1')
await page.waitForTimeout(800)
await shot('welcome')

await page.dblclick('.session-row:has-text("prod-web-01")')
await page.waitForSelector('.tab.active .dot.connected', { timeout: 20000 })
await page.waitForSelector('.sftp .crumb', { timeout: 10000 })
await page.click('.sftp-path .icon-btn')
await page.fill('.sftp-path input', demoDir)
await page.press('.sftp-path input', 'Enter')
await page.waitForSelector('.file-row:has-text("docker-compose.yml")', { timeout: 10000 })
await page.click('.sb-toggle')
await page.waitForTimeout(9000)
await page.click('.file-row:has-text("docker-compose.yml")')
await page.click('.term-host.active')
await shot('main')

await page.dblclick('.file-row:has-text("nginx")')
await page.waitForSelector('.file-row:has-text("nginx.conf")')
await page.dblclick('.file-row:has-text("nginx.conf")')
await page.waitForSelector('.editor-window .cm-content')
await page.waitForTimeout(600)
await shot('editor')
await page.click('.editor-head .icon-btn')
await page.click('.sb-toggle')

await page.click('.crumb:not(.last) >> nth=-1')
await page.fill('.sftp-search input', '*.py')
await page.press('.sftp-search input', 'Enter')
await page.waitForSelector('.search-banner', { timeout: 20000 })
await page.waitForTimeout(300)
await shot('sftp-search')
await page.click('.search-banner .icon-btn')

await page.click('.titlebar-actions .icon-btn:nth-child(4)')
await page.waitForSelector('.settings')
await page.waitForTimeout(400)
await shot('settings')
await page.click('.ui-theme-card:has-text("Светлая")')
await page.click('.theme-chip:has-text("Paper")')
await page.keyboard.press('Escape')
await page.waitForTimeout(500)
await shot('light')

for (const [label, name] of [
  ['Visual Studio', 'theme-vs'],
  ['Windows 95', 'theme-retro']
]) {
  await page.click('.titlebar-actions .icon-btn:nth-child(4)')
  await page.waitForSelector('.settings')
  await page.click(`.ui-theme-card:has-text("${label}")`)
  await page.waitForTimeout(300)
  if (name === 'theme-retro') await shot(`${name}-settings`)
  await page.keyboard.press('Escape')
  await page.click('.sb-toggle')
  await page.waitForTimeout(2500)
  await shot(name)
  await page.click('.sb-toggle')
  if (name === 'theme-retro') {
    await page.click('.tab.home')
    await page.waitForTimeout(400)
    await shot(`${name}-welcome`)
    await page.click('.tab:has-text("prod-web-01")')
  } else {
    await page.dblclick('.file-row:has-text("docker-compose.yml")')
    await page.waitForSelector('.editor-window .cm-content')
    await page.waitForTimeout(500)
    await shot(`${name}-editor`)
    await page.click('.editor-head .icon-btn')
  }
}

// MobaXterm theme: info box + output highlighting on a fresh session
await page.click('.titlebar-actions .icon-btn:nth-child(4)')
await page.waitForSelector('.settings')
await page.click('.ui-theme-card:has-text("MobaXterm")')
await page.keyboard.press('Escape')
await page.dblclick('.session-row:has-text("web-03")')
await page.waitForSelector('.tab.active .dot.connected', { timeout: 20000 })
await page.waitForSelector('.sftp .crumb', { timeout: 10000 })
await page.click('.sftp-path .icon-btn')
await page.fill('.sftp-path input', demoDir)
await page.press('.sftp-path input', 'Enter')
await page.waitForSelector('.file-row:has-text("docker-compose.yml")', { timeout: 10000 })
await page.waitForTimeout(8000)
await page.click('.term-host.active')
await shot('theme-moba')

await app.close()
console.log(`screenshots → ${out}`)
