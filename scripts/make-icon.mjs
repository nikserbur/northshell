// Builds the retro (90s pixel-art) app icon from a 32×32 pixel map, plus DMG backgrounds.
// Outputs: build/icon.svg, build/icon.png (1024, macOS app icon), docs/icon.png (256, README),
// src/renderer/src/assets/icon-32.png (sidebar mark), build/background(@2x).png (DMG window).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const root = join(import.meta.dirname, '..')

// prettier-ignore
const MAP = [
  '................................',
  '................................',
  '................................',
  '...KKKKKKKKKKKKKKKKKKKK.........',
  '..KLLLLLLLLLLLLLLLLLLLLKx.......',
  '..KLBBBBBBBBBBBBBBBBBBDKx.......',
  '..KLBKKKKKKKKKKKKKKKKBDKx.......',
  '..KLBKGGGSSSSSSSSSSSKBDKx.......',
  '..KLBKGSSSSSSSSSSSSSKBDKx.......',
  '..KLBKSSSSSPSSSSSSSSKBDKx.......',
  '..KLBKSSSSSPSSSSSSSSKBDKx.......',
  '..KLBKSSSSPSPSSSSSSSKBDKx.......',
  '..KLBKPPPPSSPSPPPPPPKBKKKKKKKK..',
  '..KLBKSSSSSSPPSSSSSSKBKHHHHHHWK.',
  '..KLBKSSSSSSPSSSSSSSKBKHVVVVVWKx',
  '..KLBKSqqqqSqqqSSSSSKBKHWWWWWWKx',
  '..KLBKSSSSSSSSSSSSSSKBKHVVVVVWKx',
  '..KLBKKKKKKKKKKKKKKKKBKHWWWWWWKx',
  '..KLBBBBBBBBBBBBBBBBBBKHVVVVVWKx',
  '..KLBBBBBBBBBBBBBBBEBBKHVEVAVWKx',
  '..KDDDDDDDDDDDDDDDDDDDKHVVVVVWKx',
  '...KKKKKKKKKKKKKKKKKKKKHVWWWVWKx',
  '.........KDDDDDKx.....KHVVVVVWKx',
  '......KKKKKKKKKKKKKKx.KHVWWWVWKx',
  '.....KBBBBBBBBBBBBBDKxKHVVVVVWKx',
  '.....KKKKKKKKKKKKKKKKxKWWWWWWWKx',
  '......xxxxxxxxxxxxxxxxxKKKKKKKKx',
  '.......................xxxxxxxxx',
  '................................',
  '................................',
  '................................',
  '................................'
]

const PALETTE = {
  K: '#101418', // outline
  L: '#fbf6e9', // beige highlight
  B: '#e3dcc8', // beige body
  D: '#b3a98d', // beige shade
  S: '#0e2a33', // CRT screen
  G: '#2a4f5a', // screen glare
  P: '#5eead4', // monitoring pulse
  q: '#2b7a70', // dim text lines
  V: '#a9acc9', // server body
  H: '#d8dae9', // server highlight
  W: '#6e7196', // server shade / drive slots
  E: '#4ade80', // green LED
  A: '#fbbf24', // amber LED
  x: 'rgba(0,0,0,0.28)' // hard drop shadow
}

function toSvg(cell, offset, size) {
  const rects = []
  MAP.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const ch = row[x]
      let end = x
      while (end + 1 < row.length && row[end + 1] === ch) end++
      if (ch !== '.') {
        if (!PALETTE[ch]) throw new Error(`Unknown pixel "${ch}" at ${x},${y}`)
        rects.push(
          `<rect x="${offset + x * cell}" y="${offset + y * cell}" width="${(end - x + 1) * cell}" height="${cell}" fill="${PALETTE[ch]}"/>`
        )
      }
      x = end + 1
    }
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">${rects.join('')}</svg>`
}

MAP.forEach((row, i) => {
  if (row.length !== 32) throw new Error(`Row ${i} has ${row.length} pixels`)
})

mkdirSync(join(root, 'docs'), { recursive: true })
mkdirSync(join(root, 'src', 'renderer', 'src', 'assets'), { recursive: true })

// App icon: 26 px per pixel inside the 1024 canvas leaves the margin macOS expects.
const appSvg = toSvg(26, 96, 1024)
writeFileSync(join(root, 'build', 'icon.svg'), appSvg)
await sharp(Buffer.from(appSvg)).png().toFile(join(root, 'build', 'icon.png'))
await sharp(Buffer.from(toSvg(8, 0, 256))).png().toFile(join(root, 'docs', 'icon.png'))
await sharp(Buffer.from(toSvg(1, 0, 32))).png().toFile(join(root, 'src', 'renderer', 'src', 'assets', 'icon-32.png'))
console.log('icons written: build/icon.png, docs/icon.png, src/renderer/src/assets/icon-32.png')

const bg = join(root, 'build', 'dmg-background.svg')
await sharp(bg).resize(540, 380).png().toFile(join(root, 'build', 'background.png'))
await sharp(bg).resize(1080, 760).png().toFile(join(root, 'build', 'background@2x.png'))
console.log('dmg backgrounds written')
