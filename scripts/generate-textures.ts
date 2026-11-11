/**
 * Generates the small pixel-art particle sprites the catbot uses and writes
 * them to assets/textures/:
 *
 *   food.png   the golden "commit cube" it eats (also used for crumbs), 16x16
 *   heart.png  the hearts it gives off when happy, 8x8
 *
 * Run with:  npm run textures   (overwrites any repainted versions)
 *
 * The catbot's own animation frames come from scripts/slice-catbot.ts.
 * Self-contained: only Node built-ins (Node 23.6+ strips TS types natively).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

type RGBA = [number, number, number, number]

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'textures')
const GOLD = ['#d99a1c', '#e9ac2a', '#f5c040', '#ffd75e']

function rgba(hex: string): RGBA {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255]
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

class Img {
  w: number
  h: number
  data: Uint8Array
  constructor(w: number, h: number) {
    this.w = w
    this.h = h
    this.data = new Uint8Array(w * h * 4)
  }
  set(x: number, y: number, c: string): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    this.data.set(rgba(c), (y * this.w + x) * 4)
  }
  alpha(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0
    return this.data[(y * this.w + x) * 4 + 3]
  }
}

/** Outline every opaque pixel's transparent neighbours. */
function outline(img: Img, color: string): void {
  const marks: [number, number][] = []
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      if (img.alpha(x, y)) continue
      if (img.alpha(x + 1, y) || img.alpha(x - 1, y) || img.alpha(x, y + 1) || img.alpha(x, y - 1)) marks.push([x, y])
    }
  for (const [x, y] of marks) img.set(x, y, color)
}

// --- PNG encoder ---------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

function encodePng(img: Img): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(img.w, 0)
  ihdr.writeUInt32BE(img.h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc((img.w * 4 + 1) * img.h)
  for (let y = 0; y < img.h; y++) Buffer.from(img.data.buffer, y * img.w * 4, img.w * 4).copy(raw, y * (img.w * 4 + 1) + 1)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0))
  ])
}

// --- sprites ---------------------------------------------------------------------------
// Food: a golden commit cube with a commit-graph line and node.
const food = new Img(16, 16)
const rnd = mulberry32(42)
for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) food.set(x, y, GOLD[Math.floor(((rnd() + rnd()) / 2) * GOLD.length)])
for (let x = 0; x < 16; x++) {
  food.set(x, 7, '#8a5a10')
  food.set(x, 8, '#a8701a')
  food.set(x, 15, '#b07a14')
}
for (let y = 5; y <= 10; y++)
  for (let x = 5; x <= 10; x++) {
    const d = Math.hypot(x - 7.5, y - 7.5)
    if (d < 3.2) food.set(x, y, d < 1.7 ? '#fff0b0' : '#8a5a10')
  }

// Heart: red with a highlight and a dark outline so it reads on any wallpaper.
const heartRows = ['.XX.XX..', 'XhXXXXX.', 'XXXXXXX.', 'XXXXXXX.', '.XXXXs..', '..XXs...', '...s....', '........']
const heart = new Img(8, 8)
const heartColors: Record<string, string> = { X: '#ff5b6e', h: '#ffc0c7', s: '#c8304a' }
heartRows.forEach((row, y) => [...row].forEach((ch, x) => heartColors[ch] && heart.set(x, y, heartColors[ch])))
outline(heart, '#4a0e18')

mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'food.png'), encodePng(food))
writeFileSync(join(OUT, 'heart.png'), encodePng(heart))
console.log(`Wrote food.png and heart.png to ${OUT}`)
