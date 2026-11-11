import { FRAME_MS, IDLE_FRAME_MS, PET_IDS } from '../shared/constants'
import type { OverlayInit, PetConfig, PetId, PetPose, PetSnapshot, PetStatus } from '../shared/types'
import { PetBrain, type RenderState } from './pet/brain'
import { Particles } from './pet/particles'
import { PERSONAS } from './pet/personas'
import { loadSprites, type SpriteSet } from './pet/sprites'
import { SpeechBubble, type Mood } from './ui/bubble'
import { PetView } from './view'
import { World } from './world'

const api = window.gremlin

type Mode = 'owner' | 'mirror' | 'idle'
interface Cursor {
  x: number
  y: number
  visible: boolean
}

/** Status shown before the main process has sent the real one. */
function placeholderStatus(cfg: PetConfig): PetStatus {
  return { name: cfg.name, stage: 'fed', level: 1, report: ['...'], grid: null, alert: null, busy: null, connected: false }
}

/**
 * Pointer handling shared by every pet on this overlay: the window is
 * click-through except while the cursor is over (or dragging) a pet.
 */
class Pointer {
  cursor: Cursor = { x: -1e6, y: -1e6, visible: true }
  private interactive = false

  constructor(private hosts: () => PetHost[]) {}

  refresh(): void {
    const want = this.hosts().some((h) => h.wantsPointer)
    const dragging = this.hosts().some((h) => h.dragging)
    if (want !== this.interactive) {
      this.interactive = want
      api.setInteractive(want)
    }
    document.body.classList.toggle('grab', want && !dragging)
    document.body.classList.toggle('grabbing', dragging)
  }
}

/** One pet on this monitor: owns it (runs its brain), mirrors it from a neighbour, or is idle. */
class PetHost {
  mode: Mode = 'idle'
  hovered = false
  dragging = false
  pending: { x: number; y: number; at: number } | null = null
  private brain: PetBrain
  private view: PetView
  private particles = new Particles()
  private bubble: SpeechBubble
  /** Whether the bubble on screen is the hover status report (as opposed to chatter). */
  private statusBubble = false
  private timer: number | null = null
  private last = performance.now()
  private snapshotClock = 0
  private straddling = false
  private lastKey = ''
  private quietFrames = 0
  private mirrorTimeout: number | null = null
  private cursorWasNear = false

  constructor(
    readonly id: PetId,
    private cfg: PetConfig,
    private status: PetStatus,
    private world: World,
    sprites: SpriteSet,
    stage: HTMLElement,
    private pointer: Pointer
  ) {
    const persona = PERSONAS[id]
    this.view = new PetView(stage, cfg.petSize, sprites)
    this.bubble = new SpeechBubble(stage, persona.bubble)
    this.brain = new PetBrain(world, cfg, status, sprites, persona, {
      say: (text, ms) => this.say(text, ms),
      spawn: (kind, x, y) => this.particles.spawn(kind, x, y),
      standing: (hwnd) => api.setStanding(id, hwnd),
      handoff: (target, snap) => {
        if (this.straddling) api.sendPose(id, null)
        this.straddling = false
        this.becomeIdle()
        api.handoff(id, target.id, snap)
      }
    })
    this.brain.size = this.view.displaySize
    this.view.setVisible(false)
  }

  get wantsPointer(): boolean {
    return this.mode === 'owner' && (this.hovered || this.dragging || this.pending !== null)
  }

  private mood(): Mood {
    const s = this.status
    return s.stage === 'starving' ? 'bad' : s.stage === 'hungry' || s.alert ? 'warn' : 'ok'
  }

  say(text: string, ms = 4000): void {
    if (this.mode !== 'owner') return
    this.statusBubble = false
    this.bubble.show(text, ms, this.status.name, this.mood())
  }

  /** The hover/click status report, built by the pet's service in the main process. */
  private showStatus(ms: number): void {
    this.statusBubble = true
    this.bubble.show(this.status.report.join('\n'), ms, this.status.name, this.mood(), this.status.grid ?? [])
  }

  // --- lifecycle --------------------------------------------------------------------------
  becomeOwner(snap: PetSnapshot | null): void {
    if (snap) this.brain.restore(snap)
    else {
      const wa = this.world.workArea
      this.brain.restore({
        x: wa.x + wa.width * (0.25 + Math.random() * 0.5),
        y: this.cfg.movement === 'roam' ? wa.y + wa.height * (0.5 + Math.random() * 0.4) : this.world.groundY,
        vx: 0,
        vy: 0,
        facing: Math.random() < 0.5 ? 1 : -1,
        grounded: true
      })
    }
    this.mode = 'owner'
    if (this.mirrorTimeout !== null) window.clearTimeout(this.mirrorTimeout)
    this.view.setVisible(true)
    this.lastKey = ''
    this.startLoop()
  }

  becomeIdle(): void {
    this.mode = 'idle'
    this.stopLoop()
    this.view.setVisible(false)
    this.bubble.hide()
    this.particles.clear()
    this.dragging = false
    this.pending = null
    if (this.hovered) {
      this.hovered = false
      this.brain.setHovered(false)
    }
    this.pointer.refresh()
  }

  /** Part of this pet hangs over from a neighbouring monitor: draw that part here. */
  mirror(p: PetPose | null): void {
    if (this.mode === 'owner') return
    if (this.mirrorTimeout !== null) window.clearTimeout(this.mirrorTimeout)
    const hw = this.view.displaySize
    if (!p || !this.world.overlaps(p.x - hw, p.x + hw, p.y - this.view.displaySize * 1.5, p.y)) {
      this.mode = 'idle'
      this.view.setVisible(false)
      return
    }
    this.mode = 'mirror'
    const l = this.world.toLocal(p.x, p.y)
    this.view.setVisible(true)
    this.view.place(l.x, l.y)
    this.view.draw(p.model as unknown as RenderState, null)
    this.mirrorTimeout = window.setTimeout(() => {
      if (this.mode === 'mirror') {
        this.mode = 'idle'
        this.view.setVisible(false)
      }
    }, 500)
  }

  // --- messages from main -------------------------------------------------------------------
  setStatus(s: PetStatus): void {
    this.status = s
    this.brain.status = s
    // Keep an open status report up to date (e.g. Dusty finishing a scan).
    if (this.statusBubble && this.bubble.visible && this.hovered) this.showStatus(60_000)
  }
  feed(ev: Parameters<PetBrain['feed']>[0]): void {
    this.brain.feed(ev)
  }
  setLedge(l: PetBrain['ledge']): void {
    this.brain.ledge = l
  }
  standingLost(hwnd: number): void {
    this.brain.standingLost(hwnd)
  }
  setConfig(cfg: PetConfig): void {
    const movementChanged = cfg.movement !== this.cfg.movement
    this.cfg = cfg
    this.brain.settings = cfg
    this.view.setPetSize(cfg.petSize)
    this.brain.size = this.view.displaySize
    if (this.mode === 'owner' && movementChanged) this.brain.restore(this.brain.snapshot())
    this.lastKey = ''
  }
  displaysChanged(): void {
    if (this.mode === 'owner') this.brain.restore(this.brain.snapshot())
    this.lastKey = ''
  }
  visibilityChanged(hidden: boolean): void {
    if (hidden) this.stopLoop()
    else if (this.mode === 'owner') {
      this.lastKey = ''
      this.startLoop()
    }
  }

  // --- pointer --------------------------------------------------------------------------------
  hit(gx: number, gy: number): boolean {
    if (this.mode !== 'owner') return false
    const b = this.brain.hitBox()
    return gx >= b.left - 4 && gx <= b.right + 4 && gy >= b.top - 4 && gy <= b.bottom
  }

  /** New cursor position from polling; `moved` = it moved over the visible desktop of this monitor. */
  cursorPolled(c: Cursor, moved: boolean): void {
    if (this.mode !== 'owner') return
    if (!this.dragging) this.brain.setCursor(c.x, c.y, moved)
    this.updateHover()
  }

  /** Recompute hover from the latest cursor position; hovering shows the status report. */
  updateHover(): void {
    if (this.mode !== 'owner') return
    const c = this.pointer.cursor
    const over = c.visible && !this.dragging && this.hit(c.x, c.y)
    if (over !== this.hovered) {
      this.hovered = over
      this.brain.setHovered(over)
      if (over) this.showStatus(60_000)
      else if (this.statusBubble) this.bubble.expireIn(1500)
    }
    this.pointer.refresh()
  }

  mouseMove(clientX: number, clientY: number, moved: boolean): void {
    if (this.mode !== 'owner') return
    const g = this.pointer.cursor
    const p = this.pending
    if (p && !this.dragging && (Math.hypot(clientX - p.x, clientY - p.y) > 5 || performance.now() - p.at > 250)) {
      this.dragging = true
      const start = this.world.toGlobal(p.x, p.y)
      if (this.statusBubble) this.bubble.hide()
      this.brain.startDrag(start.x, start.y)
      this.pointer.refresh()
    }
    this.brain.setCursor(g.x, g.y, moved && g.visible && !this.dragging)
    if (!this.dragging && !this.pending) {
      this.updateHover()
      if (g.visible) this.trackNear(g.x, g.y)
    }
  }

  mouseDown(clientX: number, clientY: number): void {
    this.pending = { x: clientX, y: clientY, at: performance.now() }
    this.pointer.refresh()
  }

  mouseUp(): void {
    if (this.dragging) {
      this.brain.release()
      this.dragging = false
    } else if (this.pending) {
      // Click: look up and give the status report. If the pet wants something
      // from you (sign in, review junk), open its page in the GitGremlin panel too.
      this.brain.clicked()
      this.showStatus(this.hovered ? 60_000 : 6000)
      if (this.status.alert) api.openHub(this.id)
    }
    this.pending = null
    this.updateHover()
  }

  private trackNear(gx: number, gy: number): void {
    const b = this.brain
    const cy = b.y - b.z - this.view.displaySize / 2
    const dist = Math.hypot(gx - b.x, gy - cy)
    if (dist < this.view.displaySize * 1.4 && !this.cursorWasNear) {
      this.cursorWasNear = true
      b.cursorNear(gx)
    } else if (dist > this.view.displaySize * 3.5) {
      this.cursorWasNear = false
    }
  }

  // --- render loop ----------------------------------------------------------------------------
  private startLoop(): void {
    if (this.timer !== null || document.hidden || this.mode !== 'owner') return
    this.last = performance.now()
    this.timer = window.setTimeout(() => this.tick(), FRAME_MS)
  }

  private stopLoop(): void {
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = null
  }

  private tick(): void {
    this.timer = null
    if (this.mode !== 'owner') return
    const now = performance.now()
    const dt = Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    const brain = this.brain

    brain.update(dt)
    if (this.mode !== 'owner') return // handed off to another monitor
    this.particles.update(dt)
    this.updateHover()
    const rs = brain.render()

    // Only redraw when something visible changed; drop to a slow tick when static.
    const key = renderKey(brain.x, brain.y, rs)
    if (key !== this.lastKey || this.particles.active) {
      this.lastKey = key
      const p = this.world.toLocal(brain.x, brain.y)
      this.view.place(p.x, p.y)
      this.view.draw(rs, this.particles)
      this.quietFrames = 0
    } else {
      this.quietFrames++
    }
    const head = this.world.toLocal(brain.x, brain.hitBox().top)
    this.bubble.update(head.x, head.y, this.world.display.bounds.width, this.world.display.bounds.height)

    this.shareEdgePose(rs)

    this.snapshotClock += dt
    if (this.snapshotClock > 2) {
      this.snapshotClock = 0
      api.sendSnapshot(this.id, brain.snapshot())
    }

    const busy = this.bubble.busy || this.dragging || this.particles.active || this.hovered
    const interval = this.quietFrames > 15 && !busy ? IDLE_FRAME_MS : FRAME_MS
    this.timer = window.setTimeout(() => this.tick(), Math.max(1, interval - (performance.now() - now)))
  }

  /** While part of the pet hangs over a neighbouring monitor, let that overlay draw it too. */
  private shareEdgePose(rs: RenderState): void {
    const hb = this.brain.hitBox()
    const w = this.world
    const over = (hb.right > w.right && w.neighbor(1)) || (hb.left < w.left && w.neighbor(-1))
    if (over) {
      const pose: PetPose = { x: this.brain.x, y: this.brain.y, grounded: this.brain.z <= 0, model: { ...rs } }
      api.sendPose(this.id, pose)
    } else if (this.straddling) {
      api.sendPose(this.id, null)
    }
    this.straddling = Boolean(over)
  }

  debug() {
    return { brain: this.brain, view: this.view, bubble: this.bubble }
  }
}

function renderKey(x: number, y: number, rs: RenderState): string {
  return `${Math.round(x)},${Math.round(y)},${rs.anim}${rs.frame},${Math.round(rs.z)},${Math.round(rs.bob)},${rs.mood},${rs.lookY},${rs.glow},${rs.dim},${rs.tint},${Math.round(rs.food * 10)},${Math.round(rs.squash * 10)},${rs.facing}`
}

async function boot(): Promise<void> {
  const init: OverlayInit | null = await api.getInit()
  if (!init) return
  let settings = init.settings
  const stage = document.getElementById('stage')!
  const world = new World(init.display, init.displays)
  const sprites = await Promise.all(PET_IDS.map((id) => loadSprites(id)))

  const hosts = new Map<PetId, PetHost>()
  const list = () => [...hosts.values()]
  const pointer = new Pointer(list)
  PET_IDS.forEach((id, i) => {
    const cfg = settings.pets[id]
    const fromInit = init.pets.find((p) => p.id === id)
    hosts.set(id, new PetHost(id, cfg, fromInit?.status ?? placeholderStatus(cfg), world, sprites[i], stage, pointer))
  })
  for (const h of list()) h.setLedge(init.ledge)
  if (import.meta.env.DEV) Object.assign(window, { __pets: Object.fromEntries(list().map((h) => [h.id, h.debug()])) })

  const onThisMonitor = (gx: number, gy: number) => gx >= world.left && gx < world.right && gy >= world.top && gy < world.bottom

  // Ask where the cursor is ~10x a second: hover works even when a pet walks
  // under a still cursor, and following works even without mouse events.
  window.setInterval(() => {
    if (!list().some((h) => h.mode === 'owner') || document.hidden) return
    void api.getCursor().then((c) => {
      const prev = pointer.cursor
      const moved = Math.hypot(c.x - prev.x, c.y - prev.y) > 2
      pointer.cursor = c
      for (const h of list()) h.cursorPolled(c, moved && c.visible && onThisMonitor(c.x, c.y))
    })
  }, 100)

  window.addEventListener('mousemove', (e) => {
    const g = world.toGlobal(e.clientX, e.clientY)
    const moved = Math.hypot(g.x - pointer.cursor.x, g.y - pointer.cursor.y) > 2
    pointer.cursor = { ...g, visible: pointer.cursor.visible }
    for (const h of list()) h.mouseMove(e.clientX, e.clientY, moved)
  })
  window.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return
    const g = world.toGlobal(e.clientX, e.clientY)
    // The pet drawn on top (added last) gets the click.
    const target = list()
      .reverse()
      .find((h) => h.hit(g.x, g.y))
    target?.mouseDown(e.clientX, e.clientY)
  })
  window.addEventListener('mouseup', (e) => {
    if (e.button !== 0) return
    const g = world.toGlobal(e.clientX, e.clientY)
    pointer.cursor = { ...g, visible: pointer.cursor.visible }
    for (const h of list()) h.mouseUp()
  })

  // --- messages from main ---------------------------------------------------------------
  api.onAdopt((id, snap, status) => {
    const h = hosts.get(id)
    if (!h) return
    if (status) h.setStatus(status)
    h.becomeOwner(snap)
  })
  api.onRelease((id) => hosts.get(id)?.becomeIdle())
  api.onMirror((id, pose) => hosts.get(id)?.mirror(pose))
  api.onDisplaysChanged((d, all) => {
    world.display = d
    world.displays = all
    for (const h of list()) h.displaysChanged()
  })
  api.onStatus((id, s) => hosts.get(id)?.setStatus(s))
  api.onFeed((id, ev) => hosts.get(id)?.feed(ev))
  api.onLedge((l) => {
    for (const h of list()) h.setLedge(l)
  })
  api.onStandingLost((id, hwnd) => hosts.get(id)?.standingLost(hwnd))
  api.onSay((id, text) => hosts.get(id)?.say(text, 4000))
  api.onSettings((s) => {
    settings = s
    for (const h of list()) h.setConfig(s.pets[h.id])
  })
  document.addEventListener('visibilitychange', () => {
    for (const h of list()) h.visibilityChanged(document.hidden)
  })

  for (const p of init.pets) if (p.isOwner) hosts.get(p.id)?.becomeOwner(p.snapshot)
}

void boot()
