/**
 * Dusty: a raccoon (the original "trash panda") who cleans up junk files.
 * Grey fur, black bandit mask with white brows and muzzle, dark little hands,
 * a bushy ringed tail and a teal cleaning bandana. Side view, facing right.
 *
 * Extra animations: `rummage` (nose down, digging: scanning for junk) and
 * `wash` (sitting up, rubbing its paws together: after a clean-up).
 */
import { gaitSwings, Img, RUN, RUN_LIFT, stamp, WALK, WALK_LIFT, type AnimOut, type FrameOut, type PetArt } from './pixel.ts'

// --- palette ------------------------------------------------------------------------
const FUR = '#8f929c'
const FUR_HI = '#a9acb5'
const FUR_SHADE = '#72757f'
const FUR_FAR = '#6c6f78'
const BELLY = '#cdd0d6'
const WHITE = '#eceef1'
const MASK = '#25272d'
const NOSE = '#16171b'
const EAR_IN = '#4b4d55'
const LEG = '#5c5f69'
const LEG_FAR = '#4c4f58'
const PAW = '#30323a'
const PAW_FAR = '#24262c'
const TAIL_LIGHT = '#a6a9b2'
const TAIL_DARK = '#2a2c32'
const BANDANA = '#2fb5a5'
const BANDANA_DARK = '#1f8a7e'
const EYE = '#f4f5f7'
const PUPIL = '#16171b'

const W = 50
const H = 38
const GROUND = 35

type Ears = 'up' | 'back' | 'perk'

interface Leg {
  x: number
  dx?: number
  lift?: number
  extra?: number
}

interface Pose {
  kind?: 'stand' | 'sit' | 'wash' | 'loaf' | 'flop'
  dy?: number
  head?: { dx?: number; dy?: number }
  ears?: Ears
  legs?: [Leg, Leg, Leg, Leg]
  tail?: { angle: number; curl?: number; len?: number }
  low?: number
  /** wash: which paw is up (0/1). */
  paw?: number
}

const STAND_LEGS = (): [Leg, Leg, Leg, Leg] => [{ x: 26 }, { x: 23 }, { x: 13 }, { x: 16 }]

function drawLeg(img: Img, leg: Leg, top: number, far: boolean): void {
  const len = GROUND - top + 1 + (leg.extra ?? 0)
  const lift = leg.lift ?? 0
  const dx = leg.dx ?? 0
  const vis = len - lift
  for (let r = 0; r < vis; r++) {
    const x = leg.x + Math.round((dx * r) / Math.max(1, len - 1))
    // Raccoons have dark legs and darker little "hands".
    const color = r < vis - 2 ? (far ? LEG_FAR : LEG) : far ? PAW_FAR : PAW
    img.rect(x, top + r, 3, 1, color)
  }
}

/** A bushy tail with alternating dark and light rings. */
function drawTail(img: Img, x0: number, y0: number, t: { angle: number; curl?: number; len?: number }): void {
  const len = t.len ?? 10
  let x = x0
  let y = y0
  let a = t.angle
  for (let i = 0; i < len; i++) {
    const rad = (a * Math.PI) / 180
    x += Math.cos(rad) * 1.6
    y -= Math.sin(rad) * 1.6
    a += t.curl ?? -5
    const size = i >= 2 && i <= len - 3 ? 4 : 3
    const color = i >= len - 2 ? TAIL_DARK : Math.floor(i / 2) % 2 === 0 ? TAIL_LIGHT : TAIL_DARK
    img.rect(Math.round(x - size / 2), Math.round(y - size / 2), size, size, color)
  }
}

function drawEar(img: Img, x: number, y: number, style: Ears, far: boolean): void {
  const fur = far ? FUR_FAR : FUR
  if (style === 'back') {
    stamp(img, ['XX..', 'XoXX'], x - 1, y - 2, fur, EAR_IN)
    return
  }
  const rows = style === 'perk' ? ['.X..', '.X..', 'XoX.', 'XoXX'] : ['.X..', 'XoX.', 'XoXX']
  stamp(img, rows, x, y - rows.length, fur, EAR_IN)
  if (!far) img.set(x + 1, y - rows.length, WHITE) // white ear tip
}

/** Head with mask, brows, muzzle and nose at (hx, hy). Returns the eye-overlay origin. */
function drawHead(img: Img, hx: number, hy: number, ears: Ears): [number, number] {
  drawEar(img, hx + 1, hy, ears, true)
  img.round(hx, hy, 12, 10, FUR)
  img.rect(hx + 2, hy + 1, 8, 1, FUR_HI)
  // White brows over the bandit mask.
  img.rect(hx + 5, hy + 2, 6, 1, WHITE)
  img.rect(hx + 4, hy + 3, 9, 3, MASK)
  // White cheeks and muzzle, black nose.
  img.rect(hx + 5, hy + 6, 6, 2, WHITE)
  img.rect(hx + 11, hy + 5, 4, 3, WHITE)
  img.rect(hx + 14, hy + 5, 2, 2, NOSE)
  img.set(hx + 12, hy + 8, MASK)
  img.rect(hx + 6, hy + 8, 5, 1, FUR_SHADE)
  drawEar(img, hx + 5, hy, ears, false)
  return [hx + 5, hy + 3]
}

function drawBandana(img: Img, hx: number, hy: number): void {
  stamp(img, ['XXXXXX', '.XoXX.', '..XX..'], hx - 2, hy + 9, BANDANA, BANDANA_DARK)
}

function drawBody(img: Img, bx: number, by: number, bw: number, bh: number): void {
  img.round(bx, by, bw, bh, FUR)
  img.rect(bx + 2, by, bw - 4, 1, FUR_HI)
  img.rect(bx + 3, by + bh - 3, bw - 7, 2, BELLY)
  img.rect(bx + 1, by + bh - 1, bw - 2, 1, FUR_SHADE)
  img.rect(bx + 5, by + 1, 6, 1, FUR_SHADE)
}

function frame(p: Pose): FrameOut {
  const kind = p.kind ?? 'stand'
  const dy = p.dy ?? 0
  const ears = p.ears ?? 'up'
  const back = new Img(W, H)
  const body = new Img(W, H)
  const near = new Img(W, H)
  const head = new Img(W, H)
  let screen: [number, number]

  if (kind === 'stand') {
    const low = p.low ?? 0
    const bx = 11
    const by = 20 + dy + low
    const bh = 9 - Math.min(low, 3)
    const legs = p.legs ?? STAND_LEGS()
    const legTop = by + bh - 1
    drawLeg(back, legs[1], legTop, true)
    drawLeg(back, legs[3], legTop, true)
    drawTail(back, bx + 1, by + 3, p.tail ?? { angle: 140 })
    drawBody(body, bx, by, 21, bh)
    drawLeg(near, legs[0], legTop, false)
    drawLeg(near, legs[2], legTop, false)
    const hx = 28 + (p.head?.dx ?? 0)
    const hy = 13 + dy + low + (p.head?.dy ?? 0)
    screen = drawHead(head, hx, hy, ears)
    drawBandana(head, hx, hy)
  } else if (kind === 'sit' || kind === 'wash') {
    // Sitting up on its haunches, tail curled along the ground.
    drawTail(back, 14, 32, p.tail ?? { angle: 180, curl: -12, len: 9 })
    body.round(12, 25, 11, 10, FUR_SHADE)
    body.rect(12, 33, 6, 2, PAW)
    body.round(16, 18, 12, 14, FUR)
    body.rect(17, 18, 10, 1, FUR_HI)
    body.rect(22, 21, 4, 9, BELLY)
    const hx = 25 + (p.head?.dx ?? 0)
    const hy = 9 + (p.head?.dy ?? 0)
    if (kind === 'sit') {
      drawLeg(near, { x: 24 }, 29, false)
      drawLeg(back, { x: 21 }, 29, true)
    } else {
      // Washing: little hands up at the muzzle, rubbing.
      const up = p.paw ?? 0
      near.rect(24, hy + 11, 3, 6, LEG)
      near.rect(hx + 9, hy + 8 - up, 3, 3, PAW)
      back.rect(hx + 7, hy + 9 + up, 3, 3, PAW_FAR)
      back.rect(21, hy + 12, 3, 5, LEG_FAR)
    }
    screen = drawHead(head, hx, hy, ears)
    drawBandana(head, hx, hy)
  } else if (kind === 'loaf') {
    const breathe = dy
    drawTail(back, 10, 31, p.tail ?? { angle: 190, curl: 10, len: 10 })
    drawBody(body, 10, 26 - breathe, 22, 10 + breathe)
    near.rect(28, 34, 4, 2, PAW)
    near.rect(11, 34, 4, 2, PAW)
    const hx = 27 + (p.head?.dx ?? 0)
    const hy = 22 + (p.head?.dy ?? 0)
    screen = drawHead(head, hx, hy, ears)
  } else {
    // Flopped over: legs splayed along the ground.
    const tw = dy
    back.rect(31, 31 - tw, 6, 3, LEG_FAR)
    back.rect(36, 31 - tw, 2, 3, PAW_FAR)
    back.rect(3, 32, 7, 3, LEG_FAR)
    back.rect(2, 32, 2, 3, PAW_FAR)
    drawTail(back, 9, 32, p.tail ?? { angle: 178, curl: 1, len: 9 })
    drawBody(body, 8, 27, 22, 9)
    near.rect(29, 33, 8, 3, LEG)
    near.rect(36, 33, 3, 3, PAW)
    near.rect(4, 34, 7, 2, LEG)
    near.rect(2, 34, 2, 2, PAW)
    const hx = 28 + (p.head?.dx ?? 0)
    const hy = 25 + (p.head?.dy ?? 0)
    screen = drawHead(head, hx, hy, 'back')
  }

  const img = new Img(W, H)
  img.over(back.outline()).over(body.outline()).over(near.outline()).over(head.outline())
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
  idle: { fps: 3, loop: true, poses: [138, 144, 150, 144].map((a) => ({ tail: { angle: a, curl: -5 } })) },
  idle_sad: { fps: 2, loop: true, poses: [190, 194, 198, 194].map((a) => ({ tail: { angle: a, curl: 2 }, ears: 'back' as const, head: { dy: 2 } })) },
  walk: { fps: 10, loop: true, poses: gait(WALK, WALK_LIFT, { bob: [0, 0, 1, 0, 0, 1], tail: { angle: 150, curl: -4 } }) },
  walk_sad: { fps: 7, loop: true, poses: gait(WALK, WALK_LIFT, { tail: { angle: 192, curl: 2 }, ears: 'back', head: { dy: 2 } }) },
  run: { fps: 14, loop: true, poses: gait(RUN, RUN_LIFT, { bob: [0, -1, -1, 0, 1, 0], tail: { angle: 172, curl: -1 }, ears: 'back' }) },
  crawl: {
    fps: 6,
    loop: true,
    poses: gait([1, 1, 0, -1, -1, 0], [0, 1, 0, 0, 0, 0], { low: 3, tail: { angle: 178, curl: -1 }, ears: 'back', head: { dy: 1 } })
  },
  sit: { fps: 1.5, loop: true, poses: [{ kind: 'sit' }, { kind: 'sit', tail: { angle: 180, curl: -14, len: 9 } }] },
  wash: { fps: 6, loop: true, poses: [0, 1].map((paw) => ({ kind: 'wash' as const, paw, ears: 'perk' as const })) },
  sleep: {
    fps: 1.2,
    loop: true,
    poses: [
      { kind: 'loaf', ears: 'back', dy: 0 },
      { kind: 'loaf', ears: 'back', dy: 1 }
    ]
  },
  starving: { fps: 1, loop: true, poses: [{ kind: 'flop', dy: 0 }, { kind: 'flop', dy: 1 }] },
  jump_up: { fps: 1, loop: false, poses: [{ tail: { angle: 165, curl: -2 }, legs: [L(26, 3, 2), L(23, 3, 2), L(13, -3, 1), L(16, -3, 1)], ears: 'perk' }] },
  jump_down: { fps: 1, loop: false, poses: [{ tail: { angle: 130, curl: -4 }, legs: [L(26, 1), L(23, 1), L(13, -1), L(16, -1)] }] },
  dragged: {
    fps: 4,
    loop: true,
    poses: [-1, 1].map((s) => ({
      tail: { angle: 255, curl: s * 3 },
      ears: 'back' as const,
      legs: [L(26, s, 0, 1), L(23, s, 0, 1), L(13, s, 0, 1), L(16, s, 0, 1)] as [Leg, Leg, Leg, Leg]
    }))
  },
  eat: {
    fps: 8,
    loop: true,
    poses: [0, 2, 3, 2].map((d) => ({ head: { dx: 1, dy: d }, tail: { angle: 140, curl: -5 }, legs: [L(26, 1), L(23, 1), L(13), L(16)] as [Leg, Leg, Leg, Leg] }))
  },
  // Nose to the ground, paws digging: scanning for junk.
  rummage: {
    fps: 7,
    loop: true,
    poses: [0, 1, 2, 3].map((i) => ({
      low: 2,
      head: { dx: 1, dy: 4 },
      tail: { angle: i % 2 ? 150 : 130, curl: -5 },
      ears: 'perk' as const,
      legs: [L(26, 2, i % 2 ? 0 : 2), L(23, 2, i % 2 ? 2 : 0), L(13), L(16)] as [Leg, Leg, Leg, Leg]
    }))
  },
  happy: { fps: 6, loop: true, poses: [120, 104].map((a) => ({ tail: { angle: a, curl: -8 }, ears: 'perk' as const })) },
  hurt: {
    fps: 8,
    loop: true,
    poses: [0, 1].map((d) => ({ dy: d, ears: 'back' as const, tail: { angle: 190, curl: 2 }, legs: [L(26, 1), L(23, 1), L(13, -1), L(16, -1)] as [Leg, Leg, Leg, Leg] }))
  },
  tap: {
    fps: 7,
    loop: true,
    poses: [3, 1].map((lift) => ({ tail: { angle: 180, curl: 2 }, ears: 'back' as const, head: { dy: 1 }, legs: [L(26, 2, lift), L(23), L(13), L(16)] as [Leg, Leg, Leg, Leg] }))
  },
  curious: { fps: 1, loop: true, poses: [{ ears: 'perk', head: { dy: -1 }, tail: { angle: 125, curl: -8 } }] }
}

// --- eyes in the bandit mask (7x3: left eye cols 0-2, right eye cols 4-6) ---------------------------
const EYES: Record<string, string[]> = {
  idle: ['XX...XX', 'Xo...Xo', '.......'],
  blink: ['.......', 'XX...XX', '.......'],
  happy: ['.X...X.', 'X.X.X.X', '.......'],
  hurt: ['X.X.X.X', '.X...X.', 'X.X.X.X'],
  alert: ['XXX.XXX', 'XoX.XoX', 'XXX.XXX'],
  sad: ['XX...XX', '.o...o.', '.......']
}

function eyes(rows: string[]): Img {
  const img = new Img(7, 3)
  stamp(img, rows, 0, 0, EYE, PUPIL)
  return img
}

export function dusty(): PetArt {
  const anims: Record<string, AnimOut> = {}
  for (const [name, a] of Object.entries(ANIMS)) anims[name] = { fps: a.fps, loop: a.loop, frames: a.poses.map(frame) }

  // What Dusty eats: a little junk file (white page, folded corner, grey lines, red tag).
  const file = new Img(7, 8)
  file.rect(0, 0, 7, 8, '#f2f3f5')
  stamp(file, ['....XX', '.....X'], 1, 0, '#c9ccd2')
  file.rect(1, 3, 5, 1, '#9fa3ab')
  file.rect(1, 5, 4, 1, '#9fa3ab')
  file.rect(4, 6, 3, 2, '#e5484d')
  const food = new Img(10, 10).over(file, 2, 1).outline('#3a3d44')

  const portrait = new Img(22, 20)
  drawHead(portrait, 3, 6, 'up')
  drawBandana(portrait, 3, 6)
  portrait.outline()
  portrait.over(eyes(EYES.idle), 8, 9)

  return {
    id: 'dusty',
    cell: { w: W, h: H },
    anchor: { x: 24, y: GROUND + 1 },
    anims,
    eyes: Object.fromEntries(Object.entries(EYES).map(([k, v]) => [k, eyes(v)])),
    accentOn: null,
    food,
    portrait
  }
}
