// Renders docs/screenshots/install-dmg.png: what the opened DMG window looks like.
// macOS only (reads the system Applications folder icon via `sips`).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'

const root = join(import.meta.dirname, '..')
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
  <text x="${W / 2}" y="37" text-anchor="middle" font-family="-apple-system, Helvetica Neue" font-size="26" font-weight="600" fill="#d6d9e0">Termora 1.2.0</text>
  ${label('Termora', 280)}${label('Applications', 800)}
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
