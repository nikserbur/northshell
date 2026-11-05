// Screenshots of the HTTP workspace and the monitor, with no real server involved.
// Usage: npm run build && node e2e/feature-shots.mjs   (XMT_DEMO_OUT changes the output folder, XMT_DEMO_LANG the language)
// Like e2e/demo-shots.mjs it runs with a throw-away HOME and data folder and a neutral shell; the API is a local
// demo server started here, and the Mac's own name, user and processes are masked before anything is captured.
// The monitor shots show made-up server numbers on a real tab: a private sshd on a random port gives it a real
// connection (its only command is the neutral shell), and the snapshots are injected from here.
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
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
  } else if (url.pathname === '/v1/login') {
    res.setHeader('Set-Cookie', 'session=d41d8cd9; Path=/; HttpOnly')
    res.end(JSON.stringify({ token: 'demo-token', expires_in: 3600 }))
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
const freePort = () =>
  new Promise((resolve) => {
    const probe = createNetServer()
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
const sshPort = await freePort()
const sshDir = mkdtempSync(join(tmpdir(), 'xmt-sshd-'))
for (const name of ['host', 'client']) spawnSync('/usr/bin/ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(sshDir, name)])
const sessions = [
  session('prod-web-01', 'production', {
    host: '127.0.0.1',
    port: sshPort,
    username: userInfo().username,
    auth: 'key',
    keyPath: join(sshDir, 'client'),
    sftp: false,
    lastUsedAt: now - 60_000
  }),
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
const apiSession = sessions.find((x) => x.name === 'api-prod').id
const saved = (name, folder, spec) => ({
  id: randomUUID(),
  name,
  folder,
  sessionId: apiSession,
  updatedAt: now,
  spec: { method: 'GET', url: '', headers: '', body: '', followRedirects: false, ...spec }
})
writeFileSync(
  join(dataDir, 'http-workspace.json'),
  JSON.stringify({
    requests: [
      saved('Log in', 'Shop API / Auth', {
        method: 'POST',
        url: '/login',
        bodyKind: 'json',
        body: '{\n  "email": "{{email}}",\n  "password": "{{password}}"\n}',
        extract: [{ source: 'json', path: '$.token', variable: 'token', enabled: true }]
      }),
      saved('Refresh token', 'Shop API / Auth', { method: 'POST', url: '/token/refresh', auth: { type: 'bearer', token: '{{token}}' } }),
      saved('List orders', 'Shop API / Orders', {
        url: '/orders?limit={{limit:3}}&status=paid',
        headers: 'X-Request-Id: {{$uuid}}\n# X-Debug: 1',
        auth: { type: 'bearer', token: '{{token}}' },
        tests: [
          { target: 'status', path: '', op: 'eq', value: '200', enabled: true },
          { target: 'json', path: '$.data[0].currency', op: 'eq', value: 'EUR', enabled: true },
          { target: 'time', path: '', op: 'lt', value: '500', enabled: true }
        ]
      }),
      saved('Create order', 'Shop API / Orders', { method: 'POST', url: '/orders', bodyKind: 'json', body: '{\n  "customer": 42\n}' }),
      saved('Cancel order', 'Shop API / Orders', { method: 'DELETE', url: '/orders/{{orderId}}' }),
      saved('Upload invoice', 'Shop API / Files', { method: 'PUT', url: '/invoices/{{orderId}}', bodyKind: 'multipart', form: [{ name: 'note', value: 'paid', enabled: true }] })
    ],
    vars: { [apiSession]: { limit: '3', email: 'ada@example.com', orderId: '10482', token: 'demo-token' } },
    history: {}
  })
)

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
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ monitorInterval: 2, language: process.env.XMT_DEMO_LANG ?? 'en', localShell, terminalBanner: false }))

writeFileSync(
  join(sshDir, 'sshd_config'),
  [
    `Port ${sshPort}`,
    'ListenAddress 127.0.0.1',
    `HostKey ${join(sshDir, 'host')}`,
    `AuthorizedKeysFile ${join(sshDir, 'client.pub')}`,
    'PasswordAuthentication no',
    'KbdInteractiveAuthentication no',
    'UsePAM no',
    'StrictModes no',
    `PidFile ${join(sshDir, 'pid')}`,
    `ForceCommand ${localShell}`,
    ''
  ].join('\n')
)
const sshd = spawn('/usr/sbin/sshd', ['-D', '-f', join(sshDir, 'sshd_config')], { stdio: 'ignore' })
process.on('exit', () => sshd.kill())

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
  [`127.0.0.1:${sshPort}`, '10.0.4.21'],
  [userInfo().username, 'deploy']
]
const personal = [hostname(), hostname().replace(/\.local$/, ''), userInfo().username, homedir(), apiHost].filter((v) => v.length > 3)

async function shot(name) {
  await page.evaluate(
    (masks) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.parentElement?.closest('.xterm')) continue
        let v = n.nodeValue ?? ''
        for (const [from, to] of masks) v = v.split(from).join(to)
        if (v !== n.nodeValue) n.nodeValue = v
      }
      document.querySelectorAll('[title]').forEach((el) => el.removeAttribute('title'))
      // Mounted disk images and USB sticks of the machine running this are not part of the demo.
      document.querySelectorAll('.bar-line').forEach((bar) => {
        if (bar.querySelector('.top span')?.textContent?.startsWith('/Volumes/')) bar.remove()
      })
      document.querySelectorAll('.sb-disk').forEach((d) => !d.textContent?.startsWith('/:') && d.remove())
    },
    masks
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

// HTTP workspace: collections on the left, the request and its response side by side, covering the terminal.
await page.dblclick('.session-row:has-text("api-prod")')
await page.waitForSelector('.http-panel.expanded')
await page.waitForTimeout(800)
await page.click('.http-request-row:has-text("List orders")')
await page.click('.http-panel .http-send')
await page.waitForSelector('.http-status:has-text("200")', { timeout: 10000 })
await page.waitForSelector('.http-tests-badge.pass', { timeout: 3000 })
await page.waitForTimeout(400)
await shot('http-workspace')

await page.click('.http-resp-tabs button:nth-child(4)')
await page.click('.http-side-tabs button:nth-child(3)')
await page.waitForTimeout(300)
await shot('http-timing')
await page.click('.http-resp-tabs button:nth-child(1)')
await page.click('.http-side-tabs button:nth-child(1)')

// The same panel beside the terminal.
await page.click('.http-top .icon-btn >> nth=-2')
await page.waitForSelector('.http-panel.side')
await page.click('.cmd-panel .sftp-head .icon-btn:last-child')
await clearTerminal()
await page.click('.term-host.active')
await page.keyboard.type('# ⇧⌘R request panel · ⇧⌘L saved commands\n')
await page.waitForTimeout(400)
await shot('http-request')
await page.click('.http-top .icon-btn >> nth=-2')

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

// The monitor on a made-up busy server: who is loading the disk now, and who takes up the space.
const GB = 1024 ** 3
const MB = 1024 ** 2
const owners = {
  '/': [
    { user: 'deploy', bytes: 86 * GB },
    { user: 'root', bytes: 31 * GB },
    { user: 'www-data', bytes: 9 * GB }
  ],
  '/var/lib/postgresql': [
    { user: 'postgres', bytes: 612 * GB },
    { user: 'backup', bytes: 148 * GB }
  ],
  '/data': [
    { user: 'backup', bytes: 1240 * GB },
    { user: 'deploy', bytes: 310 * GB },
    { user: 'etl', bytes: 96 * GB }
  ]
}
const PROCESSES = [
  // pid, ppid, user, name, args, cpu, mem%, rss GB, threads, read, write, rx, tx (MB/s)
  [2114, 1, 'postgres', 'postgres', ' -D /var/lib/postgresql/16/main', 8, 1.4, 0.9, 1, 1, 2, 0, 0],
  [2240, 2114, 'postgres', 'postgres', ': checkpointer', 4, 2.1, 1.3, 1, 0, 46, 0, 0],
  [2241, 2114, 'postgres', 'postgres', ': walwriter', 6, 0.3, 0.2, 1, 0, 28, 0, 0],
  [9310, 2114, 'postgres', 'postgres', ': etl shop 10.0.4.30 SELECT', 92, 7.8, 5, 1, 182, 3, 12, 41],
  [9344, 2114, 'postgres', 'postgres', ': app shop 10.0.4.22 idle', 3, 1.1, 0.7, 1, 2, 0, 1, 4],
  [3120, 1, 'deploy', 'node', ' /srv/shop/server.js --port 3000', 148, 4.6, 2.9, 22, 3, 2, 38, 96],
  [3121, 1, 'deploy', 'node', ' /srv/shop/worker.js --queue mail', 64, 2.2, 1.4, 12, 6, 9, 4, 3],
  [8120, 1, 'etl', 'python3', ' /opt/etl/nightly.py --since yesterday', 212, 11.6, 7.4, 8, 94, 61, 52, 7],
  [7001, 1, 'backup', 'restic', ' backup /data --tag nightly', 118, 3.1, 2, 16, 236, 4, 1, 84],
  [1502, 1, 'www-data', 'nginx', ': master process /usr/sbin/nginx', 0.4, 0.1, 0.05, 1, 0, 0, 0, 0],
  [1503, 1502, 'www-data', 'nginx', ': worker process', 34, 0.3, 0.2, 1, 1, 0, 61, 140],
  [1504, 1502, 'www-data', 'nginx', ': worker process', 31, 0.3, 0.2, 1, 1, 0, 58, 132],
  [812, 1, 'root', 'sshd', ': /usr/sbin/sshd -D', 0.2, 0.1, 0.03, 1, 0, 0, 0, 0],
  [640, 1, 'root', 'systemd-journald', '', 1.2, 0.2, 0.12, 1, 0, 3, 0, 0],
  [1, 0, 'root', 'systemd', ' --system --deserialize=42', 0.3, 0.1, 0.02, 1, 0, 0, 0, 0]
]
const CORES = 16
const MEM_TOTAL = 64 * GB
function demoSnapshot(i) {
  const wave = (phase) => 0.82 + 0.3 * Math.sin(i / 5 + phase) + 0.1 * Math.sin(i / 1.7 + phase * 2)
  const processes = PROCESSES.map(([pid, ppid, user, name, args, cpu, mem, rss, threads, read, write, rx, tx]) => {
    const w = wave(pid)
    return {
      pid,
      ppid,
      user,
      name,
      command: `${name === 'postgres' || name === 'nginx' || name === 'sshd' ? '' : `/usr/bin/`}${name}${args}`,
      cpu: cpu * w,
      mem,
      rss: rss * GB,
      vsz: rss * 3 * GB,
      threads,
      nice: name === 'restic' ? 19 : 0,
      state: cpu > 20 ? 'R' : 'S',
      elapsed: 86400 * ((pid % 11) + 1) + pid,
      diskRead: read * w * MB,
      diskWrite: write * w * MB,
      netRx: rx * w * MB,
      netTx: tx * w * MB
    }
  })
  const byUser = new Map()
  for (const p of processes) {
    const u = byUser.get(p.user) ?? { user: p.user, procs: 0, cpu: 0, mem: 0, memPct: 0, diskRead: 0, diskWrite: 0, netRx: 0, netTx: 0 }
    byUser.set(p.user, {
      ...u,
      procs: u.procs + 1,
      cpu: u.cpu + p.cpu / CORES,
      mem: u.mem + p.rss,
      memPct: u.memPct + (p.rss / MEM_TOTAL) * 100,
      diskRead: u.diskRead + p.diskRead,
      diskWrite: u.diskWrite + p.diskWrite,
      netRx: u.netRx + p.netRx,
      netTx: u.netTx + p.netTx
    })
  }
  const users = [...byUser.values()].sort((a, b) => b.cpu - a.cpu)
  const sum = (key) => processes.reduce((a, p) => a + p[key], 0)
  return {
    ts: now + i * 2000,
    hostname: 'prod-web-01',
    os: 'Ubuntu 24.04.1 LTS',
    cpu: Math.min(100, users.reduce((a, u) => a + u.cpu, 0)),
    cores: CORES,
    load: [7.4, 6.9, 6.1],
    memTotal: MEM_TOTAL,
    memUsed: 41 * GB,
    swapTotal: 8 * GB,
    swapUsed: 0.6 * GB,
    gpus: [],
    disks: [
      { mount: '/', fs: '/dev/nvme0n1p2', total: 400 * GB, used: 126 * GB },
      { mount: '/var/lib/postgresql', fs: '/dev/nvme1n1', total: 960 * GB, used: 760 * GB },
      { mount: '/data', fs: '/dev/sda1', total: 3600 * GB, used: 1646 * GB }
    ],
    netRx: sum('netRx'),
    netTx: sum('netTx'),
    diskRead: sum('diskRead'),
    diskWrite: sum('diskWrite'),
    diskDevices: [
      { name: 'nvme0n1', read: sum('diskRead') * 0.1, write: sum('diskWrite') * 0.15, util: 12 },
      { name: 'nvme1n1', read: sum('diskRead') * 0.35, write: sum('diskWrite') * 0.6, util: 64 },
      { name: 'sda', read: sum('diskRead') * 0.55, write: sum('diskWrite') * 0.25, util: 91 }
    ],
    uptime: 86400 * 41 + 7000,
    users: 3,
    userNames: ['deploy', 'etl', 'root'],
    processes: [],
    detail: { processes, users, diskIo: 'all', net: 'all' }
  }
}

await app.evaluate(({ ipcMain }, demoOwners) => {
  ipcMain.removeHandler('monitor:detail')
  ipcMain.handle('monitor:detail', (_e, id, on) => {
    if (on) globalThis.demoMonitorKey = id
  })
  ipcMain.removeHandler('monitor:disk-owners')
  ipcMain.handle('monitor:disk-owners', (_e, _tab, mount) => ({ mount, at: Date.now() - 180000, users: demoOwners[mount] ?? [], partial: false }))
}, owners)

await page.click('.tab.home').catch(() => undefined)
await page.dblclick('.session-row:has-text("prod-web-01")')
await page.waitForSelector('.modal .btn.primary', { timeout: 10000 })
await page.click('.modal .btn.primary')
await page.waitForSelector('.tab.active .dot.connected', { timeout: 15000 })
await page.waitForTimeout(800)
const monitorOpen = await page.$('.monitor')
if (!monitorOpen) await page.click('.sb-toggle')
await page.waitForFunction(() => document.querySelector('.monitor') !== null || document.querySelector('.mon-waiting') !== null)
await page.waitForTimeout(300)
await app.evaluate(({ BrowserWindow }, snapshots) => {
  const win = BrowserWindow.getAllWindows()[0]
  for (const snapshot of snapshots) win.webContents.send('monitor:snapshot', { id: globalThis.demoMonitorKey, snapshot })
}, Array.from({ length: 60 }, (_, i) => demoSnapshot(i)))
await page.waitForSelector('.mon-top .top-row', { timeout: 5000 })
await clearTerminal()
await page.click('.mon-top-metrics button:nth-child(3)')
for (const link of await page.$$('.mon-disk-row .mon-link')) await link.click()
await page.waitForSelector('.mon-owners', { timeout: 3000 })
await page.waitForTimeout(500)
await shot('monitor-users')

await page.click('.mon-diskio .mon-expand')
await page.waitForSelector('.disks-view .disk-section')
await page.waitForTimeout(300)
await shot('monitor-disks')

await page.click('.mon-toolbar [role=tab]:nth-child(1)')
await page.waitForSelector('.modal.full .sort-table tbody tr')
await page.click('.modal.full .sort-table th:nth-child(7) button')
await page.waitForTimeout(300)
await shot('monitor-processes')

await app.close()
api.close()
sshd.kill()
rmSync(sshDir, { recursive: true, force: true })
