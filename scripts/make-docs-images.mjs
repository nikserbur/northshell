// Renders docs/screenshots/install-dmg.png: what the opened DMG window looks like.
// macOS only (reads the system Applications folder icon via `sips`).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'

const root = join(import.meta.dirname, '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const name = pkg.productName
const tmp = mkdtempSync(join(tmpdir(), 'termora-docs-'))
const appsIcon = join(tmp, 'apps.png')
execFileSync('sips', [
  '-s', 'format', 'png', '-z', '224', '224',
  '/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/ApplicationsFolderIcon.icns',
  '--out', appsIcon
])

const W = 1080
const BAR = 56
const H = 760 + BAR
const label = (text, x) =>
  `<text x="${x}" y="${BAR + 520}" text-anchor="middle" font-family="-apple-system, Helvetica Neue" font-size="26" fill="#e6e9ef">${text}</text>`
const chrome = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${BAR}" fill="#2b2e36"/>
  <circle cx="30" cy="28" r="12" fill="#ff5f57"/><circle cx="66" cy="28" r="12" fill="#febc2e"/><circle cx="102" cy="28" r="12" fill="#28c840"/>
  <text x="${W / 2}" y="37" text-anchor="middle" font-family="-apple-system, Helvetica Neue" font-size="26" font-weight="600" fill="#d6d9e0">${name} ${pkg.version}</text>
  ${label(name, 280)}${label('Applications', 800)}
</svg>`)

const appIcon = await sharp(join(root, 'build', 'icon.png')).resize(224, 224).png().toBuffer()
await sharp({ create: { width: W, height: H, channels: 4, background: '#1a2030' } })
  .composite([
    { input: readFileSync(join(root, 'build', 'background@2x.png')), top: BAR, left: 0 },
    { input: chrome, top: 0, left: 0 },
    { input: appIcon, top: BAR + 380 - 112 - 20, left: 280 - 112 },
    { input: readFileSync(appsIcon), top: BAR + 380 - 112 - 20, left: 800 - 112 }
  ])
  .png({ compressionLevel: 9 })
  .toFile(join(root, 'docs', 'screenshots', 'install-dmg.png'))
console.log('docs/screenshots/install-dmg.png written')

// Social preview (1280×640) for GitHub link cards: upload in repo Settings → Social preview.
const shot = await sharp(join(root, 'docs', 'screenshots', 'main.png')).resize(760).png().toBuffer()
const shotMeta = await sharp(shot).metadata()
const card = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640">
  <rect width="1280" height="640" fill="#10131a"/>
  <text x="64" y="300" font-family="-apple-system, Helvetica Neue" font-size="64" font-weight="700" fill="#eef1f6">${name}</text>
  <text x="64" y="352" font-family="-apple-system, Helvetica Neue" font-size="26" fill="#a9b1c1">MobaXterm alternative for macOS</text>
  <text x="64" y="396" font-family="Menlo, monospace" font-size="19" fill="#5eead4">SSH · SFTP · editor · monitoring</text>
  <text x="64" y="580" font-family="-apple-system, Helvetica Neue" font-size="18" fill="#6f788b">Free and open source · github.com/nikserbur/${name.toLowerCase()}</text>
</svg>`)
await sharp(card)
  .composite([
    { input: await sharp(join(root, 'build', 'icon.png')).resize(150).png().toBuffer(), top: 92, left: 52 },
    { input: shot, top: Math.round((640 - (shotMeta.height ?? 475)) / 2), left: 1280 - 760 - 40 }
  ])
  .png({ compressionLevel: 9 })
  .toFile(join(root, 'docs', 'social-preview.png'))
console.log('docs/social-preview.png written')
