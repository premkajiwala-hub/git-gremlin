import { FRAME_MS } from '../shared/constants'
import type { DisplayInfo, PetPose, PetSnapshot } from '../shared/types'
import { PlaceholderPet } from './pet/placeholder'
import { PetView } from './view'
import { World } from './world'

const api = window.gremlin
const GRAVITY = 2200

type Mode = 'owner' | 'mirror' | 'idle'

async function boot(): Promise<void> {
  const init = await api.getInit()
  if (!init) return

  const world = new World(init.display, init.displays)
  const view = new PetView(document.getElementById('stage')!, init.petSize)
  const pet = new PlaceholderPet()
  view.scene.add(pet.root)

  const speed = init.petSpeed
  let mode: Mode = 'idle'
  const s: PetSnapshot = {
    x: world.left + world.display.bounds.width / 2,
    y: world.groundY,
    vx: 0,
    vy: 0,
    facing: 1,
    grounded: true
  }

  // --- loop -----------------------------------------------------------------
  let timer: number | null = null
  let last = performance.now()
  let snapshotClock = 0
  let straddling = false
  let mirrorTimeout: number | null = null

  function startLoop(): void {
    if (timer !== null || document.hidden) return
    last = performance.now()
    timer = window.setTimeout(tick, FRAME_MS)
  }
  function stopLoop(): void {
    if (timer !== null) window.clearTimeout(timer)
    timer = null
  }

  function tick(): void {
    timer = null
    const now = performance.now()
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    if (mode === 'owner') {
      step(dt)
      timer = window.setTimeout(tick, Math.max(1, FRAME_MS - (performance.now() - now)))
    }
  }

  function halfWidth(): number {
    return view.petSize * 0.5
  }

  function step(dt: number): void {
    if (s.grounded) {
      s.vx = s.facing * speed
      s.x += s.vx * dt
      s.y = world.groundY
    } else {
      s.vy += GRAVITY * dt
      s.x += s.vx * dt
      s.y += s.vy * dt
      if (s.y >= world.groundY) {
        s.y = world.groundY
        s.vy = 0
        s.grounded = true
      }
    }

    // Edges: hand over to the neighbouring monitor, or turn around.
    const hw = halfWidth()
    const right = world.neighbor(1)
    const left = world.neighbor(-1)
    if (s.facing > 0 && s.x > world.right - (right ? 0 : hw)) {
      if (right) return handoff(right)
      s.facing = -1
      s.x = world.right - hw
    } else if (s.facing < 0 && s.x < world.left + (left ? 0 : hw)) {
      if (left) return handoff(left)
      s.facing = 1
      s.x = world.left + hw
    }

    pet.update(dt, s.facing, s.grounded)
    draw()

    // While part of the pet hangs over a neighbouring monitor, let it draw that part too.
    const over = (right && s.x + hw > world.right) || (left && s.x - hw < world.left)
    if (over) api.sendPose(pose())
    else if (straddling) api.sendPose(null)
    straddling = Boolean(over)

    snapshotClock += dt
    if (snapshotClock > 2) {
      snapshotClock = 0
      api.sendSnapshot({ ...s })
    }
  }

  function draw(): void {
    const p = world.toLocal(s.x, s.y)
    view.place(p.x, p.y)
    view.render()
  }

  function pose(): PetPose {
    return { x: s.x, y: s.y, grounded: s.grounded, model: pet.getPose() }
  }

  function handoff(target: DisplayInfo): void {
    if (straddling) api.sendPose(null)
    straddling = false
    becomeIdle()
    api.handoff(target.id, { ...s, y: s.grounded ? target.groundY : s.y })
  }

  function becomeOwner(snap: PetSnapshot | null): void {
    if (snap) Object.assign(s, snap)
    if (s.grounded) s.y = world.groundY
    s.x = Math.min(Math.max(s.x, world.left), world.right - 1)
    mode = 'owner'
    if (mirrorTimeout !== null) window.clearTimeout(mirrorTimeout)
    view.setVisible(true)
    startLoop()
  }

  function becomeIdle(): void {
    mode = 'idle'
    stopLoop()
    view.setVisible(false)
    setInteractive(false)
  }

  // --- mirroring (pet straddling the edge from a neighbouring monitor) --------
  api.onMirror((p) => {
    if (mode === 'owner') return
    if (mirrorTimeout !== null) window.clearTimeout(mirrorTimeout)
    const hw = halfWidth()
    if (!p || !world.overlaps(p.x - hw, p.x + hw, p.y - view.petSize, p.y)) {
      mode = 'idle'
      view.setVisible(false)
      return
    }
    mode = 'mirror'
    pet.applyPose(p.model)
    const y = p.grounded ? world.groundY : p.y
    const l = world.toLocal(p.x, y)
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

  // --- mouse: click-through everywhere except the pet ------------------------
  let interactive = false
  function setInteractive(on: boolean): void {
    if (on === interactive) return
    interactive = on
    api.setInteractive(on)
    document.body.classList.toggle('grab', on)
  }

  function hitTest(clientX: number, clientY: number): boolean {
    if (mode !== 'owner') return false
    const p = world.toLocal(s.x, s.y)
    const hw = halfWidth() + 4
    const h = view.petSize + 4
    return clientX >= p.x - hw && clientX <= p.x + hw && clientY >= p.y - h && clientY <= p.y + 4
  }

  window.addEventListener('mousemove', (e) => setInteractive(hitTest(e.clientX, e.clientY)))
  window.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !hitTest(e.clientX, e.clientY)) return
    // Milestone 1: a click makes the cube hop, proving clicks land on the pet.
    if (s.grounded) {
      s.grounded = false
      s.vy = -650
      s.vx = s.facing * speed
    }
  })

  // --- lifecycle -------------------------------------------------------------
  api.onAdopt((snap) => becomeOwner(snap))
  api.onRelease(() => becomeIdle())
  api.onDisplaysChanged((d, all) => {
    world.display = d
    world.displays = all
    if (mode === 'owner' && s.grounded) s.y = world.groundY
  })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopLoop()
    else if (mode === 'owner') startLoop()
  })

  if (init.isOwner) becomeOwner(init.snapshot)
  else becomeIdle()
}

void boot()
