import type { DisplayInfo, FeedEvent, PetSnapshot, PetStatus, Settings, WindowLedge } from '../../shared/types'
import type { World } from '../world'
import type { ParticleKind } from './particles'
import { animLength, frameAt, type AnimName, type SpriteSet } from './sprites'

export type Activity =
  | 'idle'
  | 'walk'
  | 'run'
  | 'crawl'
  | 'hop'
  | 'sit'
  | 'curious'
  | 'sleep'
  | 'eat'
  | 'happy'
  | 'hurt'
  | 'starving'
  | 'dragged'
  | 'air'

/** Everything the view needs to draw one frame. */
export interface RenderState {
  anim: AnimName
  frame: number
  /** Mirror horizontally (the sheet's poses face right). */
  flip: boolean
  /** Height above the floor point, in DIP (jumps and throws). */
  z: number
  squashX: number
  squashY: number
  /** Rotation in radians around the feet. */
  rot: number
  /** 0..1 red flash. */
  tint: number
  /** 0..1 hunger dimming. */
  dim: number
  /** 0 = no food on screen, else the commit cube's remaining size (0..1). */
  food: number
  /** Being carried: the shadow shrinks. */
  lifted: boolean
}

export interface BrainHooks {
  say(text: string, ms?: number): void
  /** Spawn a particle relative to the pet's feet (DIP). */
  spawn(kind: ParticleKind, x: number, y: number): void
  handoff(target: DisplayInfo, snap: PetSnapshot): void
}

const GRAVITY = 2200 // DIP / s^2, for hops and throws
const FRICTION = 1900 // DIP / s^2, sliding along the floor
const MAX_THROW = 2600

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const chance = (p: number) => Math.random() < p
const pickOne = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

export const RANDOM_LINES = [
  'BEEP BOOP. COMMIT DETECTED?',
  'SMALL COMMITS = HAPPY CIRCUITS.',
  'HAVE YOU TRIED GIT ADD -P?',
  'MERGE CONFLICTS MAKE MY FANS SPIN.',
  'RUNNING TESTS... JUST KIDDING. YOU DO IT.',
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
  'ENTERING POWER SAVING MODE...',
  'EVEN A TYPO FIX WOULD DO.',
  'GIT COMMIT -M "FOOD"?',
  'ERROR 404: SNACK NOT FOUND'
]
const PECKISH_LINES = ['SNACK TIME SOON?', 'ENERGY DIPPING. A COMMIT WOULD BE NICE.', '*TUMMY BEEP*']
const STARVING_LINES = ['...', 'B-BATTERY CRITICAL...', 'C-COMMIT... PLEASE...']
const EAT_LINES = ['NOM.EXE COMPLETE!', 'CHARGING...', 'BYTES DIGESTED!', 'MMM, FRESH CODE.']

type Gait = 'walk' | 'run' | 'crawl'
const GAIT_SPEED: Record<Gait, number> = { walk: 1, run: 2.4, crawl: 0.45 }
const GAIT_ANIM_RATE: Record<Gait, number> = { walk: 1, run: 2, crawl: 0.6 }

/**
 * The catbot's body and mind: free movement across the screen (or along the
 * bottom edge), simple physics for hops and throws, the behaviour state
 * machine, and what to draw each frame. (x, y) is the point on the "floor"
 * under its feet, in global DIP; z is its height above that point.
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
  /** Where the current walk/run/crawl is heading. */
  tx = 0
  ty = 0
  /** The focused app window; a starving catbot crawls over and taps it. */
  ledge: WindowLedge | null = null

  private anim: AnimName = 'idle'
  private animT = 0
  private animRate = 1
  private following = false
  private crossing = false
  private hopsLeft = 0
  private hopV = { x: 0, y: 0 }
  private afterTap = false
  private pendingFeed: FeedEvent | null = null
  private afterLand: 'hurt' | null = null
  private bounce = 0.35
  private handedOff = false
  private clock = 0
  private flashT = 0
  private squashT = 0
  private twitchT = 4
  private twitching = 0
  private nagT = rand(25, 50)
  private followCooldown = 0
  private curiousCooldown = 0
  private fxClock = 0
  private dragOffset = { x: 0, y: 0 }
  private cursor = { x: 0, y: 0 }

  constructor(
    public world: World,
    public settings: Settings,
    public status: PetStatus,
    private sprites: SpriteSet,
    private hooks: BrainHooks
  ) {}

  // --- sizes -------------------------------------------------------------------
  /** Sprite pixels -> DIP. */
  get scale(): number {
    return this.settings.petSize / this.sprites.standHeight
  }
  get h(): number {
    return this.settings.petSize
  }
  get w(): number {
    return this.sprites.standWidth * this.scale
  }
  private get stage() {
    return this.status.stage
  }
  private get roam(): boolean {
    return this.settings.movement === 'roam'
  }

  /** Hit box around the pet in DIP. */
  hitBox(): { left: number; right: number; top: number; bottom: number } {
    const lying = this.activity === 'sleep' || this.activity === 'starving'
    const w = this.w * (lying ? 1.05 : 0.85)
    const h = this.h * (lying ? 0.62 : 0.95)
    const feet = this.y - this.z
    return { left: this.x - w / 2, right: this.x + w / 2, top: feet - h, bottom: feet + 4 }
  }

  /** The area the floor point may move in on this monitor. */
  private area(): { x0: number; x1: number; y0: number; y1: number } {
    const wa = this.world.workArea
    const hw = this.w * 0.5
    const x0 = wa.x + hw
    const x1 = wa.x + wa.width - hw
    if (!this.roam) return { x0, x1, y0: this.world.groundY, y1: this.world.groundY }
    return { x0, x1, y0: wa.y + this.h + 4, y1: wa.y + wa.height - 3 }
  }

  // --- snapshots -------------------------------------------------------------------
  snapshot(): PetSnapshot {
    return {
      x: this.x,
      y: this.y,
      vx: this.vx,
      vy: this.vy,
      facing: this.facing,
      grounded: this.z <= 0,
      brain: {
        activity: this.activity === 'dragged' ? 'air' : this.activity,
        t: this.t,
        dur: this.dur,
        tx: this.tx,
        ty: this.ty,
        z: this.z,
        vz: this.vz,
        following: this.following,
        hopsLeft: this.hopsLeft,
        hopV: this.hopV,
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
      following: boolean
      hopsLeft: number
      hopV: { x: number; y: number }
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
    this.following = b.following ?? false
    this.hopsLeft = b.hopsLeft ?? 0
    this.hopV = b.hopV ?? { x: 0, y: 0 }
    this.pendingFeed = b.pendingFeed ?? null
    this.crossing = false
    this.handedOff = false
    const known: Activity[] = ['idle', 'walk', 'run', 'crawl', 'hop', 'sit', 'curious', 'sleep', 'eat', 'happy', 'hurt', 'starving', 'air']
    this.activity = b.activity && known.includes(b.activity) ? b.activity : 'idle'
    if (this.activity === 'eat') this.activity = 'happy'
    this.playFor(this.activity, false)
    this.clampToArea()
  }

  // --- events from the outside world ---------------------------------------------------
  feed(ev: FeedEvent): void {
    if (this.activity === 'dragged' || this.activity === 'air') this.pendingFeed = ev
    else this.startEat(ev)
  }

  clicked(): void {
    if (this.activity === 'dragged' || this.activity === 'air' || this.activity === 'eat') return
    if (this.activity === 'starving' || this.activity === 'sleep') return
    this.set('curious', 1.6)
  }

  /** The cursor came close after being away. */
  cursorNear(gx: number): void {
    if (this.curiousCooldown > 0 || !['idle', 'walk', 'sit'].includes(this.activity)) return
    this.curiousCooldown = 15
    if (!chance(0.35)) return
    this.facing = gx >= this.x ? 1 : -1
    this.set('curious', 1.6)
  }

  /** The cursor was wiggled near the pet: sometimes chase it for a few seconds. */
  wiggled(gx: number, gy: number): void {
    const busy: Activity[] = ['dragged', 'air', 'hop', 'eat', 'sleep', 'starving', 'happy', 'hurt']
    if (this.followCooldown > 0 || busy.includes(this.activity) || this.stage === 'starving') return
    this.followCooldown = 12
    if (!chance(0.6)) return
    this.cursor = { x: gx, y: gy }
    this.following = true
    this.startMove('run', rand(3, 6))
  }

  setCursor(gx: number, gy: number): void {
    this.cursor.x = gx
    this.cursor.y = gy
  }

  startDrag(grabX: number, grabY: number): void {
    this.dragOffset = { x: grabX - this.x, y: grabY - (this.y - this.z) }
    this.cursor = { x: grabX, y: grabY }
    this.y -= this.z
    this.z = 0
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
    this.bounce = hard ? 0.5 : 0.3
    if (hard) {
      this.flashT = 0.35
      if (chance(0.6)) this.hooks.say(pickOne(['WHEEE!', 'SYSTEM SHAKEN!', 'HEY!']), 1500)
    }
    if (this.roam) {
      // Tossed across the "floor": a little hop plus a slide.
      this.vx = vx * 0.6
      this.vy = vy * 0.6
      this.vz = 260 + Math.min(500, Math.hypot(vx, vy) * 0.15)
    } else {
      // Bottom-edge mode: it falls back down to the taskbar.
      this.z = Math.max(0, this.world.groundY - this.y)
      this.y = this.world.groundY
      this.vx = vx * 0.7
      this.vy = 0
      this.vz = -vy * 0.7
    }
    this.set('air', 0)
  }

  // --- main update -------------------------------------------------------------------
  update(dt: number): void {
    if (this.handedOff) return
    this.clock += dt
    this.t += dt
    this.animT += dt * this.animRate
    this.tickTimers(dt)

    switch (this.activity) {
      case 'idle':
      case 'sit':
      case 'curious':
      case 'happy':
      case 'hurt':
        this.slide(dt)
        if (this.activity === 'happy') this.everyFx(0.35, () => this.hooks.spawn('heart', this.facing * this.w * 0.15 + rand(-6, 6), -this.h * 0.95))
        if (this.t > this.dur) {
          if (this.afterTap) {
            this.afterTap = false
            this.set('starving', rand(25, 60))
          } else this.next()
        }
        break
      case 'walk':
      case 'run':
      case 'crawl': {
        if (this.following) {
          this.tx = this.cursor.x
          this.ty = this.roam ? this.cursor.y + this.h * 0.5 : this.world.groundY
        }
        const gait = this.activity
        const arrived = this.moveToward(this.tx, this.ty, this.speed(gait), dt)
        if (this.handedOff) return
        if (this.following) {
          if (this.t > this.dur) this.next()
        } else if (arrived) {
          if (this.afterTap) this.set('curious', 2.4)
          else this.next()
        } else if (this.t > 25) this.next()
        break
      }
      case 'hop':
        this.hop(dt)
        break
      case 'sleep':
        this.slide(dt)
        if (!this.status.quiet && this.t > this.dur) this.next()
        break
      case 'eat':
        this.everyFx(0.24, () => {
          for (let i = 0; i < 2; i++) this.hooks.spawn('crumb', this.facing * this.w * 0.55, -2)
        })
        if (this.t > this.dur) {
          this.set('happy', 1.8)
        }
        break
      case 'starving':
        this.slide(dt)
        if (this.stage !== 'starving') this.next()
        else if (this.t > this.dur) this.tryTapWindow()
        break
      case 'dragged':
        this.drag(dt)
        break
      case 'air':
        this.physics(dt)
        break
    }

    if (this.activity !== 'dragged') this.checkHandoff()
  }

  // --- behaviour selection -------------------------------------------------------------
  private set(a: Activity, dur: number): void {
    this.activity = a
    this.t = 0
    this.dur = dur
    if (a !== 'walk' && a !== 'run' && a !== 'crawl') this.following = false
    this.playFor(a, true)
  }

  /** Pick the animation that goes with an activity. */
  private playFor(a: Activity, restart: boolean): void {
    const anim: Record<Activity, AnimName> = {
      idle: 'idle',
      walk: 'walk-right',
      run: 'walk-right',
      crawl: 'walk-right',
      hop: 'jump',
      sit: 'sit',
      curious: 'curious',
      sleep: 'sleep',
      eat: 'sit',
      happy: 'happy',
      hurt: 'hurt',
      starving: 'sleep',
      dragged: 'jump',
      air: 'jump'
    }
    let name = anim[a]
    if (name === 'walk-right' && this.facing < 0) name = 'walk-left'
    if (restart || name !== this.anim) this.animT = 0
    this.anim = name
    this.animRate = a === 'run' || a === 'crawl' ? GAIT_ANIM_RATE[a] : 1
  }

  private next(): void {
    this.afterTap = false
    if (this.pendingFeed) {
      const ev = this.pendingFeed
      this.pendingFeed = null
      return this.startEat(ev)
    }
    if (this.status.quiet) return this.set('sleep', 30)
    if (this.stage === 'starving') return this.set('starving', rand(20, 50))

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
              ['idle', 24],
              ['walk', 34],
              ['run', 6],
              ['crawl', 10],
              ['hop', 5],
              ['sit', 15],
              ['curious', 6]
            ]
          : [
              ['idle', 20],
              ['walk', 30],
              ['run', 12],
              ['crawl', 8],
              ['hop', 9],
              ['sit', 10],
              ['curious', 5],
              ['nap', 6]
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
        return this.startHop()
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

  private startMove(gait: Gait, dur = 0): void {
    if (!this.following) this.pickTarget()
    this.set(gait, dur)
  }

  /** A random spot to wander to: nearby, anywhere on this monitor, or on the next one. */
  private pickTarget(): void {
    const a = this.area()
    this.crossing = false
    const dir: 1 | -1 = chance(0.5) ? 1 : -1
    const neighbor = this.world.neighbor(dir)
    if (neighbor && chance(0.12)) {
      const wa = neighbor.workArea
      this.crossing = true
      this.tx = dir > 0 ? wa.x + rand(0.1, 0.5) * wa.width : wa.x + rand(0.5, 0.9) * wa.width
      this.ty = this.roam ? clamp(this.y, Math.max(a.y0, wa.y + this.h + 4), Math.min(a.y1, wa.y + wa.height - 3)) : neighbor.groundY
      return
    }
    if (!this.roam || chance(0.65)) {
      // Somewhere nearby.
      const ang = Math.random() * Math.PI * 2
      const dist = rand(80, 420)
      this.tx = clamp(this.x + Math.cos(ang) * dist, a.x0, a.x1)
      this.ty = clamp(this.y + Math.sin(ang) * dist * 0.7, a.y0, a.y1)
      if (Math.hypot(this.tx - this.x, this.ty - this.y) < 40) {
        this.tx = clamp(this.x - Math.cos(ang) * dist, a.x0, a.x1)
      }
    } else {
      // Anywhere on this monitor.
      this.tx = rand(a.x0, a.x1)
      this.ty = rand(a.y0, a.y1)
    }
  }

  private startHop(): void {
    const a = this.area()
    this.hopsLeft = 1 + Math.floor(Math.random() * 3)
    let dir: 1 | -1 = chance(0.5) ? 1 : -1
    const reach = this.h * 1.1
    if (this.x + dir * reach * this.hopsLeft > a.x1 || this.x + dir * reach * this.hopsLeft < a.x0) dir = (-dir) as 1 | -1
    this.facing = dir
    const len = animLength(this.sprites.anims.jump)
    this.hopV = { x: (dir * reach) / len, y: this.roam ? (rand(-0.35, 0.35) * reach) / len : 0 }
    this.set('hop', 0)
  }

  private startEat(ev: FeedEvent): void {
    this.z = 0
    this.vx = this.vy = this.vz = 0
    this.set('eat', 2.6)
    const what = ev.debug ? 'NOM.EXE (DEBUG SNACK)' : `${pickOne(EAT_LINES)} +${ev.commits} COMMIT${ev.commits === 1 ? '' : 'S'}`
    this.hooks.say(what, 2600)
  }

  /** Starving: get up, crawl over to the focused window's edge and tap on it. */
  private tryTapWindow(): void {
    const l = this.ledge
    const a = this.area()
    if (!l) return this.set('starving', rand(25, 60))
    const edges = [l.x - this.w * 0.4, l.x + l.width + this.w * 0.4].filter((x) => x > a.x0 && x < a.x1)
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
    const followMul = this.following ? 0.85 : 1
    return this.settings.petSpeed * stageMul * GAIT_SPEED[gait] * followMul
  }

  /** Walk in a straight line toward (tx, ty). Returns true on arrival. */
  private moveToward(tx: number, ty: number, speed: number, dt: number): boolean {
    const dx = tx - this.x
    const dy = ty - this.y
    const d = Math.hypot(dx, dy)
    if (d < 3) {
      if (this.anim.startsWith('walk')) this.playFor('idle', false)
      return true
    }
    if (Math.abs(dx) > 4) {
      const f: 1 | -1 = dx > 0 ? 1 : -1
      if (f !== this.facing) {
        this.facing = f
        this.playFor(this.activity, false)
      }
    }
    if (!this.anim.startsWith('walk')) this.playFor(this.activity, false)
    const step = Math.min(d, speed * dt)
    this.x += (dx / d) * step
    this.y += (dy / d) * step
    if (!this.crossing) this.clampToArea()
    return false
  }

  private hop(dt: number): void {
    const jump = this.sprites.anims.jump
    const frame = frameAt(jump, this.animT)
    // Only travel while airborne (frames 1-3 of the 5-frame jump).
    if (frame >= 1 && frame <= 3) {
      this.x += this.hopV.x * dt * (5 / 3)
      this.y += this.hopV.y * dt * (5 / 3)
      this.clampToArea()
    }
    if (this.animT >= animLength(jump)) {
      this.hopsLeft--
      if (this.hopsLeft > 0) this.animT = 0
      else {
        this.squashT = 0.18
        this.next()
      }
    }
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
    this.y += this.vy * dt
    this.bounceOffEdges(0.4)
  }

  private physics(dt: number): void {
    this.x += this.vx * dt
    if (this.roam) this.y += this.vy * dt
    this.vz -= GRAVITY * dt
    this.z += this.vz * dt
    this.bounceOffEdges(0.6)
    // Don't fly off the top of the screen.
    const ceiling = this.world.top + this.h
    if (this.y - this.z < ceiling) {
      this.z = this.y - ceiling
      this.vz = -Math.abs(this.vz) * 0.4
    }

    if (this.z <= 0) {
      this.z = 0
      if (this.vz < -420) {
        this.vz = -this.vz * this.bounce
        this.vx *= 0.8
        this.vy *= 0.8
        this.squashT = 0.2
        return
      }
      this.vz = 0
      const v = Math.hypot(this.vx, this.vy)
      const nv = Math.max(0, v - FRICTION * dt)
      if (v > 0) {
        this.vx *= nv / v
        this.vy *= nv / v
      }
      if (nv < 20) this.land()
    }
  }

  private land(): void {
    this.vx = this.vy = this.vz = 0
    this.z = 0
    this.squashT = 0.25
    this.bounce = 0.3
    if (this.afterLand === 'hurt') {
      this.afterLand = null
      this.flashT = Math.max(this.flashT, 0.3)
      return this.set('hurt', 1.1)
    }
    if (this.pendingFeed) return this.next()
    if (this.stage === 'starving') return this.set('starving', rand(20, 50))
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
    this.y = clamp(this.y, a.y0, a.y1)
  }

  private drag(dt: number): void {
    const w = this.world
    const nx = clamp(this.cursor.x - this.dragOffset.x, w.left + this.w * 0.4, w.right - this.w * 0.4)
    const ny = clamp(this.cursor.y - this.dragOffset.y, w.top + this.h, this.roam ? w.workArea.y + w.workArea.height : w.groundY)
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
    snap.y = this.roam ? clamp(snap.y, wa.y + this.h + 4, wa.y + wa.height - 3) : target.groundY
    this.hooks.handoff(target, snap)
  }

  // --- timers & chatter --------------------------------------------------------------------
  private everyFx(interval: number, fn: () => void): void {
    if (this.fxClock >= interval) {
      this.fxClock = 0
      fn()
    }
  }

  private tickTimers(dt: number): void {
    this.fxClock += dt
    this.flashT = Math.max(0, this.flashT - dt)
    this.squashT = Math.max(0, this.squashT - dt)
    this.followCooldown = Math.max(0, this.followCooldown - dt)
    this.curiousCooldown = Math.max(0, this.curiousCooldown - dt)
    this.twitchT -= dt
    if (this.twitchT <= 0) {
      this.twitching = 0.4
      this.twitchT = rand(3, 9)
    }
    this.twitching = Math.max(0, this.twitching - dt)

    if (this.activity === 'sleep' || this.activity === 'dragged' || this.activity === 'eat') return
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

  // --- what to draw --------------------------------------------------------------------------
  render(): RenderState {
    const anims = this.sprites.anims
    let anim = this.anim
    let frame = frameAt(anims[anim], this.animT)
    let rot = 0
    let squashX = 1
    let squashY = 1
    let food = 0

    switch (this.activity) {
      case 'crawl':
        // Sneaking: low and stretched.
        squashY = 0.8
        squashX = 1.12
        break
      case 'eat': {
        const chomp = Math.abs(Math.sin(this.t * 13))
        squashY = 1 - 0.05 * chomp
        food = Math.max(0.1, 1 - this.t / this.dur)
        break
      }
      case 'starving':
        // Lying flat with its screen dimmed; the odd twitch.
        anim = 'sleep'
        frame = 1
        if (this.twitching > 0) rot = Math.sin(this.clock * 45) * 0.06
        break
      case 'dragged':
        anim = 'jump'
        frame = 2
        rot = clamp(-this.vx * 0.0005, -0.5, 0.5) + Math.sin(this.clock * 6) * 0.05
        break
      case 'air':
        anim = 'jump'
        frame = this.vz > 0 ? 2 : 3
        break
    }
    if (this.squashT > 0) {
      const k = Math.sin((Math.PI * this.squashT) / 0.25) * 0.22
      squashY *= 1 - k
      squashX *= 1 + k * 0.7
    }

    const flip = anim === 'walk-right' || anim === 'walk-left' ? false : this.facing < 0
    const dim = this.stage === 'starving' ? 0.45 : this.stage === 'hungry' ? 0.22 : 0
    return {
      anim,
      frame,
      flip,
      z: this.z,
      squashX,
      squashY,
      rot,
      tint: this.flashT > 0 && Math.floor(this.flashT * 20) % 2 === 0 ? 1 : 0,
      dim,
      food,
      lifted: this.activity === 'dragged'
    }
  }
}
