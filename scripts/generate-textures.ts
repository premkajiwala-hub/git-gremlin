/**
 * Draws Catbot's pixel-art textures in code and writes them as PNGs to
 * assets/textures/ (plus the tray icon and installer icon). Run with:
 *
 *   npm run textures
 *
 * The app only loads the PNGs at runtime, so you can repaint them in Aseprite
 * or Piskel afterwards. Re-running this script overwrites your edits.
 *
 * Every texture is 16x16. Each box face shows the TOP-LEFT W x H texels of its
 * PNG, where W x H is the face's size in texels (1 texel = 1 model unit);
 * faces longer than 16 repeat. TEXTURES.txt lists the visible region per file.
 *
 * Self-contained: only Node built-ins (Node 23.6+ strips TS types natively).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

type RGBA = [number, number, number, number]

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'assets', 'textures')

// --- palette: white robot shell, orange accents, dark face-screen, cyan glow ----
const SHELL = ['#dde1e6', '#e6e9ed', '#eef0f3', '#f6f7f9']
const SHELL_SHADE = '#c3c9d0'
const SEAM = '#a9b1ba'
const METAL = ['#7b848e', '#8a939c', '#99a1a9']
const DARK = ['#353b43', '#3e454e']
const ORANGE = ['#f2861a', '#ff9a2e', '#ffad52']
const SCREEN = '#0a1b21'
const SCREEN_EDGE = '#14303a'
const GLINT = '#21505c'
const CYAN = '#5ef2ff'
const CYAN_DIM = '#2ab3c4'
const BELL_ON = ['#ffc23d', '#ffd66b', '#ffe9a6']
const BELL_OFF = ['#7a5a2a', '#8a6630', '#6b4e24']
const GOLD = ['#d99a1c', '#e9ac2a', '#f5c040', '#ffd75e']

// --- tiny image + RNG helpers ------------------------------------------------------
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
  set(x: number, y: number, c: string | RGBA): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    this.data.set(typeof c === 'string' ? rgba(c) : c, (y * this.w + x) * 4)
  }
  get(x: number, y: number): RGBA {
    const i = (y * this.w + x) * 4
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]]
  }
  alpha(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0
    return this.data[(y * this.w + x) * 4 + 3]
  }
  rect(x0: number, y0: number, w: number, h: number, c: string): void {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, c)
  }
}

/** Pick from a palette with a gentle bias, for a slightly noisy hand-placed look. */
function pick(pal: string[], rnd: () => number): string {
  return pal[Math.min(pal.length - 1, Math.floor(((rnd() + rnd()) / 2) * pal.length))]
}

function fill(img: Img, pal: string[], rnd: () => number): void {
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) img.set(x, y, pick(pal, rnd))
}

/** Plastic shell: light noise plus a few scuffs. */
function shell(img: Img, rnd: () => number): void {
  fill(img, SHELL, rnd)
  for (let i = 0; i < 5; i++) img.set(Math.floor(rnd() * img.w), Math.floor(rnd() * img.h), SHELL_SHADE)
}

/** Draw a pixel pattern ('X' = main colour, 'o' = secondary) at (x0, y0). */
function stamp(img: Img, rows: string[], x0: number, y0: number, main: string, second = main): void {
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === 'X') img.set(x0 + x, y0 + y, main)
      else if (ch === 'o') img.set(x0 + x, y0 + y, second)
    })
  )
}

function outline(img: Img, color: string): void {
  const marks: [number, number][] = []
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      if (img.alpha(x, y)) continue
      if (img.alpha(x + 1, y) || img.alpha(x - 1, y) || img.alpha(x, y + 1) || img.alpha(x, y - 1)) marks.push([x, y])
    }
  for (const [x, y] of marks) img.set(x, y, color)
}

// --- PNG encoder -----------------------------------------------------------------------
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

function scale(img: Img, k: number): Img {
  const out = new Img(img.w * k, img.h * k)
  for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) out.set(x, y, img.get(Math.floor(x / k), Math.floor(y / k)))
  return out
}

// --- textures --------------------------------------------------------------------------
const textures: Record<string, { img: Img; used: string }> = {}
function add(name: string, used: string, draw: (img: Img, rnd: () => number) => void, size = 16): Img {
  const img = new Img(size, size)
  const seed = [...name].reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) >>> 0, 11)
  draw(img, mulberry32(seed))
  textures[name] = { img, used }
  return img
}

// Head: a 16-unit cube whose front is a dark face-screen.
const SCREEN_X0 = 2
const SCREEN_Y0 = 3
const SCREEN_W = 12
const SCREEN_H = 10
add('head_front', '16x16', (img, rnd) => {
  shell(img, rnd)
  img.rect(0, 15, 16, 1, SHELL_SHADE)
  img.rect(SCREEN_X0, SCREEN_Y0, SCREEN_W, SCREEN_H, SCREEN_EDGE)
  img.rect(SCREEN_X0 + 1, SCREEN_Y0 + 1, SCREEN_W - 2, SCREEN_H - 2, SCREEN)
  // Rounded screen corners.
  for (const [x, y] of [
    [SCREEN_X0, SCREEN_Y0],
    [SCREEN_X0 + SCREEN_W - 1, SCREEN_Y0],
    [SCREEN_X0, SCREEN_Y0 + SCREEN_H - 1],
    [SCREEN_X0 + SCREEN_W - 1, SCREEN_Y0 + SCREEN_H - 1]
  ])
    img.set(x, y, SHELL_SHADE)
  // A little glass glint in the top-left.
  img.set(4, 4, GLINT)
  img.set(5, 4, GLINT)
  img.set(4, 5, GLINT)
})
add('head_side', '16x16', (img, rnd) => {
  shell(img, rnd)
  img.rect(0, 15, 16, 1, SHELL_SHADE)
  // Orange cheek panel and a row of vents, like a robot's ear-plate.
  img.rect(3, 8, 7, 2, ORANGE[1])
  img.rect(3, 10, 7, 1, ORANGE[0])
  for (const x of [11, 13]) {
    img.set(x, 8, METAL[0])
    img.set(x, 9, METAL[0])
  }
})
add('head_top', '16x16', (img, rnd) => {
  shell(img, rnd)
  img.rect(0, 7, 16, 1, SEAM)
})
add('head_back', '16x16', (img, rnd) => {
  shell(img, rnd)
  img.rect(0, 15, 16, 1, SHELL_SHADE)
  img.rect(6, 6, 4, 2, ORANGE[1])
  img.rect(5, 11, 6, 1, SEAM)
})
add('head_bottom', '16x16', (img, rnd) => fill(img, [SHELL_SHADE, SEAM], rnd))

// Face-screen expressions: transparent overlays drawn at full brightness so they glow.
const EYES: Record<string, { rows: string[]; y: number }> = {
  eyes_idle: { rows: ['.XX.', 'X..X'], y: 7 }, // ^ ^
  eyes_blink: { rows: ['XXXX'], y: 8 }, // - -
  eyes_happy: { rows: ['XX..', '..XX', 'XX..'], y: 6 }, // > <  (right eye mirrored)
  eyes_hurt: { rows: ['X.X', '.X.', 'X.X'], y: 6 }, // x x
  eyes_alert: { rows: ['XX', 'XX', 'XX'], y: 6 }, // tall glowing blocks
  eyes_sad: { rows: ['XX..', '..XX'], y: 7 } // droopy
}
for (const [name, e] of Object.entries(EYES)) {
  add(name, '16x16 overlay (transparent except the eyes)', (img) => {
    const w = e.rows[0].length
    // Centre each eye in its half of the screen, symmetric around the middle.
    const left = Math.floor(4.5 - w / 2) + 1
    const right = 16 - left - w
    stamp(img, e.rows, left, e.y, CYAN)
    // Mirror the right eye so asymmetric shapes make a symmetric face.
    const mirrored = e.rows.map((r) => [...r].reverse().join(''))
    stamp(img, mirrored, right, e.y, CYAN)
    // Soft glow directly under the eyes (collected first so it doesn't cascade).
    const glow: [number, number][] = []
    for (let y = 0; y < img.h; y++)
      for (let x = 0; x < img.w; x++) if (img.alpha(x, y) && !img.alpha(x, y + 1) && y + 1 < 12) glow.push([x, y + 1])
    for (const [x, y] of glow) img.set(x, y, CYAN_DIM)
  })
}

// Ears: a 3 x 4 x 5 shell base with an orange inner panel, topped by a 2 x 3 x 3 orange tip.
add('ear_front', '5x4 (top-left)', (img, rnd) => {
  shell(img, rnd)
  stamp(img, ['.XXX.', '.XXX.', '.oXo.'], 0, 0, ORANGE[1], ORANGE[0])
})
add('ear_side', '3x4 (top-left)', (img, rnd) => shell(img, rnd))
add('ear_tip', '3x3 (top-left)', (img, rnd) => {
  fill(img, ORANGE, rnd)
  img.set(0, 0, ORANGE[2])
})

// Body: 24 long x 10 tall x 14 wide.
add('body_side', '16x10 (top 10 rows), repeats along the length', (img, rnd) => {
  shell(img, rnd)
  img.rect(0, 0, 16, 1, SHELL[3])
  img.rect(3, 3, 6, 2, ORANGE[1])
  img.rect(3, 5, 6, 1, ORANGE[0])
  img.rect(12, 2, 1, 6, SEAM)
  img.rect(0, 9, 16, 1, SHELL_SHADE)
})
add('body_top', '16x14 (top 14 rows), repeats along the length', (img, rnd) => {
  shell(img, rnd)
  img.rect(0, 6, 16, 2, SHELL_SHADE)
  img.set(5, 6, ORANGE[2])
})
add('body_end', '14x10 (top-left)', (img, rnd) => {
  shell(img, rnd)
  img.rect(0, 9, 16, 1, SHELL_SHADE)
  img.rect(5, 3, 4, 3, SEAM)
})
add('body_bottom', '16x14, repeats along the length', (img, rnd) => fill(img, METAL, rnd))

// Legs: 5 x 7 x 5. White upper, orange cuff, dark paw pads.
add('leg_side', '5x7 (top-left)', (img, rnd) => {
  shell(img, rnd)
  img.rect(0, 0, 16, 1, SHELL_SHADE)
  img.rect(0, 4, 16, 1, ORANGE[1])
  img.rect(0, 5, 16, 2, DARK[1])
  img.rect(0, 6, 16, 1, DARK[0])
})
add('leg_top', '5x5 (top-left)', (img, rnd) => fill(img, [SHELL_SHADE, SEAM], rnd))
add('leg_bottom', '5x5 (top-left)', (img, rnd) => fill(img, DARK, rnd))

// Tail: striped cable segments (3 x 4 x 3) with an orange tip.
add('tail_light', '3x4 (top-left)', (img, rnd) => fill(img, SHELL.slice(0, 3), rnd))
add('tail_dark', '3x4 (top-left)', (img, rnd) => fill(img, METAL, rnd))
add('tail_tip', '3x4 (top-left)', (img, rnd) => {
  fill(img, ORANGE, rnd)
  img.set(0, 0, ORANGE[2])
})

// Collar and bell. The bell lights up when Catbot is well fed.
add('collar', '15x3 (top-left)', (img, rnd) => {
  fill(img, DARK, rnd)
  for (let x = 1; x < 16; x += 4) img.set(x, 1, METAL[2])
})
add('bell_on', '3x3 (top-left)', (img, rnd) => {
  fill(img, BELL_ON, rnd)
  img.set(0, 0, '#fff6d6')
})
add('bell_off', '3x3 (top-left)', (img, rnd) => fill(img, BELL_OFF, rnd))

// Food: a golden "commit cube" (box scaled down in the scene, full 16x16 visible).
add('food', '16x16', (img, rnd) => {
  fill(img, GOLD, rnd)
  img.rect(0, 7, 16, 1, '#8a5a10')
  img.rect(0, 8, 16, 1, '#a8701a')
  img.rect(0, 15, 16, 1, '#b07a14')
  for (let y = 5; y <= 10; y++)
    for (let x = 5; x <= 10; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5)
      if (d < 3.2) img.set(x, y, d < 1.7 ? '#fff0b0' : '#8a5a10')
    }
})

// Particle sprites (8x8).
add(
  'heart',
  '8x8 sprite',
  (img) => {
    stamp(img, ['.XX.XX..', 'XoXXXXX.', 'XXXXXXX.', 'XXXXXXX.', '.XXXXX..', '..XXX...', '...X....'], 0, 0, '#ff5b6e', '#ffc0c7')
    outline(img, '#4a0e18')
  },
  8
)
add(
  'zzz',
  '8x8 sprite',
  (img) => {
    stamp(img, ['........', '.XXXXX..', '....X...', '...X....', '..X.....', '.XXXXX..'], 0, 0, CYAN)
    outline(img, '#0a2a33')
  },
  8
)

// --- write ------------------------------------------------------------------------------
mkdirSync(OUT, { recursive: true })
const manifest: string[] = []
for (const [name, { img, used }] of Object.entries(textures)) {
  writeFileSync(join(OUT, `${name}.png`), encodePng(img))
  manifest.push(`${name}.png`.padEnd(22) + used)
}
writeFileSync(join(OUT, 'TEXTURES.txt'), `Visible region of each PNG (see scripts/generate-textures.ts):\n\n${manifest.join('\n')}\n`)

// Icon: the face-screen with happy eyes, orange ears poking up, on a dark tile.
const icon = new Img(16, 16)
icon.rect(0, 0, 16, 16, '#11161c')
const face = textures.head_front.img
for (let y = 0; y < 13; y++) for (let x = 0; x < 14; x++) icon.set(x + 1, y + 3, face.get(x + 1, y + 1))
const eyes = textures.eyes_idle.img
for (let y = 0; y < 13; y++) for (let x = 0; x < 14; x++) if (eyes.alpha(x + 1, y + 1)) icon.set(x + 1, y + 3, eyes.get(x + 1, y + 1))
stamp(icon, ['XX', 'XoX'], 2, 1, SHELL[2], ORANGE[1])
stamp(icon, ['.XX', 'XoX'], 11, 1, SHELL[2], ORANGE[1])
writeFileSync(join(ROOT, 'assets', 'icon.png'), encodePng(scale(icon, 2)))
mkdirSync(join(ROOT, 'build'), { recursive: true })
writeFileSync(join(ROOT, 'build', 'icon.png'), encodePng(scale(icon, 16)))

console.log(`Wrote ${Object.keys(textures).length} textures to ${OUT}, plus assets/icon.png and build/icon.png`)
