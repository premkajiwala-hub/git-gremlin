/**
 * Draws Catbot, a 2D pixel-art robot cat, entirely in code and exports every
 * animation frame as a PNG so you can repaint them in Aseprite or Piskel:
 *
 *   assets/catbot/<anim>-<n>.png   50x38 side-view frames, facing right
 *   assets/catbot/eyes_<mood>.png  8x6 face-screen expressions (overlaid at runtime)
 *   assets/catbot/bell_on.png      lit collar bell (overlaid when well fed)
 *   assets/catbot/frames.json      animations, frame rates, anchor, screen/bell positions
 *   assets/textures/*.png          particles: food cube, heart, Z
 *   assets/icon.png, build/icon.png  tray and installer icons
 *
 * Run with:  npm run textures   (overwrites repainted files)
 *
 * Self-contained: only Node built-ins (Node 23.6+ strips TS types natively).
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

type RGBA = [number, number, number, number]

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'assets', 'catbot')
const TEX = join(ROOT, 'assets', 'textures')

// --- palette ------------------------------------------------------------------------
const INK = '#1b2026'
const SHELL = '#eef0f3'
const SHELL_HI = '#fbfcfd'
const SHELL_MID = '#dde1e6'
const SHADE = '#bcc3cb'
const SEAM = '#aab2bb'
const METAL = '#7b848e'
const PAW = '#3b4149'
const PAW_FAR = '#2c3137'
const ORANGE = '#ff9a2e'
const ORANGE_DARK = '#d97716'
const ORANGE_FAR = '#d98a3a'
const SCREEN = '#0a1b21'
const SCREEN_EDGE = '#1d3a44'
const GLINT = '#2a5a66'
const CYAN = '#5ef2ff'
const CYAN_DIM = '#2ab3c4'
const BELL_OFF = '#8a6630'
const BELL_OFF_HI = '#a57a3a'
const BELL_ON = '#ffc23d'
const BELL_ON_HI = '#fff0b0'

// --- image helpers ------------------------------------------------------------------------
function rgba(hex: string): RGBA {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255]
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
  /** Add a 1px dark outline around everything drawn so far. */
  outline(c = INK): this {
    const marks: [number, number][] = []
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (this.alpha(x, y)) continue
        if (this.alpha(x + 1, y) || this.alpha(x - 1, y) || this.alpha(x, y + 1) || this.alpha(x, y - 1)) marks.push([x, y])
      }
    for (const [x, y] of marks) this.set(x, y, c)
    return this
  }
  over(top: Img): this {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) if (top.alpha(x, y)) this.data.set(top.get(x, y), (y * this.w + x) * 4)
    return this
  }
  mirror(): Img {
    const out = new Img(this.w, this.h)
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) out.data.set(this.get(x, y), (y * this.w + this.w - 1 - x) * 4)
    return out
  }
}

/** Draw a pixel pattern ('X' = colour a, 'o' = colour b). */
function stamp(img: Img, rows: string[], x0: number, y0: number, a: string, b = a): void {
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === 'X') img.set(x0 + x, y0 + y, a)
      else if (ch === 'o') img.set(x0 + x, y0 + y, b)
    })
  )
}

// --- PNG encoder ------------------------------------------------------------------------------
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
function png(img: Img): Buffer {
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
  for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) out.data.set(img.get(Math.floor(x / k), Math.floor(y / k)), (y * out.w + x) * 4)
  return out
}

// --- the catbot ---------------------------------------------------------------------------------
const W = 50
const H = 38
/** Bottom row of the feet. */
const GROUND = 35
const ANCHOR = { x: 24, y: GROUND + 1 }

interface Leg {
  /** Left column of the 3px-wide leg at the hip. */
  x: number
  /** Horizontal swing of the paw (the hip stays put). */
  dx?: number
  /** How far the paw is lifted off the ground. */
  lift?: number
  /** Extra length (dangling legs). */
  extra?: number
}

interface Pose {
  kind?: 'stand' | 'sit' | 'loaf' | 'flop'
  /** Whole-body vertical offset (positive = down). */
  dy?: number
  head?: { dx?: number; dy?: number }
  ears?: 'up' | 'back' | 'perk'
  /** Near-front, far-front, near-back, far-back. */
  legs?: [Leg, Leg, Leg, Leg]
  /** Tail: base angle in degrees (90 = straight up, 180 = straight back), curl per segment, length. */
  tail?: { angle: number; curl?: number; len?: number }
  /** Body squash for crouching (rows removed from the body height). */
  low?: number
}

interface FrameInfo {
  img: Img
  screen: [number, number]
  bell: [number, number]
}

const STAND_LEGS = (): [Leg, Leg, Leg, Leg] => [{ x: 25 }, { x: 22 }, { x: 13 }, { x: 16 }]

function drawLeg(img: Img, leg: Leg, top: number, far: boolean): void {
  const len = GROUND - top + 1 + (leg.extra ?? 0)
  const lift = leg.lift ?? 0
  const dx = leg.dx ?? 0
  const vis = len - lift
  for (let r = 0; r < vis; r++) {
    const x = leg.x + Math.round((dx * r) / Math.max(1, len - 1))
    const color = r < vis - 3 ? (far ? SHADE : SHELL) : r === vis - 3 ? (far ? ORANGE_FAR : ORANGE) : far ? PAW_FAR : PAW
    img.rect(x, top + r, 3, 1, color)
  }
}

function drawTail(img: Img, x0: number, y0: number, t: { angle: number; curl?: number; len?: number }): void {
  const len = t.len ?? 9
  let x = x0
  let y = y0
  let a = t.angle
  for (let i = 0; i < len; i++) {
    const rad = (a * Math.PI) / 180
    x += Math.cos(rad) * 1.5
    y -= Math.sin(rad) * 1.5
    a += t.curl ?? -6
    const tip = i >= len - 2
    const color = tip ? ORANGE : Math.floor(i / 2) % 2 === 0 ? SHELL_MID : METAL
    img.rect(Math.round(x), Math.round(y), tip && i === len - 1 ? 3 : 2, tip && i === len - 1 ? 3 : 2, color)
  }
}

function drawEar(img: Img, x: number, y: number, style: 'up' | 'back' | 'perk', far: boolean): void {
  const body = far ? SHADE : SHELL
  const inner = far ? ORANGE_FAR : ORANGE
  if (style === 'back') {
    stamp(img, ['XXX..', 'XXXXX'], x - 1, y - 2, body)
    img.set(x + 1, y - 1, inner)
    return
  }
  const rows = style === 'perk' ? ['.X..', '.XX.', '.XoX', '.XoX', 'XXXX'] : ['.X..', '.XX.', '.XoX', 'XXXX']
  stamp(img, rows, x, y - rows.length, body, inner)
}

/** The head (with face-screen and ears) at (hx, hy). Returns the screen-interior origin. */
function drawHead(img: Img, hx: number, hy: number, ears: 'up' | 'back' | 'perk'): [number, number] {
  drawEar(img, hx + 3, hy, ears, true)
  img.round(hx, hy, 16, 13, SHELL)
  img.rect(hx + 1, hy + 11, 14, 1, SHELL_MID)
  img.rect(hx + 1, hy + 1, 13, 1, SHELL_HI)
  // Cheek panel and vent on the side of the head.
  img.rect(hx + 1, hy + 6, 3, 2, ORANGE)
  img.rect(hx + 1, hy + 8, 3, 1, ORANGE_DARK)
  img.set(hx + 2, hy + 10, METAL)
  // Face-screen.
  img.round(hx + 5, hy + 2, 10, 9, SCREEN_EDGE)
  img.rect(hx + 6, hy + 3, 8, 7, SCREEN)
  img.set(hx + 6, hy + 3, GLINT)
  img.set(hx + 7, hy + 3, GLINT)
  img.set(hx + 6, hy + 4, GLINT)
  drawEar(img, hx + 9, hy, ears, false)
  return [hx + 6, hy + 4]
}

function drawBody(img: Img, bx: number, by: number, bw: number, bh: number): void {
  img.round(bx, by, bw, bh, SHELL)
  img.rect(bx + 1, by, bw - 2, 1, SHELL_HI)
  img.rect(bx + 1, by + bh - 1, bw - 2, 1, SHADE)
  img.rect(bx + 4, by + 2, 5, 2, ORANGE)
  img.rect(bx + 4, by + 4, 5, 1, ORANGE_DARK)
  img.rect(bx + 11, by + 2, 1, Math.max(1, bh - 4), SEAM)
}

function drawCollar(img: Img, hx: number, hy: number): [number, number] {
  img.rect(hx + 1, hy + 13, 7, 1, PAW)
  const bx = hx + 5
  const by = hy + 13
  img.rect(bx, by, 3, 3, BELL_OFF)
  img.set(bx, by, BELL_OFF_HI)
  return [bx, by]
}

/** Draw one frame from a pose, layer by layer, each outlined so the parts read clearly. */
function frame(p: Pose): FrameInfo {
  const kind = p.kind ?? 'stand'
  const dy = p.dy ?? 0
  const ears = p.ears ?? 'up'
  const back = new Img(W, H)
  const body = new Img(W, H)
  const near = new Img(W, H)
  const head = new Img(W, H)
  let screen: [number, number]
  let bell: [number, number]

  if (kind === 'stand') {
    const low = p.low ?? 0
    const bx = 12
    const by = 18 + dy + low
    const bh = 9 - Math.min(low, 3)
    const legs = p.legs ?? STAND_LEGS()
    const legTop = by + bh - 1
    drawLeg(back, legs[1], legTop, true)
    drawLeg(back, legs[3], legTop, true)
    drawTail(back, bx + 1, by + 2, p.tail ?? { angle: 115 })
    drawBody(body, bx, by, 18, bh)
    drawLeg(near, legs[0], legTop, false)
    drawLeg(near, legs[2], legTop, false)
    const hx = 26 + (p.head?.dx ?? 0)
    const hy = 9 + dy + low + (p.head?.dy ?? 0)
    screen = drawHead(head, hx, hy, ears)
    bell = drawCollar(head, hx, hy)
  } else if (kind === 'sit') {
    // Haunches down, front legs straight, tail curled along the ground.
    drawTail(back, 13, 32, p.tail ?? { angle: 180, curl: -14, len: 8 })
    body.round(11, 23, 11, 12, SHADE)
    body.round(14, 17, 14, 13, SHELL)
    body.rect(15, 17, 12, 1, SHELL_HI)
    body.rect(17, 20, 4, 2, ORANGE)
    body.rect(17, 22, 4, 1, ORANGE_DARK)
    body.rect(11, 33, 6, 2, PAW)
    drawLeg(near, { x: 24 }, 27, false)
    drawLeg(back, { x: 21 }, 27, true)
    const hx = 24 + (p.head?.dx ?? 0)
    const hy = 7 + (p.head?.dy ?? 0)
    screen = drawHead(head, hx, hy, ears)
    bell = drawCollar(head, hx, hy)
  } else if (kind === 'loaf') {
    // Lying down like a loaf, paws tucked, tail wrapped round the front.
    const breathe = dy
    drawTail(back, 9, 31, p.tail ?? { angle: 200, curl: 12, len: 9 })
    drawBody(body, 9, 25 - breathe, 21, 11 + breathe)
    near.rect(27, 34, 4, 2, PAW)
    near.rect(10, 34, 4, 2, PAW)
    const hx = 25 + (p.head?.dx ?? 0)
    const hy = 21 + (p.head?.dy ?? 0)
    screen = drawHead(head, hx, hy, ears)
    bell = [hx + 5, hy + 13]
  } else {
    // Flopped over: legs splayed out along the ground, head down.
    const tw = dy
    back.rect(31, 31 - tw, 6, 3, SHADE)
    back.rect(36, 31 - tw, 2, 3, PAW_FAR)
    back.rect(3, 32, 7, 3, SHADE)
    back.rect(2, 32, 2, 3, PAW_FAR)
    drawTail(back, 9, 33, p.tail ?? { angle: 175, curl: 2, len: 8 })
    drawBody(body, 8, 27, 22, 9)
    near.rect(29, 33, 8, 3, SHELL)
    near.rect(35, 33, 1, 3, ORANGE)
    near.rect(36, 33, 3, 3, PAW)
    near.rect(4, 34, 7, 2, SHELL)
    near.rect(2, 34, 2, 2, PAW)
    const hx = 27 + (p.head?.dx ?? 0)
    const hy = 23 + (p.head?.dy ?? 0)
    screen = drawHead(head, hx, hy, 'back')
    bell = [hx + 5, hy + 13]
  }

  const img = new Img(W, H)
  img.over(back.outline()).over(body.outline()).over(near.outline()).over(head.outline())
  return { img, screen, bell }
}

// --- animations ---------------------------------------------------------------------------------
const L = (x: number, dx = 0, lift = 0, extra = 0): Leg => ({ x, dx, lift, extra })

/** Walk/run/crawl cycles: diagonal leg pairs swing together. */
function gait(steps: number[], lifts: number[], opts: { bob?: number[]; tail: Pose['tail']; ears?: Pose['ears']; low?: number; head?: Pose['head'] }): Pose[] {
  return steps.map((s, i) => ({
    dy: opts.bob?.[i] ?? 0,
    low: opts.low,
    ears: opts.ears,
    head: opts.head,
    tail: opts.tail,
    legs: [L(25, s, lifts[i]), L(22, -s, lifts[(i + steps.length / 2) % steps.length]), L(13, -s, lifts[(i + steps.length / 2) % steps.length]), L(16, s, lifts[i])]
  }))
}

const WALK = [2, 1, -1, -2, -1, 1]
const WALK_LIFT = [0, 1, 1, 0, 0, 0]
const RUN = [4, 2, -1, -4, -2, 1]
const RUN_LIFT = [0, 2, 2, 0, 0, 0]

const ANIMS: Record<string, { fps: number; loop: boolean; poses: Pose[] }> = {
  idle: {
    fps: 3,
    loop: true,
    poses: [112, 118, 124, 118].map((a, i) => ({ tail: { angle: a, curl: -7 }, dy: i === 2 ? 0 : 0 }))
  },
  idle_sad: {
    fps: 2,
    loop: true,
    poses: [196, 200, 204, 200].map((a) => ({ tail: { angle: a, curl: 3 }, ears: 'back' as const, head: { dy: 2 } }))
  },
  walk: { fps: 10, loop: true, poses: gait(WALK, WALK_LIFT, { bob: [0, 0, 1, 0, 0, 1], tail: { angle: 125, curl: -6 } }) },
  walk_sad: {
    fps: 7,
    loop: true,
    poses: gait(WALK, WALK_LIFT, { tail: { angle: 200, curl: 3 }, ears: 'back', head: { dy: 2 } })
  },
  run: {
    fps: 14,
    loop: true,
    poses: gait(RUN, RUN_LIFT, { bob: [0, -1, -1, 0, 1, 0], tail: { angle: 165, curl: -2 }, ears: 'back' })
  },
  crawl: {
    fps: 6,
    loop: true,
    poses: gait([1, 1, 0, -1, -1, 0], [0, 1, 0, 0, 0, 0], { low: 3, tail: { angle: 175, curl: -2 }, ears: 'back', head: { dy: 1 } })
  },
  sit: { fps: 1.5, loop: true, poses: [{ kind: 'sit' }, { kind: 'sit', tail: { angle: 180, curl: -16, len: 8 } }] },
  sleep: {
    fps: 1.2,
    loop: true,
    poses: [
      { kind: 'loaf', ears: 'back', dy: 0 },
      { kind: 'loaf', ears: 'back', dy: 1 }
    ]
  },
  starving: { fps: 1, loop: true, poses: [{ kind: 'flop', dy: 0 }, { kind: 'flop', dy: 1 }] },
  jump_up: {
    fps: 1,
    loop: false,
    poses: [{ tail: { angle: 150, curl: -3 }, legs: [L(25, 3, 2), L(22, 3, 2), L(13, -3, 1), L(16, -3, 1)], ears: 'perk' }]
  },
  jump_down: {
    fps: 1,
    loop: false,
    poses: [{ tail: { angle: 105, curl: -4 }, legs: [L(25, 1), L(22, 1), L(13, -1), L(16, -1)] }]
  },
  dragged: {
    fps: 4,
    loop: true,
    poses: [-1, 1].map((s) => ({
      tail: { angle: 255, curl: s * 4 },
      ears: 'back' as const,
      legs: [L(25, s, 0, 1), L(22, s, 0, 1), L(13, s, 0, 1), L(16, s, 0, 1)] as [Leg, Leg, Leg, Leg]
    }))
  },
  eat: {
    fps: 8,
    loop: true,
    poses: [0, 2, 4, 2].map((d) => ({ head: { dx: 1, dy: d }, tail: { angle: 110, curl: -7 }, legs: [L(25, 1), L(22, 1), L(13), L(16)] as [Leg, Leg, Leg, Leg] }))
  },
  happy: {
    fps: 6,
    loop: true,
    poses: [95, 80].map((a) => ({ tail: { angle: a, curl: -9 }, ears: 'perk' as const }))
  },
  hurt: {
    fps: 8,
    loop: true,
    poses: [0, 1].map((d) => ({ dy: d, ears: 'back' as const, tail: { angle: 190, curl: 2 }, legs: [L(25, 1), L(22, 1), L(13, -1), L(16, -1)] as [Leg, Leg, Leg, Leg] }))
  },
  tap: {
    fps: 7,
    loop: true,
    poses: [3, 1].map((lift) => ({ tail: { angle: 200, curl: 3 }, ears: 'back' as const, head: { dy: 1 }, legs: [L(25, 2, lift), L(22), L(13), L(16)] as [Leg, Leg, Leg, Leg] }))
  },
  curious: {
    fps: 1,
    loop: true,
    poses: [{ ears: 'perk', head: { dy: -1 }, tail: { angle: 100, curl: -10 } }]
  }
}

// --- face-screen expressions (8x6, left eye cols 0-2, right eye cols 5-7) --------------------------
const EYES: Record<string, string[]> = {
  idle: ['........', '.X....X.', 'X.X..X.X', '........', '........', '........'],
  blink: ['........', '........', '........', 'XXX..XXX', '........', '........'],
  happy: ['........', 'X......X', '.X....X.', 'X......X', '........', '........'],
  hurt: ['........', 'X.X..X.X', '.X....X.', 'X.X..X.X', '........', '........'],
  alert: ['........', '.XX..XX.', '.XX..XX.', '.XX..XX.', '........', '........'],
  sad: ['........', '........', 'XX....XX', '..X..X..', '........', '........']
}

// --- write everything -------------------------------------------------------------------------
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
mkdirSync(TEX, { recursive: true })

const meta: {
  cell: { w: number; h: number }
  anchor: { x: number; y: number }
  standHeight: number
  standWidth: number
  eyes: { w: number; h: number }
  anims: Record<string, { fps: number; loop: boolean; frames: { file: string; screen: [number, number]; bell: [number, number] }[] }>
} = { cell: { w: W, h: H }, anchor: ANCHOR, standHeight: 0, standWidth: 0, eyes: { w: 8, h: 6 }, anims: {} }

let firstIdle: FrameInfo | null = null
for (const [name, a] of Object.entries(ANIMS)) {
  meta.anims[name] = { fps: a.fps, loop: a.loop, frames: [] }
  a.poses.forEach((pose, i) => {
    const f = frame(pose)
    if (name === 'idle' && i === 0) firstIdle = f
    const file = `${name}-${i}.png`
    writeFileSync(join(OUT, file), png(f.img))
    meta.anims[name].frames.push({ file, screen: f.screen, bell: f.bell })
  })
}

// Standing size, measured from the first idle frame.
{
  const img = firstIdle!.img
  let top = H
  let left = W
  let right = 0
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (img.alpha(x, y)) {
        top = Math.min(top, y)
        left = Math.min(left, x)
        right = Math.max(right, x)
      }
  meta.standHeight = ANCHOR.y - top
  meta.standWidth = right - left + 1
}

for (const [mood, rows] of Object.entries(EYES)) {
  const img = new Img(8, 6)
  stamp(img, rows, 0, 0, CYAN)
  // A dim glow pixel under each lit pixel that has nothing below it.
  const glow: [number, number][] = []
  for (let y = 0; y < 5; y++) for (let x = 0; x < 8; x++) if (img.alpha(x, y) && !img.alpha(x, y + 1)) glow.push([x, y + 1])
  for (const [x, y] of glow) img.set(x, y, CYAN_DIM)
  writeFileSync(join(OUT, `eyes_${mood}.png`), png(img))
}

const bellOn = new Img(3, 3)
bellOn.rect(0, 0, 3, 3, BELL_ON)
bellOn.set(0, 0, BELL_ON_HI)
writeFileSync(join(OUT, 'bell_on.png'), png(bellOn))
writeFileSync(join(OUT, 'frames.json'), JSON.stringify(meta, null, 2))

// Particles.
const food = new Img(8, 8)
food.rect(0, 0, 8, 8, '#e9ac2a')
food.rect(0, 0, 8, 1, '#ffd75e')
food.rect(0, 7, 8, 1, '#b07a14')
food.rect(0, 3, 8, 1, '#8a5a10')
food.rect(3, 2, 2, 3, '#fff0b0')
food.outline('#5a3a08')
const foodPad = new Img(10, 10)
for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (food.alpha(x, y)) foodPad.data.set(food.get(x, y), ((y + 1) * 10 + x + 1) * 4)
foodPad.outline('#5a3a08')
writeFileSync(join(TEX, 'food.png'), png(foodPad))

const heart = new Img(9, 8)
stamp(heart, ['.XX.XX.', 'XoXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'], 1, 1, '#ff5b6e', '#ffc0c7')
heart.outline('#4a0e18')
writeFileSync(join(TEX, 'heart.png'), png(heart))

const zzz = new Img(7, 7)
stamp(zzz, ['XXXXX', '...X.', '..X..', '.X...', 'XXXXX'], 1, 1, CYAN)
zzz.outline('#0a2a33')
writeFileSync(join(TEX, 'zzz.png'), png(zzz))

// Icons: the catbot's head and ears on a dark rounded tile.
const iconHead = new Img(20, 20)
drawHead(iconHead, 2, 6, 'up')
iconHead.outline()
const eyeImg = new Img(8, 6)
stamp(eyeImg, EYES.idle, 0, 0, CYAN)
for (let y = 0; y < 6; y++) for (let x = 0; x < 8; x++) if (eyeImg.alpha(x, y)) iconHead.set(8 + x, 10 + y, CYAN)
const icon = new Img(20, 20)
icon.round(0, 0, 20, 20, '#11161c')
icon.over(iconHead)
writeFileSync(join(ROOT, 'assets', 'icon.png'), png(scale(icon, 2)))
mkdirSync(join(ROOT, 'build'), { recursive: true })
writeFileSync(join(ROOT, 'build', 'icon.png'), png(scale(icon, 13)))

const count = Object.values(meta.anims).reduce((n, a) => n + a.frames.length, 0)
console.log(`Drew ${count} catbot frames (${W}x${H}, stand height ${meta.standHeight}px) into ${OUT}`)
