import { FRAME_MS, IDLE_FRAME_MS } from '../shared/constants'
import type { PetPose, PetSnapshot, PetStatus, Settings } from '../shared/types'
import { PetBrain, RANDOM_LINES, type RenderState } from './pet/brain'
import { Particles } from './pet/particles'
import { loadSprites } from './pet/sprites'
import { SpeechBubble, type Mood } from './ui/bubble'
import { PetView } from './view'
import { World } from './world'

const api = window.gremlin

type Mode = 'owner' | 'mirror' | 'idle'

async function boot(): Promise<void> {
  const init = await api.getInit()
  if (!init) return

  let settings: Settings = init.settings
  let status: PetStatus = init.status
  const stage = document.getElementById('stage')!
  const world = new World(init.display, init.displays)
  const sprites = await loadSprites()
  const view = new PetView(stage, settings.petSize, sprites)
  const particles = new Particles()
  const bubble = new SpeechBubble(stage)

  const mood = (): Mood => (status.stage === 'starving' ? 'bad' : status.stage === 'hungry' ? 'warn' : 'ok')
  /** Whether the bubble on screen is the hover status report (as opposed to chatter). */
  let statusBubble = false
  const say = (text: string, ms = 4000) => {
    if (mode !== 'owner') return
    statusBubble = false
    bubble.show(text, ms, status.name, mood())
  }

  const brain = new PetBrain(world, settings, status, sprites, {
    say,
    spawn: (kind, x, y) => particles.spawn(kind, x, y),
    standing: (hwnd) => api.setStanding(hwnd),
    handoff: (target, snap) => {
      if (straddling) api.sendPose(null)
      straddling = false
      becomeIdle()
      api.handoff(target.id, snap)
    }
  })
  brain.ledge = init.ledge
  brain.size = view.displaySize
  if (import.meta.env.DEV) Object.assign(window, { __catbot: { brain, view, world, bubble } })

  let mode: Mode = 'idle'

  // --- render loop ---------------------------------------------------------------
  let timer: number | null = null
  let last = performance.now()
  let snapshotClock = 0
  let cursorClock = 0
  let straddling = false
  let lastKey = ''
  let quietFrames = 0
  let mirrorTimeout: number | null = null

  function startLoop(): void {
    if (timer !== null || document.hidden || mode !== 'owner') return
    last = performance.now()
    timer = window.setTimeout(tick, FRAME_MS)
  }
  function stopLoop(): void {
    if (timer !== null) window.clearTimeout(timer)
    timer = null
  }

  function tick(): void {
    timer = null
    if (mode !== 'owner') return
    const now = performance.now()
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now

    // Ask where the cursor is ~10x a second: hover works even when Catbot walks
    // under a still cursor, and following works even without mouse events.
    cursorClock += dt
    if (cursorClock >= 0.1) {
      cursorClock = 0
      void api.getCursor().then((c) => {
        const moved = Math.hypot(c.x - cursor.x, c.y - cursor.y) > 2
        cursor = { x: c.x, y: c.y }
        cursorVisible = c.visible
        if (!dragging) brain.setCursor(c.x, c.y, moved && c.visible && onThisMonitor(c.x, c.y))
        updateHover()
      })
    }

    brain.update(dt)
    if (mode !== 'owner') return // handed off to another monitor
    particles.update(dt)
    updateHover()
    const rs = brain.render()

    // Only redraw when something visible changed; drop to a slow tick when static.
    const key = renderKey(brain.x, brain.y, rs)
    if (key !== lastKey || particles.active) {
      lastKey = key
      draw(rs)
      quietFrames = 0
    } else {
      quietFrames++
    }
    const head = world.toLocal(brain.x, brain.hitBox().top)
    bubble.update(head.x, head.y, world.display.bounds.width, world.display.bounds.height)

    shareEdgePose(rs)

    snapshotClock += dt
    if (snapshotClock > 2) {
      snapshotClock = 0
      api.sendSnapshot(brain.snapshot())
    }

    const busy = bubble.busy || dragging || particles.active || hovered
    const interval = quietFrames > 15 && !busy ? IDLE_FRAME_MS : FRAME_MS
    timer = window.setTimeout(tick, Math.max(1, interval - (performance.now() - now)))
  }

  function draw(rs: RenderState): void {
    const p = world.toLocal(brain.x, brain.y)
    view.place(p.x, p.y)
    view.draw(rs, particles)
  }

  /** While part of Catbot hangs over a neighbouring monitor, let that overlay draw it too. */
  function shareEdgePose(rs: RenderState): void {
    const hb = brain.hitBox()
    const over = (hb.right > world.right && world.neighbor(1)) || (hb.left < world.left && world.neighbor(-1))
    if (over) {
      const pose: PetPose = { x: brain.x, y: brain.y, grounded: brain.z <= 0, model: { ...rs } }
      api.sendPose(pose)
    } else if (straddling) {
      api.sendPose(null)
    }
    straddling = Boolean(over)
  }

  function becomeOwner(snap: PetSnapshot | null): void {
    if (snap) brain.restore(snap)
    else {
      const wa = world.workArea
      brain.restore({
        x: wa.x + wa.width * (0.3 + Math.random() * 0.4),
        y: settings.movement === 'roam' ? wa.y + wa.height * (0.5 + Math.random() * 0.4) : world.groundY,
        vx: 0,
        vy: 0,
        facing: 1,
        grounded: true
      })
    }
    mode = 'owner'
    if (mirrorTimeout !== null) window.clearTimeout(mirrorTimeout)
    view.setVisible(true)
    lastKey = ''
    startLoop()
  }

  function becomeIdle(): void {
    mode = 'idle'
    stopLoop()
    view.setVisible(false)
    bubble.hide()
    particles.clear()
    setInteractive(false)
    dragging = false
    pending = null
    if (hovered) {
      hovered = false
      brain.setHovered(false)
    }
  }

  // --- mirroring (Catbot straddling the edge from a neighbouring monitor) ------------------
  api.onMirror((p) => {
    if (mode === 'owner') return
    if (mirrorTimeout !== null) window.clearTimeout(mirrorTimeout)
    const hw = view.displaySize
    if (!p || !world.overlaps(p.x - hw, p.x + hw, p.y - view.displaySize * 1.5, p.y)) {
      mode = 'idle'
      view.setVisible(false)
      return
    }
    mode = 'mirror'
    const l = world.toLocal(p.x, p.y)
    view.setVisible(true)
    view.place(l.x, l.y)
    view.draw(p.model as unknown as RenderState, null)
    mirrorTimeout = window.setTimeout(() => {
      if (mode === 'mirror') {
        mode = 'idle'
        view.setVisible(false)
      }
    }, 500)
  })

  // --- mouse: click-through everywhere except Catbot ------------------------------------
  let interactive = false
  let hovered = false
  let dragging = false
  let pending: { x: number; y: number; at: number } | null = null
  let cursor = { x: -1e6, y: -1e6 }
  let cursorVisible = true
  let cursorWasNear = false

  function onThisMonitor(gx: number, gy: number): boolean {
    return gx >= world.left && gx < world.right && gy >= world.top && gy < world.bottom
  }

  function setInteractive(on: boolean): void {
    if (on === interactive) return
    interactive = on
    api.setInteractive(on)
    document.body.classList.toggle('grab', on && !dragging)
  }

  function hit(gx: number, gy: number): boolean {
    if (mode !== 'owner') return false
    const b = brain.hitBox()
    return gx >= b.left - 4 && gx <= b.right + 4 && gy >= b.top - 4 && gy <= b.bottom
  }

  /** Recompute hover from the latest cursor position; hovering shows the status report. */
  function updateHover(): void {
    if (mode !== 'owner') return
    const over = cursorVisible && !dragging && hit(cursor.x, cursor.y)
    if (over !== hovered) {
      hovered = over
      brain.setHovered(over)
      if (over) {
        statusBubble = true
        bubble.show(statusText(), 60_000, status.name, mood())
      } else if (statusBubble) {
        bubble.expireIn(1500)
      }
    }
    setInteractive(hovered || dragging || pending !== null)
  }

  function trackNear(gx: number, gy: number): void {
    const cy = brain.y - brain.z - view.displaySize / 2
    const dist = Math.hypot(gx - brain.x, gy - cy)
    if (dist < view.displaySize * 1.4 && !cursorWasNear) {
      cursorWasNear = true
      brain.cursorNear(gx)
    } else if (dist > view.displaySize * 3.5) {
      cursorWasNear = false
    }
  }

  window.addEventListener('mousemove', (e) => {
    const g = world.toGlobal(e.clientX, e.clientY)
    const moved = Math.hypot(g.x - cursor.x, g.y - cursor.y) > 2
    cursor = g
    if (mode !== 'owner') return
    if (pending && !dragging && (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > 5 || performance.now() - pending.at > 250)) {
      dragging = true
      document.body.classList.remove('grab')
      document.body.classList.add('grabbing')
      const start = world.toGlobal(pending.x, pending.y)
      if (statusBubble) bubble.hide()
      brain.startDrag(start.x, start.y)
    }
    brain.setCursor(g.x, g.y, moved && cursorVisible && !dragging)
    if (!dragging && !pending) {
      updateHover()
      if (cursorVisible) trackNear(g.x, g.y)
    }
  })

  window.addEventListener('mousedown', (e) => {
    const g = world.toGlobal(e.clientX, e.clientY)
    if (e.button !== 0 || !hit(g.x, g.y)) return
    pending = { x: e.clientX, y: e.clientY, at: performance.now() }
    setInteractive(true)
  })

  window.addEventListener('mouseup', (e) => {
    if (e.button !== 0) return
    const g = world.toGlobal(e.clientX, e.clientY)
    cursor = g
    if (dragging) {
      brain.release()
      dragging = false
      document.body.classList.remove('grabbing')
    } else if (pending) {
      // Click: look up and give the status report (with a fresh random line).
      brain.clicked()
      statusBubble = true
      bubble.show(statusText(), hovered ? 60_000 : 6000, status.name, mood())
    }
    pending = null
    updateHover()
  })

  function statusText(): string {
    const pct = Math.round(status.fullness * 100)
    const filled = Math.round(status.fullness * 10)
    const bar = '█'.repeat(filled) + '░'.repeat(10 - filled)
    const moodText = status.paused ? `${status.stage} (PAUSED)` : status.quiet ? `${status.stage} (QUIET)` : status.stage
    const last = status.lastCommitAt ? `${ago(Date.now() - status.lastCommitAt)} AGO` : 'NEVER'
    const tip =
      status.repoCount === 0
        ? 'ADD A REPO FROM THE TRAY MENU SO I CAN EAT!'
        : RANDOM_LINES[Math.floor(Math.random() * RANDOM_LINES.length)]
    return `ENERGY ${bar} ${pct}%\nMOOD: ${moodText}\nLAST COMMIT: ${last}\n\n> ${tip}`
  }

  // --- lifecycle & messages from main --------------------------------------------------
  api.onAdopt((snap) => becomeOwner(snap))
  api.onRelease(() => becomeIdle())
  api.onDisplaysChanged((d, all) => {
    world.display = d
    world.displays = all
    if (mode === 'owner') brain.restore(brain.snapshot())
    lastKey = ''
  })
  api.onStatus((s) => {
    status = s
    brain.status = s
  })
  api.onFeed((ev) => brain.feed(ev))
  api.onLedge((l) => {
    brain.ledge = l
  })
  api.onStandingLost((hwnd) => brain.standingLost(hwnd))
  api.onSay((text) => say(text, 4000))
  api.onSettings((s) => {
    const movementChanged = s.movement !== settings.movement
    settings = s
    brain.settings = s
    view.setPetSize(s.petSize)
    brain.size = view.displaySize
    if (mode === 'owner' && movementChanged) brain.restore(brain.snapshot())
    lastKey = ''
  })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopLoop()
    else if (mode === 'owner') {
      lastKey = ''
      startLoop()
    }
  })

  if (init.isOwner) becomeOwner(init.snapshot)
  else becomeIdle()
}

function renderKey(x: number, y: number, rs: RenderState): string {
  return `${Math.round(x)},${Math.round(y)},${rs.anim}${rs.frame},${Math.round(rs.z)},${Math.round(rs.bob)},${rs.mood},${rs.lookY},${rs.glow},${rs.dim},${rs.tint},${Math.round(rs.food * 10)},${Math.round(rs.squash * 10)},${rs.facing}`
}

function ago(ms: number): string {
  const m = Math.floor(ms / 60000)
  if (m < 1) return '<1M'
  if (m < 60) return `${m}M`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}H ${m % 60}M`
  return `${Math.floor(h / 24)}D`
}

void boot()
