/**
 * Syncy: a beaver who guards work you haven't saved to GitHub. Beavers build
 * dams to hold things back; Syncy holds back lost work. Brown fur, a tan
 * muzzle, big orange front teeth, a flat crosshatched paddle tail and a yellow
 * builder's hard hat. Side view, facing right.
 *
 * Extra animations: `rummage` (sitting up, gnawing a log: checking your
 * repos), `wash` (grooming after a meal) and `slap` (raising its tail and
 * slapping it down: the beaver warning, used when it nudges you).
 */
import { gaitSwings, Img, RUN, RUN_LIFT, stamp, WALK, WALK_LIFT, type AnimOut, type FrameOut, type PetArt } from './pixel.ts'

// --- palette ------------------------------------------------------------------------
const FUR = '#8a5a34'
const FUR_HI = '#a8723f'
const FUR_SHADE = '#6d4528'
const FUR_FAR = '#62401f'
const BELLY = '#b78253'
const MUZZLE = '#d2aa82'
const NOSE = '#2a1810'
const EAR = '#5a3720'
const TEETH = '#f2a93b'
const TEETH_DARK = '#c47f18'
const LEG = '#5e3b22'
const LEG_FAR = '#4d301c'
const PAW = '#3a2416'
const PAW_FAR = '#2c1b10'
const TAIL = '#4f4038'
const TAIL_LINE = '#332923'
const HAT = '#f2c230'
const HAT_SHADE = '#c99a1c'
const HAT_BRIM = '#e0ae22'
const LOG = '#9a6a3c'
const LOG_DARK = '#7a5230'
const LOG_END = '#e2bd8a'
const LOG_RING = '#b98a55'
const LEAF = '#4fae4a'
const EYE = '#1b120b'
const GLINT = '#ffffff'

const W = 50
const H = 38
const GROUND = 35

type Ears = 'up' | 'back'

interface Leg {
  x: number
  dx?: number
  lift?: number
  extra?: number
}

interface Pose {
  kind?: 'stand' | 'sit' | 'wash' | 'gnaw' | 'loaf' | 'flop'
  dy?: number
  head?: { dx?: number; dy?: number }
  ears?: Ears
  legs?: [Leg, Leg, Leg, Leg]
  /** Paddle tail direction in degrees (180 = straight back), and length. */
  tail?: { angle: number; len?: number }
  low?: number
  /** wash / gnaw: which phase (0/1). */
  phase?: number
  hat?: boolean
}

const STAND_LEGS = (): [Leg, Leg, Leg, Leg] => [{ x: 26 }, { x: 23 }, { x: 13 }, { x: 16 }]

/** Short stubby legs; the hind feet are big and webbed. */
function drawLeg(img: Img, leg: Leg, top: number, far: boolean, hind: boolean): void {
  const len = GROUND - top + 1 + (leg.extra ?? 0)
  const lift = leg.lift ?? 0
  const dx = leg.dx ?? 0
  const vis = len - lift
  for (let r = 0; r < vis; r++) {
    const x = leg.x + Math.round((dx * r) / Math.max(1, len - 1))
    const foot = r >= vis - 2
    const color = foot ? (far ? PAW_FAR : PAW) : far ? LEG_FAR : LEG
    img.rect(foot && hind ? x - 1 : x, top + r, foot && hind ? 4 : 3, 1, color)
  }
}

/** The flat, scaly paddle tail: a stem, then a wide oval with a crosshatch. */
function drawPaddle(img: Img, x0: number, y0: number, t: { angle: number; len?: number }): void {
  const len = t.len ?? 14
  const rad = (t.angle * Math.PI) / 180
  const ux = Math.cos(rad)
  const uy = -Math.sin(rad)
  const nx = -uy
  const ny = ux
  for (let i = 0; i < len; i++) {
    const cx = x0 + ux * i
    const cy = y0 + uy * i
    // Width profile: thin stem, then a wide rounded paddle.
    const hw = i < 2 ? 0.6 : i < 3 ? 1.6 : i < 4 ? 2.4 : i >= len - 1 ? 1.6 : i >= len - 2 ? 2.4 : 3
    for (let k = -hw; k <= hw + 0.01; k += 0.5) {
      const px = Math.round(cx + nx * k)
      const py = Math.round(cy + ny * k)
      img.set(px, py, i >= 3 && (px + py) % 3 === 0 ? TAIL_LINE : TAIL)
    }
  }
}

function drawEar(img: Img, x: number, y: number, style: Ears, far: boolean): void {
  if (style === 'back') img.rect(x - 1, y, 3, 2, far ? FUR_FAR : EAR)
  else img.round(x, y - 1, 3, 3, far ? FUR_FAR : EAR)
}

/** The builder's hard hat sitting on top of the head. */
function drawHat(img: Img, hx: number, hy: number): void {
  stamp(img, ['..XXXXX..', '.XXXXXXX.', 'XXXXXXXXX'], hx + 1, hy - 3, HAT)
  img.rect(hx + 2, hy - 1, 7, 1, HAT_SHADE)
  img.rect(hx + 4, hy - 3, 2, 2, HAT_SHADE) // the ridge down the middle
  img.rect(hx, hy, 11, 1, HAT_BRIM)
}

/** Round head with muzzle, nose and big front teeth at (hx, hy). Returns the eye-overlay origin. */
function drawHead(img: Img, hx: number, hy: number, ears: Ears, hat: boolean): [number, number] {
  drawEar(img, hx + 1, hy + 1, ears, true)
  img.round(hx, hy, 12, 10, FUR)
  img.rect(hx + 2, hy + 1, 7, 1, FUR_HI)
  img.rect(hx + 1, hy + 7, 7, 2, FUR_SHADE)
  // Tan muzzle, dark nose, whisker dots and the famous orange teeth.
  img.round(hx + 8, hy + 3, 7, 6, MUZZLE)
  img.rect(hx + 13, hy + 3, 2, 2, NOSE)
  img.set(hx + 10, hy + 6, FUR_SHADE)
  img.set(hx + 12, hy + 6, FUR_SHADE)
  img.rect(hx + 10, hy + 9, 3, 3, TEETH)
  img.set(hx + 11, hy + 9, TEETH_DARK)
  img.set(hx + 11, hy + 10, TEETH_DARK)
  drawEar(img, hx + 4, hy + 1, ears, false)
  if (hat) drawHat(img, hx, hy)
  return [hx + 2, hy + 3]
}

function drawBody(img: Img, bx: number, by: number, bw: number, bh: number): void {
  img.round(bx, by, bw, bh, FUR)
  img.rect(bx + 2, by, bw - 4, 1, FUR_HI)
  img.rect(bx + 4, by + bh - 3, bw - 8, 2, BELLY)
  img.rect(bx + 1, by + bh - 1, bw - 2, 1, FUR_SHADE)
  img.rect(bx + 4, by + 2, 5, 1, FUR_SHADE)
  img.rect(bx + 12, by + 3, 4, 1, FUR_SHADE)
}

/** A short log with light cut ends and a leaf: what Syncy gnaws and eats. */
function drawLog(img: Img, x: number, y: number, len = 8): void {
  img.rect(x, y, len, 4, LOG)
  img.rect(x, y + 3, len, 1, LOG_DARK)
  img.rect(x + 2, y + 1, 3, 1, LOG_DARK)
  img.rect(x + len - 1, y, 2, 4, LOG_END)
  img.set(x + len, y + 1, LOG_RING)
  img.set(x + len, y + 2, LOG_RING)
}

function frame(p: Pose): FrameOut {
  const kind = p.kind ?? 'stand'
  const dy = p.dy ?? 0
  const ears = p.ears ?? 'up'
  const hat = p.hat ?? true
  const back = new Img(W, H)
  const body = new Img(W, H)
  const near = new Img(W, H)
  const head = new Img(W, H)
  const front = new Img(W, H)
  let screen: [number, number]

  if (kind === 'stand') {
    const low = p.low ?? 0
    const bx = 10
    const by = 21 + dy + low
    const bh = 11 - Math.min(low, 3)
    const legs = p.legs ?? STAND_LEGS()
    const legTop = by + bh - 1
    drawLeg(back, legs[1], legTop, true, false)
    drawLeg(back, legs[3], legTop, true, true)
    drawPaddle(back, bx + 3, by + bh - 3, p.tail ?? { angle: 200 })
    drawBody(body, bx, by, 22, bh)
    drawLeg(near, legs[0], legTop, false, false)
    drawLeg(near, legs[2], legTop, false, true)
    const hx = 28 + (p.head?.dx ?? 0)
    const hy = 15 + dy + low + (p.head?.dy ?? 0)
    screen = drawHead(head, hx, hy, ears, hat)
  } else if (kind === 'sit' || kind === 'wash' || kind === 'gnaw') {
    // Sitting up on its haunches, propped on its flat tail.
    drawPaddle(back, 17, 33, p.tail ?? { angle: 180, len: 14 })
    body.round(14, 17, 13, 17, FUR)
    body.rect(15, 17, 11, 1, FUR_HI)
    body.rect(20, 20, 5, 12, BELLY)
    body.rect(14, 33, 7, 2, PAW) // big webbed hind foot
    const chew = kind === 'gnaw' ? (p.phase ?? 0) : 0
    const hx = 22 + (p.head?.dx ?? 0)
    const hy = 8 + chew + (p.head?.dy ?? 0)
    screen = drawHead(head, hx, hy, ears, hat)
    if (kind === 'sit') {
      near.rect(25, 24, 3, 3, LEG)
      near.rect(26, 26, 3, 2, PAW)
    } else if (kind === 'wash') {
      // Grooming: little paws rubbing its cheek, one up, one down.
      const up = p.phase ?? 0
      front.rect(hx + 7, hy + 7 - up * 2, 3, 3, PAW)
      front.rect(24, hy + 10 - up * 2, 3, 6, LEG)
      back.rect(hx + 5, hy + 8 + up, 3, 3, PAW_FAR)
    } else {
      // Gnawing: holding a log up to its teeth with both paws.
      drawLog(front, hx + 8, hy + 10, 8)
      front.rect(hx + 8, hy + 10, 2, 3, PAW)
      front.rect(hx + 14, hy + 10, 2, 3, PAW)
      front.rect(24, hy + 12, 3, 5, LEG)
    }
  } else if (kind === 'loaf') {
    const breathe = dy
    drawPaddle(back, 12, 33, p.tail ?? { angle: 180, len: 14 })
    drawBody(body, 10, 26 - breathe, 22, 10 + breathe)
    near.rect(28, 34, 4, 2, PAW)
    near.rect(11, 34, 5, 2, PAW)
    const hx = 27 + (p.head?.dx ?? 0)
    const hy = 24 + (p.head?.dy ?? 0)
    screen = drawHead(head, hx, hy, ears, hat)
  } else {
    // Flopped over: legs splayed along the ground, hat tipped off.
    const tw = dy
    back.rect(31, 31 - tw, 6, 3, LEG_FAR)
    back.rect(36, 31 - tw, 2, 3, PAW_FAR)
    back.rect(3, 32, 7, 3, LEG_FAR)
    drawPaddle(back, 10, 32, p.tail ?? { angle: 182, len: 13 })
    drawBody(body, 8, 27, 22, 9)
    near.rect(29, 33, 8, 3, LEG)
    near.rect(36, 33, 3, 3, PAW)
    const hx = 28 + (p.head?.dx ?? 0)
    const hy = 25 + (p.head?.dy ?? 0)
    screen = drawHead(head, hx, hy, 'back', false)
    stamp(front, ['..XXX', '.XXXX', 'XXXXX'], 42, 31, HAT)
  }

  const img = new Img(W, H)
  img.over(back.outline()).over(body.outline()).over(near.outline()).over(head.outline()).over(front.outline())
  return { img, screen, accent: null }
}

// --- animations ---------------------------------------------------------------------------------
const L = (x: number, dx = 0, lift = 0, extra = 0): Leg => ({ x, dx, lift, extra })

function gait(steps: number[], lifts: number[], opts: { bob?: number[]; tail: Pose['tail']; ears?: Ears; low?: number; head?: Pose['head'] }): Pose[] {
  return gaitSwings(steps, lifts).map(({ s, liftA, liftB }, i) => ({
    dy: opts.bob?.[i] ?? 0,
    low: opts.low,
    ears: opts.ears,
    head: opts.head,
    tail: opts.tail,
    legs: [L(26, s, liftA), L(23, -s, liftB), L(13, -s, liftB), L(16, s, liftA)]
  }))
}

const ANIMS: Record<string, { fps: number; loop: boolean; poses: Pose[] }> = {
  idle: { fps: 3, loop: true, poses: [198, 202, 206, 202].map((a) => ({ tail: { angle: a } })) },
  idle_sad: { fps: 2, loop: true, poses: [204, 206, 208, 206].map((a) => ({ tail: { angle: a }, ears: 'back' as const, head: { dy: 2 } })) },
  walk: { fps: 10, loop: true, poses: gait(WALK, WALK_LIFT, { bob: [0, 0, 1, 0, 0, 1], tail: { angle: 196 } }) },
  walk_sad: { fps: 7, loop: true, poses: gait(WALK, WALK_LIFT, { tail: { angle: 204 }, ears: 'back', head: { dy: 2 } }) },
  run: { fps: 14, loop: true, poses: gait(RUN, RUN_LIFT, { bob: [0, -1, -1, 0, 1, 0], tail: { angle: 186 }, ears: 'back' }) },
  crawl: {
    fps: 6,
    loop: true,
    poses: gait([1, 1, 0, -1, -1, 0], [0, 1, 0, 0, 0, 0], { low: 3, tail: { angle: 184 }, ears: 'back', head: { dy: 1 } })
  },
  sit: { fps: 1.5, loop: true, poses: [{ kind: 'sit' }, { kind: 'sit', head: { dy: 1 } }] },
  wash: { fps: 6, loop: true, poses: [0, 1].map((phase) => ({ kind: 'wash' as const, phase })) },
  // Gnawing a log: checking your repos.
  rummage: { fps: 7, loop: true, poses: [0, 1, 0, 1].map((phase) => ({ kind: 'gnaw' as const, phase })) },
  // Tail raised high, then slapped down: the beaver warning.
  slap: {
    fps: 6,
    loop: true,
    poses: [
      { tail: { angle: 120, len: 14 }, ears: 'up', head: { dy: -1 } },
      { tail: { angle: 95, len: 14 }, ears: 'up', head: { dy: -1 } },
      { tail: { angle: 150, len: 14 }, ears: 'up' },
      { tail: { angle: 205, len: 14 }, ears: 'up', dy: 1 }
    ]
  },
  sleep: {
    fps: 1.2,
    loop: true,
    poses: [
      { kind: 'loaf', ears: 'back', dy: 0 },
      { kind: 'loaf', ears: 'back', dy: 1 }
    ]
  },
  starving: { fps: 1, loop: true, poses: [{ kind: 'flop', dy: 0 }, { kind: 'flop', dy: 1 }] },
  jump_up: { fps: 1, loop: false, poses: [{ tail: { angle: 170 }, legs: [L(26, 3, 2), L(23, 3, 2), L(13, -3, 1), L(16, -3, 1)] }] },
  jump_down: { fps: 1, loop: false, poses: [{ tail: { angle: 160 }, legs: [L(26, 1), L(23, 1), L(13, -1), L(16, -1)] }] },
  dragged: {
    fps: 4,
    loop: true,
    poses: [-1, 1].map((s) => ({
      tail: { angle: 265 + s * 6 },
      ears: 'back' as const,
      legs: [L(26, s, 0, 1), L(23, s, 0, 1), L(13, s, 0, 1), L(16, s, 0, 1)] as [Leg, Leg, Leg, Leg]
    }))
  },
  eat: {
    fps: 8,
    loop: true,
    poses: [0, 2, 3, 2].map((d) => ({ head: { dx: 1, dy: d }, tail: { angle: 190 }, legs: [L(26, 1), L(23, 1), L(13), L(16)] as [Leg, Leg, Leg, Leg] }))
  },
  happy: { fps: 6, loop: true, poses: [160, 140].map((a) => ({ tail: { angle: a }, head: { dy: -1 } })) },
  hurt: {
    fps: 8,
    loop: true,
    poses: [0, 1].map((d) => ({ dy: d, ears: 'back' as const, tail: { angle: 206 }, legs: [L(26, 1), L(23, 1), L(13, -1), L(16, -1)] as [Leg, Leg, Leg, Leg] }))
  },
  tap: {
    fps: 7,
    loop: true,
    poses: [3, 1].map((lift) => ({ tail: { angle: 204 }, ears: 'back' as const, head: { dy: 1 }, legs: [L(26, 2, lift), L(23), L(13), L(16)] as [Leg, Leg, Leg, Leg] }))
  },
  curious: { fps: 1, loop: true, poses: [{ head: { dy: -1 }, tail: { angle: 175 } }] }
}

// --- eyes (7x3: far eye cols 0-1, near eye cols 5-6; 'o' = white glint) ------------------------------
const EYES: Record<string, string[]> = {
  idle: ['oX...oX', 'XX...XX', '.......'],
  blink: ['.......', 'XX...XX', '.......'],
  happy: ['.X...X.', 'X.X.X.X', '.......'],
  hurt: ['X.X.X.X', '.X...X.', 'X.X.X.X'],
  alert: ['oXX.oXX', 'XXX.XXX', 'XXX.XXX'],
  sad: ['.......', 'oX...oX', 'XX...XX']
}

function eyes(rows: string[]): Img {
  const img = new Img(7, 3)
  stamp(img, rows, 0, 0, EYE, GLINT)
  return img
}

export function syncy(): PetArt {
  const anims: Record<string, AnimOut> = {}
  for (const [name, a] of Object.entries(ANIMS)) anims[name] = { fps: a.fps, loop: a.loop, frames: a.poses.map(frame) }

  // What Syncy eats: a short log with a green sprig (your work, safely stored).
  const food = new Img(10, 10)
  drawLog(food, 0, 4, 8)
  stamp(food, ['.X.', 'XXX', '.X.'], 2, 1, LEAF)
  food.outline('#2b1a0e')

  const portrait = new Img(22, 22)
  drawHead(portrait, 3, 7, 'up', true)
  portrait.outline()
  portrait.over(eyes(EYES.idle), 5, 10)

  return {
    id: 'syncy',
    cell: { w: W, h: H },
    anchor: { x: 24, y: GROUND + 1 },
    anims,
    eyes: Object.fromEntries(Object.entries(EYES).map(([k, v]) => [k, eyes(v)])),
    accentOn: null,
    food,
    portrait
  }
}
