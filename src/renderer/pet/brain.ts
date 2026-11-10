import type { DisplayInfo, FeedEvent, PetSnapshot, PetStatus, Settings, WindowLedge } from '../../shared/types'
import type { World } from '../world'
import type { ParticleKind } from './particles'
import { neutralPose, type Pose } from './pose'

export type Activity =
  | 'idle'
  | 'walk'
  | 'follow'
  | 'prejump'
  | 'air'
  | 'dragged'
  | 'eat'
  | 'happy'
  | 'sleep'
  | 'starving'
  | 'crawl'
  | 'tap'

export interface BrainHooks {
  say(text: string, ms?: number): void
  /** Spawn a particle at (x, y) in model units relative to the pet's feet. */
  spawn(kind: ParticleKind, x: number, y: number): void
  /** The pet started (hwnd) or stopped (0) standing on a window. */
  standing(hwnd: number): void
  handoff(target: DisplayInfo, snap: PetSnapshot): void
}

type Surface = { kind: 'ground' } | { kind: 'ledge'; ledge: WindowLedge } | null

const GRAVITY = 2400 // DIP / s^2
const MAX_THROW = 3000

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const chance = (p: number) => Math.random() < p
const pickOne = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

export const RANDOM_LINES = [
  'SHIP IT!',
  'SMALL COMMITS, HAPPY GREMLIN.',
  'HAVE YOU TRIED GIT ADD -P?',
  'MERGE CONFLICTS GIVE ME A TUMMY ACHE.',
  'ONE MORE TEST, THEN COMMIT?',
  "I'M 40% MOSS.",
  'BEEP BOOP. COMMIT.',
  'YOUR DIFFS SMELL DELICIOUS.',
  'I DREAM IN GREEN SQUARES.',
  'REMEMBER TO HYDRATE. ALSO COMMIT.',
  'WIP COMMITS ARE STILL FOOD.'
]
const HUNGRY_LINES = [
  'FEED ME COMMITS...',
  '*SIGH*',
  'SO... HUNGRY...',
  'EVEN A TYPO FIX WOULD DO.',
  'MY ANTENNA IS DIMMING...',
  'GIT COMMIT -M "FOOD"?'
]
const PECKISH_LINES = ['SNACK TIME SOON?', 'A SMALL COMMIT WOULD BE NICE.', '*TUMMY RUMBLE*']
const STARVING_LINES = ['...', 'C-COMMIT... PLEASE...', 'SO... WEAK...']
const EAT_LINES = ['NOM NOM!', 'CRUNCHY COMMIT!', 'DELICIOUS DIFF!', 'MMM, FRESH CODE.']

/**
 * The pet's body and mind: physics (gravity, bounce, friction), the behaviour
 * state machine, and the target pose for the model each frame. Positions are
 * global DIP with (x, y) at the middle of the pet's feet.
 */
export class PetBrain {
  x = 0
  y = 0
  vx = 0
  vy = 0
  facing: 1 | -1 = 1
  surface: Surface = { kind: 'ground' }
  activity: Activity = 'idle'
  /** Seconds spent in the current activity, and how long it should last. */
  t = 0
  dur = 2
  walkTarget = 0
  speedMul = 1
  /** The focused window (if any) the pet may hop onto. */
  ledge: WindowLedge | null = null
  readonly target: Pose = neutralPose()

  private pendingFeed: FeedEvent | null = null
  private handedOff = false
  private clock = 0
  private blinkT = 3
  private blinking = 0
  private lookT = 0
  private lookYaw = 0
  private lookAtCamera = 0
  private squashT = 0
  private flashT = 0
  private sighT = 0
  private nagT = rand(25, 50)
  private twitchT = 4
  private twitching = 0
  private followCooldown = 0
  private bounce = 0.35
  private jump: { vx: number; vy: number } | null = null
  private dragOffset = { x: 0, y: 0 }
  private cursor = { x: 0, y: 0 }
  private walkPhase = 0
  private fxClock = 0

  constructor(
    public world: World,
    public settings: Settings,
    public status: PetStatus,
    private hooks: BrainHooks
  ) {}

  // --- sizes -----------------------------------------------------------------
  get size(): number {
    return this.settings.petSize
  }
  get hw(): number {
    return this.size * 0.5
  }
  get grounded(): boolean {
    return this.surface !== null
  }
  private get stage() {
    return this.status.stage
  }

  /** Hit box around the feet position, in DIP. */
  hitBox(): { left: number; right: number; top: number; bottom: number } {
    const lying = this.activity === 'starving' || this.activity === 'sleep'
    const hw = this.size * (lying ? 0.62 : 0.55)
    const h = this.size * (lying ? 0.62 : 1.0)
    return { left: this.x - hw, right: this.x + hw, top: this.y - h, bottom: this.y + 4 }
  }

  // --- snapshots ---------------------------------------------------------------
  snapshot(): PetSnapshot {
    return {
      x: this.x,
      y: this.y,
      vx: this.vx,
      vy: this.vy,
      facing: this.facing,
      grounded: this.surface?.kind === 'ground',
      brain: {
        activity: this.activity === 'dragged' ? 'air' : this.activity,
        t: this.t,
        dur: this.dur,
        walkTarget: this.walkTarget,
        speedMul: this.speedMul,
        pendingFeed: this.pendingFeed
      }
    }
  }

  restore(s: PetSnapshot): void {
    this.x = s.x
    this.y = s.y
    this.vx = s.vx
    this.vy = s.vy
    this.facing = s.facing
    this.surface = s.grounded ? { kind: 'ground' } : null
    const b = (s.brain ?? {}) as Partial<{
      activity: Activity
      t: number
      dur: number
      walkTarget: number
      speedMul: number
      pendingFeed: FeedEvent | null
    }>
    this.activity = b.activity ?? (s.grounded ? 'idle' : 'air')
    if (!s.grounded) this.activity = 'air'
    else if (this.activity === 'air' || this.activity === 'prejump') this.activity = 'idle'
    this.t = b.t ?? 0
    this.dur = b.dur ?? 2
    this.walkTarget = b.walkTarget ?? s.x
    this.speedMul = b.speedMul ?? 1
    this.pendingFeed = b.pendingFeed ?? null
    this.handedOff = false
    if (this.grounded) this.y = this.world.groundY
    this.y = Math.min(this.y, this.world.groundY)
  }

  // --- external events -------------------------------------------------------------
  feed(ev: FeedEvent): void {
    if (this.grounded && this.activity !== 'dragged') this.startEat(ev)
    else this.pendingFeed = ev
  }

  clicked(): void {
    this.lookAtCamera = 2
    this.blinking = 0
  }

  wiggled(cursorX: number): void {
    const busy: Activity[] = ['dragged', 'air', 'prejump', 'eat', 'sleep', 'starving', 'crawl', 'tap', 'happy']
    if (this.followCooldown > 0 || busy.includes(this.activity) || !this.grounded) return
    this.followCooldown = 12
    if (!chance(0.6)) return
    this.cursor.x = cursorX
    this.set('follow', rand(3, 6))
  }

  setCursor(gx: number, gy: number): void {
    this.cursor.x = gx
    this.cursor.y = gy
  }

  startDrag(grabX: number, grabY: number): void {
    if (this.surface?.kind === 'ledge') this.hooks.standing(0)
    this.surface = null
    this.dragOffset = { x: grabX - this.x, y: grabY - this.y }
    this.cursor = { x: grabX, y: grabY }
    this.vx = this.vy = 0
    this.jump = null
    this.set('dragged', 0)
  }

  release(): void {
    if (this.activity !== 'dragged') return
    this.vx = clamp(this.vx, -MAX_THROW, MAX_THROW)
    this.vy = clamp(this.vy, -MAX_THROW, MAX_THROW)
    const speed = Math.hypot(this.vx, this.vy)
    if (speed > 1500) {
      // Flicked hard: cosmetic red flash and a bouncier landing.
      this.flashT = 0.35
      this.bounce = 0.55
      if (chance(0.5)) this.hooks.say(pickOne(['HEY!', 'WHEEE!', 'OOF!']), 1500)
    } else {
      this.bounce = 0.35
    }
    this.set('air', 0)
  }

  /** The window the pet is standing on moved, closed or was minimised. */
  standingLost(hwnd: number): void {
    if (this.surface?.kind === 'ledge' && this.surface.ledge.hwnd === hwnd) this.fall()
  }

  // --- main update -------------------------------------------------------------------
  update(dt: number): void {
    if (this.handedOff) return
    this.clock += dt
    this.t += dt
    this.tickTimers(dt)

    switch (this.activity) {
      case 'idle':
        this.slide(dt)
        if (this.t > this.dur) this.next()
        break
      case 'walk':
      case 'follow':
      case 'crawl': {
        const target = this.activity === 'follow' ? this.cursor.x : this.walkTarget
        const arrived = this.moveToward(target, dt)
        if (this.handedOff) return
        if (this.activity === 'crawl' && arrived) this.set('tap', 3.2)
        else if (this.activity === 'walk' && (arrived || this.t > 14)) this.next()
        else if (this.activity === 'follow' && this.t > this.dur) this.next()
        break
      }
      case 'prejump':
        if (this.t > 0.28 && this.jump) {
          if (this.surface?.kind === 'ledge') this.hooks.standing(0)
          this.surface = null
          this.vx = this.jump.vx
          this.vy = this.jump.vy
          this.jump = null
          this.set('air', 0)
        }
        break
      case 'air':
        this.physics(dt)
        break
      case 'dragged':
        this.drag(dt)
        break
      case 'eat':
        if (this.t > this.dur) {
          this.set('happy', 1.8)
        }
        break
      case 'happy':
        if (this.t > this.dur) this.next()
        break
      case 'sleep':
        this.slide(dt)
        if (!this.status.quiet && this.t > this.dur) this.next()
        break
      case 'starving':
        this.slide(dt)
        if (this.stage !== 'starving') this.next()
        else if (this.t > this.dur) this.tryTapWindow()
        break
      case 'tap':
        if (this.t > this.dur) this.set('starving', rand(25, 60))
        break
    }

    // Anything (other than dragging) that crosses into a neighbouring monitor moves there.
    if (this.activity !== 'dragged') this.checkHandoff()
    this.animate(dt)
  }

  // --- behaviour selection ---------------------------------------------------------
  private set(a: Activity, dur: number): void {
    this.activity = a
    this.t = 0
    this.dur = dur
  }

  private next(): void {
    if (!this.grounded) return this.set('air', 0)
    if (this.pendingFeed) {
      const ev = this.pendingFeed
      this.pendingFeed = null
      return this.startEat(ev)
    }
    if (this.status.quiet) return this.set('sleep', 30)
    if (this.stage === 'starving') {
      if (this.surface?.kind === 'ledge') return this.walkOff()
      return this.set('starving', rand(20, 50))
    }

    const hungry = this.stage === 'hungry'
    const r = Math.random()
    if (this.surface?.kind === 'ledge') {
      if (r < 0.4) return this.set('idle', rand(2, 6))
      if (r < 0.85) return this.startWalk()
      return this.walkOff()
    }
    if (r < 0.4) return this.set('idle', rand(2, 6))
    if (r < 0.82) return this.startWalk()
    if (r < 0.94 && !hungry && this.startHop()) return
    if (!hungry && this.stage === 'full' && chance(0.5)) return this.set('sleep', rand(10, 25))
    return this.set('idle', rand(1, 3))
  }

  private startWalk(dir?: 1 | -1): void {
    const [a, b] = this.walkBounds()
    const d = dir ?? (chance(0.5) ? 1 : -1)
    let target = clamp(this.x + d * rand(80, 360), a, b)
    if (Math.abs(target - this.x) < 30) target = clamp(this.x - d * rand(80, 360), a, b)
    this.walkTarget = target
    this.speedMul = 1
    this.set('walk', 0)
  }

  private walkOff(): void {
    if (this.surface?.kind !== 'ledge') return this.startWalk()
    const l = this.surface.ledge
    const left = this.x - l.x < l.x + l.width - this.x
    this.walkTarget = left ? l.x - this.hw : l.x + l.width + this.hw
    this.speedMul = 1
    this.set('walk', 0)
  }

  private startEat(ev: FeedEvent): void {
    this.set('eat', 2.8)
    this.jump = null
    const what = ev.debug ? 'NOM! (DEBUG SNACK)' : `${pickOne(EAT_LINES)} +${ev.commits} COMMIT${ev.commits === 1 ? '' : 'S'}`
    this.hooks.say(what, 2600)
  }

  /** Jump onto the top edge of the focused window. */
  private startHop(): boolean {
    const l = this.usableLedge()
    if (!l || this.surface?.kind !== 'ground') return false
    const tx = clamp(this.x + this.facing * rand(40, 180), l.x + this.hw, l.x + l.width - this.hw)
    const up = this.y - l.y + 40
    if (up < 60 || up > 1100) return false
    const vy = -Math.sqrt(2 * GRAVITY * up)
    const flight = -vy / GRAVITY + Math.sqrt((2 * 40) / GRAVITY)
    const vx = (tx - this.x) / flight
    if (Math.abs(vx) > 1400) return false
    this.facing = vx >= 0 ? 1 : -1
    this.jump = { vx, vy }
    this.set('prejump', 0.28)
    return true
  }

  /** Starving: get up, crawl to the focused window's edge and tap it. */
  private tryTapWindow(): void {
    const l = this.ledge
    if (!l || this.surface?.kind !== 'ground') return this.set('starving', rand(25, 60))
    const edges = [
      { x: l.x, side: -1 as const },
      { x: l.x + l.width, side: 1 as const }
    ].filter((e) => e.x > this.world.left + this.hw && e.x < this.world.right - this.hw)
    if (!edges.length) return this.set('starving', rand(25, 60))
    edges.sort((a, b) => Math.abs(a.x - this.x) - Math.abs(b.x - this.x))
    const e = edges[0]
    this.walkTarget = e.x + e.side * this.hw * 0.9
    this.speedMul = 1
    this.set('crawl', 0)
    if (chance(0.5)) this.hooks.say(pickOne(['FOOD...?', '*TAP TAP*', 'ANYONE CODING?']), 2500)
  }

  private walkBounds(): [number, number] {
    if (this.surface?.kind === 'ledge') {
      const l = this.surface.ledge
      return [Math.max(l.x, this.world.left) + this.hw * 0.5, Math.min(l.x + l.width, this.world.right) - this.hw * 0.5]
    }
    const left = this.world.neighbor(-1) ? -Infinity : this.world.left + this.hw
    const right = this.world.neighbor(1) ? Infinity : this.world.right - this.hw
    return [left, right]
  }

  /** The focused window's top edge, clipped to this monitor, if the pet can stand on it. */
  private usableLedge(): WindowLedge | null {
    const l = this.ledge
    if (!l) return null
    const x0 = Math.max(l.x, this.world.left)
    const x1 = Math.min(l.x + l.width, this.world.right)
    if (x1 - x0 < this.size * 2) return null
    if (l.y < this.world.top + this.size * 1.3 || l.y > this.world.groundY - this.size * 0.9) return null
    return { ...l, x: x0, width: x1 - x0 }
  }

  // --- movement & physics -------------------------------------------------------------
  private speed(): number {
    const stageMul = this.stage === 'hungry' ? 0.5 : this.stage === 'starving' ? 0.3 : 1
    const actMul = this.activity === 'follow' ? 1.5 : this.activity === 'crawl' ? 0.35 : 1
    return this.settings.petSpeed * stageMul * actMul * this.speedMul
  }

  /** Walk along the current surface. Returns true on arrival. */
  private moveToward(tx: number, dt: number): boolean {
    const dx = tx - this.x
    if (Math.abs(dx) < 3) {
      this.vx = 0
      return true
    }
    this.facing = dx > 0 ? 1 : -1
    const step = Math.min(Math.abs(dx), this.speed() * dt)
    this.x += this.facing * step
    this.vx = 0

    if (this.surface?.kind === 'ledge') {
      const l = this.surface.ledge
      const x0 = Math.max(l.x, this.world.left)
      const x1 = Math.min(l.x + l.width, this.world.right)
      if (this.x < x0 || this.x > x1) {
        // Walked off the edge of the window.
        this.vx = this.facing * this.speed()
        this.fall()
        return false
      }
      this.y = l.y
    } else if (this.surface?.kind === 'ground') {
      this.y = this.world.groundY
      const [a, b] = this.walkBounds()
      if (this.x <= a || this.x >= b) {
        this.x = clamp(this.x, a, b)
        return true
      }
    }
    return false
  }

  /** Residual sliding after a throw, with friction. */
  private slide(dt: number): void {
    if (!this.grounded || Math.abs(this.vx) < 1) {
      this.vx = 0
      return
    }
    const decel = 1600 * dt
    this.vx = Math.abs(this.vx) <= decel ? 0 : this.vx - Math.sign(this.vx) * decel
    this.x += this.vx * dt
    const [a, b] = this.walkBounds()
    if (this.surface?.kind === 'ledge' && (this.x < a - this.hw * 0.5 || this.x > b + this.hw * 0.5)) return this.fall()
    if (this.x < a || this.x > b) {
      this.x = clamp(this.x, a, b)
      this.vx = -this.vx * 0.3
    }
  }

  private fall(): void {
    if (this.surface?.kind === 'ledge') this.hooks.standing(0)
    this.surface = null
    this.vy = Math.min(this.vy, 0)
    this.set('air', 0)
  }

  private physics(dt: number): void {
    const prevY = this.y
    this.vy += GRAVITY * dt
    this.x += this.vx * dt
    this.y += this.vy * dt
    const w = this.world
    const hw = this.hw * 0.8

    if (!w.neighbor(-1) && this.x - hw < w.left) {
      this.x = w.left + hw
      this.vx = Math.abs(this.vx) * 0.5
    }
    if (!w.neighbor(1) && this.x + hw > w.right) {
      this.x = w.right - hw
      this.vx = -Math.abs(this.vx) * 0.5
    }
    if (this.y - this.size < w.top) {
      this.y = w.top + this.size
      this.vy = Math.abs(this.vy) * 0.4
    }

    const l = this.usableLedge()
    if (l && this.vy > 0 && prevY <= l.y + 1 && this.y >= l.y && this.x >= l.x && this.x <= l.x + l.width) {
      this.y = l.y
      return this.land({ kind: 'ledge', ledge: { ...this.ledge! } })
    }

    if (this.y >= w.groundY) {
      this.y = w.groundY
      if (this.vy > 450) {
        this.vy = -this.vy * this.bounce
        this.vx *= 0.75
        this.squashT = 0.22
      } else {
        this.land({ kind: 'ground' })
      }
    }
  }

  private land(surface: Surface): void {
    this.surface = surface
    this.vy = 0
    this.squashT = 0.25
    this.bounce = 0.35
    if (surface?.kind === 'ledge') {
      this.vx = 0
      this.hooks.standing(surface.ledge.hwnd)
    }
    if (this.pendingFeed) return this.next()
    if (this.stage === 'starving' && surface?.kind === 'ground') return this.set('starving', rand(20, 50))
    this.set('idle', rand(0.6, 1.6))
  }

  private drag(dt: number): void {
    const w = this.world
    const nx = clamp(this.cursor.x - this.dragOffset.x, w.left + this.hw * 0.5, w.right - this.hw * 0.5)
    const ny = clamp(this.cursor.y - this.dragOffset.y, w.top + this.size, w.groundY)
    if (dt > 0) {
      this.vx = this.vx * 0.5 + ((nx - this.x) / dt) * 0.5
      this.vy = this.vy * 0.5 + ((ny - this.y) / dt) * 0.5
    }
    this.x = nx
    this.y = ny
  }

  private checkHandoff(): void {
    const w = this.world
    if (this.surface?.kind === 'ledge') return
    const right = w.neighbor(1)
    const left = w.neighbor(-1)
    const target = this.x >= w.right && right ? right : this.x < w.left && left ? left : null
    if (!target) return
    this.handedOff = true
    const snap = this.snapshot()
    if (snap.grounded) snap.y = target.groundY
    else snap.y = clamp(snap.y, target.bounds.y + this.size, target.groundY)
    this.hooks.handoff(target, snap)
  }

  // --- timers & chatter ---------------------------------------------------------------
  private tickTimers(dt: number): void {
    this.blinkT -= dt
    if (this.blinkT <= 0) {
      this.blinking = 0.14
      this.blinkT = rand(2, 6)
    }
    this.blinking = Math.max(0, this.blinking - dt)
    this.lookT -= dt
    if (this.lookT <= 0) {
      this.lookYaw = chance(0.4) ? 0 : rand(-0.6, 0.5)
      this.lookT = rand(1, 3.5)
    }
    this.lookAtCamera = Math.max(0, this.lookAtCamera - dt)
    this.squashT = Math.max(0, this.squashT - dt)
    this.flashT = Math.max(0, this.flashT - dt)
    this.sighT = Math.max(0, this.sighT - dt)
    this.followCooldown = Math.max(0, this.followCooldown - dt)
    this.twitchT -= dt
    if (this.twitchT <= 0) {
      this.twitching = 0.35
      this.twitchT = rand(3, 9)
    }
    this.twitching = Math.max(0, this.twitching - dt)

    // Stage-dependent grumbling.
    if (this.activity === 'sleep' || this.activity === 'dragged' || this.activity === 'eat') return
    this.nagT -= dt
    if (this.nagT > 0) return
    if (this.stage === 'hungry') {
      const line = pickOne(HUNGRY_LINES)
      this.hooks.say(line, 3000)
      if (line === '*SIGH*' || chance(0.4)) this.sighT = 1.4
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
    // Starving pets also lie down right away if they were up and about.
  }

  // --- animation -------------------------------------------------------------------------
  private animate(dt: number): void {
    const p = this.target
    const f = this.facing
    const hungry = this.stage === 'hungry' || this.stage === 'starving'
    const clock = this.clock

    p.yaw = f > 0 ? -0.55 : Math.PI + 0.55
    p.bodyY = 0
    p.bodyPitch = 0
    p.roll = 0
    p.squash = 1
    p.neckPitch = hungry ? -0.35 : 0
    p.neckYaw = 0
    p.legs = [0, 0, 0, 0]
    p.antenna = hungry ? -0.55 + Math.sin(clock * 1.5) * 0.04 : Math.sin(clock * 2.1) * 0.1
    p.tip = hungry ? -0.3 : Math.sin(clock * 2.7) * 0.15
    p.eyes = this.blinking > 0 ? 0 : 1
    p.glow = { full: 1, peckish: 0.7, hungry: 0.35, starving: 0 }[this.stage]
    p.tint = this.flashT > 0 && Math.floor(this.flashT * 20) % 2 === 0 ? 1 : 0
    p.food = 0

    this.fxClock += dt
    switch (this.activity) {
      case 'idle':
      case 'follow':
      case 'walk':
      case 'crawl': {
        const moving = this.activity !== 'idle' && Math.abs(this.walkTarget - this.x) > 3
        if (this.activity === 'idle' || (this.activity === 'follow' && Math.abs(this.cursor.x - this.x) < 4)) {
          p.neckYaw = this.lookYaw
          // Idle antenna wiggle every now and then.
          if (Math.sin(clock * 0.9) > 0.85) p.antenna += Math.sin(clock * 18) * 0.25
          break
        }
        if (!moving && this.activity !== 'follow') break
        this.walkPhase += dt * (this.speed() / this.size) * 9
        const amp = hungry ? 0.4 : 0.6
        const s = Math.sin(this.walkPhase) * amp
        p.legs = [s, -s, -s, s]
        p.bodyY = Math.abs(Math.sin(this.walkPhase)) * 0.8
        p.neckPitch += Math.sin(this.walkPhase * 2) * 0.07
        break
      }
      case 'prejump':
        p.squash = 0.78
        p.bodyY = -1
        p.legs = [-0.3, -0.3, 0.3, 0.3]
        p.neckPitch = 0.15
        break
      case 'air': {
        const up = this.vy < 0
        p.legs = up ? [-0.5, -0.5, 0.5, 0.5] : [0.6, 0.6, -0.6, -0.6]
        p.bodyPitch = clamp(-this.vy * 0.00015, -0.25, 0.25)
        p.neckPitch = up ? 0.2 : -0.1
        break
      }
      case 'dragged': {
        const trail = clamp(this.vx * f * 0.0007, -1.1, 1.1)
        for (let i = 0; i < 4; i++) p.legs[i] = -trail + Math.sin(clock * 7 + i * 1.3) * 0.18
        p.bodyPitch = clamp(-this.vx * f * 0.0003, -0.45, 0.45) + Math.sin(clock * 3) * 0.05
        p.neckPitch = -0.15
        p.eyes = 1
        p.antenna = clamp(-this.vx * f * 0.0006, -0.8, 0.8)
        break
      }
      case 'eat': {
        const dip = Math.max(0, Math.sin(this.t * 12))
        p.neckPitch = -0.35 - 0.45 * dip
        p.food = Math.max(0.08, 1 - this.t / this.dur)
        p.glow = 0.6 + 0.4 * dip
        if (this.fxClock > 0.26) {
          this.fxClock = 0
          for (let i = 0; i < 2; i++) this.hooks.spawn('crumb', f * 21, 8)
        }
        break
      }
      case 'happy': {
        const k = (this.t % 0.6) / 0.6
        const hop = 4 * k * (1 - k)
        p.bodyY = hop * 10
        const tuck = hop * 0.6
        p.legs = [tuck, tuck, -tuck, -tuck]
        p.antenna = Math.sin(clock * 20) * 0.3
        p.glow = 1
        p.eyes = 1
        if (this.fxClock > 0.35) {
          this.fxClock = 0
          this.hooks.spawn('heart', f * 6 + rand(-6, 6), 38)
        }
        break
      }
      case 'sleep':
        p.legs = [1.45, 1.45, -1.45, -1.45]
        p.bodyY = -5
        p.neckPitch = -0.3
        p.eyes = this.lookAtCamera > 0 ? 1 : 0
        p.antenna = -0.6
        p.tip = -0.3
        p.squash = 1 + Math.sin(clock * 2) * 0.025
        if (this.fxClock > 1.6) {
          this.fxClock = 0
          this.hooks.spawn('zzz', f * 10, 28)
        }
        break
      case 'starving': {
        p.roll = 1
        const tw = this.twitching > 0 ? Math.sin(clock * 40) * 0.35 : 0
        p.legs = [0.25 + tw, 0.25 - tw, -0.25 + tw, -0.25]
        p.eyes = this.lookAtCamera > 0 || Math.sin(clock * 0.6) > 0.7 ? 1 : 0
        p.neckPitch = -0.2
        p.glow = 0
        break
      }
      case 'tap': {
        p.legs = [1.1 + Math.sin(this.t * 14) * 0.35, 0, 0, 0]
        p.neckPitch = -0.1 + Math.sin(this.t * 14) * 0.05
        p.glow = 0
        break
      }
    }

    if (this.sighT > 0) {
      const k = Math.sin((Math.PI * this.sighT) / 1.4)
      p.squash *= 1 - 0.06 * k
      p.neckPitch -= 0.25 * k
    }
    if (this.squashT > 0) p.squash *= 1 - 0.28 * Math.sin((Math.PI * this.squashT) / 0.25)
    if (this.lookAtCamera > 0 && this.activity !== 'starving' && this.activity !== 'sleep') {
      p.neckYaw = f > 0 ? -0.6 : 0.6
      p.eyes = 1
    }
  }
}
