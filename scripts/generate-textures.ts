/**
 * Generates GitGremlin's pixel-art textures and writes them as PNGs to
 * assets/textures/ (plus the tray/app icons). Run with:
 *
 *   npm run textures
 *
 * The app only loads the PNGs at runtime, so you can repaint them in Aseprite
 * or Piskel afterwards. Re-running this script overwrites your edits.
 *
 * Every face texture is 16x16. Each box face shows the TOP-LEFT W x H texels of
 * its PNG, where W x H is the face's size in texels (1 texel = 1 model unit);
 * faces longer than 16 texels repeat the texture. The `used` sizes below say
 * which region of each PNG is visible.
 *
 * Self-contained: only Node built-ins, so it runs with `node` (Node 23.6+
 * strips the TypeScript types natively).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

type RGBA = [number, number, number, number]

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'assets', 'textures')

// --- palette (original colours) -----------------------------------------------
const MOSS = ['#2f5222', '#3d6b2b', '#4b8034', '#5a963d', '#6cab48']
const MOSS_TUFT = '#86c25e'
const STONE = ['#4e4e53', '#5d5d62', '#6c6c72', '#7c7c82', '#8d8d93']
const STONE_DARK = ['#36363a', '#3f3f44', '#48484d']
const SOCKET = '#252528'
const AMBER = { hi: '#fff1b3', mid: '#ffb21e', lo: '#ec8a00' }
const TIP_OFF = ['#4d3d22', '#5c4a2a', '#6e5a33']
const TIP_ON = ['#ffc21f', '#ffd84a', '#ffe98f']
const GOLD = ['#d99a1c', '#e9ac2a', '#f5c040', '#ffd75e']

// --- tiny image + RNG helpers ---------------------------------------------------
function rgba(hex: string, a = 255): RGBA {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), a]
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
  set(x: number, y: number, c: string | RGBA): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    const v = typeof c === 'string' ? rgba(c) : c
    this.data.set(v, (y * this.w + x) * 4)
  }
  get(x: number, y: number): RGBA {
    const i = (y * this.w + x) * 4
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]]
  }
  alpha(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0
    return this.data[(y * this.w + x) * 4 + 3]
  }
}

/** Pick from a palette with a gentle bias, giving a hand-placed noisy look. */
function pick(pal: string[], rnd: () => number, bias = 0.5): string {
  const r = Math.min(0.999, Math.max(0, (rnd() + rnd() + bias * 2) / 3))
  return pal[Math.floor(r * pal.length)]
}

function fillNoise(img: Img, pal: string[], rnd: () => number, x0 = 0, y0 = 0, x1 = img.w, y1 = img.h): void {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) img.set(x, y, pick(pal, rnd))
}

/** Stone with a mossy top band and a few drips running down. */
function mossTopStone(img: Img, rnd: () => number, mossRows: number, usedH = img.h): void {
  fillNoise(img, STONE, rnd)
  for (let x = 0; x < img.w; x++) {
    const drip = rnd() < 0.35 ? 1 + Math.floor(rnd() * 3) : 0
    for (let y = 0; y < mossRows + drip; y++) img.set(x, y, pick(MOSS, rnd, y < mossRows - 1 ? 0.55 : 0.3))
    if (rnd() < 0.2) img.set(x, 0, MOSS_TUFT)
  }
  // A couple of cracks.
  for (let i = 0; i < 3; i++) {
    const cx = Math.floor(rnd() * img.w)
    const cy = mossRows + 2 + Math.floor(rnd() * Math.max(1, usedH - mossRows - 3))
    img.set(cx, cy, STONE_DARK[1])
    img.set(cx + (rnd() < 0.5 ? 1 : -1), cy + 1, STONE_DARK[0])
  }
  // Darker bottom row of the visible region for a little depth.
  for (let x = 0; x < img.w; x++) img.set(x, usedH - 1, pick(STONE_DARK, rnd))
}

function mossTop(img: Img, rnd: () => number): void {
  fillNoise(img, MOSS, rnd)
  for (let i = 0; i < 14; i++) img.set(Math.floor(rnd() * img.w), Math.floor(rnd() * img.h), MOSS_TUFT)
  for (let i = 0; i < 4; i++) {
    const x = Math.floor(rnd() * img.w)
    const y = Math.floor(rnd() * img.h)
    img.set(x, y, STONE[3])
    img.set(x + 1, y, STONE[2])
  }
}

/** Outline every opaque pixel's transparent neighbours (for sprites). */
function outline(img: Img, color: string): void {
  const marks: [number, number][] = []
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      if (img.alpha(x, y)) continue
      if (img.alpha(x + 1, y) || img.alpha(x - 1, y) || img.alpha(x, y + 1) || img.alpha(x, y - 1)) marks.push([x, y])
    }
  for (const [x, y] of marks) img.set(x, y, color)
}

function fromMask(rows: string[], colors: Record<string, string>): Img {
  const img = new Img(rows[0].length, rows.length)
  rows.forEach((row, y) => [...row].forEach((ch, x) => colors[ch] && img.set(x, y, colors[ch])))
  return img
}

// --- PNG encoder -------------------------------------------------------------------
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
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc((img.w * 4 + 1) * img.h)
  for (let y = 0; y < img.h; y++) {
    raw[y * (img.w * 4 + 1)] = 0
    Buffer.from(img.data.buffer, y * img.w * 4, img.w * 4).copy(raw, y * (img.w * 4 + 1) + 1)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0))
  ])
}

function scale(img: Img, k: number): Img {
  const out = new Img(img.w * k, img.h * k)
  for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) out.set(x, y, img.get(Math.floor(x / k), Math.floor(y / k)))
  return out
}

// --- textures ---------------------------------------------------------------------
const EYE_L = [3, 4, 5]
const EYE_R = [10, 11, 12]
const EYE_ROWS = [6, 7]

const textures: Record<string, { img: Img; used: string }> = {}
function add(name: string, used: string, draw: (img: Img, rnd: () => number) => void, size = 16): void {
  const img = new Img(size, size)
  const seed = [...name].reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) >>> 0, 7)
  draw(img, mulberry32(seed))
  textures[name] = { img, used }
}

// Head: a 16x16x16 cube.
add('head_top', '16x16', (img, rnd) => mossTop(img, rnd))
add('head_side', '16x16', (img, rnd) => mossTopStone(img, rnd, 4))
add('head_back', '16x16', (img, rnd) => mossTopStone(img, rnd, 5))
add('head_bottom', '16x16', (img, rnd) => fillNoise(img, STONE_DARK, rnd))
add('head_front', '16x16', (img, rnd) => {
  mossTopStone(img, rnd, 3)
  // Clear any drips/cracks away from the face area, then carve the features.
  fillNoise(img, STONE, rnd, 2, 5, 14, 13)
  for (const y of EYE_ROWS) for (const x of [...EYE_L, ...EYE_R]) img.set(x, y, SOCKET)
  for (let x = 6; x <= 9; x++) img.set(x, 11, SOCKET)
  img.set(5, 10, SOCKET)
  img.set(10, 10, SOCKET)
})
// Eye overlays sit on the head front at full brightness so they "glow".
add('eyes_open', '16x16 (transparent except eyes)', (img) => {
  for (const eye of [EYE_L, EYE_R]) {
    eye.forEach((x, i) => {
      img.set(x, 6, i === 0 ? AMBER.hi : AMBER.mid)
      img.set(x, 7, AMBER.lo)
    })
  }
})
add('eyes_closed', '16x16 (transparent except eyelids)', (img) => {
  for (const x of [...EYE_L, ...EYE_R]) {
    img.set(x, 6, STONE[3])
    img.set(x, 7, SOCKET)
  }
})

// Body: 28 long x 12 tall x 16 wide.
add('body_top', '16x16, repeats along the length', (img, rnd) => mossTop(img, rnd))
add('body_side', '16x12 (top 12 rows), repeats along the length', (img, rnd) => {
  mossTopStone(img, rnd, 4, 12)
  // Moss patches growing on the stone.
  for (let i = 0; i < 3; i++) {
    const px = Math.floor(rnd() * 14)
    const py = 6 + Math.floor(rnd() * 3)
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2 + Math.floor(rnd() * 2); dx++) img.set(px + dx, py + dy, pick(MOSS, rnd, 0.4))
  }
})
add('body_end', '16x12 (top 12 rows)', (img, rnd) => mossTopStone(img, rnd, 4, 12))
add('body_bottom', '16x16, repeats along the length', (img, rnd) => fillNoise(img, STONE_DARK, rnd))

// Legs: 6 x 7 x 6.
add('leg_side', '6x7 (top-left)', (img, rnd) => {
  fillNoise(img, STONE.slice(0, 3), rnd)
  for (let x = 0; x < 16; x++) {
    img.set(x, 0, pick(MOSS, rnd, 0.5))
    img.set(x, 1, pick(MOSS, rnd, 0.3))
    img.set(x, 6, STONE_DARK[0])
  }
})
add('leg_top', '6x6 (top-left)', (img, rnd) => fillNoise(img, MOSS, rnd))
add('leg_bottom', '6x6 (top-left)', (img, rnd) => fillNoise(img, STONE_DARK, rnd))

// Antenna: a 2x5x2 stem topped with a 4x4x4 bulb.
add('antenna_stem', '2x5 (top-left)', (img, rnd) => fillNoise(img, STONE.slice(1), rnd))
add('antenna_tip_off', '4x4 (top-left)', (img, rnd) => {
  fillNoise(img, TIP_OFF, rnd)
  img.set(0, 0, TIP_OFF[2])
})
add('antenna_tip_on', '4x4 (top-left)', (img, rnd) => {
  fillNoise(img, TIP_ON, rnd)
  img.set(0, 0, '#fff8d6')
  img.set(1, 0, TIP_ON[2])
  img.set(0, 1, TIP_ON[2])
})

// Food: a golden "commit cube" (box scaled down in the scene, full 16x16 visible).
add('food', '16x16', (img, rnd) => {
  fillNoise(img, GOLD, rnd)
  for (let x = 0; x < 16; x++) {
    img.set(x, 7, '#8a5a10')
    img.set(x, 8, '#a8701a')
  }
  for (let y = 5; y <= 10; y++) for (let x = 5; x <= 10; x++) {
    const d = Math.hypot(x - 7.5, y - 7.5)
    if (d < 3.2) img.set(x, y, d < 1.7 ? '#fff0b0' : '#8a5a10')
  }
  for (let x = 0; x < 16; x++) img.set(x, 15, '#b07a14')
})

// Particle sprites (8x8).
textures.heart = {
  used: '8x8 sprite',
  img: (() => {
    const img = fromMask(
      ['.XX.XX..', 'XhXXXXX.', 'XXXXXXX.', 'XXXXXXX.', '.XXXXs..', '..XXs...', '...s....', '........'],
      { X: '#e8424f', h: '#ffb0b6', s: '#b8283a' }
    )
    outline(img, '#4a0e18')
    return img
  })()
}
textures.zzz = {
  used: '8x8 sprite',
  img: (() => {
    const img = fromMask(['........', '.XXXXX..', '....X...', '...X....', '..X.....', '.XXXXX..', '........', '........'], {
      X: '#e6efff'
    })
    outline(img, '#2b3a55')
    return img
  })()
}

// --- write ------------------------------------------------------------------------
mkdirSync(OUT, { recursive: true })
const manifest: string[] = []
for (const [name, { img, used }] of Object.entries(textures)) {
  writeFileSync(join(OUT, `${name}.png`), encodePng(img))
  manifest.push(`${name}.png`.padEnd(24) + used)
}
writeFileSync(join(OUT, 'TEXTURES.txt'), `Visible region of each PNG (see scripts/generate-textures.ts):\n\n${manifest.join('\n')}\n`)

// Icons: the head front with its eyes, framed by a dark outline.
const face = new Img(16, 16)
face.data.set(textures.head_front.img.data)
const eyes = textures.eyes_open.img
for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (eyes.alpha(x, y)) face.set(x, y, eyes.get(x, y))
const framed = new Img(18, 18)
for (let y = 0; y < 18; y++) for (let x = 0; x < 18; x++) framed.set(x, y, '#1b1f1a')
for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) framed.set(x + 1, y + 1, face.get(x, y))
const icon32 = new Img(32, 32)
const s2 = scale(framed, 2) // 36x36 -> crop the 2px frame overflow
for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) icon32.set(x, y, s2.get(x + 2, y + 2))
writeFileSync(join(ROOT, 'assets', 'icon.png'), encodePng(icon32))
mkdirSync(join(ROOT, 'build'), { recursive: true })
writeFileSync(join(ROOT, 'build', 'icon.png'), encodePng(scale(icon32, 8)))

console.log(`Wrote ${Object.keys(textures).length} textures to ${OUT}, plus assets/icon.png and build/icon.png`)
