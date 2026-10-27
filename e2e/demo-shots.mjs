// Generates the README screenshots against a demo project on a test SSH server.
// Usage: XMT_E2E_SSH_HOST=… XMT_E2E_SSH_PORT=… XMT_E2E_SSH_USER=… XMT_E2E_SSH_KEY=… XMT_DEMO_DIR=… node e2e/demo-shots.mjs
// The app runs with a throw-away HOME (demo ~/.ssh/config, neutral local shell) and a throw-away data folder, and only
// XMT_* variables are passed on, so nothing of the real account is read. Personal details of the machine running the
// demo (hostname, user, paths, process names) are still masked in the DOM as a second line of defence.
// The test server must hold a demo project in XMT_DEMO_DIR (README.md, docker-compose.yml, deploy.log, nginx/nginx.conf,
// src/**/*.py, a .motd) and start a quiet shell: the typed startup lines are not echoed, because `clear` would also wipe
// the info box the app prints on connect. Run it on a throw-away machine or container, never on one with real data.
// Optional: XMT_DEMO_OUT (output folder), XMT_DEMO_LANG, XMT_DEMO_QUICK_HOST (host typed for the host key prompt),
// XMT_DEMO_LAUNCHER and XMT_DEMO_ELECTRON (a different launcher script / Electron binary, e.g. a sandboxed one).
import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, hostname, tmpdir, userInfo } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'
import sharp from 'sharp'

const root = resolve(import.meta.dirname, '..')
const env = process.env
const out = env.XMT_DEMO_OUT ?? join(root, 'docs', 'screenshots')
mkdirSync(out, { recursive: true })
const demoDir = env.XMT_DEMO_DIR
if (!env.XMT_E2E_SSH_HOST || !env.XMT_E2E_SSH_KEY || !demoDir) throw new Error('SSH env and XMT_DEMO_DIR are required')

const dataDir = mkdtempSync(join(tmpdir(), 'xmt-demo-'))
const now = Date.now()
const session = (name, folder, host, username, color, extra = {}) => ({
  id: randomUUID(),
  kind: 'ssh',
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
  baseUrl: '',
  headers: '',
  insecure: false,
  createdAt: now,
  lastUsedAt: 0,
  useCount: 0,
  ...extra
})
const httpEnv = (name, folder, baseUrl, color, extra = {}) =>
  session(name, folder, '', '', color, {
    kind: 'http',
    port: 443,
    auth: 'password',
    monitoring: false,
    sftp: false,
    baseUrl,
    headers: 'Accept: application/json\nAuthorization: Bearer $TOKEN',
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
  httpEnv('api-prod', 'api', 'https://api.example.com/v1', '#5eead4', { lastUsedAt: now - 1_800_000 }),
  httpEnv('api-staging', 'api', 'https://staging-api.example.com', '#fbbf24'),
  session('web-03', 'production', env.XMT_E2E_SSH_HOST, env.XMT_E2E_SSH_USER, '#fbbf24', {
    port: Number(env.XMT_E2E_SSH_PORT ?? 22),
    auth: 'key',
    keyPath: env.XMT_E2E_SSH_KEY,
    startupCommand: `cd '${demoDir}' && export PS1='deploy@web-03:~$ ' PROMPT='deploy@web-03:~$ ' && cat .motd`
  })
]
writeFileSync(join(dataDir, 'sessions.json'), JSON.stringify({ version: 1, sessions }))
const hostKey = readFileSync(`${env.XMT_E2E_SSH_KEY.replace(/user_ed25519$/, 'host_ed25519')}.pub`, 'utf8').split(' ')[1]
const fingerprint = `SHA256:${createHash('sha256').update(Buffer.from(hostKey, 'base64')).digest('base64').replace(/=+$/, '')}`
writeFileSync(
  join(dataDir, 'known_hosts.json'),
  JSON.stringify({ [`${env.XMT_E2E_SSH_HOST}:${demo.port}`]: { fingerprint, keyType: 'ssh-ed25519', addedAt: now } })
)

// Command library: shared commands plus commands that belong to one connection (`session` is its name).
const commands = [
  { name: 'Disk usage', command: 'df -h /' },
  { name: 'RAM and load', command: 'free -h && cat /proc/loadavg' },
  { name: 'Find large files', command: 'du -ah {{path:/var/log}} | sort -rh | head -{{n:10}}' },
  { name: 'Listening ports', command: 'ss -tulpn' },
  { name: 'Restart API', command: 'docker compose restart api', session: 'prod-web-01' },
  { name: 'Tail deploy log', command: 'tail -n 20 -f deploy.log', session: 'prod-web-01' },
  { name: 'Reload nginx', command: 'sudo nginx -t && sudo nginx -s reload', session: 'prod-web-01' },
  { name: 'API health', command: 'curl -s $BASE_URL/health', session: 'api-prod' },
  { name: 'Latest orders', command: 'curl -s "$BASE_URL/orders?limit={{limit:5}}"', session: 'api-prod' }
]
writeFileSync(join(dataDir, 'commands.json'), JSON.stringify({ version: 1, commands }, null, 2))

// Throw-away HOME with placeholder hosts, and a neutral shell for any local terminal the demo opens.
const homeDir = mkdtempSync(join(tmpdir(), 'xmt-home-'))
mkdirSync(join(homeDir, '.ssh'))
writeFileSync(
  join(homeDir, '.ssh', 'config'),
  'Host bastion\n  HostName bastion.example.com\n  User ops\nHost staging-api\n  HostName staging.example.com\n  User deploy\n'
)
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
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ monitorInterval: 2, language: env.XMT_DEMO_LANG ?? 'en', localShell }))

const demoEnv = {
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
  HOME: homeDir,
  USER: 'deploy',
  LOGNAME: 'deploy',
  LANG: 'en_US.UTF-8',
  TMPDIR: tmpdir(),
  ...Object.fromEntries(Object.entries(env).filter(([key]) => key.startsWith('XMT_'))),
  XMT_E2E_DATA: dataDir
}
const app = await electron.launch({
  ...(env.XMT_DEMO_ELECTRON ? { executablePath: env.XMT_DEMO_ELECTRON } : {}),
  args: [env.XMT_DEMO_LAUNCHER ?? join(root, 'e2e', 'launch-main.cjs')],
  env: demoEnv
})
const page = await app.firstWindow()

const masks = [
  [hostname(), 'prod-web-01'],
  [hostname().replace(/\.local$/, ''), 'prod-web-01'],
  [`${userInfo().username}@${env.XMT_E2E_SSH_HOST}`, 'deploy@10.0.4.21'],
  [userInfo().username, 'deploy'],
  [env.XMT_E2E_SSH_HOST, '10.0.4.21'],
  ['localhost', 'srv-07.example.com'],
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

// Anything of the real account that is still in the page after masking aborts the run before it is captured.
const personal = [hostname(), hostname().replace(/\.local$/, ''), userInfo().username, homedir()].filter((v) => v.length > 3)

async function shot(name) {
  await mask()
  const leaked = await page.evaluate((needles) => needles.filter((n) => document.body.innerText.includes(n)).length, personal)
  if (leaked > 0) throw new Error(`${name}: ${leaked} personal detail(s) still visible after masking`)
  await page.waitForTimeout(150)
  const buf = await page.screenshot()
  await sharp(buf).resize(1600).png({ compressionLevel: 9, palette: false }).toFile(join(out, `${name}.png`))
  console.log(`  ✓ ${name}`)
}

const toolbar = (n) => `.titlebar-actions .icon-btn:nth-child(${n})` // 1 broadcast, 2 monitor, 3 command library, 4 palette, 5 settings

async function paletteAction(query) {
  await page.click(toolbar(4))
  await page.waitForSelector('.palette input')
  await page.keyboard.type(query)
  await page.keyboard.press('Enter')
  await page.waitForSelector('.palette', { state: 'detached' })
}

async function openDemoSession(name) {
  await page.dblclick(`.session-row:has-text("${name}")`)
  await page.waitForSelector('.tab.active .dot.connected', { timeout: 20000 })
  await page.waitForSelector('.sftp .crumb', { timeout: 10000 })
  await page.click('.sftp-path .icon-btn')
  await page.fill('.sftp-path input', demoDir)
  await page.press('.sftp-path input', 'Enter')
  await page.waitForSelector('.file-row:has-text("docker-compose.yml")', { timeout: 10000 })
}

await page.waitForSelector('.welcome h1')
await page.waitForTimeout(800)
await shot('welcome')

await openDemoSession('prod-web-01')
await page.click('.sb-toggle')
await page.waitForTimeout(9000)
await page.click('.file-row:has-text("docker-compose.yml")')
await page.click(toolbar(3))
await page.waitForSelector('.cmd-panel .cmd-row')
await page.click('.term-host.active')
await shot('main')

// Command library: run two commands from the panel (results land in the terminal), with room for the output.
await page.click('.sb-toggle')
await paletteAction('sftp')
await page.dblclick('.cmd-row:has-text("Disk usage")')
await page.waitForTimeout(500)
await page.dblclick('.cmd-row:has-text("Listening ports")')
await page.waitForTimeout(700)
const noTooltips = await page.addStyleTag({ content: '.tooltip { display: none !important }' })
await page.hover('.cmd-row:has-text("Restart API")')
await shot('command-library')
await noTooltips.evaluate((el) => el.remove())
await paletteAction('sftp')
await page.waitForSelector('.sftp .file-row')
await page.click(toolbar(3))
await page.waitForSelector('.cmd-panel', { state: 'detached' })
await page.click('.term-host.active')
await page.keyboard.type(`printf '\\033c' && ls -G && cat deploy.log\n`)
await page.waitForTimeout(600)
await page.click('.sb-toggle')

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

// File actions menu in the SFTP browser
await page.click('.file-row:has-text("docker-compose.yml")', { button: 'right' })
await page.waitForSelector('.ctx-menu')
await page.waitForTimeout(250)
await shot('sftp-menu')
await page.keyboard.press('Escape')

// Command palette: a library command plus the new actions
await page.click(toolbar(4))
await page.waitForSelector('.palette input')
await page.keyboard.type('m')
await page.waitForTimeout(250)
await shot('palette')
await page.keyboard.press('Escape')

// New session dialog (SSH / HTTP switch at the top)
await page.click('.sidebar-top .icon-btn:nth-child(2)')
await page.waitForSelector('.modal')
await page.fill('.modal input.input.mono >> nth=0', '10.0.4.30')
await page.fill('.modal .grid-2 input >> nth=0', 'deploy')
await page.fill('.modal .grid-2 input >> nth=1', 'api-gateway')
await page.click('.modal .segmented:not(.session-kind) button:nth-child(2)')
await page.fill('.modal input[placeholder="~/.ssh/id_ed25519"]', '~/.ssh/id_ed25519')
await page.fill('.modal input[list="xmt-folders"]', 'production')
await page.click('.modal .swatch >> nth=0')
await page.fill('.modal input.input.mono >> nth=-1', 'cd /srv/app && git status')
await page.waitForTimeout(300)
await shot('session-editor')

// The same dialog switched to an HTTP environment (nothing is saved: the dialog is dismissed)
await page.click('.modal .session-kind button:nth-child(2)')
await page.waitForSelector('#http-base-url')
await page.fill('#http-base-url', 'https://api.example.com/v1')
await page.fill('#http-name', 'api-prod')
await page.fill('#http-token', 'demo-token')
await page.fill('#http-headers', 'Accept: application/json\nAuthorization: Bearer $TOKEN')
await page.fill('.modal input[list="xmt-folders"]', 'api')
await page.fill('.modal input.input.mono >> nth=-1', '')
await page.waitForTimeout(300)
await shot('http-environment')
await page.keyboard.press('Escape')

// Host key confirmation for a server seen for the first time
await page.click('.tab.home')
await page.fill('.quick input', `ssh -p ${demo.port} deploy@${env.XMT_DEMO_QUICK_HOST ?? 'localhost'}`)
await page.press('.quick input', 'Enter')
await page.waitForSelector('.fingerprint', { timeout: 15000 })
await page.waitForTimeout(400)
await shot('hostkey')
await page.click('.modal-foot .btn.ghost')
await page.waitForTimeout(500)
await page.click('.tab.active .tab-close')
await page.click('.tab:has-text("prod-web-01")')

await page.click(toolbar(5))
await page.waitForSelector('.settings')
await page.waitForTimeout(400)
await shot('settings')
await page.click('.ui-theme-card >> nth=1')
await page.click('.theme-chip:has-text("Paper")')
await page.keyboard.press('Escape')
await page.waitForTimeout(500)
await shot('light')

for (const [label, name] of [
  ['Visual Studio', 'theme-vs'],
  ['Windows 95', 'theme-retro']
]) {
  await page.click(toolbar(5))
  await page.waitForSelector('.settings')
  await page.click(`.ui-theme-card:has-text("${label}")`)
  await page.waitForTimeout(300)
  await page.keyboard.press('Escape')
  await page.click('.sb-toggle')
  await page.mouse.move(1000, 400)
  await page.waitForTimeout(2500)
  await shot(name)
  await page.click('.sb-toggle')
}

// MobaXterm theme: info box + output highlighting on a fresh session
await page.click(toolbar(5))
await page.waitForSelector('.settings')
await page.click('.ui-theme-card:has-text("MobaXterm")')
await page.keyboard.press('Escape')
await openDemoSession('web-03')
await page.waitForTimeout(8000)
await page.click('.term-host.active')
await shot('theme-moba')

await app.close()
console.log(`screenshots → ${out}`)
