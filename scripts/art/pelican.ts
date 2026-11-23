/**
 * Pelican: opens the sites you build on your phone. A white pelican with
 * black wingtips, a grey crest, a long yellow bill and a big orange throat
 * pouch. Side view, facing right.
 *
 * Extra animations: `rummage` (bill down, fishing around: its "busy" and
 * alert pose) and `wash` (preening its chest feathers).
 */
import { gaitSwings, Img, RUN, RUN_LIFT, stamp, WALK, WALK_LIFT, type AnimOut, type FrameOut, type PetArt } from './pixel.ts'

// --- palette ------------------------------------------------------------------------
const WHITE = '#f6f3ec'
const WHITE_HI = '#ffffff'
const WHITE_SHADE = '#d8d2c4'
const WHITE_FAR = '#c7c0b1'
const WING = '#cfcac0'
const WING_SHADE = '#b3ada2'
const PRIMARY = '#2c2f36'
const PRIMARY_HI = '#4a4f59'
const CREST = '#a7adb5'
const CROWN = '#f6e7b5'
const BILL = '#f3c552'
const BILL_SHADE = '#d9a63a'
const HOOK = '#c4622a'
const POUCH = '#f08b3b'
const POUCH_SHADE = '#cd6b25'
const POUCH_HI = '#f8a865'
const LEG = '#f0a24a'
const LEG_FAR = '#c88134'
const EYE = '#17181c'
const GLINT = '#ffffff'
const FISH = '#a9c6de'
const FISH_SHADE = '#7f9fbb'

const W = 56
const H = 44
const GROUND = 41

interface Leg {
  x: number
  dx?: number
  lift?: number
  extra?: number
}

type Kind = 'stand' | 'dig' | 'sit' | 'wash' | 'loaf' | 'flop'

interface Pose {
  kind?: Kind
  dy?: number
  /** Head offset, and bill angle: 0 level, + up, - down. */
  head?: { dx?: number; dy?: number; pitch?: number }
  legs?: [Leg, Leg]
  /** 0 folded, 1 half open, 2 raised high. */
  wings?: number
  /** Extra roundness of the pouch (gulping). */
  bulge?: number
  low?: number
  phase?: number
}

// --- drawing helpers ----------------------------------------------------------------
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

/** White feathers with a lit top edge and a shaded belly. */
function feathers(img: Img, x: number, y: number, w: number, h: number): void {
  oval(img, x, y, w, h, WHITE_SHADE)
  oval(img, x, y, w, h - 1, WHITE_HI)
  oval(img, x, y + 1, w, h - 2, WHITE)
}

/** A thick line (round brush of `r` pixels). */
function line(img: Img, x0: number, y0: number, x1: number, y1: number, c: string, r = 0): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2))
  for (let i = 0; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps
    const y = y0 + ((y1 - y0) * i) / steps
    for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) if (ox * ox + oy * oy <= r * r + r) img.set(x + ox, y + oy, c)
  }
}

/** Direction of the bill for a pitch (+ up, - down). */
function billDir(pitch: number): [number, number] {
  const a = (-pitch * Math.PI) / 7
  return [Math.cos(a), Math.sin(a)]
}

const BILL_LEN = 14

/**
 * Head at (hx, hy) with its long bill and throat pouch. Returns the eye-overlay
 * origin and where the mouth is.
 */
function drawHead(img: Img, hx: number, hy: number, pitch = 0, bulge = 0, len = BILL_LEN): { eye: [number, number]; mouth: [number, number] } {
  // Crest and head.
  img.set(hx - 1, hy + 1, CREST)
  img.set(hx - 2, hy + 2, CREST)
  img.set(hx - 1, hy + 2, CREST)
  feathers(img, hx, hy, 10, 8)
  img.rect(hx + 2, hy, 5, 1, CROWN)
  // Bill: upper mandible along `dir`, pouch hanging below it.
  const [dx, dy] = billDir(pitch)
  const px = -dy // "below the bill"
  const py = dx
  const bx = hx + 8
  const by = hy + 3
  for (let t = 0; t <= len; t += 0.5) {
    const x = bx + dx * t
    const y = by + dy * t
    const f = t / len
    // Pouch: deep near the throat, tapering to the tip; rounder when gulping.
    const depth = Math.max(0, Math.round(4.5 * (1 - f) + bulge * Math.sin(Math.PI * Math.min(1, f * 1.4))))
    for (let d = 2; d <= 2 + depth; d++) img.set(x + px * d, y + py * d, d === 2 + depth ? POUCH_SHADE : d === 3 && f < 0.6 ? POUCH_HI : POUCH)
    img.set(x, y, BILL)
    img.set(x + px, y + py, BILL_SHADE)
  }
  // Hooked red tip.
  img.set(bx + dx * len + px, by + dy * len + py, HOOK)
  img.set(bx + dx * (len + 0.6) + px * 1.5, by + dy * (len + 0.6) + py * 1.5, HOOK)
  const m = 0.42 * len
  return { eye: [hx + 5, hy + 2], mouth: [Math.round(bx + dx * m + px * 2) - 4, Math.round(by + dy * m + py * 2) - 3] }
}

/** Short orange legs with webbed feet. */
function drawLeg(img: Img, leg: Leg, top: number, far: boolean): void {
  const len = GROUND - top + 1 + (leg.extra ?? 0)
  const lift = leg.lift ?? 0
  const dx = leg.dx ?? 0
  const vis = len - lift
  const c = far ? LEG_FAR : LEG
  for (let r = 0; r < vis; r++) {
    const x = leg.x + Math.round((dx * r) / Math.max(1, len - 1))
    if (r === vis - 1) img.rect(x - 1, top + r, 5, 1, c) // webbed foot
    else img.rect(x, top + r, 2, 1, c)
  }
}

/** Folded wing on the body (black wingtips at the back), or raised. */
function drawWing(img: Img, bx: number, by: number, wings: number, far: boolean): void {
  if (wings === 0) {
    if (far) return
    oval(img, bx + 3, by + 2, 17, 8, WING)
    img.rect(bx + 6, by + 8, 11, 1, WING_SHADE)
    img.rect(bx - 2, by + 6, 8, 3, PRIMARY)
    img.rect(bx - 1, by + 6, 5, 1, PRIMARY_HI)
    return
  }
  // Raised: fanned up and back from the shoulder; `wings` 1 = half, 2 = high.
  const sx = bx + 15
  const sy = by + 3
  const tipY = sy - (wings === 2 ? 15 : 8)
  const tipX = sx - (wings === 2 ? 6 : 12)
  const c = far ? WHITE_FAR : WING
  for (let i = 0; i < 6; i++) line(img, sx - i, sy + i * 0.4, tipX + i * 1.5, tipY + i, c, 1)
  line(img, tipX, tipY, tipX + 7, tipY + 3, PRIMARY, 1)
}

function drawBody(img: Img, bx: number, by: number, bw: number, bh: number): void {
  feathers(img, bx, by, bw, bh)
  // Short tail.
  img.rect(bx - 3, by + 5, 4, 3, WHITE_SHADE)
  img.rect(bx - 3, by + 5, 3, 1, WHITE)
}

/** S-curved neck from the shoulder up to the head. */
function drawNeck(img: Img, sx: number, sy: number, hx: number, hy: number): void {
  const mx = (sx + hx) / 2 + 2
  const my = (sy + hy) / 2
  line(img, sx, sy, mx, my, WHITE, 2)
  line(img, mx, my, hx, hy, WHITE, 2)
  line(img, sx + 1, sy + 1, mx + 1, my, WHITE_SHADE, 0)
}

function frame(p: Pose): FrameOut {
  const kind = p.kind ?? 'stand'
  const dy = p.dy ?? 0
  const pitch = p.head?.pitch ?? 0
  const back = new Img(W, H)
  const body = new Img(W, H)
  const near = new Img(W, H)
  const head = new Img(W, H)
  let out: { eye: [number, number]; mouth: [number, number] }

  if (kind === 'stand' || kind === 'dig') {
    const dig = kind === 'dig'
    const low = p.low ?? 0
    const bx = 10
    const by = 20 + dy + low
    const legs = p.legs ?? [{ x: 22 }, { x: 18 }]
    const legTop = by + 14
    drawLeg(back, legs[1], legTop, true)
    drawWing(back, bx, by, p.wings ?? 0, true)
    drawBody(body, bx, by, 24, 15)
    drawWing(body, bx, by, p.wings ?? 0, false)
    drawLeg(near, legs[0], legTop, false)
    const phase = p.phase ?? 0
    const hx = (dig ? 33 : 31) + (p.head?.dx ?? 0)
    const hy = (dig ? 17 + phase : 7) + dy + low + (p.head?.dy ?? 0)
    drawNeck(head, bx + 20, by + 3, hx + 3, hy + 6)
    out = drawHead(head, hx, hy, dig ? -2.2 : pitch, p.bulge ?? 0, dig ? 11 : BILL_LEN)
  } else if (kind === 'sit' || kind === 'wash' || kind === 'loaf') {
    // Resting on its belly, feet tucked away.
    const breathe = kind === 'loaf' ? dy : 0
    const bx = 10
    const by = 27 - breathe
    drawBody(body, bx, by, 25, 14 + breathe)
    drawWing(body, bx, by, 0, false)
    const phase = p.phase ?? 0
    if (kind === 'sit') {
      const hx = 30 + (p.head?.dx ?? 0)
      const hy = 14 + (p.head?.dy ?? 0)
      drawNeck(head, bx + 20, by + 3, hx + 3, hy + 6)
      out = drawHead(head, hx, hy, pitch)
    } else if (kind === 'wash') {
      // Preening: bill tucked down into its chest feathers.
      const hx = 29
      const hy = 18 + phase
      drawNeck(head, bx + 20, by + 3, hx + 3, hy + 6)
      out = drawHead(head, hx, hy, -3 - phase * 0.5, 0, 10)
    } else {
      // Asleep: neck folded, head resting low on its chest, bill along the body.
      const hx = 27 + (p.head?.dx ?? 0)
      const hy = 22 - breathe
      out = drawHead(head, hx, hy, -0.4, 0, 12)
    }
  } else {
    // Flopped: lying flat, head and bill on the ground.
    const tw = dy
    drawBody(body, 10, 30, 25, 11)
    drawWing(body, 10, 30, 0, false)
    near.rect(14, 39 - tw, 4, 1, LEG)
    near.rect(20, 40, 4, 1, LEG_FAR)
    out = drawHead(head, 31, 31, 0.3, 0, 12)
  }

  const img = new Img(W, H)
  img.over(back.outline()).over(body.outline()).over(near.outline()).over(head.outline())
  return { img, screen: out.eye, accent: null }
}

// --- animations ---------------------------------------------------------------------------------
const L = (x: number, dx = 0, lift = 0, extra = 0): Leg => ({ x, dx, lift, extra })

function gait(steps: number[], lifts: number[], opts: { bob?: number[]; low?: number; head?: Pose['head'] }): Pose[] {
  return gaitSwings(steps, lifts).map(({ s, liftA, liftB }, i) => ({
    dy: opts.bob?.[i] ?? 0,
    low: opts.low,
    head: opts.head,
    legs: [L(22, s, liftA), L(18, -s, liftB)]
  }))
}

const ANIMS: Record<string, { fps: number; loop: boolean; poses: Pose[] }> = {
  idle: { fps: 3, loop: true, poses: [0, 0, 1, 0].map((d) => ({ head: { dy: d } })) },
  idle_sad: { fps: 2, loop: true, poses: [2, 2, 3, 2].map((d) => ({ head: { dy: d, pitch: -0.6 } })) },
  walk: { fps: 10, loop: true, poses: gait(WALK, WALK_LIFT, { bob: [0, 0, 1, 0, 0, 1] }) },
  walk_sad: { fps: 7, loop: true, poses: gait(WALK, WALK_LIFT, { head: { dy: 3, pitch: -0.6 } }) },
  run: { fps: 14, loop: true, poses: gait(RUN, RUN_LIFT, { bob: [0, -1, -1, 0, 1, 0], head: { dx: 1, dy: 1 } }) },
  crawl: { fps: 6, loop: true, poses: gait([1, 1, 0, -1, -1, 0], [0, 1, 0, 0, 0, 0], { low: 3, head: { dx: 1, dy: 4, pitch: -0.3 } }) },
  sit: { fps: 1.5, loop: true, poses: [{ kind: 'sit' }, { kind: 'sit', head: { dy: 1 } }] },
  // Preening its chest feathers.
  wash: { fps: 5, loop: true, poses: [0, 1].map((phase) => ({ kind: 'wash' as const, phase })) },
  // Bill down, fishing around.
  rummage: { fps: 6, loop: true, poses: [0, 1, 0, 1].map((phase) => ({ kind: 'dig' as const, phase })) },
  sleep: { fps: 1.2, loop: true, poses: [{ kind: 'loaf', dy: 0 }, { kind: 'loaf', dy: 1 }] },
  starving: { fps: 1, loop: true, poses: [{ kind: 'flop', dy: 0 }, { kind: 'flop', dy: 1 }] },
  jump_up: { fps: 1, loop: false, poses: [{ wings: 2, head: { dy: -1, pitch: 0.4 }, legs: [L(22, -2, 2), L(18, -2, 2)] }] },
  jump_down: { fps: 1, loop: false, poses: [{ wings: 1, legs: [L(22, 1), L(18, 1)] }] },
  dragged: {
    fps: 4,
    loop: true,
    poses: [1, 2].map((w) => ({ wings: w, head: { pitch: -0.4 }, legs: [L(22, 0, 0, 1), L(18, 0, 0, 1)] as [Leg, Leg] }))
  },
  // Gulping a fish: bill tipped up, pouch bulging.
  eat: { fps: 7, loop: true, poses: [1, 3, 2, 3].map((b) => ({ head: { dy: -2, pitch: 1.6 }, bulge: b })) },
  happy: { fps: 6, loop: true, poses: [2, 1].map((w, i) => ({ wings: w, dy: -i, head: { pitch: 0.5 } })) },
  hurt: { fps: 8, loop: true, poses: [0, 1].map((d) => ({ dy: d, wings: 1, head: { dy: 1, pitch: -0.5 } })) },
  tap: { fps: 7, loop: true, poses: [3, 1].map((lift) => ({ head: { dy: 1, pitch: -0.4 }, legs: [L(22, 2, lift), L(18)] as [Leg, Leg] })) },
  curious: { fps: 1, loop: true, poses: [{ head: { dy: -2, dx: 1, pitch: 0.8 } }] }
}

// --- eyes (3x2: 'o' = white glint) --------------------------------------------------------------
const EYES: Record<string, string[]> = {
  idle: ['oX.', 'XX.'],
  blink: ['...', 'XXX'],
  happy: ['.X.', 'X.X'],
  hurt: ['X.X', '.X.'],
  alert: ['oXX', 'XXX'],
  sad: ['X..', '.XX']
}

function eyes(rows: string[]): Img {
  const img = new Img(3, 2)
  stamp(img, rows, 0, 0, EYE, GLINT)
  return img
}

export function pelican(): PetArt {
  const anims: Record<string, AnimOut> = {}
  for (const [name, a] of Object.entries(ANIMS)) anims[name] = { fps: a.fps, loop: a.loop, frames: a.poses.map(frame) }

  // What Pelican gulps down: a little silver fish.
  const food = new Img(10, 10)
  stamp(food, ['..XXXX..X', '.XXXXXXXX', 'XXoXXXXX.', '.XXXXXXXX', '..XXXX..X'], 0, 3, FISH, EYE)
  food.rect(2, 7, 4, 1, FISH_SHADE)
  food.outline('#2c4a63')

  const portrait = new Img(30, 22)
  const pHead = drawHead(portrait, 3, 5, 0, 0, 13)
  portrait.outline()
  portrait.over(eyes(EYES.idle), pHead.eye[0], pHead.eye[1])

  return {
    id: 'pelican',
    cell: { w: W, h: H },
    anchor: { x: 22, y: GROUND + 1 },
    anims,
    eyes: Object.fromEntries(Object.entries(EYES).map(([k, v]) => [k, eyes(v)])),
    accentOn: null,
    food,
    portrait
  }
}
