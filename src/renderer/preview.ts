/**
 * Dev-only browser preview of the overlay renderer: a fake desktop, a fake
 * focused window and buttons to drive every pet's states. Open
 * http://localhost:5173/preview.html while `npm start` is running.
 */
import { DEFAULT_SETTINGS, GRID_MARK } from '../shared/constants'
import type { ContributionLevel, DisplayInfo, OverlayInit, PetId, PetStatus, Settings, WindowLedge } from '../shared/types'

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
const settings: Settings = structuredClone(DEFAULT_SETTINGS)
settings.pets.catbot.petSize = 96
settings.pets.dusty.petSize = 88

let week: ContributionLevel[] = [0, 1, 2, 2, 3, 1, 2]
const catbot = (level: ContributionLevel, count: number, starving = false): PetStatus => ({
  name: 'Catbot',
  stage: count > 0 ? 'fed' : starving ? 'starving' : 'hungry',
  level,
  report: [`TODAY: ${count} CONTRIBUTIONS`, `MOOD: LEVEL ${level}/4`, 'LAST 7 DAYS:', GRID_MARK, '', '> PREVIEW MODE.'],
  grid: week,
  alert: null,
  busy: null,
  connected: true
})
const dusty = (busy: PetStatus['busy'], alert: string | null = null): PetStatus => ({
  name: 'Dusty',
  stage: 'fed',
  level: alert ? 2 : 3,
  report: [alert ? 'JUNK FOUND: 1.2 GB' : 'ALL CLEAN!', 'MODE: ASK FIRST', 'LAST SCAN: 3M AGO', '', '> PREVIEW MODE.'],
  grid: null,
  alert,
  busy,
  connected: true
})
const syncy = (stale: boolean): PetStatus => ({
  name: 'Syncy',
  stage: 'fed',
  level: stale ? 2 : 4,
  report: stale ? ['WATCHING 7 REPOS', 'NOT ON GITHUB: 2 REPOS', '- API: 3 UNPUSHED, 4D', '', '> RIGHT-CLICK ME TO SEE THEM.'] : ['WATCHING 7 REPOS', 'ALL WORK IS ON GITHUB!'],
  grid: null,
  alert: stale ? "2 REPOS HAVE WORK THAT ISN'T ON GITHUB! RIGHT-CLICK ME." : null,
  busy: null,
  connected: true
})
const status: Record<PetId, PetStatus> = { catbot: catbot(2, 5), dusty: dusty(null), syncy: syncy(false) }

const fake = document.getElementById('fakewin')!.getBoundingClientRect()
const ledge: WindowLedge = { hwnd: 42, x: fake.left, y: fake.top, width: fake.width, height: fake.height }
let cursor = { x: -1000, y: -1000 }
window.addEventListener('mousemove', (e) => (cursor = { x: e.clientX, y: e.clientY }))

const init: OverlayInit = {
  display,
  displays: [display],
  settings,
  pets: (['catbot', 'dusty', 'syncy'] as PetId[]).map((id) => ({ id, isOwner: true, snapshot: null, status: status[id] })),
  ledge
}

;(window as any).gremlin = {
  getInit: async () => init,
  setInteractive: () => {},
  getCursor: async () => ({ ...cursor, visible: true }),
  handoff: () => {},
  sendPose: () => {},
  sendSnapshot: () => {},
  setStanding: () => {},
  openHub: (id: string) => console.log('[preview] open hub', id),
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

const setStatus = (id: PetId, s: PetStatus) => {
  status[id] = s
  emit('status', id, s)
}
const level = (l: ContributionLevel, count: number, starving = false) => {
  week = [...week.slice(1, 6), starving ? 0 : 1, l] as ContributionLevel[]
  setStatus('catbot', catbot(l, count, starving))
}

const actions: Record<string, () => void> = {
  'Catbot: feed': () => emit('feed', 'catbot', { text: 'CRUNCHY COMMIT! +2 CONTRIBUTIONS' }),
  'Catbot: starving': () => level(0, 0, true),
  'Catbot: hungry': () => level(0, 0),
  'Catbot: level 2': () => level(2, 5),
  'Catbot: level 4': () => level(4, 14),
  'Dusty: scan': () => {
    setStatus('dusty', dusty('scanning'))
    window.setTimeout(() => setStatus('dusty', dusty(null, 'I SNIFFED OUT 1.2 GB OF JUNK! RIGHT-CLICK ME TO REVIEW.')), 9000)
  },
  'Dusty: clean': () => {
    setStatus('dusty', dusty('cleaning'))
    window.setTimeout(() => {
      setStatus('dusty', dusty(null))
      emit('feed', 'dusty', { text: 'MUNCHED 1.2 GB OF JUNK!' })
    }, 5000)
  },
  'Dusty: say': () => emit('say', 'dusty', 'TRASH PANDA REPORTING FOR DUTY.'),
  'Syncy: unpushed': () => setStatus('syncy', syncy(true)),
  'Syncy: pushed': () => {
    setStatus('syncy', syncy(false))
    emit('feed', 'syncy', { text: '3 COMMITS FROM API SAFE ON GITHUB!' })
  },
  'Window moved': () => {
    emit('standingLost', 'catbot', 42)
    emit('standingLost', 'dusty', 42)
  }
}
const panel = document.getElementById('panel')!
for (const [label, fn] of Object.entries(actions)) {
  const b = document.createElement('button')
  b.textContent = label
  b.addEventListener('click', fn)
  panel.append(b)
}
;(window as any).__preview = { emit, setStatus }

await import('./main')
