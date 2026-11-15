/**
 * Rex: a robot dog that sniffs your public GitHub repos for leaked secrets.
 * Gunmetal plating with a blue status light, a boxy head with a dog's snout,
 * hinged metal ears, a radio antenna, a red collar with a gold tag and a
 * wagging antenna tail. Side view, facing right.
 *
 * Extra animations: `rummage` (nose to the ground, sniffing: scanning your
 * repos), `bark` (head up, jaw open: a leak!) and `wash` (sitting, scratching
 * behind its ear).
 */
import { gaitSwings, Img, RUN, RUN_LIFT, stamp, WALK, WALK_LIFT, type AnimOut, type FrameOut, type PetArt } from './pixel.ts'

// --- palette ------------------------------------------------------------------------
const METAL = '#7d8ca3'
const METAL_HI = '#a9b7cc'
const METAL_SHADE = '#5f6d83'
const PANEL = '#4a5568'
const SNOUT = '#93a2b8'
const NOSE = '#1d2230'
const MOUTH = '#2b3242'
const EAR = '#3f4a5e'
const EAR_FAR = '#333c4d'
const RIVET = '#c9d4e3'
const LED = '#4aa8ff'
const LED_HI = '#bfe2ff'
const COLLAR = '#e0483e'
const COLLAR_SHADE = '#b2342c'
const TAG = '#f2c230'
const LEG = '#6b7a91'
const LEG_FAR = '#4f5b70'
const JOINT = '#3b4558'
const PAW = '#343c4c'
const PAW_FAR = '#2a313e'
const BONE = '#dfe6ef'
const BONE_SHADE = '#aab6c6'
const SOUND = '#bfe2ff'
const EYE = '#4aa8ff'
const GLINT = '#e8f5ff'

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
  /** Tail angle in degrees (180 = straight back, 135 = up and back). */
  tail?: number
  low?: number
  /** Jaw open (barking). */
  bark?: boolean
  /** Sound waves in front of the snout (barking). */
  waves?: number
  /** Antenna light on. */
  lit?: boolean
  phase?: number
}

const STAND_LEGS = (): [Leg, Leg, Leg, Leg] => [{ x: 29 }, { x: 26 }, { x: 14 }, { x: 17 }]

/** Two-part robot legs: plate, a joint bolt, and a dark paw. */
function drawLeg(img: Img, leg: Leg, top: number, far: boolean): void {
  const len = GROUND - top + 1 + (leg.extra ?? 0)
  const lift = leg.lift ?? 0
  const dx = leg.dx ?? 0
  const vis = len - lift
  for (let r = 0; r < vis; r++) {
    const x = leg.x + Math.round((dx * r) / Math.max(1, len - 1))
    const foot = r >= vis - 2
    const joint = r === Math.floor(vis / 2)
    img.rect(foot ? x : x, top + r, foot ? 4 : 3, 1, foot ? (far ? PAW_FAR : PAW) : joint ? JOINT : far ? LEG_FAR : LEG)
  }
}

/** A thin antenna tail with a blue ball tip. */
function drawTail(img: Img, x0: number, y0: number, angle: number, lit: boolean): void {
  const rad = (angle * Math.PI) / 180
  const ux = Math.cos(rad)
  const uy = -Math.sin(rad)
  let x = x0
  let y = y0
  for (let i = 0; i < 6; i++) {
    x = x0 + ux * i
    y = y0 + uy * i
    img.set(x, y, METAL_SHADE)
    if (i < 2) img.set(x, y + 1, METAL_SHADE)
  }
  img.rect(Math.round(x) - 1, Math.round(y) - 1, 2, 2, lit ? LED_HI : LED)
}

function drawBody(img: Img, bx: number, by: number, bw: number, bh: number): void {
  img.round(bx, by, bw, bh, METAL)
  img.rect(bx + 2, by, bw - 4, 1, METAL_HI)
  img.rect(bx + 1, by + bh - 2, bw - 2, 2, METAL_SHADE)
  // Panel seam, bolts and the status light strip.
  img.rect(bx + 11, by + 1, 1, bh - 3, PANEL)
  img.set(bx + 2, by + 2, RIVET)
  img.set(bx + bw - 3, by + 2, RIVET)
  img.rect(bx + 4, by + 4, 5, 1, LED)
  img.set(bx + 4, by + 4, LED_HI)
}

/** Boxy head with a dog's snout at (hx, hy). Returns the eye-overlay origin. */
function drawHead(img: Img, back: Img, hx: number, hy: number, p: Pose): [number, number] {
  // Antenna on top, light at the tip.
  back.rect(hx + 6, hy - 4, 1, 4, METAL_SHADE)
  back.rect(hx + 5, hy - 6, 3, 2, p.lit ? LED_HI : LED)
  back.rect(hx + 3, hy + 1, 3, 3, EAR_FAR) // far ear, peeking over the top
  img.round(hx, hy, 12, 10, METAL)
  img.rect(hx + 2, hy, 8, 1, METAL_HI)
  img.rect(hx + 1, hy + 8, 9, 1, METAL_SHADE)
  // Snout, nose, and the jaw (open when barking).
  if (p.bark) {
    img.round(hx + 9, hy + 3, 8, 4, SNOUT)
    img.rect(hx + 9, hy + 7, 7, 1, MOUTH)
    img.rect(hx + 9, hy + 8, 6, 2, SNOUT)
    img.rect(hx + 15, hy + 3, 2, 2, NOSE)
  } else {
    img.round(hx + 9, hy + 4, 8, 5, SNOUT)
    img.rect(hx + 10, hy + 8, 5, 1, MOUTH)
    img.rect(hx + 15, hy + 4, 2, 2, NOSE)
  }
  img.set(hx + 12, hy + 5, METAL_SHADE)
  // Near ear: a hinged plate with a rivet.
  img.rect(hx + 1, hy + 1, 3, 7, EAR)
  img.set(hx + 2, hy + 2, RIVET)
  return [hx + 4, hy + 3]
}

function drawCollar(img: Img, x: number, y: number): void {
  img.rect(x, y, 6, 2, COLLAR)
  img.rect(x, y + 1, 6, 1, COLLAR_SHADE)
  img.rect(x + 3, y + 2, 2, 2, TAG)
}

function drawWaves(img: Img, x: number, y: number, n: number): void {
  for (let i = 0; i < n; i++) stamp(img, ['X.', '.X', '.X', 'X.'], x + i * 3, y - i, SOUND)
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
    const bx = 11
    const by = 20 + dy + low
    const bh = 10 - Math.min(low, 3)
    const legs = p.legs ?? STAND_LEGS()
    const legTop = by + bh - 2
    drawLeg(back, legs[1], legTop, true)
    drawLeg(back, legs[3], legTop, true)
    drawTail(back, bx + 1, by + 2, p.tail ?? 140, Boolean(p.lit))
    drawBody(body, bx, by, 22, bh)
    drawLeg(near, legs[0], legTop, false)
    drawLeg(near, legs[2], legTop, false)
    const hx = 28 + (p.head?.dx ?? 0)
    const hy = 9 + dy + low + (p.head?.dy ?? 0)
    screen = drawHead(head, back, hx, hy, p)
    if (hy + 9 <= by + 1) drawCollar(front, hx, hy + 9)
    else {
      // Head down (sniffing): the collar wraps the back of the neck.
      front.rect(hx - 1, hy + 1, 2, 6, COLLAR)
      front.rect(hx - 1, hy + 6, 2, 1, COLLAR_SHADE)
    }
    if (p.waves) drawWaves(front, hx + 18, hy + 3, p.waves)
  } else if (kind === 'sit' || kind === 'scratch') {
    // Sitting on its haunches.
    drawTail(back, 14, 33, 175, Boolean(p.lit))
    body.round(14, 17, 13, 17, METAL)
    body.rect(15, 17, 11, 1, METAL_HI)
    body.rect(19, 20, 1, 12, PANEL)
    body.rect(16, 22, 2, 1, LED)
    body.rect(13, 33, 7, 2, PAW)
    const hx = 21 + (p.head?.dx ?? 0)
    const hy = 5 + (p.head?.dy ?? 0)
    screen = drawHead(head, back, hx, hy, p)
    drawCollar(front, hx, hy + 9)
    // Front legs straight down.
    near.rect(24, 24, 3, 10, LEG)
    near.rect(24, 28, 3, 1, JOINT)
    near.rect(24, 33, 4, 2, PAW)
    back.rect(21, 25, 3, 9, LEG_FAR)
    back.rect(21, 33, 4, 2, PAW_FAR)
    if (kind === 'scratch') {
      // Hind leg up, scratching behind the ear.
      const up = p.phase ?? 0
      front.rect(17, 14 + up * 2, 3, 8, LEG)
      front.rect(16, 13 + up * 2, 4, 2, PAW)
    }
  } else if (kind === 'loaf') {
    const breathe = dy
    drawTail(back, 10, 33, 182, false)
    drawBody(body, 9, 26 - breathe, 23, 9 + breathe)
    near.rect(28, 33, 5, 2, PAW)
    near.rect(11, 33, 5, 2, PAW)
    const hx = 28 + (p.head?.dx ?? 0)
    const hy = 23 + (p.head?.dy ?? 0)
    screen = drawHead(head, back, hx, hy, { ...p, lit: false })
  } else {
    // Powered down on its side, legs out.
    const tw = dy
    back.rect(30, 30 - tw, 6, 3, LEG_FAR)
    back.rect(35, 30 - tw, 2, 3, PAW_FAR)
    back.rect(3, 31, 7, 3, LEG_FAR)
    drawTail(back, 9, 32, 182, false)
    drawBody(body, 8, 26, 22, 9)
    near.rect(28, 32, 8, 3, LEG)
    near.rect(35, 32, 3, 3, PAW)
    const hx = 29 + (p.head?.dx ?? 0)
    const hy = 25 + (p.head?.dy ?? 0)
    screen = drawHead(head, back, hx, hy, { ...p, lit: false })
  }

  const img = new Img(W, H)
  img.over(back.outline()).over(body.outline()).over(near.outline()).over(head.outline()).over(front.outline())
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
    legs: [L(29, s, liftA), L(26, -s, liftB), L(14, -s, liftB), L(17, s, liftA)]
  }))
}

const WAG = [130, 150, 130, 115]

const ANIMS: Record<string, { fps: number; loop: boolean; poses: Pose[] }> = {
  idle: { fps: 4, loop: true, poses: WAG.map((t) => ({ tail: t })) },
  idle_sad: { fps: 2, loop: true, poses: [190, 195, 190, 195].map((t) => ({ tail: t, head: { dy: 2 } })) },
  walk: { fps: 10, loop: true, poses: gait(WALK, WALK_LIFT, { bob: [0, 0, 1, 0, 0, 1], tail: [140, 125] }) },
  walk_sad: { fps: 7, loop: true, poses: gait(WALK, WALK_LIFT, { tail: [190], head: { dy: 2 } }) },
  run: { fps: 14, loop: true, poses: gait(RUN, RUN_LIFT, { bob: [0, -1, -1, 0, 1, 0], tail: [160] }) },
  crawl: { fps: 6, loop: true, poses: gait([1, 1, 0, -1, -1, 0], [0, 1, 0, 0, 0, 0], { low: 3, tail: [180], head: { dy: 1 } }) },
  sit: { fps: 1.5, loop: true, poses: [{ kind: 'sit' }, { kind: 'sit', head: { dy: 1 } }] },
  // Scratching behind its ear.
  wash: { fps: 7, loop: true, poses: [0, 1].map((phase) => ({ kind: 'scratch' as const, phase, head: { dx: -1, dy: 1 } })) },
  // Nose to the ground, sniffing: scanning your repos.
  rummage: {
    fps: 7,
    loop: true,
    poses: [0, 1, 0, 1].map((ph, i) => ({ head: { dx: 2, dy: 9 + ph }, tail: WAG[i], lit: i % 2 === 0, legs: [L(29, 1), L(26, 1), L(14), L(17)] as [Leg, Leg, Leg, Leg] }))
  },
  // Head up, jaw open: a leak!
  bark: {
    fps: 6,
    loop: true,
    poses: [
      { head: { dy: -1 }, tail: 125, bark: true, waves: 2, lit: true },
      { head: { dy: 0 }, tail: 130, lit: true },
      { head: { dy: -1 }, tail: 125, bark: true, waves: 3, lit: true },
      { head: { dy: 0 }, tail: 130, lit: true }
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
  jump_up: { fps: 1, loop: false, poses: [{ tail: 120, legs: [L(29, 3, 2), L(26, 3, 2), L(14, -3, 1), L(17, -3, 1)] }] },
  jump_down: { fps: 1, loop: false, poses: [{ tail: 140, legs: [L(29, 1), L(26, 1), L(14, -1), L(17, -1)] }] },
  dragged: {
    fps: 4,
    loop: true,
    poses: [-1, 1].map((s) => ({ tail: 250 + s * 8, legs: [L(29, s, 0, 1), L(26, s, 0, 1), L(14, s, 0, 1), L(17, s, 0, 1)] as [Leg, Leg, Leg, Leg] }))
  },
  eat: {
    fps: 8,
    loop: true,
    poses: [0, 2, 3, 2].map((d, i) => ({ head: { dx: 1, dy: d }, tail: WAG[i], legs: [L(29, 1), L(26, 1), L(14), L(17)] as [Leg, Leg, Leg, Leg] }))
  },
  happy: { fps: 8, loop: true, poses: [110, 150].map((t, i) => ({ tail: t, dy: -i, head: { dy: -1 }, lit: true })) },
  hurt: {
    fps: 8,
    loop: true,
    poses: [0, 1].map((d) => ({ dy: d, tail: 200, legs: [L(29, 1), L(26, 1), L(14, -1), L(17, -1)] as [Leg, Leg, Leg, Leg] }))
  },
  tap: {
    fps: 7,
    loop: true,
    poses: [3, 1].map((lift) => ({ tail: 140, head: { dy: 1 }, legs: [L(29, 2, lift), L(26), L(14), L(17)] as [Leg, Leg, Leg, Leg] }))
  },
  curious: { fps: 1, loop: true, poses: [{ head: { dy: -1 }, tail: 120, lit: true }] }
}

// --- eyes (7x3 LED eyes: far eye cols 0-1, near eye cols 5-6; 'o' = bright centre) -------------------
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

export function rex(): PetArt {
  const anims: Record<string, AnimOut> = {}
  for (const [name, a] of Object.entries(ANIMS)) anims[name] = { fps: a.fps, loop: a.loop, frames: a.poses.map(frame) }

  // What Rex eats: a shiny metal bone.
  const food = new Img(11, 10)
  stamp(food, ['XX.....XX', 'XXX...XXX', '.XXXXXXX.', '.XXXXXXX.', 'XXX...XXX', 'XX.....XX'], 1, 2, BONE)
  food.rect(3, 5, 5, 1, BONE_SHADE)
  food.set(2, 3, '#ffffff')
  food.outline('#3b4558')

  const portrait = new Img(24, 22)
  const pb = new Img(24, 22)
  drawHead(portrait, pb, 3, 9, { lit: true })
  drawCollar(portrait, 3, 18)
  pb.over(portrait)
  pb.outline()
  pb.over(eyes(EYES.idle), 7, 12)

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
