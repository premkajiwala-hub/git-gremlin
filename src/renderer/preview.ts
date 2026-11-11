/**
 * Dev-only browser preview of the overlay renderer: a fake desktop, a fake
 * focused window and buttons to drive Catbot's states. Open
 * http://localhost:5173/preview.html while `npm start` is running.
 */
import { DEFAULT_SETTINGS } from '../shared/constants'
import type { ContributionLevel, DisplayInfo, FeedEvent, OverlayInit, PetStatus, Settings, WindowLedge } from '../shared/types'

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
let status: PetStatus = {
  name: 'Catbot',
  stage: 'fed',
  level: 2,
  todayCount: 5,
  streak: 4,
  week: [0, 1, 2, 2, 3, 1, 2],
  login: 'preview-user',
  connected: true
}
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

/** Set today's contribution count/level, like a square on the GitHub chart. */
function setLevel(level: ContributionLevel, count: number, starving = false): void {
  const week = [...status.week.slice(1, 6), starving ? 0 : 1, level] as ContributionLevel[]
  status = { ...status, level, todayCount: count, stage: count > 0 ? 'fed' : starving ? 'starving' : 'hungry', week }
  emit('status', status)
}
const setStage = (stage: PetStatus['stage']) => setLevel(stage === 'fed' ? 2 : 0, stage === 'fed' ? 5 : 0, stage === 'starving')

const actions: Record<string, () => void> = {
  Feed: () => emit('feed', { commits: 2 } satisfies FeedEvent),
  Say: () => emit('say', 'HELLO! I AM CATBOT. BEEP BOOP, FEED ME COMMITS.'),
  Starving: () => setLevel(0, 0, true),
  '0 (hungry)': () => setLevel(0, 0),
  '1 Less': () => setLevel(1, 2),
  '2': () => setLevel(2, 5),
  '3': () => setLevel(3, 8),
  '4 More': () => setLevel(4, 14),
  'Not linked': () => {
    status = { ...status, connected: !status.connected }
    emit('status', status)
  },
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
