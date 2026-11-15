/**
 * Mole: digs through your ports and processes. Moles live underground and
 * barely see, so this one wears round glasses. Slate-grey velvet fur, a pink
 * pointed snout, huge pink digging paws and a stubby pink tail. Side view,
 * facing right.
 *
 * Extra animations: `rummage` (digging into a little dirt mound: looking
 * through your ports, and its warning when a port is taken) and `wash`
 * (polishing its glasses after a meal).
 */
import { gaitSwings, Img, RUN, RUN_LIFT, stamp, WALK, WALK_LIFT, type AnimOut, type FrameOut, type PetArt } from './pixel.ts'

// --- palette ------------------------------------------------------------------------
const FUR = '#4f4858'
const FUR_HI = '#6c6378'
const FUR_SHADE = '#3a3442'
const FUR_FAR = '#36313e'
const BELLY = '#5d5567'
const SNOUT = '#f2a7b0'
const SNOUT_SHADE = '#d9848f'
const NOSE = '#c4566c'
const PAW = '#f4b8b4'
const PAW_FAR = '#cf8f8c'
const CLAW = '#fbe3dc'
const TAIL = '#e99aa6'
const WHISKER = '#a59cb0'
const FRAME_C = '#1f1d24'
const LENS = '#d6ecf5'
const LENS_FAR = '#b5ccd6'
const DIRT = '#7a5332'
const DIRT_DARK = '#5a3b22'
const DIRT_HI = '#9a6d44'
const WORM = '#ef8e9e'
const WORM_DARK = '#c86b7c'
const EYE = '#16131a'
const GLINT = '#ffffff'

const W = 50
const H = 38
const GROUND = 35

interface Leg {
  x: number
  dx?: number
  lift?: number
  extra?: number
}

interface Pose {
  kind?: 'stand' | 'sit' | 'wash' | 'dig' | 'loaf' | 'flop'
  dy?: number
  head?: { dx?: number; dy?: number }
  legs?: [Leg, Leg, Leg, Leg]
  /** Tail stub: how far it points up (0 = straight back). */
  tail?: number
  low?: number
  /** wash / dig: which phase (0/1). */
  phase?: number
  glasses?: boolean
}

/** A filled ellipse inside the box (x, y, w, h). */
function oval(img: Img, x: number, y: number, w: number, h: number, c: string): void {
  const rx = w / 2
  const ry = h / 2
  for (let yy = 0; yy < h; yy++)
    for (let xx = 0; xx < w; xx++) {
      const dx = (xx + 0.5 - rx) / rx
      const dy = (yy + 0.5 - ry) / ry
      if (dx * dx + dy * dy <= 1.08) img.set(x + xx, y + yy, c)
    }
}

/** An oval with a lit top edge and a shaded bottom edge. */
function shaded(img: Img, x: number, y: number, w: number, h: number): void {
  oval(img, x, y, w, h, FUR_SHADE)
  oval(img, x, y, w, h - 1, FUR_HI)
  oval(img, x, y + 1, w, h - 2, FUR)
}

const STAND_LEGS = (): [Leg, Leg, Leg, Leg] => [{ x: 30 }, { x: 27 }, { x: 13 }, { x: 16 }]

/** Very short legs. Front legs end in huge pink spade paws with pale claws; hind feet are small. */
function drawLeg(img: Img, leg: Leg, top: number, far: boolean, front: boolean): void {
  const len = GROUND - top + 1 + (leg.extra ?? 0)
  const lift = leg.lift ?? 0
  const dx = leg.dx ?? 0
  const vis = len - lift
  for (let r = 0; r < vis; r++) {
    const x = leg.x + Math.round((dx * r) / Math.max(1, len - 1))
    const foot = r >= vis - 2
    if (!foot) {
      img.rect(x, top + r, 3, 1, far ? FUR_FAR : FUR_SHADE)
      continue
    }
    if (front) {
      // The spade: wide, turned outward, claws at the front.
      img.rect(x - 1, top + r, 6, 1, far ? PAW_FAR : PAW)
      if (r === vis - 1) img.rect(x + 5, top + r, 1, 1, far ? PAW_FAR : CLAW)
      else img.set(x + 3, top + r, far ? PAW_FAR : CLAW)
    } else img.rect(x, top + r, 3, 1, far ? PAW_FAR : PAW)
  }
}

function drawTail(img: Img, x: number, y: number, up: number): void {
  img.set(x, y, TAIL)
  img.set(x - 1, y - Math.round(up / 2), TAIL)
  img.set(x - 2, y - up, TAIL)
}

/** Round glasses: a lens around each eye, a bridge, and an arm back to the ear. */
function drawGlasses(img: Img, hx: number, hy: number): void {
  const ring = (x: number, y: number, lens: string) => {
    img.round(x, y, 4, 5, FRAME_C)
    img.rect(x + 1, y + 1, 2, 3, lens)
  }
  ring(hx + 2, hy + 2, LENS_FAR)
  ring(hx + 7, hy + 2, LENS)
  img.set(hx + 6, hy + 3, FRAME_C)
  img.rect(hx, hy + 3, 2, 1, FRAME_C)
}

/** Head with snout at (hx, hy). Returns the eye-overlay origin. */
function drawHead(img: Img, hx: number, hy: number, glasses: boolean): [number, number] {
  shaded(img, hx - 1, hy, 14, 10)
  // Pink pointed snout with a darker nose tip, whiskers and a little mouth.
  img.rect(hx + 11, hy + 4, 3, 1, SNOUT)
  img.rect(hx + 11, hy + 5, 5, 1, SNOUT)
  img.rect(hx + 11, hy + 6, 4, 1, SNOUT_SHADE)
  img.rect(hx + 15, hy + 4, 1, 2, NOSE)
  img.set(hx + 16, hy + 5, NOSE)
  img.set(hx + 13, hy + 3, WHISKER)
  img.set(hx + 14, hy + 7, WHISKER)
  img.set(hx + 11, hy + 7, FUR_SHADE)
  if (glasses) drawGlasses(img, hx, hy)
  return [hx + 3, hy + 3]
}

function drawBody(img: Img, bx: number, by: number, bw: number, bh: number): void {
  shaded(img, bx, by - 1, bw, bh + 1)
  oval(img, bx + 5, by + bh - 4, bw - 10, 3, BELLY)
  // Velvet sheen.
  img.rect(bx + 6, by + 2, 4, 1, FUR_HI)
  img.rect(bx + 14, by + 3, 3, 1, FUR_HI)
}

/** A little mound of dirt, bumpier on `phase` 1. */
function drawMound(img: Img, x: number, phase: number): void {
  img.round(x, GROUND - 3, 10, 4, DIRT)
  img.round(x + 2, GROUND - 5 - phase, 6, 3, DIRT)
  img.rect(x + 3, GROUND - 5 - phase, 3, 1, DIRT_HI)
  img.rect(x + 1, GROUND, 8, 1, DIRT_DARK)
  img.set(x + 6, GROUND - 2, DIRT_DARK)
  img.set(x + 3, GROUND - 1, DIRT_DARK)
}

function frame(p: Pose): FrameOut {
  const kind = p.kind ?? 'stand'
  const dy = p.dy ?? 0
  const glasses = p.glasses ?? true
  const back = new Img(W, H)
  const body = new Img(W, H)
  const near = new Img(W, H)
  const head = new Img(W, H)
  const front = new Img(W, H)
  let screen: [number, number]

  if (kind === 'stand' || kind === 'dig') {
    const dig = kind === 'dig'
    const low = (p.low ?? 0) + (dig ? 1 : 0)
    const bx = 8
    const by = 22 + dy + low
    const bh = 11 - Math.min(low, 3)
    const legs = p.legs ?? STAND_LEGS()
    const legTop = by + bh - 2
    drawLeg(back, legs[1], legTop, true, true)
    drawLeg(back, legs[3], legTop, true, false)
    drawTail(back, bx, by + 4, p.tail ?? 1)
    drawBody(body, bx, by, 25, bh)
    drawLeg(near, legs[0], legTop, false, true)
    drawLeg(near, legs[2], legTop, false, false)
    const phase = p.phase ?? 0
    const hx = 28 + (p.head?.dx ?? 0) + (dig ? 1 : 0)
    const hy = 19 + dy + low + (p.head?.dy ?? 0) + (dig ? 3 : 0)
    screen = drawHead(head, hx, hy, glasses)
    if (dig) {
      // Nose in the dirt, front paws scooping it away in turns.
      drawMound(front, 38, phase)
      front.rect(36 + phase * 2, GROUND - 3, 4, 2, PAW)
      front.set(40 + phase * 2, GROUND - 3, CLAW)
    }
  } else if (kind === 'sit' || kind === 'wash') {
    // Sitting up on its haunches, big paws in front of its chest.
    drawTail(back, 16, 33, 0)
    shaded(body, 14, 15, 16, 20)
    oval(body, 21, 19, 7, 13, BELLY)
    body.rect(15, 33, 6, 2, PAW) // hind foot
    const hx = 20 + (p.head?.dx ?? 0)
    const hy = 7 + (p.head?.dy ?? 0)
    screen = drawHead(head, hx, hy, glasses)
    if (kind === 'sit') {
      front.rect(25, 24, 5, 2, PAW)
      front.set(30, 24, CLAW)
      back.rect(23, 23, 4, 2, PAW_FAR)
    } else {
      // Polishing its glasses: paws rubbing the lens, one up, one down.
      const up = p.phase ?? 0
      front.rect(hx + 7, hy + 6 - up * 2, 4, 3, PAW)
      front.set(hx + 10, hy + 6 - up * 2, CLAW)
      front.rect(26, hy + 9 - up, 3, 6, FUR_SHADE)
      back.rect(hx + 2, hy + 7 + up, 3, 3, PAW_FAR)
    }
  } else if (kind === 'loaf') {
    const breathe = dy
    drawTail(back, 9, 31, 0)
    drawBody(body, 8, 26 - breathe, 25, 10 + breathe)
    near.rect(31, 34, 5, 2, PAW)
    near.rect(11, 34, 4, 2, PAW)
    const hx = 29 + (p.head?.dx ?? 0)
    const hy = 24 + (p.head?.dy ?? 0)
    screen = drawHead(head, hx, hy, glasses)
  } else {
    // Flopped over, paws in the air, glasses fallen off beside it.
    const tw = dy
    back.rect(31, 30 - tw, 5, 2, PAW_FAR)
    back.rect(4, 32, 6, 2, PAW_FAR)
    drawBody(body, 8, 27, 25, 9)
    near.rect(30, 32 - tw, 6, 2, PAW)
    near.rect(35, 31 - tw, 2, 1, CLAW)
    const hx = 30 + (p.head?.dx ?? 0)
    const hy = 25 + (p.head?.dy ?? 0)
    screen = drawHead(head, hx, hy, false)
    front.rect(46, 32, 3, 3, FRAME_C)
    front.set(47, 33, LENS)
    front.rect(43, 33, 3, 1, FRAME_C)
  }

  const img = new Img(W, H)
  img.over(back.outline()).over(body.outline()).over(near.outline()).over(head.outline()).over(front.outline())
  return { img, screen, accent: null }
}

// --- animations ---------------------------------------------------------------------------------
const L = (x: number, dx = 0, lift = 0, extra = 0): Leg => ({ x, dx, lift, extra })

function gait(steps: number[], lifts: number[], opts: { bob?: number[]; tail?: number; low?: number; head?: Pose['head'] }): Pose[] {
  return gaitSwings(steps, lifts).map(({ s, liftA, liftB }, i) => ({
    dy: opts.bob?.[i] ?? 0,
    low: opts.low,
    head: opts.head,
    tail: opts.tail,
    legs: [L(30, s, liftA), L(27, -s, liftB), L(13, -s, liftB), L(16, s, liftA)]
  }))
}

const ANIMS: Record<string, { fps: number; loop: boolean; poses: Pose[] }> = {
  idle: { fps: 3, loop: true, poses: [1, 2, 2, 1].map((t, i) => ({ tail: t, head: { dy: i === 2 ? 1 : 0 } })) },
  idle_sad: { fps: 2, loop: true, poses: [0, 0, 0, 0].map((t, i) => ({ tail: t, head: { dy: i % 2 ? 2 : 1 } })) },
  walk: { fps: 10, loop: true, poses: gait(WALK, WALK_LIFT, { bob: [0, 0, 1, 0, 0, 1], tail: 1 }) },
  walk_sad: { fps: 7, loop: true, poses: gait(WALK, WALK_LIFT, { tail: 0, head: { dy: 2 } }) },
  run: { fps: 14, loop: true, poses: gait(RUN, RUN_LIFT, { bob: [0, -1, -1, 0, 1, 0], tail: 2 }) },
  crawl: { fps: 6, loop: true, poses: gait([1, 1, 0, -1, -1, 0], [0, 1, 0, 0, 0, 0], { low: 3, tail: 0, head: { dy: 1 } }) },
  sit: { fps: 1.5, loop: true, poses: [{ kind: 'sit' }, { kind: 'sit', head: { dy: 1 } }] },
  // Polishing its glasses.
  wash: { fps: 6, loop: true, poses: [0, 1].map((phase) => ({ kind: 'wash' as const, phase })) },
  // Digging: looking through your ports.
  rummage: { fps: 8, loop: true, poses: [0, 1, 0, 1].map((phase, i) => ({ kind: 'dig' as const, phase, dy: i % 2 })) },
  sleep: {
    fps: 1.2,
    loop: true,
    poses: [
      { kind: 'loaf', dy: 0 },
      { kind: 'loaf', dy: 1 }
    ]
  },
  starving: { fps: 1, loop: true, poses: [{ kind: 'flop', dy: 0 }, { kind: 'flop', dy: 1 }] },
  jump_up: { fps: 1, loop: false, poses: [{ tail: 3, legs: [L(30, 3, 2), L(27, 3, 2), L(13, -3, 1), L(16, -3, 1)] }] },
  jump_down: { fps: 1, loop: false, poses: [{ tail: 2, legs: [L(30, 1), L(27, 1), L(13, -1), L(16, -1)] }] },
  dragged: {
    fps: 4,
    loop: true,
    poses: [-1, 1].map((s) => ({ tail: 0, legs: [L(30, s, 0, 1), L(27, s, 0, 1), L(13, s, 0, 1), L(16, s, 0, 1)] as [Leg, Leg, Leg, Leg] }))
  },
  eat: {
    fps: 8,
    loop: true,
    poses: [0, 2, 3, 2].map((d) => ({ head: { dx: 1, dy: d }, tail: 1, legs: [L(30, 1), L(27, 1), L(13), L(16)] as [Leg, Leg, Leg, Leg] }))
  },
  happy: { fps: 6, loop: true, poses: [3, 2].map((t, i) => ({ tail: t, dy: -i, head: { dy: -1 } })) },
  hurt: {
    fps: 8,
    loop: true,
    poses: [0, 1].map((d) => ({ dy: d, tail: 0, legs: [L(30, 1), L(27, 1), L(13, -1), L(16, -1)] as [Leg, Leg, Leg, Leg] }))
  },
  tap: {
    fps: 7,
    loop: true,
    poses: [3, 1].map((lift) => ({ tail: 0, head: { dy: 1 }, legs: [L(30, 2, lift), L(27), L(13), L(16)] as [Leg, Leg, Leg, Leg] }))
  },
  curious: { fps: 1, loop: true, poses: [{ head: { dy: -1 }, tail: 3 }] }
}

// --- eyes (7x3: far eye cols 0-1, near eye cols 5-6, inside the lenses; 'o' = white glint) ---------
const EYES: Record<string, string[]> = {
  idle: ['.X...X.', 'XX...XX', '.......'],
  blink: ['.......', 'XX...XX', '.......'],
  happy: ['.......', 'XX...XX', '.......'],
  hurt: ['X....X.', '.X....X', 'X....X.'],
  alert: ['oX...oX', 'XX...XX', 'XX...XX'],
  sad: ['.......', '.X...X.', 'XX...XX']
}

function eyes(rows: string[]): Img {
  const img = new Img(7, 3)
  stamp(img, rows, 0, 0, EYE, GLINT)
  return img
}

export function mole(): PetArt {
  const anims: Record<string, AnimOut> = {}
  for (const [name, a] of Object.entries(ANIMS)) anims[name] = { fps: a.fps, loop: a.loop, frames: a.poses.map(frame) }

  // What Mole eats: an earthworm on a clod of dirt (the dirt is what flies when it digs).
  const food = new Img(10, 10)
  food.round(1, 3, 8, 6, DIRT)
  food.rect(2, 7, 6, 1, DIRT_DARK)
  food.set(4, 4, DIRT_HI)
  stamp(food, ['XX....XX', '.XX..XX.', '..XXXX..'], 1, 0, WORM)
  food.set(1, 0, WORM_DARK)
  food.outline('#2a1a10')

  const portrait = new Img(24, 22)
  drawHead(portrait, 3, 7, true)
  portrait.outline()
  portrait.over(eyes(EYES.idle), 6, 10)

  return {
    id: 'mole',
    cell: { w: W, h: H },
    anchor: { x: 24, y: GROUND + 1 },
    anims,
    eyes: Object.fromEntries(Object.entries(EYES).map(([k, v]) => [k, eyes(v)])),
    accentOn: null,
    food,
    portrait
  }
}
