/**
 * Rex: a retro wind-up tin toy dog that sniffs your public GitHub repos for
 * leaked secrets. A cream tin barrel body with a red saddle stripe and
 * rivets, a brass wind-up key on its back that turns as it moves, long
 * floppy red ears, round headlamp eyes, little red shoes and a coil-spring
 * tail with a red ball. Side view, facing right.
 *
 * Extra animations: `rummage` (nose down, sniffing, key turning: scanning
 * your repos), `bark` (its nutcracker jaw drops open: a leak!) and `wash`
 * (sitting, scratching behind its ear). When it never gets fed it simply
 * winds down and tips over (`starving`).
 */
import { gaitSwings, Img, RUN, RUN_LIFT, stamp, WALK, WALK_LIFT, type AnimOut, type FrameOut, type PetArt } from './pixel.ts'

// --- palette ------------------------------------------------------------------------
const TIN = '#efe2c0'
const TIN_HI = '#fff7df'
const TIN_SHADE = '#cdb98a'
const TIN_FAR = '#c2ad7c'
const RED = '#d8433a'
const RED_SHADE = '#a62f27'
const BRASS = '#dcaa32'
const BRASS_SHADE = '#a87d1c'
const DARK = '#2b2320'
const RIVET = '#9b8661'
const LAMP = '#fffbea'
const SPRING = '#8f8a80'
const PUFF = '#b9ad94'
const EYE = '#2b2320'
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
  kind?: 'stand' | 'sit' | 'scratch' | 'loaf' | 'flop'
  dy?: number
  head?: { dx?: number; dy?: number }
  legs?: [Leg, Leg, Leg, Leg]
  /** Spring tail angle in degrees (180 = straight back, 120 = up and back). */
  tail?: number
  /** Body lowered (crawling). */
  low?: number
  /** Jaw dropped open (barking). */
  bark?: boolean
  /** Sound waves in front of the snout. */
  waves?: number
  /** Nose down to the ground (sniffing), and which sniff (0/1). */
  sniff?: number
  /** The wind-up key face-on (true) or edge-on (false). */
  key?: boolean
  phase?: number
}

const STAND_LEGS = (): [Leg, Leg, Leg, Leg] => [{ x: 28 }, { x: 25 }, { x: 14 }, { x: 17 }]

/** Short tin legs ending in little red shoes. */
function drawLeg(img: Img, leg: Leg, top: number, far: boolean): void {
  const len = GROUND - top + 1 + (leg.extra ?? 0)
  const lift = leg.lift ?? 0
  const dx = leg.dx ?? 0
  const vis = len - lift
  for (let r = 0; r < vis; r++) {
    const x = leg.x + Math.round((dx * r) / Math.max(1, len - 1))
    if (r >= vis - 2) img.rect(x - 1, top + r, 5, 1, far ? RED_SHADE : RED)
    else img.rect(x, top + r, 3, 1, far ? TIN_FAR : TIN_SHADE)
  }
}

/** The brass wind-up key, face-on or edge-on. */
function drawKey(img: Img, x: number, y: number, open: boolean): void {
  img.rect(x + 2, y + 3, 1, 2, BRASS_SHADE)
  if (open) stamp(img, ['XX.XX', 'XXXXX', '.XXX.'], x, y, BRASS)
  else stamp(img, ['.XXX.', '.XXX.', '..X..'], x, y, BRASS)
}

/** Coil-spring tail with a red ball on the end. */
function drawSpring(img: Img, x0: number, y0: number, angle: number): void {
  const rad = (angle * Math.PI) / 180
  let x = x0
  let y = y0
  for (let i = 0; i < 6; i++) {
    x = x0 + Math.cos(rad) * i
    y = y0 - Math.sin(rad) * i
    img.set(x + (i % 2 ? 1 : -1), y, SPRING)
  }
  img.round(Math.round(x) - 2, Math.round(y) - 2, 3, 3, RED)
}

/** Cream tin barrel with a red saddle stripe and rivets. */
function drawBody(img: Img, bx: number, by: number, bw: number, bh: number): void {
  img.round(bx, by, bw, bh, TIN)
  img.rect(bx + 2, by, bw - 4, 1, TIN_HI)
  img.rect(bx + 1, by + bh - 2, bw - 2, 2, TIN_SHADE)
  const sx = bx + Math.round(bw * 0.38)
  img.rect(sx, by, 5, bh, RED)
  img.rect(sx, by + bh - 2, 5, 2, RED_SHADE)
  img.set(bx + 3, by + 2, RIVET)
  img.set(bx + bw - 6, by + 2, RIVET)
  img.set(sx + 2, by + Math.floor(bh / 2), TIN_HI)
}

/** Round head with headlamp eyes, a muzzle and a nutcracker jaw at (hx, hy). Returns the eye-overlay origin. */
function drawHead(img: Img, back: Img, hx: number, hy: number, p: Pose): [number, number] {
  back.round(hx + 6, hy - 1, 4, 3, RED_SHADE) // far ear tip
  img.round(hx, hy, 13, 11, TIN)
  img.rect(hx + 2, hy, 8, 1, TIN_HI)
  img.rect(hx + 1, hy + 9, 9, 1, TIN_SHADE)
  if (p.bark) {
    img.round(hx + 9, hy + 4, 7, 4, TIN_HI)
    img.rect(hx + 10, hy + 8, 6, 1, DARK)
    img.rect(hx + 10, hy + 9, 5, 2, TIN)
    img.rect(hx + 15, hy + 4, 2, 2, DARK)
  } else {
    img.round(hx + 9, hy + 5, 7, 5, TIN_HI)
    img.rect(hx + 11, hy + 9, 4, 1, DARK)
    img.rect(hx + 15, hy + 5, 2, 2, DARK)
  }
  // Headlamp eyes (the pupils are the eye overlay).
  img.rect(hx + 4, hy + 2, 3, 4, LAMP)
  img.rect(hx + 8, hy + 2, 3, 4, LAMP)
  // Long floppy red ear with a rivet.
  img.round(hx, hy + 2, 4, 10, RED)
  img.rect(hx, hy + 10, 4, 1, RED_SHADE)
  img.set(hx + 1, hy + 3, TIN_HI)
  return [hx + 4, hy + 2]
}

function drawWaves(img: Img, x: number, y: number, n: number): void {
  for (let i = 0; i < n; i++) stamp(img, ['X.', '.X', '.X', 'X.'], x + i * 3, y - i, RED)
}

function frame(p: Pose): FrameOut {
  const kind = p.kind ?? 'stand'
  const dy = p.dy ?? 0
  const back = new Img(W, H)
  const body = new Img(W, H)
  const near = new Img(W, H)
  const head = new Img(W, H)
  const front = new Img(W, H)
  const after: ((img: Img) => void)[] = []
  let screen: [number, number]

  if (kind === 'stand') {
    const low = p.low ?? 0
    const bx = 11
    const by = 20 + dy + low
    const bh = 11 - Math.min(low, 3)
    const legs = p.legs ?? STAND_LEGS()
    const legTop = by + bh - 2
    drawLeg(back, legs[1], legTop, true)
    drawLeg(back, legs[3], legTop, true)
    drawSpring(back, bx, by + 2, p.tail ?? 130)
    drawKey(back, bx + 8, by - 6, Boolean(p.key))
    drawBody(body, bx, by, 22, bh)
    drawLeg(near, legs[0], legTop, false)
    drawLeg(near, legs[2], legTop, false)
    const sniff = p.sniff !== undefined
    const hx = 27 + (p.head?.dx ?? 0) + (sniff ? 2 : 0)
    const hy = 9 + dy + low + (p.head?.dy ?? 0) + (sniff ? 8 + (p.sniff ?? 0) : 0)
    screen = drawHead(head, back, hx, hy, p)
    if (sniff) {
      // Little puffs of dust where its nose meets the ground.
      const nx = hx + 17
      const ny = hy + 7
      const puffs = p.sniff ? [[nx, ny - 2], [nx + 2, ny - 4]] : [[nx + 1, ny - 1], [nx + 3, ny - 3]]
      after.push((img) => puffs.forEach(([x, y]) => img.set(x, y, PUFF)))
    }
    if (p.waves) after.push((img) => drawWaves(img, hx + 18, hy + 3, p.waves!))
  } else if (kind === 'sit' || kind === 'scratch') {
    // Sitting up on its haunches, spring tail along the ground.
    drawSpring(back, 15, 33, 175)
    drawKey(back, 15, 11, Boolean(p.key))
    body.round(14, 16, 13, 18, TIN)
    body.rect(15, 16, 11, 1, TIN_HI)
    body.rect(14, 21, 13, 4, RED)
    body.rect(14, 24, 13, 1, RED_SHADE)
    body.rect(13, 33, 7, 2, RED)
    near.rect(23, 25, 3, 9, TIN_SHADE)
    near.rect(22, 33, 5, 2, RED)
    back.rect(20, 26, 3, 8, TIN_FAR)
    back.rect(19, 33, 5, 2, RED_SHADE)
    const hx = 20 + (p.head?.dx ?? 0)
    const hy = 5 + (p.head?.dy ?? 0)
    screen = drawHead(head, back, hx, hy, p)
    if (kind === 'scratch') {
      // Hind leg up, scratching behind the floppy ear.
      const up = p.phase ?? 0
      front.rect(16, 13 + up * 2, 3, 8, TIN_SHADE)
      front.rect(15, 12 + up * 2, 5, 2, RED)
    }
  } else if (kind === 'loaf') {
    const breathe = dy
    drawKey(back, 17, 20 - breathe, false)
    drawSpring(back, 9, 31, 182)
    body.round(9, 26 - breathe, 23, 9 + breathe, TIN)
    body.rect(11, 26 - breathe, 19, 1, TIN_HI)
    body.rect(16, 26 - breathe, 5, 9 + breathe, RED)
    near.rect(28, 33, 5, 2, RED)
    near.rect(10, 33, 5, 2, RED)
    const hx = 28 + (p.head?.dx ?? 0)
    const hy = 23 + (p.head?.dy ?? 0)
    screen = drawHead(head, back, hx, hy, p)
  } else {
    // Wound down: tipped over on its side, shoes in the air, key still.
    const tw = dy
    drawKey(back, 4, 24, false)
    back.rect(29, 26 - tw, 3, 5, TIN_FAR)
    back.rect(28, 25 - tw, 5, 2, RED_SHADE)
    back.rect(14, 26, 3, 5, TIN_FAR)
    back.rect(13, 25, 5, 2, RED_SHADE)
    drawSpring(back, 9, 32, 182)
    drawBody(body, 8, 28, 24, 8)
    const hx = 30 + (p.head?.dx ?? 0)
    const hy = 25 + (p.head?.dy ?? 0)
    screen = drawHead(head, back, hx, hy, p)
  }

  const img = new Img(W, H)
  img.over(back.outline()).over(body.outline()).over(near.outline()).over(head.outline()).over(front.outline())
  for (const f of after) f(img)
  return { img, screen, accent: null }
}

// --- animations ---------------------------------------------------------------------------------
const L = (x: number, dx = 0, lift = 0, extra = 0): Leg => ({ x, dx, lift, extra })

function gait(steps: number[], lifts: number[], opts: { bob?: number[]; tail: number[]; low?: number; head?: Pose['head'] }): Pose[] {
  return gaitSwings(steps, lifts).map(({ s, liftA, liftB }, i) => ({
    dy: opts.bob?.[i] ?? 0,
    low: opts.low,
    head: opts.head,
    tail: opts.tail[i % opts.tail.length],
    key: i % 2 === 0,
    legs: [L(28, s, liftA), L(25, -s, liftB), L(14, -s, liftB), L(17, s, liftA)]
  }))
}

const WAG = [130, 150, 130, 115]
const STILL = (): [Leg, Leg, Leg, Leg] => [L(28), L(25), L(14), L(17)]

const ANIMS: Record<string, { fps: number; loop: boolean; poses: Pose[] }> = {
  idle: { fps: 4, loop: true, poses: WAG.map((t, i) => ({ tail: t, key: i === 1 })) },
  idle_sad: { fps: 2, loop: true, poses: [190, 195, 190, 195].map((t) => ({ tail: t, head: { dy: 2 } })) },
  walk: { fps: 10, loop: true, poses: gait(WALK, WALK_LIFT, { bob: [0, 0, 1, 0, 0, 1], tail: [140, 125] }) },
  walk_sad: { fps: 7, loop: true, poses: gait(WALK, WALK_LIFT, { tail: [190], head: { dy: 2 } }) },
  run: { fps: 14, loop: true, poses: gait(RUN, RUN_LIFT, { bob: [0, -1, -1, 0, 1, 0], tail: [160, 150] }) },
  crawl: { fps: 6, loop: true, poses: gait([1, 1, 0, -1, -1, 0], [0, 1, 0, 0, 0, 0], { low: 3, tail: [180], head: { dy: 1 } }) },
  sit: { fps: 1.5, loop: true, poses: [{ kind: 'sit' }, { kind: 'sit', head: { dy: 1 } }] },
  // Scratching behind its ear.
  wash: { fps: 7, loop: true, poses: [0, 1].map((phase) => ({ kind: 'scratch' as const, phase, key: phase === 1, head: { dx: -1, dy: 1 } })) },
  // Nose to the ground, key turning: scanning your repos.
  rummage: { fps: 7, loop: true, poses: [0, 1, 0, 1].map((s, i) => ({ sniff: s, key: s === 1, tail: WAG[i], legs: [L(28, 1), L(25, 1), L(14), L(17)] as [Leg, Leg, Leg, Leg] })) },
  // The nutcracker jaw drops open: a leak!
  bark: {
    fps: 6,
    loop: true,
    poses: [
      { head: { dy: -1 }, tail: 125, bark: true, waves: 2, key: true },
      { head: { dy: 0 }, tail: 130 },
      { head: { dy: -1 }, tail: 125, bark: true, waves: 3, key: true },
      { head: { dy: 0 }, tail: 130 }
    ]
  },
  sleep: {
    fps: 1.2,
    loop: true,
    poses: [
      { kind: 'loaf', dy: 0 },
      { kind: 'loaf', dy: 1 }
    ]
  },
  starving: { fps: 1, loop: true, poses: [{ kind: 'flop', dy: 0 }, { kind: 'flop', dy: 1 }] },
  jump_up: { fps: 1, loop: false, poses: [{ tail: 120, key: true, legs: [L(28, 3, 2), L(25, 3, 2), L(14, -3, 1), L(17, -3, 1)] }] },
  jump_down: { fps: 1, loop: false, poses: [{ tail: 140, legs: [L(28, 1), L(25, 1), L(14, -1), L(17, -1)] }] },
  dragged: {
    fps: 4,
    loop: true,
    poses: [-1, 1].map((s) => ({ tail: 250 + s * 8, legs: [L(28, s, 0, 1), L(25, s, 0, 1), L(14, s, 0, 1), L(17, s, 0, 1)] as [Leg, Leg, Leg, Leg] }))
  },
  eat: {
    fps: 8,
    loop: true,
    poses: [0, 2, 3, 2].map((d, i) => ({ head: { dx: 1, dy: d }, tail: WAG[i], key: i % 2 === 0, legs: [L(28, 1), L(25, 1), L(14), L(17)] as [Leg, Leg, Leg, Leg] }))
  },
  happy: { fps: 8, loop: true, poses: [110, 150].map((t, i) => ({ tail: t, dy: -i, head: { dy: -1 }, key: i === 0 })) },
  hurt: {
    fps: 8,
    loop: true,
    poses: [0, 1].map((d) => ({ dy: d, tail: 200, legs: [L(28, 1), L(25, 1), L(14, -1), L(17, -1)] as [Leg, Leg, Leg, Leg] }))
  },
  tap: {
    fps: 7,
    loop: true,
    poses: [3, 1].map((lift) => ({ tail: 140, head: { dy: 1 }, legs: [L(28, 2, lift), L(25), L(14), L(17)] as [Leg, Leg, Leg, Leg] }))
  },
  curious: { fps: 1, loop: true, poses: [{ head: { dy: -1 }, tail: 120, legs: STILL() }] }
}

// --- eyes: pupils inside the headlamps (7x3: far lamp cols 0-2, near lamp cols 4-6) ----------------
const EYES: Record<string, string[]> = {
  idle: ['.......', '.X...X.', '.X...X.'],
  blink: ['.......', 'XXX.XXX', '.......'],
  happy: ['.X...X.', 'X.X.X.X', '.......'],
  hurt: ['X.X.X.X', '.X...X.', 'X.X.X.X'],
  alert: ['.XX..XX', '.XX..XX', '.......'],
  sad: ['.......', '.......', 'XXX.XXX']
}

function eyes(rows: string[]): Img {
  const img = new Img(7, 3)
  stamp(img, rows, 0, 0, EYE, GLINT)
  return img
}

export function rex(): PetArt {
  const anims: Record<string, AnimOut> = {}
  for (const [name, a] of Object.entries(ANIMS)) anims[name] = { fps: a.fps, loop: a.loop, frames: a.poses.map(frame) }

  // What Rex eats: a tin bone.
  const food = new Img(11, 10)
  stamp(food, ['XX.....XX', 'XXX...XXX', '.XXXXXXX.', '.XXXXXXX.', 'XXX...XXX', 'XX.....XX'], 1, 2, TIN_HI)
  food.rect(3, 5, 5, 1, TIN_SHADE)
  food.set(2, 3, '#ffffff')
  food.outline()

  const portrait = new Img(24, 22)
  const pb = new Img(24, 22)
  drawHead(portrait, pb, 3, 6, {})
  pb.outline()
  portrait.outline()
  pb.over(portrait)
  pb.over(eyes(EYES.idle), 7, 8)

  return {
    id: 'rex',
    cell: { w: W, h: H },
    anchor: { x: 24, y: GROUND + 1 },
    anims,
    eyes: Object.fromEntries(Object.entries(EYES).map(([k, v]) => [k, eyes(v)])),
    accentOn: null,
    food,
    portrait: pb
  }
}
