import { FRAME_MS, IDLE_FRAME_MS } from '../shared/constants'
import type { PetPose, PetSnapshot, PetStatus, Settings } from '../shared/types'
import { PetBrain, RANDOM_LINES } from './pet/brain'
import { MODEL_HEIGHT, PetModel } from './pet/model'
import { Particles } from './pet/particles'
import { easePose, poseKey, type Pose } from './pet/pose'
import { loadTextures } from './pet/textures'
import { SpeechBubble } from './ui/bubble'
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
  const view = new PetView(stage, settings.petSize, MODEL_HEIGHT)
  const textures = await loadTextures()
  const model = new PetModel(textures)
  view.scene.add(model.root)
  const particles = new Particles(view.scene, textures)
  const bubble = new SpeechBubble(stage)

  const brain = new PetBrain(world, settings, status, {
    say: (text, ms) => {
      if (mode === 'owner') bubble.show(text, ms)
    },
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
    easePose(model.pose, brain.target, dt)
    model.apply()
    particles.update(dt)

    // Only redraw when something visible changed; drop to a slow tick when static.
    const key = `${Math.round(brain.x)},${Math.round(brain.y)},${poseKey(model.pose)}`
    const changed = key !== lastKey || particles.active
    if (changed) {
      lastKey = key
      draw()
      quietFrames = 0
    } else {
      quietFrames++
    }
    const head = world.toLocal(brain.x, brain.hitBox().top)
    bubble.update(head.x, head.y, world.display.bounds.width, world.display.bounds.height)

    shareEdgePose()

    snapshotClock += dt
    if (snapshotClock > 2) {
      snapshotClock = 0
      api.sendSnapshot(brain.snapshot())
    }

    const interval = quietFrames > 15 && !bubble.visible && !dragging ? IDLE_FRAME_MS : FRAME_MS
    timer = window.setTimeout(tick, Math.max(1, interval - (performance.now() - now)))
  }

  function draw(): void {
    const p = world.toLocal(brain.x, brain.y)
    view.place(p.x, p.y)
    view.render()
  }

  /** While part of the pet hangs over a neighbouring monitor, let that overlay draw it too. */
  function shareEdgePose(): void {
    const hb = brain.hitBox()
    const over = (hb.right > world.right && world.neighbor(1)) || (hb.left < world.left && world.neighbor(-1))
    if (over) {
      const pose: PetPose = { x: brain.x, y: brain.y, grounded: brain.grounded, model: { ...model.pose } }
      api.sendPose(pose)
    } else if (straddling) {
      api.sendPose(null)
    }
    straddling = Boolean(over)
  }

  function becomeOwner(snap: PetSnapshot | null): void {
    if (snap) brain.restore(snap)
    else {
      brain.x = world.left + world.display.bounds.width * (0.3 + Math.random() * 0.4)
      brain.y = world.groundY
    }
    brain.x = Math.min(Math.max(brain.x, world.left), world.right - 1)
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
    const hw = settings.petSize * 0.62
    if (!p || !world.overlaps(p.x - hw, p.x + hw, p.y - settings.petSize, p.y)) {
      mode = 'idle'
      view.setVisible(false)
      return
    }
    mode = 'mirror'
    model.applyPose(p.model as unknown as Pose)
    const l = world.toLocal(p.x, p.grounded ? world.groundY : p.y)
    view.setVisible(true)
    view.place(l.x, l.y)
    view.render()
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

  function trackWiggle(gx: number, gy: number): void {
    const near = Math.abs(gx - brain.x) < 220 && Math.abs(gy - (brain.y - settings.petSize / 2)) < 200
    const now = performance.now()
    while (wiggle.length && now - wiggle[0].t > 1500) wiggle.shift()
    if (!near) return
    const lastPt = wiggle[wiggle.length - 1]
    const dir = lastPt ? Math.sign(gx - lastPt.x) : 0
    if (!lastPt || (dir !== 0 && Math.abs(gx - lastPt.x) > 6)) wiggle.push({ x: gx, t: now, dir })
    let reversals = 0
    for (let i = 2; i < wiggle.length; i++) if (wiggle[i].dir !== 0 && wiggle[i].dir !== wiggle[i - 1].dir) reversals++
    if (reversals >= 4) {
      wiggle.length = 0
      brain.wiggled(gx)
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
      trackWiggle(g.x, g.y)
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
      bubble.show(statusText(), 6000)
    }
    pending = null
    setInteractive(hit(g.x, g.y))
  })

  function statusText(): string {
    const pct = Math.round(status.fullness * 100)
    const filled = Math.round(status.fullness * 10)
    const bar = '█'.repeat(filled) + '░'.repeat(10 - filled)
    const mood = status.paused ? `${status.stage} (PAUSED)` : status.quiet ? `${status.stage} (QUIET HOURS)` : status.stage
    const last = status.lastCommitAt ? `${ago(Date.now() - status.lastCommitAt)} AGO` : 'NEVER'
    const tip = status.repoCount === 0 ? 'ADD A REPO FROM THE TRAY MENU SO I CAN EAT!' : RANDOM_LINES[Math.floor(Math.random() * RANDOM_LINES.length)]
    return `${status.name}\nMOOD: ${mood}\nFOOD ${bar} ${pct}%\nLAST COMMIT: ${last}\n\n${tip}`
  }

  // --- lifecycle & messages from main --------------------------------------------------
  api.onAdopt((snap) => becomeOwner(snap))
  api.onRelease(() => becomeIdle())
  api.onDisplaysChanged((d, all) => {
    world.display = d
    world.displays = all
    if (mode === 'owner' && brain.surface?.kind === 'ground') brain.y = world.groundY
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
  api.onSay((text) => {
    if (mode === 'owner') bubble.show(text, 4000)
  })
  api.onSettings((s) => {
    settings = s
    brain.settings = s
    view.setPetSize(s.petSize)
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

function ago(ms: number): string {
  const m = Math.floor(ms / 60000)
  if (m < 1) return '<1M'
  if (m < 60) return `${m}M`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}H ${m % 60}M`
  return `${Math.floor(h / 24)}D`
}

void boot()
