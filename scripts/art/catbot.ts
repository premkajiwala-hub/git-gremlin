/**
 * Catbot: a white robot cat with orange accents, a striped cable tail, a
 * collar bell that lights up when fed, and a dark face-screen whose cyan eyes
 * show its mood. Side view, facing right.
 */
import { gaitSwings, Img, RUN, RUN_LIFT, stamp, WALK, WALK_LIFT, type AnimOut, type FrameOut, type PetArt } from './pixel.ts'

// --- palette ------------------------------------------------------------------------
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
  kind?: 'stand' | 'sit' | 'loaf' | 'flop'
  dy?: number
  head?: { dx?: number; dy?: number }
  ears?: 'up' | 'back' | 'perk'
  legs?: [Leg, Leg, Leg, Leg]
  tail?: { angle: number; curl?: number; len?: number }
  low?: number
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

/** The head (with face-screen and ears) at (hx, hy). Returns the eye-overlay origin. */
function drawHead(img: Img, hx: number, hy: number, ears: 'up' | 'back' | 'perk'): [number, number] {
  drawEar(img, hx + 3, hy, ears, true)
  img.round(hx, hy, 16, 13, SHELL)
  img.rect(hx + 1, hy + 11, 14, 1, SHELL_MID)
  img.rect(hx + 1, hy + 1, 13, 1, SHELL_HI)
  img.rect(hx + 1, hy + 6, 3, 2, ORANGE)
  img.rect(hx + 1, hy + 8, 3, 1, ORANGE_DARK)
  img.set(hx + 2, hy + 10, METAL)
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
function frame(p: Pose): FrameOut {
  const kind = p.kind ?? 'stand'
  const dy = p.dy ?? 0
  const ears = p.ears ?? 'up'
  const back = new Img(W, H)
  const body = new Img(W, H)
  const near = new Img(W, H)
  const head = new Img(W, H)
  let screen: [number, number]
  let accent: [number, number]

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
    accent = drawCollar(head, hx, hy)
  } else if (kind === 'sit') {
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
    accent = drawCollar(head, hx, hy)
  } else if (kind === 'loaf') {
    const breathe = dy
    drawTail(back, 9, 31, p.tail ?? { angle: 200, curl: 12, len: 9 })
    drawBody(body, 9, 25 - breathe, 21, 11 + breathe)
    near.rect(27, 34, 4, 2, PAW)
    near.rect(10, 34, 4, 2, PAW)
    const hx = 25 + (p.head?.dx ?? 0)
    const hy = 21 + (p.head?.dy ?? 0)
    screen = drawHead(head, hx, hy, ears)
    accent = [hx + 5, hy + 13]
  } else {
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
    accent = [hx + 5, hy + 13]
  }

  const img = new Img(W, H)
  img.over(back.outline()).over(body.outline()).over(near.outline()).over(head.outline())
  return { img, screen, accent }
}

// --- animations ---------------------------------------------------------------------------------
const L = (x: number, dx = 0, lift = 0, extra = 0): Leg => ({ x, dx, lift, extra })

function gait(steps: number[], lifts: number[], opts: { bob?: number[]; tail: Pose['tail']; ears?: Pose['ears']; low?: number; head?: Pose['head'] }): Pose[] {
  return gaitSwings(steps, lifts).map(({ s, liftA, liftB }, i) => ({
    dy: opts.bob?.[i] ?? 0,
    low: opts.low,
    ears: opts.ears,
    head: opts.head,
    tail: opts.tail,
    legs: [L(25, s, liftA), L(22, -s, liftB), L(13, -s, liftB), L(16, s, liftA)]
  }))
}

const ANIMS: Record<string, { fps: number; loop: boolean; poses: Pose[] }> = {
  idle: { fps: 3, loop: true, poses: [112, 118, 124, 118].map((a) => ({ tail: { angle: a, curl: -7 } })) },
  idle_sad: {
    fps: 2,
    loop: true,
    poses: [196, 200, 204, 200].map((a) => ({ tail: { angle: a, curl: 3 }, ears: 'back' as const, head: { dy: 2 } }))
  },
  walk: { fps: 10, loop: true, poses: gait(WALK, WALK_LIFT, { bob: [0, 0, 1, 0, 0, 1], tail: { angle: 125, curl: -6 } }) },
  walk_sad: { fps: 7, loop: true, poses: gait(WALK, WALK_LIFT, { tail: { angle: 200, curl: 3 }, ears: 'back', head: { dy: 2 } }) },
  run: { fps: 14, loop: true, poses: gait(RUN, RUN_LIFT, { bob: [0, -1, -1, 0, 1, 0], tail: { angle: 165, curl: -2 }, ears: 'back' }) },
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
  jump_up: { fps: 1, loop: false, poses: [{ tail: { angle: 150, curl: -3 }, legs: [L(25, 3, 2), L(22, 3, 2), L(13, -3, 1), L(16, -3, 1)], ears: 'perk' }] },
  jump_down: { fps: 1, loop: false, poses: [{ tail: { angle: 105, curl: -4 }, legs: [L(25, 1), L(22, 1), L(13, -1), L(16, -1)] }] },
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
  happy: { fps: 6, loop: true, poses: [95, 80].map((a) => ({ tail: { angle: a, curl: -9 }, ears: 'perk' as const })) },
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
  curious: { fps: 1, loop: true, poses: [{ ears: 'perk', head: { dy: -1 }, tail: { angle: 100, curl: -10 } }] }
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

function eyes(rows: string[]): Img {
  const img = new Img(8, 6)
  stamp(img, rows, 0, 0, CYAN)
  // A dim glow pixel under each lit pixel that has nothing below it.
  const glow: [number, number][] = []
  for (let y = 0; y < 5; y++) for (let x = 0; x < 8; x++) if (img.alpha(x, y) && !img.alpha(x, y + 1)) glow.push([x, y + 1])
  for (const [x, y] of glow) img.set(x, y, CYAN_DIM)
  return img
}

export function catbot(): PetArt {
  const anims: Record<string, AnimOut> = {}
  for (const [name, a] of Object.entries(ANIMS)) anims[name] = { fps: a.fps, loop: a.loop, frames: a.poses.map(frame) }

  const bell = new Img(3, 3)
  bell.rect(0, 0, 3, 3, BELL_ON)
  bell.set(0, 0, BELL_ON_HI)

  // The commit cube Catbot eats.
  const cube = new Img(8, 8)
  cube.rect(0, 0, 8, 8, '#e9ac2a')
  cube.rect(0, 0, 8, 1, '#ffd75e')
  cube.rect(0, 7, 8, 1, '#b07a14')
  cube.rect(0, 3, 8, 1, '#8a5a10')
  cube.rect(3, 2, 2, 3, '#fff0b0')
  const food = new Img(10, 10).over(cube, 1, 1).outline('#5a3a08')

  const portrait = new Img(20, 20)
  drawHead(portrait, 2, 6, 'up')
  portrait.outline()
  portrait.over(eyes(EYES.idle), 8, 10)

  return {
    id: 'catbot',
    cell: { w: W, h: H },
    anchor: { x: 24, y: GROUND + 1 },
    anims,
    eyes: Object.fromEntries(Object.entries(EYES).map(([k, v]) => [k, eyes(v)])),
    accentOn: bell,
    food,
    portrait
  }
}
