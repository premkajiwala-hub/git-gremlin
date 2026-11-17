/**
 * Squirrel: keeps an eye on your free tiers, the way squirrels stash acorns
 * so they don't run out. A red squirrel with tufted ears, a cream belly, a
 * big bushy S-shaped tail, and a little brown backpack stuffed with acorns
 * (your saved allowance). Side view, facing right.
 *
 * Extra animations: `rummage` (nose down, burying an acorn: checking your
 * usage) and `wash` (sitting up, scrubbing its face).
 */
import { gaitSwings, Img, RUN, RUN_LIFT, stamp, WALK, WALK_LIFT, type AnimOut, type FrameOut, type PetArt } from './pixel.ts'

// --- palette ------------------------------------------------------------------------
const FUR = '#c4612b'
const FUR_HI = '#de8448'
const FUR_SHADE = '#9a4720'
const FUR_FAR = '#86401d'
const BELLY = '#f1d8b0'
const TAIL = '#d26d33'
const TAIL_HI = '#eb9455'
const TAIL_SHADE = '#a14d22'
const EAR_IN = '#f0a77d'
const NOSE = '#2a1610'
const PAW = '#7a3415'
const PAW_FAR = '#632b12'
const PACK = '#5f7d3d'
const PACK_SHADE = '#47622b'
const STRAP = '#3d2616'
const BUCKLE = '#e2b04a'
const NUT = '#c99a5b'
const NUT_SHADE = '#a5793f'
const CAP = '#6b4321'
const CAP_HI = '#8c5a2e'
const STEM = '#4a2d15'
const DIRT = '#7a5332'
const EYE = '#1a0f0a'
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
  kind?: 'stand' | 'sit' | 'wash' | 'eat' | 'loaf' | 'flop'
  dy?: number
  head?: { dx?: number; dy?: number }
  legs?: [Leg, Leg, Leg, Leg]
  /** Tail sway: how far the top of the tail leans (px). */
  sway?: number
  low?: number
  /** Nose down to the ground, burying an acorn (0/1). */
  dig?: number
  phase?: number
}

const STAND_LEGS = (): [Leg, Leg, Leg, Leg] => [{ x: 29 }, { x: 27 }, { x: 18 }, { x: 20 }]

/** Slim legs, dark paws; the hind feet are long. */
function drawLeg(img: Img, leg: Leg, top: number, far: boolean, hind: boolean): void {
  const len = GROUND - top + 1 + (leg.extra ?? 0)
  const lift = leg.lift ?? 0
  const dx = leg.dx ?? 0
  const vis = len - lift
  for (let r = 0; r < vis; r++) {
    const x = leg.x + Math.round((dx * r) / Math.max(1, len - 1))
    const foot = r >= vis - 1
    img.rect(foot && hind ? x - 1 : x, top + r, foot && hind ? 4 : 2, 1, foot ? (far ? PAW_FAR : PAW) : far ? FUR_FAR : FUR_SHADE)
  }
}

/** One acorn: cap on top, nut below, tiny stem. */
function acorn(img: Img, x: number, y: number): void {
  img.rect(x, y + 1, 4, 2, CAP)
  img.rect(x + 1, y + 1, 2, 1, CAP_HI)
  img.set(x + 2, y, STEM)
  img.rect(x, y + 3, 4, 2, NUT)
  img.rect(x + 1, y + 5, 2, 1, NUT)
  img.set(x + 3, y + 4, NUT_SHADE)
}

/** The big bushy tail: a column of round tufts curling up and over, with a lit edge. */
function drawTail(img: Img, x0: number, y0: number, sway: number, curl = 1): void {
  const pts: [number, number, number][] = [
    [0, 0, 3],
    [-3, -4, 4],
    [-5, -9, 5],
    [-4 + sway / 2, -14, 5],
    [-1 + sway, -17, 4],
    [2 + sway, -18 * curl, 3]
  ]
  for (const [dx, dy, r] of pts) img.round(Math.round(x0 + dx - r), Math.round(y0 + dy - r), r * 2, r * 2, TAIL)
  for (const [dx, dy, r] of pts.slice(1)) img.rect(Math.round(x0 + dx - r + 1), Math.round(y0 + dy - r), r, 1, TAIL_HI)
  img.rect(Math.round(x0 - 7), Math.round(y0 - 9), 1, 4, TAIL_SHADE)
}

/** Backpack on its back, stuffed with acorns. */
function drawPack(img: Img, x: number, y: number): void {
  acorn(img, x + 1, y - 5)
  acorn(img, x + 4, y - 4)
  img.round(x, y, 8, 7, PACK)
  img.rect(x, y, 8, 2, PACK_SHADE)
  img.rect(x + 1, y + 6, 6, 1, PACK_SHADE)
  img.set(x + 4, y + 2, BUCKLE)
  // The shoulder strap across its chest.
  img.rect(x + 8, y + 3, 3, 1, STRAP)
}

/** Round head with a pointed muzzle and tufted ears at (hx, hy). Returns the eye-overlay origin. */
function drawHead(img: Img, back: Img, hx: number, hy: number): [number, number] {
  // Far ear, then the head, then the near ear with its tuft.
  stamp(back, ['.X', 'XX', 'XX'], hx + 5, hy - 3, FUR_FAR)
  img.round(hx, hy, 11, 9, FUR)
  img.rect(hx + 2, hy, 6, 1, FUR_HI)
  img.round(hx + 7, hy + 3, 6, 5, FUR)
  img.rect(hx + 8, hy + 6, 4, 2, BELLY)
  img.rect(hx + 3, hy + 6, 5, 2, BELLY)
  img.rect(hx + 12, hy + 3, 2, 2, NOSE)
  stamp(img, ['X.', 'XX', 'XX', 'XX'], hx + 1, hy - 4, FUR)
  img.set(hx + 1, hy - 5, FUR_SHADE)
  img.set(hx + 2, hy - 2, EAR_IN)
  return [hx + 3, hy + 2]
}

function frame(p: Pose): FrameOut {
  const kind = p.kind ?? 'stand'
  const dy = p.dy ?? 0
  const back = new Img(W, H)
  const body = new Img(W, H)
  const near = new Img(W, H)
  const head = new Img(W, H)
  const front = new Img(W, H)
  let screen: [number, number]

  if (kind === 'stand') {
    const low = p.low ?? 0
    const bx = 16
    const by = 23 + dy + low
    const bh = 9 - Math.min(low, 2)
    const legs = p.legs ?? STAND_LEGS()
    const legTop = by + bh - 2
    drawLeg(back, legs[1], legTop, true, false)
    drawLeg(back, legs[3], legTop, true, true)
    drawTail(back, bx + 1, by + 3, p.sway ?? 0)
    body.round(bx, by, 16, bh, FUR)
    body.rect(bx + 2, by, 12, 1, FUR_HI)
    body.rect(bx + 5, by + bh - 2, 9, 2, BELLY)
    body.round(bx + 1, by + 2, 6, bh - 2, FUR_SHADE) // the hind haunch
    drawPack(body, bx + 3, by - 3)
    drawLeg(near, legs[0], legTop, false, false)
    drawLeg(near, legs[2], legTop, false, true)
    const dig = p.dig !== undefined
    const hx = 28 + (p.head?.dx ?? 0) + (dig ? 2 : 0)
    const hy = 15 + dy + low + (p.head?.dy ?? 0) + (dig ? 9 + (p.dig ?? 0) : 0)
    screen = drawHead(head, back, hx, hy)
    if (dig) {
      // Burying an acorn: a little mound under its nose, the acorn half in.
      front.round(hx + 9, GROUND - 2, 8, 3, DIRT)
      acorn(front, hx + 11, GROUND - 4 - (p.dig ?? 0))
    }
  } else if (kind === 'sit' || kind === 'wash' || kind === 'eat') {
    // Sitting up on its haunches, tail curled up behind.
    drawTail(back, 17, 30, p.sway ?? 0)
    body.round(17, 17, 12, 17, FUR)
    body.rect(18, 17, 10, 1, FUR_HI)
    body.rect(23, 20, 5, 12, BELLY)
    body.round(16, 26, 8, 8, FUR_SHADE)
    body.rect(16, 33, 8, 2, PAW)
    drawPack(body, 16, 17)
    const hx = 22 + (p.head?.dx ?? 0)
    const hy = 7 + (p.head?.dy ?? 0)
    screen = drawHead(head, back, hx, hy)
    if (kind === 'sit') {
      front.rect(26, 22, 3, 2, PAW)
    } else if (kind === 'wash') {
      // Scrubbing its face: little paws up and down.
      const up = p.phase ?? 0
      front.rect(hx + 8, hy + 5 - up * 2, 3, 3, PAW)
      front.rect(hx + 6, hy + 7 + up, 3, 3, PAW_FAR)
    } else {
      // Nibbling an acorn held in both paws.
      const nib = p.phase ?? 0
      acorn(front, hx + 9, hy + 6 + nib)
      front.rect(hx + 8, hy + 9 + nib, 2, 2, PAW)
      front.rect(hx + 12, hy + 9 + nib, 2, 2, PAW)
    }
  } else if (kind === 'loaf') {
    // Curled up asleep, tail wrapped over like a blanket.
    const breathe = dy
    body.round(14, 25 - breathe, 18, 10 + breathe, FUR)
    body.rect(16, 25 - breathe, 14, 1, FUR_HI)
    drawPack(body, 17, 22 - breathe)
    const hx = 28 + (p.head?.dx ?? 0)
    const hy = 24 + (p.head?.dy ?? 0)
    screen = drawHead(head, back, hx, hy)
    front.round(9, 27 - breathe, 14, 9, TAIL)
    front.rect(11, 27 - breathe, 9, 1, TAIL_HI)
  } else {
    // Worn out: flat on its belly, tail limp, backpack slipped off.
    const tw = dy
    back.round(4, 30, 14, 5, TAIL)
    body.round(14, 28, 18, 7, FUR)
    near.rect(30, 33 - tw, 5, 2, PAW)
    near.rect(14, 33, 5, 2, PAW)
    const hx = 30 + (p.head?.dx ?? 0)
    const hy = 26 + (p.head?.dy ?? 0)
    screen = drawHead(head, back, hx, hy)
    drawPack(front, 40, 29)
  }

  const img = new Img(W, H)
  img.over(back.outline()).over(body.outline()).over(near.outline()).over(head.outline()).over(front.outline())
  return { img, screen, accent: null }
}

// --- animations ---------------------------------------------------------------------------------
const L = (x: number, dx = 0, lift = 0, extra = 0): Leg => ({ x, dx, lift, extra })

function gait(steps: number[], lifts: number[], opts: { bob?: number[]; sway: number[]; low?: number; head?: Pose['head'] }): Pose[] {
  return gaitSwings(steps, lifts).map(({ s, liftA, liftB }, i) => ({
    dy: opts.bob?.[i] ?? 0,
    low: opts.low,
    head: opts.head,
    sway: opts.sway[i % opts.sway.length],
    legs: [L(29, s, liftA), L(27, -s, liftB), L(18, -s, liftB), L(20, s, liftA)]
  }))
}

const SWAY = [0, 1, 2, 1]

const ANIMS: Record<string, { fps: number; loop: boolean; poses: Pose[] }> = {
  idle: { fps: 4, loop: true, poses: SWAY.map((s) => ({ sway: s })) },
  idle_sad: { fps: 2, loop: true, poses: [0, -1, 0, -1].map((s) => ({ sway: s, head: { dy: 2 } })) },
  // Squirrels bound: a bouncier walk.
  walk: { fps: 10, loop: true, poses: gait(WALK, WALK_LIFT, { bob: [0, -1, -1, 0, -1, -1], sway: [1, 2] }) },
  walk_sad: { fps: 7, loop: true, poses: gait(WALK, WALK_LIFT, { sway: [-1], head: { dy: 2 } }) },
  run: { fps: 14, loop: true, poses: gait(RUN, RUN_LIFT, { bob: [0, -2, -2, 0, -1, 0], sway: [3, 2] }) },
  crawl: { fps: 6, loop: true, poses: gait([1, 1, 0, -1, -1, 0], [0, 1, 0, 0, 0, 0], { low: 2, sway: [-1], head: { dy: 1 } }) },
  sit: { fps: 1.5, loop: true, poses: [{ kind: 'sit' }, { kind: 'sit', head: { dy: 1 }, sway: 1 }] },
  // Scrubbing its face.
  wash: { fps: 7, loop: true, poses: [0, 1].map((phase) => ({ kind: 'wash' as const, phase })) },
  // Burying an acorn: checking your usage.
  rummage: { fps: 7, loop: true, poses: [0, 1, 0, 1].map((d, i) => ({ dig: d, sway: SWAY[i], legs: [L(29, 1), L(27, 1), L(18), L(20)] as [Leg, Leg, Leg, Leg] })) },
  sleep: {
    fps: 1.2,
    loop: true,
    poses: [
      { kind: 'loaf', dy: 0 },
      { kind: 'loaf', dy: 1 }
    ]
  },
  starving: { fps: 1, loop: true, poses: [{ kind: 'flop', dy: 0 }, { kind: 'flop', dy: 1 }] },
  jump_up: { fps: 1, loop: false, poses: [{ sway: 3, legs: [L(29, 3, 2), L(27, 3, 2), L(18, -3, 1), L(20, -3, 1)] }] },
  jump_down: { fps: 1, loop: false, poses: [{ sway: 2, legs: [L(29, 1), L(27, 1), L(18, -1), L(20, -1)] }] },
  dragged: {
    fps: 4,
    loop: true,
    poses: [-1, 1].map((s) => ({ sway: -2 + s, legs: [L(29, s, 0, 1), L(27, s, 0, 1), L(18, s, 0, 1), L(20, s, 0, 1)] as [Leg, Leg, Leg, Leg] }))
  },
  // Nibbling an acorn after a free tier resets.
  eat: { fps: 8, loop: true, poses: [0, 1, 0, 1].map((phase) => ({ kind: 'eat' as const, phase })) },
  happy: { fps: 8, loop: true, poses: [3, 1].map((s, i) => ({ sway: s, dy: -i * 2, head: { dy: -1 } })) },
  hurt: {
    fps: 8,
    loop: true,
    poses: [0, 1].map((d) => ({ dy: d, sway: -2, legs: [L(29, 1), L(27, 1), L(18, -1), L(20, -1)] as [Leg, Leg, Leg, Leg] }))
  },
  tap: {
    fps: 7,
    loop: true,
    poses: [3, 1].map((lift) => ({ sway: 0, head: { dy: 1 }, legs: [L(29, 2, lift), L(27), L(18), L(20)] as [Leg, Leg, Leg, Leg] }))
  },
  curious: { fps: 1, loop: true, poses: [{ head: { dy: -1 }, sway: 3 }] }
}

// --- eyes (7x3: far eye cols 0-1, near eye cols 5-6; 'o' = white glint) ----------------------------
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

export function squirrel(): PetArt {
  const anims: Record<string, AnimOut> = {}
  for (const [name, a] of Object.entries(ANIMS)) anims[name] = { fps: a.fps, loop: a.loop, frames: a.poses.map(frame) }

  // What Squirrel eats: an acorn.
  const food = new Img(10, 10)
  food.rect(2, 2, 6, 3, CAP)
  food.rect(3, 2, 3, 1, CAP_HI)
  food.set(5, 1, STEM)
  food.rect(2, 5, 6, 2, NUT)
  food.rect(3, 7, 4, 1, NUT)
  food.set(4, 8, NUT_SHADE)
  food.set(6, 5, NUT_SHADE)
  food.outline('#2a1608')

  const portrait = new Img(24, 22)
  const pb = new Img(24, 22)
  drawHead(portrait, pb, 4, 8)
  pb.outline()
  portrait.outline()
  pb.over(portrait)
  pb.over(eyes(EYES.idle), 7, 10)

  return {
    id: 'squirrel',
    cell: { w: W, h: H },
    anchor: { x: 24, y: GROUND + 1 },
    anims,
    eyes: Object.fromEntries(Object.entries(EYES).map(([k, v]) => [k, eyes(v)])),
    accentOn: null,
    food,
    portrait: pb
  }
}
