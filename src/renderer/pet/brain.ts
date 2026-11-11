import type { DisplayInfo, FeedEvent, PetSnapshot, PetStatus, Settings, WindowLedge } from '../../shared/types'
import type { World } from '../world'
import type { ParticleKind } from './particles'
import { frameAt, type AnimName, type Mood, type SpriteSet } from './sprites'

export type Activity =
  | 'idle'
  | 'walk'
  | 'run'
  | 'crawl'
  | 'hop'
  | 'prejump'
  | 'sit'
  | 'curious'
  | 'sleep'
  | 'eat'
  | 'happy'
  | 'hurt'
  | 'starving'
  | 'tap'
  | 'dragged'
  | 'air'

/** Everything the view needs to draw one frame. */
export interface RenderState {
  anim: AnimName
  frame: number
  facing: 1 | -1
  /** Height above the floor point, in DIP (jumps, falls, tosses). */
  z: number
  /** Little hop offset in sprite pixels (happy bounce). */
  bob: number
  mood: Mood
  /** Eyes glance up (-1) or down (+1) on the screen. */
  lookY: number
  /** Collar bell lit (well fed). */
  glow: boolean
  /** 0..1 hunger dimming. */
  dim: number
  /** 0..1 red flash. */
  tint: number
  /** 0 = no food on screen, else the commit cube's remaining size (0..1). */
  food: number
  /** 0..1 landing squash. */
  squash: number
  /** Being carried: the shadow shrinks. */
  lifted: boolean
}

export interface BrainHooks {
  say(text: string, ms?: number): void
  /** Spawn a particle at (x, y) sprite pixels from Catbot's feet (x already facing-aware). */
  spawn(kind: ParticleKind, x: number, y: number): void
  /** Catbot started (hwnd) or stopped (0) standing on a window's top edge. */
  standing(hwnd: number): void
  handoff(target: DisplayInfo, snap: PetSnapshot): void
}

const GRAVITY = 2400 // DIP / s^2
const FRICTION = 1900 // DIP / s^2 when sliding along the floor
const MAX_THROW = 2600
/** How long after the cursor last moved Catbot keeps following it (s), so it can catch up. */
const FOLLOW_GRACE = 6

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const chance = (p: number) => Math.random() < p
const pickOne = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

export const RANDOM_LINES = [
  'BEEP BOOP. COMMIT DETECTED?',
  'SMALL COMMITS = HAPPY CIRCUITS.',
  'HAVE YOU TRIED GIT ADD -P?',
  'MERGE CONFLICTS MAKE MY FANS SPIN.',
  'MEOW.EXE HAS STARTED.',
  'MY TAIL IS 40% CABLE.',
  'I DREAM IN GREEN SQUARES.',
  'REMEMBER TO HYDRATE. I USE COOLANT.',
  'WIP COMMITS STILL COUNT AS FOOD.',
  'PURRING AT 60 HZ.'
]
const HUNGRY_LINES = [
  'LOW BATTERY... FEED ME COMMITS',
  '*WHIRRR* SO HUNGRY...',
  '*SIGH*',
  'EVEN A TYPO FIX WOULD DO.',
  'GIT COMMIT -M "FOOD"?',
  'ERROR 404: SNACK NOT FOUND'
]
const PECKISH_LINES = ['SNACK TIME SOON?', 'ENERGY DIPPING. A COMMIT WOULD BE NICE.', '*TUMMY BEEP*']
const STARVING_LINES = ['...', 'B-BATTERY CRITICAL...', 'C-COMMIT... PLEASE...']
const EAT_LINES = ['NOM.EXE COMPLETE!', 'CRUNCHY COMMIT!', 'BYTES DIGESTED!', 'MMM, FRESH CODE.']

type Gait = 'walk' | 'run' | 'crawl'
const GAIT_SPEED: Record<Gait, number> = { walk: 1, run: 2.4, crawl: 0.45 }
/** Activities that pause while the cursor hovers over Catbot, and that cursor-following can interrupt. */
const PAUSABLE: Activity[] = ['idle', 'walk', 'run', 'crawl', 'sit', 'curious']

/**
 * Catbot's body and mind: free movement across the screen (or along the
 * bottom edge), hops onto the focused window's top edge, following the cursor,
 * physics for jumps and throws, the behaviour state machine, and what to draw.
 *
 * (x, y) is the point on the "floor" under its feet, in global DIP; z is its
 * height above that point. On a window's top edge, y is that edge.
 */
export class PetBrain {
  x = 0
  y = 0
  z = 0
  vx = 0
  vy = 0
  vz = 0
  facing: 1 | -1 = 1
  activity: Activity = 'idle'
  t = 0
  dur = 2
  tx = 0
  ty = 0
  /** On-screen standing height in DIP (set by the view, snapped to crisp pixels). */
  size = 72
  /** The focused app window, which Catbot may hop onto. */
  ledge: WindowLedge | null = null

  private stand: WindowLedge | null = null
  private following = false
  private crossing = false
  private thenHop = false
  private walkingOff = false
  private afterTap = false
  private hopsLeft = 0
  private jump: { vx: number; vy: number; vz: number } | null = null
  private pendingFeed: FeedEvent | null = null
  private afterLand: 'hurt' | null = null
  private bounce = 0.35
  private hovered = false
  private pausedForHover = false
  private handedOff = false
  private clock = 0
  private animName: AnimName = 'idle'
  private animT = 0
  private fxClock = 0
  private blinkT = 3
  private blinking = 0
  private lookAtYou = 0
  private squashT = 0
  private flashT = 0
  private twitchT = 4
  private twitching = 0
  private noLandT = 0
  private nagT = rand(25, 50)
  private curiousCooldown = 0
  private dragOffset = { x: 0, y: 0 }
  private cursor = { x: 0, y: 0 }
  /** Seconds since the cursor last moved over the visible desktop. */
  private cursorIdle = Infinity

  constructor(
    public world: World,
    public settings: Settings,
    public status: PetStatus,
    private sprites: SpriteSet,
    private hooks: BrainHooks
  ) {}

  // --- sizes ---------------------------------------------------------------------
  get hw(): number {
    return this.size * 0.55
  }
  private get stage() {
    return this.status.stage
  }
  private get roam(): boolean {
    return this.settings.movement === 'roam'
  }
  get onWindow(): boolean {
    return this.stand !== null
  }

  /** Hit box around Catbot in DIP. */
  hitBox(): { left: number; right: number; top: number; bottom: number } {
    const lying = this.activity === 'sleep' || this.activity === 'starving'
    const hw = this.size * (lying ? 0.7 : 0.6)
    const h = this.size * (lying ? 0.55 : 1.0)
    const feet = this.y - this.z
    return { left: this.x - hw, right: this.x + hw, top: feet - h, bottom: feet + 4 }
  }

  /** Where the feet may go right now: a window's top edge, or the floor of this monitor. */
  private area(): { x0: number; x1: number; y0: number; y1: number } {
    const wa = this.world.workArea
    if (this.stand) {
      const l = this.stand
      return {
        x0: Math.max(l.x, wa.x) + this.hw * 0.5,
        x1: Math.min(l.x + l.width, wa.x + wa.width) - this.hw * 0.5,
        y0: l.y,
        y1: l.y
      }
    }
    const x0 = wa.x + this.hw
    const x1 = wa.x + wa.width - this.hw
    if (!this.roam) return { x0, x1, y0: this.world.groundY, y1: this.world.groundY }
    return { x0, x1, y0: wa.y + this.size + 4, y1: wa.y + wa.height - 3 }
  }

  // --- snapshots ---------------------------------------------------------------------
  snapshot(): PetSnapshot {
    return {
      x: this.x,
      y: this.y,
      vx: this.vx,
      vy: this.vy,
      facing: this.facing,
      grounded: this.z <= 0,
      brain: {
        activity: ['dragged', 'prejump', 'hop', 'eat'].includes(this.activity) ? 'idle' : this.activity,
        t: this.t,
        dur: this.dur,
        tx: this.tx,
        ty: this.ty,
        z: this.z,
        vz: this.vz,
        pendingFeed: this.pendingFeed
      }
    }
  }

  restore(s: PetSnapshot): void {
    const b = (s.brain ?? {}) as Partial<{
      activity: Activity
      t: number
      dur: number
      tx: number
      ty: number
      z: number
      vz: number
      pendingFeed: FeedEvent | null
    }>
    this.x = s.x
    this.y = s.y
    this.vx = s.vx
    this.vy = s.vy
    this.facing = s.facing
    this.z = b.z ?? 0
    this.vz = b.vz ?? 0
    this.t = b.t ?? 0
    this.dur = b.dur ?? 2
    this.tx = b.tx ?? s.x
    this.ty = b.ty ?? s.y
    this.pendingFeed = b.pendingFeed ?? null
    this.stand = null
    this.following = this.crossing = this.thenHop = this.walkingOff = this.afterTap = false
    this.handedOff = false
    const known: Activity[] = ['idle', 'walk', 'run', 'crawl', 'sit', 'curious', 'sleep', 'happy', 'hurt', 'starving', 'air']
    this.activity = b.activity && known.includes(b.activity) ? b.activity : 'idle'
    if (this.z > 0) this.activity = 'air'
    if (!this.roam) this.y = this.world.groundY
    this.clampToArea()
  }

  // --- events from the outside world ---------------------------------------------------
  feed(ev: FeedEvent): void {
    if (this.activity === 'dragged' || this.activity === 'air' || this.activity === 'prejump' || this.activity === 'hop')
      this.pendingFeed = ev
    else this.startEat(ev)
  }

  clicked(): void {
    this.lookAtYou = 2
    this.blinking = 0
  }

  /** The cursor is over Catbot: it stops what it's doing and looks at you. */
  setHovered(h: boolean): void {
    this.hovered = h
  }

  /** Latest cursor position; `moved` = it moved over the visible desktop since last time. */
  setCursor(gx: number, gy: number, moved = false): void {
    this.cursor.x = gx
    this.cursor.y = gy
    if (moved) this.cursorIdle = 0
  }

  /** The cursor came close after being away. */
  cursorNear(gx: number): void {
    if (this.curiousCooldown > 0 || this.following || !['idle', 'walk', 'sit'].includes(this.activity)) return
    this.curiousCooldown = 15
    if (!chance(0.35)) return
    this.facing = gx >= this.x ? 1 : -1
    this.set('curious', 1.6)
  }

  startDrag(grabX: number, grabY: number): void {
    this.leaveWindow()
    this.y -= this.z
    this.z = 0
    this.dragOffset = { x: grabX - this.x, y: grabY - this.y }
    this.cursor = { x: grabX, y: grabY }
    this.vx = this.vy = this.vz = 0
    this.following = false
    this.set('dragged', 0)
  }

  release(): void {
    if (this.activity !== 'dragged') return
    const vx = clamp(this.vx, -MAX_THROW, MAX_THROW)
    const vy = clamp(this.vy, -MAX_THROW, MAX_THROW)
    const hard = Math.hypot(vx, vy) > 1400
    this.afterLand = hard ? 'hurt' : null
    this.bounce = hard ? 0.55 : 0.35
    if (hard) {
      // Flicked hard: cosmetic red flash and a bouncier landing.
      this.flashT = 0.35
      if (chance(0.6)) this.hooks.say(pickOne(['WHEEE!', 'SYSTEM SHAKEN!', 'HEY!']), 1500)
    }
    if (this.roam) {
      this.vx = vx * 0.6
      this.vy = vy * 0.6
      this.vz = 260 + Math.min(500, Math.hypot(vx, vy) * 0.15)
    } else {
      this.z = Math.max(0, this.world.groundY - this.y)
      this.y = this.world.groundY
      this.vx = vx * 0.7
      this.vy = 0
      this.vz = -vy * 0.7
    }
    // Don't immediately chase the cursor that just threw it.
    this.cursorIdle = FOLLOW_GRACE
    this.set('air', 0)
  }

  /** The window Catbot is standing on moved, closed or was minimised. */
  standingLost(hwnd: number): void {
    if (this.stand?.hwnd === hwnd) this.fallFromWindow()
  }

  // --- main update -------------------------------------------------------------------
  update(dt: number): void {
    if (this.handedOff) return
    this.clock += dt
    this.t += dt
    this.animT += dt
    this.cursorIdle += dt
    this.tickTimers(dt)
    this.handleHover()
    this.handleFollow()

    switch (this.activity) {
      case 'idle':
      case 'sit':
      case 'curious':
      case 'hurt':
        this.slide(dt)
        if (this.t > this.dur) {
          if (this.afterTap) {
            this.afterTap = false
            this.set('starving', rand(25, 60))
          } else this.next()
        }
        break
      case 'happy':
        this.slide(dt)
        if (this.fxClock > 0.35) {
          this.fxClock = 0
          this.hooks.spawn('heart', this.facing * 4 + rand(-4, 4), -34)
        }
        if (this.t > this.dur) this.next()
        break
      case 'walk':
      case 'run':
      case 'crawl': {
        if (this.following) this.aimAtCursor()
        const arrived = this.moveToward(this.tx, this.ty, this.speed(this.activity), dt)
        // Walking off a window's edge switches to falling.
        if (this.handedOff || (this.activity as Activity) === 'air') break
        if (this.following) {
          if (arrived) this.set('idle', 0.6)
        } else if (arrived) {
          if (this.afterTap) this.set('tap', 3)
          else if (this.thenHop) {
            this.thenHop = false
            if (!this.launchToWindow()) this.next()
          } else this.next()
        } else if (this.t > 25) this.next()
        break
      }
      case 'hop':
        this.physics(dt)
        break
      case 'prejump':
        if (this.t > 0.28 && this.jump) {
          this.leaveWindow()
          this.vx = this.jump.vx
          this.vy = this.jump.vy
          this.vz = this.jump.vz
          this.jump = null
          this.set('air', 0)
        }
        break
      case 'sleep':
        this.slide(dt)
        if (this.fxClock > 1.6) {
          this.fxClock = 0
          this.hooks.spawn('zzz', this.facing * 10, -24)
        }
        if (!this.status.quiet && this.t > this.dur) this.next()
        break
      case 'eat':
        if (this.fxClock > 0.24) {
          this.fxClock = 0
          for (let i = 0; i < 2; i++) this.hooks.spawn('crumb', this.facing * 20, -3)
        }
        if (this.t > this.dur) this.set('happy', 1.8)
        break
      case 'starving':
        this.slide(dt)
        if (this.stage !== 'starving') this.next()
        else if (this.t > this.dur) this.tryTapWindow()
        break
      case 'tap':
        if (this.t > this.dur) this.set('starving', rand(25, 60))
        break
      case 'dragged':
        this.drag(dt)
        break
      case 'air':
        this.physics(dt)
        break
    }

    if (this.activity !== 'dragged' && !this.stand) this.checkHandoff()
  }

  private handleHover(): void {
    if (this.hovered && PAUSABLE.includes(this.activity) && !this.pausedForHover) {
      this.pausedForHover = true
      this.following = false
      this.thenHop = false
      this.set('idle', Infinity)
    } else if (!this.hovered && this.pausedForHover) {
      this.pausedForHover = false
      if (this.activity === 'idle') this.dur = this.t + 0.8
    }
    if (this.pausedForHover && Math.abs(this.cursor.x - this.x) > 6) this.facing = this.cursor.x > this.x ? 1 : -1
  }

  /** Follow the cursor while it's moving over the desktop; go back to wandering once it rests. */
  private handleFollow(): void {
    const canFollow =
      this.settings.followCursor &&
      !this.hovered &&
      !this.pendingFeed &&
      !this.status.quiet &&
      this.stage !== 'starving' &&
      PAUSABLE.includes(this.activity)
    const active = this.cursorIdle < FOLLOW_GRACE
    if (this.following && (!active || !canFollow)) {
      this.following = false
      if (PAUSABLE.includes(this.activity)) this.next()
      return
    }
    if (!this.following && active && canFollow && this.cursorIdle < 0.3) {
      this.following = true
      this.crossing = false
      this.thenHop = false
      this.aimAtCursor()
      if (Math.hypot(this.tx - this.x, this.ty - this.y) > this.size * 0.4) this.set(this.followGait(), 0)
    }
  }

  private followGait(): Gait {
    if (this.stage === 'hungry') return 'walk'
    return Math.hypot(this.tx - this.x, this.ty - this.y) > this.size * 4 ? 'run' : 'walk'
  }

  /** Aim so the cursor ends up over Catbot's body. */
  private aimAtCursor(): void {
    const a = this.area()
    if (this.stand) {
      // On a window: walk along it toward the cursor, and drop off the end if it's beyond.
      const l = this.stand
      const inside = this.cursor.x > l.x && this.cursor.x < l.x + l.width
      this.tx = inside ? clamp(this.cursor.x, a.x0, a.x1) : this.cursor.x < l.x ? l.x - this.hw : l.x + l.width + this.hw
      this.ty = l.y
      this.walkingOff = !inside
      return
    }
    this.tx = clamp(this.cursor.x, a.x0, a.x1)
    this.ty = this.roam ? clamp(this.cursor.y + this.size * 0.45, a.y0, a.y1) : this.world.groundY
    if (this.activity === 'walk' || this.activity === 'run') {
      const g = this.followGait()
      if (g !== this.activity) this.activity = g
    }
  }

  // --- behaviour selection -------------------------------------------------------------
  private set(a: Activity, dur: number): void {
    this.activity = a
    this.t = 0
    this.dur = dur
    if (a !== 'walk' && a !== 'run' && a !== 'crawl') this.following = false
    this.fxClock = 0
  }

  private next(): void {
    this.afterTap = false
    this.walkingOff = false
    if (this.pendingFeed) {
      const ev = this.pendingFeed
      this.pendingFeed = null
      return this.startEat(ev)
    }
    if (this.status.quiet) return this.stand ? this.walkOffWindow() : this.set('sleep', 30)
    if (this.stage === 'starving') return this.stand ? this.walkOffWindow() : this.set('starving', rand(20, 50))

    if (this.stand) {
      const r = Math.random()
      if (r < 0.35) return this.set('idle', rand(2, 6))
      if (r < 0.55) return this.set('sit', rand(4, 9))
      if (r < 0.85) return this.startMove('walk')
      return this.walkOffWindow()
    }

    const weights: [string, number][] =
      this.stage === 'hungry'
        ? [
            ['idle', 30],
            ['walk', 35],
            ['crawl', 10],
            ['sit', 25]
          ]
        : this.stage === 'peckish'
          ? [
              ['idle', 22],
              ['walk', 32],
              ['run', 6],
              ['crawl', 10],
              ['hop', 4],
              ['window', 8],
              ['sit', 12],
              ['curious', 6]
            ]
          : [
              ['idle', 18],
              ['walk', 28],
              ['run', 12],
              ['crawl', 7],
              ['hop', 7],
              ['window', 12],
              ['sit', 8],
              ['curious', 4],
              ['nap', 4]
            ]
    let r = Math.random() * weights.reduce((s, [, w]) => s + w, 0)
    let choice = weights[0][0]
    for (const [name, w] of weights) {
      r -= w
      if (r <= 0) {
        choice = name
        break
      }
    }
    switch (choice) {
      case 'walk':
      case 'run':
      case 'crawl':
        return this.startMove(choice as Gait)
      case 'hop':
        return this.startHops()
      case 'window':
        if (this.goToWindow()) return
        return this.startMove('walk')
      case 'sit':
        return this.set('sit', rand(4, 10))
      case 'curious':
        return this.set('curious', 1.6)
      case 'nap':
        return this.set('sleep', rand(10, 25))
      default:
        return this.set('idle', rand(2, 5))
    }
  }

  private startMove(gait: Gait): void {
    this.pickTarget()
    this.set(gait, 0)
  }

  /** A random spot to wander to: nearby, anywhere on this monitor, or on the next one. */
  private pickTarget(): void {
    const a = this.area()
    this.crossing = false
    if (this.stand) {
      this.tx = rand(a.x0, a.x1)
      this.ty = a.y0
      return
    }
    const dir: 1 | -1 = chance(0.5) ? 1 : -1
    const neighbor = this.world.neighbor(dir)
    if (neighbor && chance(0.12)) {
      const wa = neighbor.workArea
      this.crossing = true
      this.tx = dir > 0 ? wa.x + rand(0.1, 0.5) * wa.width : wa.x + rand(0.5, 0.9) * wa.width
      this.ty = this.roam ? clamp(this.y, Math.max(a.y0, wa.y + this.size + 4), Math.min(a.y1, wa.y + wa.height - 3)) : neighbor.groundY
      return
    }
    if (!this.roam || chance(0.65)) {
      const ang = Math.random() * Math.PI * 2
      const dist = rand(80, 420)
      this.tx = clamp(this.x + Math.cos(ang) * dist, a.x0, a.x1)
      this.ty = clamp(this.y + Math.sin(ang) * dist * 0.7, a.y0, a.y1)
      if (Math.hypot(this.tx - this.x, this.ty - this.y) < 40) this.tx = clamp(this.x - Math.cos(ang) * dist, a.x0, a.x1)
    } else {
      this.tx = rand(a.x0, a.x1)
      this.ty = rand(a.y0, a.y1)
    }
  }

  /** A few playful hops along the floor. */
  private startHops(): void {
    this.hopsLeft = 1 + Math.floor(Math.random() * 3)
    this.facing = chance(0.5) ? 1 : -1
    this.hopOnce()
  }

  private hopOnce(): void {
    const a = this.area()
    const reach = this.size * 1.1
    if (this.x + this.facing * reach > a.x1 || this.x + this.facing * reach < a.x0) this.facing = (-this.facing) as 1 | -1
    const vz = 520
    const flight = (2 * vz) / GRAVITY
    this.vx = (this.facing * reach) / flight
    this.vy = this.roam ? (rand(-0.35, 0.35) * reach) / flight : 0
    this.vz = vz
    this.set('hop', 0)
  }

  /** The focused window's top edge on this monitor, if Catbot can stand on it. */
  private usableLedge(): WindowLedge | null {
    const l = this.ledge
    if (!l) return null
    const wa = this.world.workArea
    const x0 = Math.max(l.x, wa.x)
    const x1 = Math.min(l.x + l.width, wa.x + wa.width)
    if (x1 - x0 < this.size * 2) return null
    if (l.y < wa.y + this.size * 1.3 || l.y > wa.y + wa.height - this.size * 0.9) return null
    return { ...l, x: x0, width: x1 - x0 }
  }

  /** Head for a spot under the focused window's top edge, then jump up onto it. */
  private goToWindow(): boolean {
    const l = this.usableLedge()
    if (!l || this.stage === 'hungry') return false
    const a = this.area()
    const inside = this.x > l.x + this.hw && this.x < l.x + l.width - this.hw
    const below = this.y > l.y + 40
    if (inside && below && this.y - l.y < 700) return this.launchToWindow()
    this.tx = clamp(rand(l.x + this.hw, l.x + l.width - this.hw), a.x0, a.x1)
    this.ty = this.roam ? clamp(l.y + rand(120, 320), a.y0, a.y1) : this.world.groundY
    if (this.ty <= l.y + 40) return false
    this.crossing = false
    this.thenHop = true
    this.set('walk', 0)
    return true
  }

  private launchToWindow(): boolean {
    const l = this.usableLedge()
    if (!l || this.stand) return false
    const tx = clamp(this.x + this.facing * rand(30, 140), l.x + this.hw, l.x + l.width - this.hw)
    const up = this.y - l.y + 40
    if (up < 70 || up > 1000) return false
    const vz = Math.sqrt(2 * GRAVITY * up)
    const flight = vz / GRAVITY + Math.sqrt((2 * 40) / GRAVITY)
    const vx = (tx - this.x) / flight
    if (Math.abs(vx) > 1400) return false
    this.facing = vx >= 0 ? 1 : -1
    this.jump = { vx, vy: 0, vz }
    this.set('prejump', 0.28)
    return true
  }

  private walkOffWindow(): void {
    if (!this.stand) return this.startMove('walk')
    const l = this.stand
    const left = this.x - l.x < l.x + l.width - this.x
    this.tx = left ? l.x - this.hw : l.x + l.width + this.hw
    this.ty = l.y
    this.walkingOff = true
    this.set('walk', 0)
  }

  private leaveWindow(): void {
    if (this.stand) {
      this.stand = null
      this.hooks.standing(0)
    }
  }

  /** Drop from the window's top edge down to the floor below it. */
  private fallFromWindow(): void {
    const l = this.stand
    this.leaveWindow()
    if (!l) return
    const a = this.area()
    const landY = this.roam ? clamp(l.y + rand(90, 260), a.y0, a.y1) : this.world.groundY
    // Don't land straight back on the (possibly stale) window edge.
    this.noLandT = 0.8
    this.z = Math.max(0, landY - l.y)
    this.y = landY
    this.vz = 0
    this.vy = 0
    this.set('air', 0)
  }

  private startEat(ev: FeedEvent): void {
    this.z = 0
    this.vx = this.vy = this.vz = 0
    this.jump = null
    this.following = false
    this.set('eat', 2.8)
    const what = ev.debug ? 'NOM.EXE (DEBUG SNACK)' : `${pickOne(EAT_LINES)} +${ev.commits} COMMIT${ev.commits === 1 ? '' : 'S'}`
    this.hooks.say(what, 2600)
  }

  /** Starving: get up, crawl over to the focused window's edge and tap on it. */
  private tryTapWindow(): void {
    const l = this.ledge
    const a = this.area()
    if (!l) return this.set('starving', rand(25, 60))
    const edges = [l.x - this.hw * 0.9, l.x + l.width + this.hw * 0.9].filter((x) => x > a.x0 && x < a.x1)
    if (!edges.length) return this.set('starving', rand(25, 60))
    edges.sort((p, q) => Math.abs(p - this.x) - Math.abs(q - this.x))
    this.tx = edges[0]
    this.ty = this.roam ? clamp(l.y + l.height * 0.6, a.y0, a.y1) : this.world.groundY
    this.crossing = false
    this.afterTap = true
    this.set('crawl', 0)
    if (chance(0.5)) this.hooks.say(pickOne(['FOOD...?', '*TAP TAP*', 'ANYONE CODING?']), 2500)
  }

  // --- movement & physics ------------------------------------------------------------------
  private speed(gait: Gait): number {
    const stageMul = this.stage === 'hungry' ? 0.5 : this.stage === 'starving' ? 0.3 : 1
    return this.settings.petSpeed * stageMul * GAIT_SPEED[gait]
  }

  /** Walk in a straight line toward (tx, ty). Returns true on arrival. */
  private moveToward(tx: number, ty: number, speed: number, dt: number): boolean {
    const dx = tx - this.x
    const dy = this.stand ? 0 : ty - this.y
    const d = Math.hypot(dx, dy)
    if (d < 3) return true
    if (Math.abs(dx) > 4) this.facing = dx > 0 ? 1 : -1
    const step = Math.min(d, speed * dt)
    this.x += (dx / d) * step
    this.y += (dy / d) * step

    if (this.stand) {
      const l = this.stand
      if (this.x < Math.max(l.x, this.world.left) || this.x > Math.min(l.x + l.width, this.world.right)) {
        // Walked off the edge of the window.
        this.fallFromWindow()
        this.vx = this.facing * speed
        return false
      }
      if (!this.walkingOff) this.clampToArea()
      return false
    }
    if (!this.crossing) this.clampToArea()
    return false
  }

  /** Residual sliding after a throw, with friction. */
  private slide(dt: number): void {
    const v = Math.hypot(this.vx, this.vy)
    if (v < 1) {
      this.vx = this.vy = 0
      return
    }
    const nv = Math.max(0, v - FRICTION * dt)
    this.vx *= nv / v
    this.vy *= nv / v
    this.x += this.vx * dt
    if (!this.stand) this.y += this.vy * dt
    if (this.stand && (this.x < this.stand.x || this.x > this.stand.x + this.stand.width)) return this.fallFromWindow()
    this.bounceOffEdges(0.4)
  }

  private physics(dt: number): void {
    const prevFeet = this.y - this.z
    this.x += this.vx * dt
    if (this.roam) this.y += this.vy * dt
    this.vz -= GRAVITY * dt
    this.z += this.vz * dt
    this.bounceOffEdges(0.6)
    const ceiling = this.world.top + this.size
    if (this.y - this.z < ceiling) {
      this.z = this.y - ceiling
      this.vz = -Math.abs(this.vz) * 0.4
    }

    // Land on the focused window's top edge when coming down through it.
    const feet = this.y - this.z
    const l = this.noLandT > 0 ? null : this.usableLedge()
    if (l && this.vz < 0 && prevFeet <= l.y + 1 && feet >= l.y && l.y < this.y && this.x >= l.x && this.x <= l.x + l.width) {
      this.y = l.y
      this.z = 0
      this.stand = { ...this.ledge! }
      this.hooks.standing(this.stand.hwnd)
      return this.land(true)
    }

    if (this.z <= 0) {
      this.z = 0
      if (this.vz < -450) {
        this.vz = -this.vz * this.bounce
        this.vx *= 0.8
        this.vy *= 0.8
        this.squashT = 0.22
        return
      }
      this.vz = 0
      if (this.activity === 'hop') {
        this.vx = this.vy = 0
        this.squashT = 0.18
        this.hopsLeft--
        if (this.hopsLeft > 0) this.hopOnce()
        else this.next()
        return
      }
      const v = Math.hypot(this.vx, this.vy)
      const nv = Math.max(0, v - FRICTION * dt)
      if (v > 0) {
        this.vx *= nv / v
        this.vy *= nv / v
      }
      if (nv < 20) this.land(false)
    }
  }

  private land(onWindow: boolean): void {
    this.vx = this.vy = this.vz = 0
    this.squashT = 0.25
    this.bounce = 0.35
    if (this.afterLand === 'hurt') {
      this.afterLand = null
      this.flashT = Math.max(this.flashT, 0.3)
      return this.set('hurt', 1.1)
    }
    if (this.pendingFeed) return this.next()
    if (this.stage === 'starving' && !onWindow) return this.set('starving', rand(20, 50))
    this.set('idle', rand(0.6, 1.6))
  }

  /** Bounce off the edges of the movement area (unless another monitor is there). */
  private bounceOffEdges(k: number): void {
    const a = this.area()
    if (this.x < a.x0 && !this.world.neighbor(-1)) {
      this.x = a.x0
      this.vx = Math.abs(this.vx) * k
    }
    if (this.x > a.x1 && !this.world.neighbor(1)) {
      this.x = a.x1
      this.vx = -Math.abs(this.vx) * k
    }
    if (this.stand || !this.roam) return
    if (this.y < a.y0) {
      this.y = a.y0
      this.vy = Math.abs(this.vy) * k
    }
    if (this.y > a.y1) {
      this.y = a.y1
      this.vy = -Math.abs(this.vy) * k
    }
  }

  private clampToArea(): void {
    const a = this.area()
    this.x = clamp(this.x, a.x0, a.x1)
    if (this.z <= 0) this.y = clamp(this.y, a.y0, a.y1)
  }

  private drag(dt: number): void {
    const w = this.world
    const nx = clamp(this.cursor.x - this.dragOffset.x, w.left + this.hw * 0.6, w.right - this.hw * 0.6)
    const ny = clamp(this.cursor.y - this.dragOffset.y, w.top + this.size, this.roam ? w.workArea.y + w.workArea.height : w.groundY)
    if (dt > 0) {
      this.vx = this.vx * 0.5 + ((nx - this.x) / dt) * 0.5
      this.vy = this.vy * 0.5 + ((ny - this.y) / dt) * 0.5
    }
    this.x = nx
    this.y = ny
  }

  private checkHandoff(): void {
    const w = this.world
    if (this.x >= w.left && this.x < w.right) return
    const target = w.displayAt(this.x, Math.min(this.y, w.bottom - 1)) ?? w.neighbor(this.x >= w.right ? 1 : -1)
    if (!target || target.id === w.display.id) {
      this.clampToArea()
      return
    }
    this.handedOff = true
    const snap = this.snapshot()
    const wa = target.workArea
    snap.y = this.roam ? clamp(snap.y, wa.y + this.size + 4, wa.y + wa.height - 3) : target.groundY
    this.hooks.handoff(target, snap)
  }

  // --- timers & chatter ---------------------------------------------------------------------
  private tickTimers(dt: number): void {
    this.fxClock += dt
    this.blinkT -= dt
    if (this.blinkT <= 0) {
      this.blinking = 0.14
      this.blinkT = rand(2, 6)
    }
    this.blinking = Math.max(0, this.blinking - dt)
    this.lookAtYou = Math.max(0, this.lookAtYou - dt)
    this.squashT = Math.max(0, this.squashT - dt)
    this.flashT = Math.max(0, this.flashT - dt)
    this.noLandT = Math.max(0, this.noLandT - dt)
    this.curiousCooldown = Math.max(0, this.curiousCooldown - dt)
    this.twitchT -= dt
    if (this.twitchT <= 0) {
      this.twitching = 0.35
      this.twitchT = rand(3, 9)
    }
    this.twitching = Math.max(0, this.twitching - dt)

    if (this.activity === 'sleep' || this.activity === 'dragged' || this.activity === 'eat' || this.hovered) return
    this.nagT -= dt
    if (this.nagT > 0) return
    if (this.stage === 'hungry') {
      this.hooks.say(pickOne(HUNGRY_LINES), 3000)
      this.nagT = rand(45, 90)
    } else if (this.stage === 'starving') {
      this.hooks.say(pickOne(STARVING_LINES), 2500)
      this.nagT = rand(60, 120)
    } else if (this.stage === 'peckish') {
      this.hooks.say(pickOne(PECKISH_LINES), 2500)
      this.nagT = rand(240, 420)
    } else {
      this.nagT = rand(30, 60)
    }
  }

  // --- what to draw ---------------------------------------------------------------------------
  render(): RenderState {
    const hungry = this.stage === 'hungry' || this.stage === 'starving'
    let anim: AnimName = hungry ? 'idle_sad' : 'idle'
    let rate = 1
    let mood: Mood = this.blinking > 0 ? 'blink' : hungry ? 'sad' : 'idle'
    let bob = 0
    let food = 0
    let glow = this.stage === 'full' || this.stage === 'peckish'
    let fixedFrame: number | null = null

    switch (this.activity) {
      case 'walk':
        anim = hungry ? 'walk_sad' : 'walk'
        rate = this.speed('walk') / Math.max(1, this.settings.petSpeed) / (hungry ? 0.7 : 1)
        break
      case 'run':
        anim = 'run'
        break
      case 'crawl':
        anim = 'crawl'
        break
      case 'prejump':
        anim = 'crawl'
        fixedFrame = 0
        mood = 'alert'
        break
      case 'hop':
      case 'air':
        anim = this.vz > 0 ? 'jump_up' : 'jump_down'
        mood = this.activity === 'hop' ? 'happy' : 'alert'
        break
      case 'sit':
        anim = 'sit'
        break
      case 'curious':
        anim = 'curious'
        mood = 'alert'
        break
      case 'sleep':
        anim = 'sleep'
        mood = 'blink'
        break
      case 'eat':
        anim = 'eat'
        mood = 'happy'
        food = Math.max(0.1, 1 - this.t / this.dur)
        glow = true
        break
      case 'happy': {
        anim = 'happy'
        mood = 'happy'
        glow = true
        const k = (this.t % 0.6) / 0.6
        bob = 4 * k * (1 - k) * 6
        break
      }
      case 'hurt':
        anim = 'hurt'
        mood = 'hurt'
        break
      case 'starving':
        anim = 'starving'
        fixedFrame = this.twitching > 0 ? Math.floor(this.clock * 12) % 2 : 0
        mood = Math.sin(this.clock * 0.6) > 0.7 ? 'sad' : 'blink'
        glow = false
        break
      case 'tap':
        anim = 'tap'
        mood = 'sad'
        break
      case 'dragged':
        anim = 'dragged'
        mood = 'alert'
        break
    }
    if ((this.pausedForHover || this.lookAtYou > 0) && this.activity === 'idle') {
      mood = this.blinking > 0 ? 'blink' : hungry ? 'sad' : this.lookAtYou > 0 ? 'alert' : 'idle'
    }

    // Restart the animation when it changes, then pick the frame.
    if (anim !== this.animName) {
      this.animName = anim
      this.animT = 0
    }
    const a = this.sprites.anims[anim]
    const frame = fixedFrame ?? frameAt(a, this.animT * rate)

    // Eyes glance up toward the cursor when it's above Catbot's head.
    const watching = this.pausedForHover || this.following || this.lookAtYou > 0 || this.activity === 'curious'
    const headY = this.y - this.z - this.size * 0.75
    const lookY = watching && this.cursor.y < headY - this.size * 0.3 ? -1 : 0

    return {
      anim,
      frame,
      facing: this.facing,
      z: this.z,
      bob,
      mood,
      lookY,
      glow,
      dim: this.stage === 'starving' ? 0.35 : this.stage === 'hungry' ? 0.15 : 0,
      tint: this.flashT > 0 && Math.floor(this.flashT * 20) % 2 === 0 ? 1 : 0,
      food,
      squash: this.squashT > 0 ? Math.sin((Math.PI * this.squashT) / 0.25) : 0,
      lifted: this.activity === 'dragged'
    }
  }
}
