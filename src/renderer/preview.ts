/**
 * Dev-only browser preview of the overlay renderer: a fake desktop, a fake
 * focused window and buttons to drive Catbot's states. Open
 * http://localhost:5173/preview.html while `npm start` is running.
 */
import { DEFAULT_SETTINGS } from '../shared/constants'
import type { DisplayInfo, FeedEvent, OverlayInit, PetStatus, Settings, WindowLedge } from '../shared/types'

type Cb = (...args: any[]) => void
const listeners: Record<string, Cb[]> = {}
const on = (name: string) => (cb: Cb) => {
  ;(listeners[name] ??= []).push(cb)
  return () => {}
}
const emit = (name: string, ...args: unknown[]) => (listeners[name] ?? []).forEach((cb) => cb(...args))

const W = window.innerWidth
const H = window.innerHeight
const display: DisplayInfo = {
  id: 1,
  bounds: { x: 0, y: 0, width: W, height: H },
  workArea: { x: 0, y: 0, width: W, height: H - 40 },
  scaleFactor: window.devicePixelRatio,
  primary: true,
  taskbar: 'bottom',
  groundY: H - 40
}
const settings: Settings = { ...DEFAULT_SETTINGS, petSize: 96 }
let status: PetStatus = { name: 'Catbot', stage: 'full', fullness: 1, lastCommitAt: Date.now() - 3_600_000, quiet: false, paused: false, repoCount: 1 }
const fake = document.getElementById('fakewin')!.getBoundingClientRect()
const ledge: WindowLedge = { hwnd: 42, x: fake.left, y: fake.top, width: fake.width, height: fake.height }
let cursor = { x: -1000, y: -1000 }
window.addEventListener('mousemove', (e) => (cursor = { x: e.clientX, y: e.clientY }))

const init: OverlayInit = { display, displays: [display], isOwner: true, snapshot: null, settings, status, ledge }

;(window as any).gremlin = {
  getInit: async () => init,
  setInteractive: () => {},
  handoff: () => {},
  sendPose: () => {},
  sendSnapshot: () => {},
  setStanding: () => {},
  getCursor: async () => ({ ...cursor, visible: true }),
  onAdopt: on('adopt'),
  onRelease: on('release'),
  onMirror: on('mirror'),
  onDisplaysChanged: on('displays'),
  onStatus: on('status'),
  onFeed: on('feed'),
  onLedge: on('ledge'),
  onStandingLost: on('standingLost'),
  onSay: on('say'),
  onSettings: on('settings')
}

function setStage(stage: PetStatus['stage'], fullness: number, quiet = false): void {
  status = { ...status, stage, fullness, quiet }
  emit('status', status)
}

const actions: Record<string, () => void> = {
  Feed: () => emit('feed', { commits: 2, lines: 80, foodHours: 5 } satisfies FeedEvent),
  Say: () => emit('say', 'HELLO! I AM CATBOT. BEEP BOOP, FEED ME COMMITS.'),
  Full: () => setStage('full', 1),
  Peckish: () => setStage('peckish', 0.7),
  Hungry: () => setStage('hungry', 0.4),
  Starving: () => setStage('starving', 0),
  'Quiet hours': () => setStage(status.stage, status.fullness, !status.quiet),
  'Window moved': () => emit('standingLost', 42),
  'Bottom only': () => emit('settings', { ...settings, movement: settings.movement === 'roam' ? 'ground' : 'roam' })
}
const panel = document.getElementById('panel')!
for (const [label, fn] of Object.entries(actions)) {
  const b = document.createElement('button')
  b.textContent = label
  b.addEventListener('click', fn)
  panel.append(b)
}
;(window as any).__preview = { emit, setStage }

await import('./main')
