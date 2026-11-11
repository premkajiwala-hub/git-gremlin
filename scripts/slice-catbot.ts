/**
 * Slices the catbot sprite sheet (art/catbot-sheet.webp) into individual,
 * aligned animation frames:
 *
 *   assets/catbot/<anim>-<n>.png   one PNG per frame, all the same cell size
 *   assets/catbot/frames.json      animation list, frame rate and anchor point
 *   assets/icon.png, build/icon.png  tray and installer icons (catbot head)
 *
 * Run with:  npm run sprites
 *
 * How it works: the sheet's background is transparent, so we find connected
 * blobs of opaque pixels, drop the dark label pills, treat big blobs as catbots
 * and attach small blobs (Zs, "!", "?", sparkles, jump shadows) to the nearest
 * catbot. Frames are lined up on the catbot's face screen (so the body doesn't
 * jitter) and on each animation's ground line.
 *
 * To use a different sheet, keep the same layout (rows/order) or edit LAYOUT.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHEET = join(ROOT, 'art', 'catbot-sheet.webp')
const OUT = join(ROOT, 'assets', 'catbot')

/** Animations per sheet row, left to right, with their frame counts. */
const LAYOUT: { name: string; count: number; fps: number; loop: boolean }[][] = [
  [
    { name: 'idle', count: 4, fps: 4, loop: true },
    { name: 'walk-right', count: 6, fps: 9, loop: true }
  ],
  [
    { name: 'walk-left', count: 5, fps: 9, loop: true },
    { name: 'sit', count: 4, fps: 6, loop: false },
    { name: 'sleep', count: 4, fps: 1.5, loop: true }
  ],
  [
    { name: 'jump', count: 5, fps: 10, loop: false },
    { name: 'curious', count: 4, fps: 4, loop: false },
    { name: 'happy', count: 3, fps: 6, loop: true },
    { name: 'hurt', count: 2, fps: 6, loop: true }
  ]
]

const ALPHA_MIN = 60 // the sheet's "transparent" background has alpha 0..1
const PAD = 6

interface Blob {
  x0: number
  y0: number
  x1: number
  y1: number
  area: number
  dark: number
  pixels: number[]
}

const { data, info } = await sharp(SHEET).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const W = info.width
const H = info.height
const alpha = (i: number) => data[i * 4 + 3]

// --- connected components ------------------------------------------------------
const seen = new Uint8Array(W * H)
const blobs: Blob[] = []
for (let start = 0; start < W * H; start++) {
  if (seen[start] || alpha(start) < ALPHA_MIN) continue
  const b: Blob = { x0: W, y0: H, x1: 0, y1: 0, area: 0, dark: 0, pixels: [] }
  const stack = [start]
  seen[start] = 1
  while (stack.length) {
    const p = stack.pop()!
    const x = p % W
    const y = (p - x) / W
    b.pixels.push(p)
    b.area++
    if (data[p * 4] + data[p * 4 + 1] + data[p * 4 + 2] < 150) b.dark++
    if (x < b.x0) b.x0 = x
    if (x > b.x1) b.x1 = x
    if (y < b.y0) b.y0 = y
    if (y > b.y1) b.y1 = y
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const q = ny * W + nx
        if (!seen[q] && alpha(q) >= ALPHA_MIN) {
          seen[q] = 1
          stack.push(q)
        }
      }
  }
  if (b.area >= 12) blobs.push(b)
}

const w = (b: Blob) => b.x1 - b.x0 + 1
const h = (b: Blob) => b.y1 - b.y0 + 1
// Label pills: wide, short, mostly dark rounded rectangles with text.
const isPill = (b: Blob) => w(b) > 1.5 * h(b) && h(b) < 55
const cats = blobs.filter((b) => !isPill(b) && b.area > 2500)
const extras = blobs.filter((b) => !isPill(b) && b.area <= 2500)

// --- group catbots into rows, then animations ------------------------------------
cats.sort((a, b) => a.y0 - b.y0)
const rows: Blob[][] = []
for (const c of cats) {
  const cy = (c.y0 + c.y1) / 2
  const row = rows.find((r) => Math.abs((r[0].y0 + r[0].y1) / 2 - cy) < 90)
  if (row) row.push(c)
  else rows.push([c])
}
rows.forEach((r) => r.sort((a, b) => a.x0 - b.x0))
const expected = LAYOUT.map((r) => r.reduce((n, a) => n + a.count, 0))
if (rows.length !== LAYOUT.length || rows.some((r, i) => r.length !== expected[i])) {
  for (const r of rows) console.error(r.map((b) => `[${b.x0},${b.y0} ${w(b)}x${h(b)} a=${b.area}]`).join(' '))
  throw new Error(`Found rows of ${rows.map((r) => r.length).join('/')} catbots, expected ${expected.join('/')}`)
}

// Attach each small blob to the nearest catbot (by bounding-box distance).
const attached = new Map<Blob, Blob[]>(cats.map((c) => [c, []]))
for (const e of extras) {
  const ex = (e.x0 + e.x1) / 2
  const ey = (e.y0 + e.y1) / 2
  let best: Blob | null = null
  let bestD = Infinity
  for (const c of cats) {
    const dx = Math.max(c.x0 - ex, 0, ex - c.x1)
    const dy = Math.max(c.y0 - ey, 0, ey - c.y1)
    const d = Math.hypot(dx, dy)
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  if (best && bestD < 70) attached.get(best)!.push(e)
}

/** Centroid of the dark teal face screen: a stable point to align frames on. */
function screenCenter(c: Blob): { x: number; y: number; w: number; h: number } {
  let sx = 0
  let sy = 0
  let n = 0
  let x0 = W
  let x1 = 0
  let y0 = H
  let y1 = 0
  for (const p of c.pixels) {
    const r = data[p * 4]
    const g = data[p * 4 + 1]
    const bl = data[p * 4 + 2]
    if (Math.max(r, g, bl) < 95 && bl > r + 12 && g > r + 6) {
      const x = p % W
      const y = (p - x) / W
      sx += x
      sy += y
      n++
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      y0 = Math.min(y0, y)
      y1 = Math.max(y1, y)
    }
  }
  if (!n) return { x: (c.x0 + c.x1) / 2, y: (c.y0 + c.y1) / 2, w: w(c) / 2, h: h(c) / 3 }
  return { x: sx / n, y: sy / n, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

interface Frame {
  anim: string
  index: number
  parts: Blob[]
  /** Sheet x that should land on the cell's centre, and the ground line y. */
  ax: number
  groundY: number
  top: number
  left: number
  right: number
  bottom: number
}

const frames: Frame[] = []
const anims: Record<string, { frames: string[]; fps: number; loop: boolean }> = {}
LAYOUT.forEach((rowLayout, ri) => {
  let i = 0
  for (const a of rowLayout) {
    const group = rows[ri].slice(i, i + a.count)
    i += a.count
    const ground = Math.max(...group.map((c) => c.y1))
    const offsets = group.map((c) => (c.x0 + c.x1) / 2 - screenCenter(c).x)
    const meanOffset = offsets.reduce((s, v) => s + v, 0) / offsets.length
    group.forEach((c, fi) => {
      const parts = [c, ...attached.get(c)!]
      frames.push({
        anim: a.name,
        index: fi,
        parts,
        ax: screenCenter(c).x + meanOffset,
        groundY: ground,
        top: Math.min(...parts.map((p) => p.y0)),
        bottom: Math.max(...parts.map((p) => p.y1)),
        left: Math.min(...parts.map((p) => p.x0)),
        right: Math.max(...parts.map((p) => p.x1))
      })
    })
    anims[a.name] = { frames: group.map((_, fi) => `${a.name}-${fi}.png`), fps: a.fps, loop: a.loop }
  }
})

// One cell size for every frame so the renderer can use a single anchor.
const halfW = Math.ceil(Math.max(...frames.map((f) => Math.max(f.ax - f.left, f.right - f.ax)))) + PAD
const above = Math.ceil(Math.max(...frames.map((f) => f.groundY - f.top))) + PAD
const below = Math.ceil(Math.max(...frames.map((f) => f.bottom - f.groundY))) + PAD
const cellW = halfW * 2
const cellH = above + below

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
for (const f of frames) {
  const cell = Buffer.alloc(cellW * cellH * 4)
  const ox = Math.round(halfW - f.ax)
  const oy = Math.round(above - f.groundY)
  for (const part of f.parts)
    for (const p of part.pixels) {
      const x = (p % W) + ox
      const y = Math.floor(p / W) + oy
      if (x < 0 || y < 0 || x >= cellW || y >= cellH) continue
      data.copy(cell, (y * cellW + x) * 4, p * 4, p * 4 + 4)
    }
  await sharp(cell, { raw: { width: cellW, height: cellH, channels: 4 } })
    .png()
    .toFile(join(OUT, `${f.anim}-${f.index}.png`))
}

// Typical standing height (ears to feet), used to scale to the "size" setting.
const idle = frames.filter((f) => f.anim === 'idle')
const standHeight = Math.round(idle.reduce((s, f) => s + (f.groundY - f.parts[0].y0), 0) / idle.length)
const standWidth = Math.round(idle.reduce((s, f) => s + (f.parts[0].x1 - f.parts[0].x0), 0) / idle.length)
writeFileSync(
  join(OUT, 'frames.json'),
  JSON.stringify({ cell: { w: cellW, h: cellH }, anchor: { x: halfW, y: above }, standHeight, standWidth, anims }, null, 2)
)

// Icons: a square crop around the first idle frame's head.
const head = screenCenter(rows[0][0])
// The face screen sits on the right of the head, so shift left to include both ears.
const side = Math.round(head.w * 2.05)
const crop = {
  left: Math.max(0, Math.round(head.x - head.w * 0.18 - side / 2)),
  top: Math.max(0, Math.round(head.y - side * 0.6)),
  width: side,
  height: side
}
const headPng = await sharp(SHEET).extract(crop).png().toBuffer()
await sharp(headPng).resize(32, 32, { kernel: 'lanczos3' }).png().toFile(join(ROOT, 'assets', 'icon.png'))
mkdirSync(join(ROOT, 'build'), { recursive: true })
await sharp(headPng).resize(256, 256, { kernel: 'lanczos3' }).png().toFile(join(ROOT, 'build', 'icon.png'))

console.log(`Sliced ${frames.length} frames (${cellW}x${cellH}) into ${OUT}; stand height ${standHeight}px`)
