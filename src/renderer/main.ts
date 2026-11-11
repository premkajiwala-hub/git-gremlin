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
  const say = (text: string, ms = 4000) => {
    if (mode === 'owner') bubble.show(text, ms, status.name, mood())
  }

  const brain = new PetBrain(world, settings, status, sprites, {
    say,
    spawn: (kind, x, y) => particles.spawn(kind, x, y, settings.petSize / 72),
    handoff: (target, snap) => {
      if (straddling) api.sendPose(null)
      straddling = false
      becomeIdle()
      api.handoff(target.id, snap)
    }
  })
  brain.ledge = init.ledge

  let mode: Mode = 'idle'

  // --- render loop ---------------------------------------------------------------
  let timer: number | null = null
  let last = performance.now()
  let snapshotClock = 0
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

    brain.update(dt)
    if (mode !== 'owner') return // handed off to another monitor
    particles.update(dt)
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

    const busy = bubble.busy || dragging || particles.active
    const interval = quietFrames > 15 && !busy ? IDLE_FRAME_MS : FRAME_MS
    timer = window.setTimeout(tick, Math.max(1, interval - (performance.now() - now)))
  }

  function draw(rs: RenderState): void {
    const p = world.toLocal(brain.x, brain.y)
    view.place(p.x, p.y)
    view.draw(rs, brain.facing, particles)
  }

  /** While part of the pet hangs over a neighbouring monitor, let that overlay draw it too. */
  function shareEdgePose(rs: RenderState): void {
    const hb = brain.hitBox()
    const over = (hb.right > world.right && world.neighbor(1)) || (hb.left < world.left && world.neighbor(-1))
    if (over) {
      const pose: PetPose = { x: brain.x, y: brain.y, grounded: brain.z <= 0, model: { ...rs, facing: brain.facing } }
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
      brain.x = wa.x + wa.width * (0.3 + Math.random() * 0.4)
      brain.y = settings.movement === 'roam' ? wa.y + wa.height * (0.5 + Math.random() * 0.4) : world.groundY
      brain.restore(brain.snapshot())
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
  }

  // --- mirroring (the pet straddling the edge from a neighbouring monitor) -----------------
  api.onMirror((p) => {
    if (mode === 'owner') return
    if (mirrorTimeout !== null) window.clearTimeout(mirrorTimeout)
    const hw = settings.petSize
    if (!p || !world.overlaps(p.x - hw, p.x + hw, p.y - settings.petSize * 1.5, p.y)) {
      mode = 'idle'
      view.setVisible(false)
      return
    }
    mode = 'mirror'
    const rs = p.model as unknown as RenderState & { facing: 1 | -1 }
    const l = world.toLocal(p.x, p.y)
    view.setVisible(true)
    view.place(l.x, l.y)
    view.draw(rs, rs.facing, null)
    mirrorTimeout = window.setTimeout(() => {
      if (mode === 'mirror') {
        mode = 'idle'
        view.setVisible(false)
      }
    }, 500)
  })

  // --- mouse: click-through everywhere except the pet -----------------------------------
  let interactive = false
  let dragging = false
  let pending: { x: number; y: number; at: number } | null = null
  let cursorWasNear = false
  const wiggle: { x: number; t: number; dir: number }[] = []

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

  function trackCursor(gx: number, gy: number): void {
    const cy = brain.y - brain.z - settings.petSize / 2
    const dist = Math.hypot(gx - brain.x, gy - cy)
    if (dist < settings.petSize * 1.4 && !cursorWasNear) {
      cursorWasNear = true
      brain.cursorNear(gx)
    } else if (dist > settings.petSize * 3.5) {
      cursorWasNear = false
    }

    const now = performance.now()
    while (wiggle.length && now - wiggle[0].t > 1500) wiggle.shift()
    if (dist > 240) return
    const lastPt = wiggle[wiggle.length - 1]
    const dir = lastPt ? Math.sign(gx - lastPt.x) : 0
    if (!lastPt || (dir !== 0 && Math.abs(gx - lastPt.x) > 6)) wiggle.push({ x: gx, t: now, dir })
    let reversals = 0
    for (let i = 2; i < wiggle.length; i++) if (wiggle[i].dir !== 0 && wiggle[i].dir !== wiggle[i - 1].dir) reversals++
    if (reversals >= 4) {
      wiggle.length = 0
      brain.wiggled(gx, gy)
    }
  }

  window.addEventListener('mousemove', (e) => {
    const g = world.toGlobal(e.clientX, e.clientY)
    brain.setCursor(g.x, g.y)
    if (mode !== 'owner') return
    if (pending && !dragging && (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > 5 || performance.now() - pending.at > 250)) {
      dragging = true
      document.body.classList.remove('grab')
      document.body.classList.add('grabbing')
      const start = world.toGlobal(pending.x, pending.y)
      brain.startDrag(start.x, start.y)
      brain.setCursor(g.x, g.y)
    }
    if (!dragging && !pending) {
      setInteractive(hit(g.x, g.y))
      trackCursor(g.x, g.y)
    }
  })

  window.addEventListener('mousedown', (e) => {
    const g = world.toGlobal(e.clientX, e.clientY)
    if (e.button !== 0 || !hit(g.x, g.y)) return
    pending = { x: e.clientX, y: e.clientY, at: performance.now() }
  })

  window.addEventListener('mouseup', (e) => {
    if (e.button !== 0) return
    const g = world.toGlobal(e.clientX, e.clientY)
    if (dragging) {
      brain.release()
      dragging = false
      document.body.classList.remove('grabbing')
    } else if (pending) {
      brain.clicked()
      say(statusText(), 6000)
    }
    pending = null
    setInteractive(hit(g.x, g.y))
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
  api.onSay((text) => say(text, 4000))
  api.onSettings((s) => {
    const movementChanged = s.movement !== settings.movement
    settings = s
    brain.settings = s
    view.setPetSize(s.petSize)
    if (mode === 'owner' && movementChanged) {
      // Switching to bottom-edge mode drops the catbot onto the taskbar.
      if (s.movement === 'ground') brain.y = world.groundY
      brain.restore(brain.snapshot())
    }
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
  const r = (n: number) => Math.round(n * 100)
  return `${Math.round(x)},${Math.round(y)},${rs.anim}${rs.frame},${Math.round(rs.z)},${r(rs.squashX)},${r(rs.squashY)},${r(rs.rot)},${rs.tint},${r(rs.dim)},${r(rs.food)},${rs.flip}`
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
