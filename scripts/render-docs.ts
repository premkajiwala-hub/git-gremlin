/**
 * Renders the README images from the pets' actual asset PNGs (so they show
 * exactly what the app draws, including repainted frames):
 *
 *   docs/images/pets-hero.png      all the pets together
 *   docs/images/catbot-poses.png   a strip of Catbot's animations
 *   docs/images/dusty-poses.png    a strip of Dusty's animations
 *   docs/images/syncy-poses.png    a strip of Syncy's animations
 *
 * Run with:  npm run docs-images
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'
import { Img, png, scale } from './art/pixel.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DOCS = join(ROOT, 'docs', 'images')
const BG = '#1f2a35'
const FLOOR = '#2a3846'
const SHADOW = '#17202a'

/** Decode an 8-bit RGBA PNG (what the art pipeline writes, and what pixel editors save). */
function readPng(path: string): Img {
  const buf = readFileSync(path)
  let pos = 8
  let w = 0
  let h = 0
  const idat: Buffer[] = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) throw new Error(`${path}: only 8-bit RGBA, non-interlaced PNGs are supported`)
    } else if (type === 'IDAT') idat.push(data)
    pos += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const img = new Img(w, h)
  const stride = w * 4
  const prev = new Uint8Array(stride)
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const out = new Uint8Array(stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? out[i - 4] : 0
      const b = prev[i]
      const c = i >= 4 ? prev[i - 4] : 0
      const p = a + b - c
      const pa = Math.abs(p - a)
      const pb = Math.abs(p - b)
      const pc = Math.abs(p - c)
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      const pred = [0, a, b, (a + b) >> 1, paeth][filter] ?? 0
      out[i] = (line[i] + pred) & 0xff
    }
    img.data.set(out, y * stride)
    prev.set(out)
  }
  return img
}

function flip(img: Img): Img {
  const out = new Img(img.w, img.h)
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) out.data.set(img.get(x, y), (y * img.w + img.w - 1 - x) * 4)
  return out
}

interface Meta {
  cell: { w: number; h: number }
  anchor: { x: number; y: number }
  accent: string | null
  anims: Record<string, { frames: { file: string; screen: [number, number]; accent: [number, number] | null }[] }>
}

interface Pose {
  anim: string
  frame: number
  eyes: string
  food?: boolean
  hearts?: boolean
  zzz?: boolean
}

/** One finished frame: body + eyes + lit accent + food, as the app composes it. */
function pose(pet: string, p: Pose): Img {
  const dir = join(ROOT, 'assets', 'pets', pet)
  const meta = JSON.parse(readFileSync(join(dir, 'frames.json'), 'utf8')) as Meta
  const f = meta.anims[p.anim].frames[p.frame]
  const img = readPng(join(dir, f.file))
  img.over(readPng(join(dir, `eyes_${p.eyes}.png`)), f.screen[0], f.screen[1])
  if (meta.accent && f.accent && p.eyes !== 'sad' && p.eyes !== 'blink') img.over(readPng(join(dir, meta.accent)), f.accent[0], f.accent[1])
  if (p.food) {
    const food = readPng(join(dir, 'food.png'))
    img.over(food, meta.anchor.x + 20 - Math.floor(food.w / 2), meta.anchor.y + 1 - food.h)
  }
  return img
}

/** Place a pose on a canvas with its feet at (fx, fy), plus a little shadow and particles. */
function place(canvas: Img, pet: string, p: Pose, fx: number, fy: number, mirrored = false): void {
  const meta = JSON.parse(readFileSync(join(ROOT, 'assets', 'pets', pet, 'frames.json'), 'utf8')) as Meta
  let img = pose(pet, p)
  const ax = mirrored ? meta.cell.w - 1 - meta.anchor.x : meta.anchor.x
  if (mirrored) img = flip(img)
  canvas.rect(fx - 9, fy, 18, 1, SHADOW)
  canvas.rect(fx - 6, fy + 1, 12, 1, SHADOW)
  canvas.over(img, fx - ax, fy - meta.anchor.y)
  const tex = join(ROOT, 'assets', 'textures')
  if (p.hearts) {
    const heart = readPng(join(tex, 'heart.png'))
    canvas.over(heart, fx - 2, fy - 40)
    canvas.over(heart, fx + 6, fy - 46)
  }
  if (p.zzz) canvas.over(readPng(join(tex, 'zzz.png')), fx + (mirrored ? -16 : 10), fy - 26)
}

function strip(pet: string, poses: Pose[]): Img {
  const cw = 56
  const canvas = new Img(cw * poses.length + 8, 60)
  canvas.round(0, 0, canvas.w, canvas.h, BG)
  canvas.rect(1, 50, canvas.w - 2, 1, FLOOR)
  poses.forEach((p, i) => place(canvas, pet, p, 4 + i * cw + 28, 50))
  return canvas
}

mkdirSync(DOCS, { recursive: true })

const hero = new Img(200, 66)
hero.round(0, 0, hero.w, hero.h, BG)
hero.rect(1, 56, hero.w - 2, 1, FLOOR)
place(hero, 'catbot', { anim: 'idle', frame: 0, eyes: 'happy' }, 46, 56)
place(hero, 'syncy', { anim: 'sit', frame: 0, eyes: 'idle' }, 100, 56)
place(hero, 'dusty', { anim: 'idle', frame: 0, eyes: 'idle' }, 154, 56, true)
const heart = readPng(join(ROOT, 'assets', 'textures', 'heart.png'))
hero.over(heart, 70, 14)
hero.over(heart, 124, 18)
writeFileSync(join(DOCS, 'pets-hero.png'), png(scale(hero, 5)))

const catbot: Pose[] = [
  { anim: 'idle', frame: 0, eyes: 'idle' },
  { anim: 'walk', frame: 1, eyes: 'idle' },
  { anim: 'run', frame: 2, eyes: 'happy' },
  { anim: 'eat', frame: 1, eyes: 'happy', food: true },
  { anim: 'happy', frame: 0, eyes: 'happy', hearts: true },
  { anim: 'sit', frame: 0, eyes: 'idle' },
  { anim: 'idle_sad', frame: 0, eyes: 'sad' },
  { anim: 'sleep', frame: 0, eyes: 'blink', zzz: true }
]
writeFileSync(join(DOCS, 'catbot-poses.png'), png(scale(strip('catbot', catbot), 3)))

const dusty: Pose[] = [
  { anim: 'idle', frame: 0, eyes: 'idle' },
  { anim: 'walk', frame: 1, eyes: 'idle' },
  { anim: 'run', frame: 2, eyes: 'happy' },
  { anim: 'rummage', frame: 1, eyes: 'alert' },
  { anim: 'eat', frame: 1, eyes: 'happy', food: true },
  { anim: 'happy', frame: 0, eyes: 'happy', hearts: true },
  { anim: 'wash', frame: 0, eyes: 'happy' },
  { anim: 'sleep', frame: 0, eyes: 'blink', zzz: true }
]
writeFileSync(join(DOCS, 'dusty-poses.png'), png(scale(strip('dusty', dusty), 3)))

const syncy: Pose[] = [
  { anim: 'idle', frame: 0, eyes: 'idle' },
  { anim: 'walk', frame: 1, eyes: 'idle' },
  { anim: 'rummage', frame: 1, eyes: 'idle' },
  { anim: 'slap', frame: 1, eyes: 'alert' },
  { anim: 'eat', frame: 1, eyes: 'happy', food: true },
  { anim: 'happy', frame: 0, eyes: 'happy', hearts: true },
  { anim: 'wash', frame: 0, eyes: 'happy' },
  { anim: 'sleep', frame: 0, eyes: 'blink', zzz: true }
]
writeFileSync(join(DOCS, 'syncy-poses.png'), png(scale(strip('syncy', syncy), 3)))

console.log(`Wrote README images to ${DOCS}`)
