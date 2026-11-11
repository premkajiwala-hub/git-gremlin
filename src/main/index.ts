import { basename } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, powerMonitor } from 'electron'
import { APP_ID, DEFAULT_SETTINGS, IPC, PET_SIZE_MAX, PET_SIZE_MIN } from '../shared/constants'
import type { FeedEvent, PetStatus, RepoResult, Settings, SettingsView } from '../shared/types'
import { GitWatcher, type NewCommit } from './git'
import { Hunger } from './hunger'
import { OverlayManager } from './overlay'
import { openSettingsWindow, settingsWindow } from './settings-window'
import { Store } from './store'
import { AppTray } from './tray'
import { WindowTracker } from './windows'

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.setAppUserModelId(APP_ID)
  app.whenReady().then(start)
  // A second launch forwards its arguments here: `GitGremlin --feed` (debug
  // snack), `--say "text"` (speech bubble), `--settings`; otherwise show the pet.
  app.on('second-instance', (_e, argv) => {
    if (!store) return
    // Chromium inserts its own --switches into argv, so take the first non-switch after --say.
    const sayAt = argv.indexOf('--say')
    const sayText = sayAt >= 0 ? argv.slice(sayAt + 1).find((a) => !a.startsWith('--')) : undefined
    if (argv.includes('--feed')) feedNow()
    else if (argv.includes('--settings')) openSettingsWindow()
    else if (sayText) overlays.sendToPet(IPC.say, sayText.toUpperCase())
    else setHidden(false)
  })
}

function feedNow(): void {
  const foodHours = hunger.feed(40)
  feedPet({ commits: 1, lines: 40, foodHours, debug: true })
}

let store: Store
let hunger: Hunger
let overlays: OverlayManager
let tracker: WindowTracker
let git: GitWatcher
let tray: AppTray
let hideTimer: NodeJS.Timeout | null = null
let lastStage = ''

function start(): void {
  store = new Store()
  store.load()
  hunger = new Hunger(store)

  tracker = new WindowTracker((ledge) => overlays.broadcast(IPC.ledge, ledge))
  overlays = new OverlayManager({
    getSettings: () => store.state.settings,
    getStatus: status,
    getLedge: () => tracker.ledge,
    initialSnapshot: store.state.pet,
    onSnapshot: (snap) => {
      store.state.pet = snap
      store.saveSoon()
    }
  })
  git = new GitWatcher(store, onCommits)
  tray = new AppTray({
    feedNow,
    addRepo: () => void pickRepo(null),
    removeRepo: (path) => {
      git.removeRepo(path)
      changed()
    },
    togglePause: () => {
      hunger.setPaused(!hunger.paused)
      changed()
    },
    hideForHour: () => setHidden(true, 60 * 60_000),
    showPet: () => setHidden(false),
    openSettings: () => openSettingsWindow(),
    toggleStartWithWindows: () => {
      setStartWithWindows(!startWithWindows())
      changed()
    },
    quit: () => app.quit()
  })

  overlays.start()
  tracker.start()
  git.start()
  registerSettingsIpc()

  // Hunger pauses while the PC is locked or asleep.
  powerMonitor.on('lock-screen', () => hunger.setAsleep(true))
  powerMonitor.on('unlock-screen', () => hunger.setAsleep(false))
  powerMonitor.on('suspend', () => hunger.setAsleep(true))
  powerMonitor.on('resume', () => hunger.setAsleep(false))

  setInterval(() => {
    hunger.tick()
    pushStatus()
  }, 30_000)
  pushStatus()

  if (store.state.settings.repos.length === 0) {
    setTimeout(() => overlays.sendToPet(IPC.say, 'HI! RIGHT-CLICK MY TRAY ICON AND PICK "ADD REPO..." SO I CAN EAT YOUR COMMITS.'), 6000)
  }
}

function status(): PetStatus {
  return {
    name: store.state.settings.petName,
    stage: hunger.stage(),
    fullness: hunger.fullness(),
    lastCommitAt: store.state.hunger.lastCommitAt,
    quiet: hunger.quiet(),
    paused: hunger.paused,
    repoCount: store.state.settings.repos.length
  }
}

function pushStatus(): void {
  const s = status()
  overlays.broadcast(IPC.status, s)
  tray.update({
    status: s,
    repos: store.state.settings.repos,
    paused: hunger.paused,
    hidden: overlays.isHidden,
    startWithWindows: startWithWindows()
  })
  if (s.stage !== lastStage) {
    lastStage = s.stage
    store.saveSoon()
  }
}

/** Something user-visible changed: tell everyone and save. */
function changed(): void {
  store.saveSoon()
  pushStatus()
  overlays.broadcast(IPC.settingsChanged, store.state.settings)
  settingsWindow()?.webContents.send(IPC.settingsChanged, store.state.settings)
}

function onCommits(commits: NewCommit[]): void {
  let foodHours = 0
  let lines = 0
  for (const c of commits) {
    foodHours += hunger.feed(c.linesChanged, c.at)
    lines += c.linesChanged
  }
  feedPet({ commits: commits.length, lines, foodHours })
}

/** Hunger has already been updated; this plays the eat animation (off-screen if hidden). */
function feedPet(ev: FeedEvent): void {
  overlays.sendToPet(IPC.feed, ev)
  pushStatus()
}

function setHidden(hidden: boolean, ms?: number): void {
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = null
  overlays.setHidden(hidden)
  if (hidden) tracker.stop()
  else tracker.start()
  if (hidden && ms) hideTimer = setTimeout(() => setHidden(false), ms)
  pushStatus()
}

/**
 * Login item for the installed app, or for `electron <project>` in dev mode
 * (useful where Smart App Control blocks unsigned builds).
 */
function loginItem(): { path: string; args: string[] } {
  return { path: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] }
}

function startWithWindows(): boolean {
  return app.getLoginItemSettings(loginItem()).openAtLogin
}

function setStartWithWindows(on: boolean): void {
  app.setLoginItemSettings({ openAtLogin: on, ...loginItem() })
}

async function pickRepo(parent: BrowserWindow | null): Promise<RepoResult> {
  const opts: Electron.OpenDialogOptions = {
    title: 'Choose a git repository to watch',
    properties: ['openDirectory']
  }
  const res = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts)
  if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true }
  const result = await git.addRepo(res.filePaths[0])
  if (!result.ok) {
    const box: Electron.MessageBoxOptions = { type: 'warning', title: 'Not added', message: result.error ?? 'Could not add that folder.' }
    if (parent) await dialog.showMessageBox(parent, box)
    else await dialog.showMessageBox(box)
    return result
  }
  changed()
  overlays.sendToPet(IPC.say, `OOH, A NEW PANTRY: ${basename(result.path!)}!`)
  return result
}

async function settingsView(): Promise<SettingsView> {
  return {
    settings: store.state.settings,
    detectedEmail: await git.detectedEmail(),
    startWithWindows: startWithWindows()
  }
}

function sanitize(input: Settings): Settings {
  const cur = store.state.settings
  const num = (v: unknown, def: number, lo: number, hi: number) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def
  }
  const time = (v: unknown, def: string) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : def)
  const hours = [
    num(input.peckishAfterHours, DEFAULT_SETTINGS.peckishAfterHours, 0.1, 72),
    num(input.hungryAfterHours, DEFAULT_SETTINGS.hungryAfterHours, 0.1, 72),
    num(input.starvingAfterHours, DEFAULT_SETTINGS.starvingAfterHours, 0.1, 72)
  ].sort((a, b) => a - b)
  return {
    petName: String(input.petName ?? '').trim().slice(0, 24) || cur.petName,
    petSize: Math.round(num(input.petSize, DEFAULT_SETTINGS.petSize, PET_SIZE_MIN, PET_SIZE_MAX)),
    petSpeed: Math.round(num(input.petSpeed, DEFAULT_SETTINGS.petSpeed, 10, 150)),
    movement: input.movement === 'ground' ? 'ground' : 'roam',
    onTopOfApps: Boolean(input.onTopOfApps),
    peckishAfterHours: hours[0],
    hungryAfterHours: hours[1],
    starvingAfterHours: hours[2],
    quietHoursEnabled: Boolean(input.quietHoursEnabled),
    quietStart: time(input.quietStart, cur.quietStart),
    quietEnd: time(input.quietEnd, cur.quietEnd),
    gitEmail: String(input.gitEmail ?? '').trim(),
    repos: cur.repos // managed through add/remove
  }
}

function registerSettingsIpc(): void {
  ipcMain.handle(IPC.settingsGet, () => settingsView())
  ipcMain.handle(IPC.settingsSave, async (_e, s: Settings, sww: boolean) => {
    hunger.tick()
    store.state.settings = sanitize(s)
    overlays.setOnTop(store.state.settings.onTopOfApps)
    if (sww !== startWithWindows()) setStartWithWindows(Boolean(sww))
    changed()
    return settingsView()
  })
  ipcMain.handle(IPC.repoPick, (e) => pickRepo(BrowserWindow.fromWebContents(e.sender)))
  ipcMain.handle(IPC.repoRemove, (_e, path: string) => {
    git.removeRepo(path)
    changed()
    return settingsView()
  })
}

app.on('window-all-closed', () => {
  // Stay alive in the tray.
})

app.on('before-quit', () => {
  hunger?.tick()
  if (overlays?.snapshot) store.state.pet = overlays.snapshot
  store?.flush()
  git?.stop()
  tracker?.stop()
  overlays?.stop()
  tray?.destroy()
})
