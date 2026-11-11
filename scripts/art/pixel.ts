/**
 * Shared pixel-art toolkit for drawing GitGremlin pets in code: a tiny RGBA
 * image, pattern stamping, auto-outlines, scaling and a PNG encoder. Only
 * Node built-ins, so it runs with plain `node` (Node 23.6+ strips TS types).
 */
import { deflateSync } from 'node:zlib'

type RGBA = [number, number, number, number]

export function rgba(hex: string): RGBA {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255]
}

export class Img {
  w: number
  h: number
  data: Uint8Array
  constructor(w: number, h: number) {
    this.w = w
    this.h = h
    this.data = new Uint8Array(w * h * 4)
  }
  set(x: number, y: number, c: string): void {
    x = Math.round(x)
    y = Math.round(y)
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    this.data.set(rgba(c), (y * this.w + x) * 4)
  }
  rect(x: number, y: number, w: number, h: number, c: string): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c)
  }
  /** Rectangle with its four corner pixels knocked off. */
  round(x: number, y: number, w: number, h: number, c: string): void {
    this.rect(x + 1, y, w - 2, h, c)
    this.rect(x, y + 1, w, h - 2, c)
  }
  alpha(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0
    return this.data[(y * this.w + x) * 4 + 3]
  }
  get(x: number, y: number): RGBA {
    const i = (y * this.w + x) * 4
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]]
  }
  /** Add a 1px outline around everything drawn so far. */
  outline(c = '#1b2026'): this {
    const marks: [number, number][] = []
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (this.alpha(x, y)) continue
        if (this.alpha(x + 1, y) || this.alpha(x - 1, y) || this.alpha(x, y + 1) || this.alpha(x, y - 1)) marks.push([x, y])
      }
    for (const [x, y] of marks) this.set(x, y, c)
    return this
  }
  /** Paint `top` over this image (its transparent pixels are skipped). */
  over(top: Img, dx = 0, dy = 0): this {
    for (let y = 0; y < top.h; y++)
      for (let x = 0; x < top.w; x++) {
        const tx = x + dx
        const ty = y + dy
        if (top.alpha(x, y) && tx >= 0 && ty >= 0 && tx < this.w && ty < this.h) this.data.set(top.get(x, y), (ty * this.w + tx) * 4)
      }
    return this
  }
}

/** Draw a pixel pattern: 'X' = colour a, 'o' = colour b, anything else = skip. */
export function stamp(img: Img, rows: string[], x0: number, y0: number, a: string, b = a): void {
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === 'X') img.set(x0 + x, y0 + y, a)
      else if (ch === 'o') img.set(x0 + x, y0 + y, b)
    })
  )
}

export function scale(img: Img, k: number): Img {
  const out = new Img(img.w * k, img.h * k)
  for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) out.data.set(img.get(Math.floor(x / k), Math.floor(y / k)), (y * out.w + x) * 4)
  return out
}

// --- PNG encoder ---------------------------------------------------------------------------
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

export function png(img: Img): Buffer {
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

// --- pet art contract ----------------------------------------------------------------------
export interface FrameOut {
  img: Img
  /** Top-left of the eye overlay inside the frame. */
  screen: [number, number]
  /** Top-left of the lit accent overlay (e.g. Catbot's bell), if the pet has one. */
  accent: [number, number] | null
}

export interface AnimOut {
  fps: number
  loop: boolean
  frames: FrameOut[]
}

/**
 * Everything a pet's drawing module produces. Every pet provides the standard
 * animations (idle, idle_sad, walk, walk_sad, run, crawl, sit, sleep, starving,
 * jump_up, jump_down, dragged, eat, happy, hurt, tap, curious) and may add its
 * own (e.g. Dusty's rummage and wash).
 */
export interface PetArt {
  id: string
  cell: { w: number; h: number }
  /** Feet (bottom centre) inside each frame. */
  anchor: { x: number; y: number }
  anims: Record<string, AnimOut>
  /** Eye overlays by mood: idle, blink, happy, hurt, alert, sad. */
  eyes: Record<string, Img>
  /** Lit accent drawn over the frame while the pet is happy/fed, or null. */
  accentOn: Img | null
  /** What the pet eats (also used for crumbs), about 10x10. */
  food: Img
  /** A head portrait for the GitGremlin panel, about 20x20. */
  portrait: Img
}

/** Walk/run/crawl cycles: diagonal leg pairs swing together. Returns per-frame leg swings. */
export function gaitSwings(steps: number[], lifts: number[]): { s: number; liftA: number; liftB: number }[] {
  return steps.map((s, i) => ({ s, liftA: lifts[i], liftB: lifts[(i + steps.length / 2) % steps.length] }))
}

export const WALK = [2, 1, -1, -2, -1, 1]
export const WALK_LIFT = [0, 1, 1, 0, 0, 0]
export const RUN = [4, 2, -1, -4, -2, 1]
export const RUN_LIFT = [0, 2, 2, 0, 0, 0]
