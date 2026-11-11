import { app, BrowserWindow, clipboard, ipcMain, powerMonitor, shell } from 'electron'
import { APP_ID, DEFAULT_SETTINGS, IPC, PET_SIZE_MAX, PET_SIZE_MIN } from '../shared/constants'
import type { FeedEvent, PetStatus, Settings, SettingsView, SignInCode, SignInResult } from '../shared/types'
import { clientId, DeviceFlow } from './github-auth'
import { GitHubWatcher, localDate, moodFrom, type GitHubData } from './github'
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
    if (argv.includes('--feed')) feedPet({ commits: 1, debug: true })
    else if (argv.includes('--settings')) openSettingsWindow()
    else if (sayText) overlays.sendToPet(IPC.say, sayText.toUpperCase())
    else setHidden(false)
  })
}

let store: Store
let overlays: OverlayManager
let tracker: WindowTracker
let github: GitHubWatcher
let tray: AppTray
let hideTimer: NodeJS.Timeout | null = null
let hinted = false

function start(): void {
  store = new Store()
  store.load()

  tracker = new WindowTracker(
    (ledge) => overlays.broadcast(IPC.ledge, ledge),
    (hwnd) => overlays.sendToPet(IPC.standingLost, hwnd)
  )
  overlays = new OverlayManager({
    getSettings: () => store.state.settings,
    getStatus: status,
    getLedge: () => tracker.ledge,
    initialSnapshot: store.state.pet,
    onSnapshot: (snap) => {
      store.state.pet = snap
      store.saveSoon()
    },
    onStanding: (hwnd) => tracker.setStanding(hwnd)
  })
  github = new GitHubWatcher(store, onGitHub)
  tray = new AppTray({
    feedNow: () => feedPet({ commits: 1, debug: true }),
    refreshGitHub: () => void github.refresh(),
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
  github.start()
  if (github.source === 'none') {
    hinted = true
    setTimeout(() => overlays.sendToPet(IPC.say, 'SIGN IN WITH GITHUB IN SETTINGS SO I KNOW IF YOU CODED TODAY!'), 6000)
  }
  registerSettingsIpc()

  // Catch up as soon as the PC wakes or unlocks.
  powerMonitor.on('unlock-screen', () => void github.refresh())
  powerMonitor.on('resume', () => void github.refresh())

  // Re-evaluate every minute (the new day starts at midnight).
  setInterval(pushStatus, 60_000)
  pushStatus()
}

/** Catbot's mood, straight from today's square on the GitHub contribution chart. */
function status(): PetStatus {
  const data = github.data
  const mood = moodFrom(data.days)
  return {
    name: store.state.settings.petName,
    stage: mood.stage,
    level: mood.level,
    todayCount: mood.todayCount,
    streak: mood.streak,
    week: mood.week,
    login: data.login,
    connected: github.source !== 'none' && data.days.length > 0
  }
}

function pushStatus(): void {
  const s = status()
  overlays.broadcast(IPC.status, s)
  tray.update({ status: s, hidden: overlays.isHidden, startWithWindows: startWithWindows() })
}

/** New contribution data: update the mood, and feed Catbot for any new contributions today. */
function onGitHub(data: GitHubData, previous: GitHubData): void {
  const today = localDate()
  const before = previous.days.find((d) => d.date === today)?.count ?? 0
  const now = data.days.find((d) => d.date === today)?.count ?? 0
  const sameAccount = previous.login === data.login && previous.days.length > 0
  pushStatus()
  if (sameAccount && now > before) {
    feedPet({ commits: now - before })
    const prevLevel = previous.days.find((d) => d.date === today)?.level ?? 0
    const level = data.days.find((d) => d.date === today)?.level ?? 0
    if (level > prevLevel && prevLevel > 0) {
      setTimeout(() => overlays.sendToPet(IPC.say, `LEVEL UP! TODAY'S SQUARE IS NOW ${level}/4`), 4500)
    }
  }
  if (github.source === 'none' && !hinted) {
    hinted = true
    setTimeout(() => overlays.sendToPet(IPC.say, 'SIGN IN WITH GITHUB IN SETTINGS SO I KNOW IF YOU CODED TODAY!'), 5000)
  }
  settingsWindow()?.webContents.send(IPC.settingsChanged, store.state.settings)
}

/** Play the eating animation (contributions arrived, or a debug snack). */
function feedPet(ev: FeedEvent): void {
  overlays.sendToPet(IPC.feed, ev)
}

/** Something user-visible changed: tell everyone and save. */
function changed(): void {
  store.saveSoon()
  pushStatus()
  overlays.broadcast(IPC.settingsChanged, store.state.settings)
  settingsWindow()?.webContents.send(IPC.settingsChanged, store.state.settings)
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

async function settingsView(): Promise<SettingsView> {
  const data = github.data
  const linked = github.source !== 'none'
  const mood = moodFrom(data.days)
  return {
    settings: store.state.settings,
    github: {
      login: linked ? data.login : null,
      name: linked ? data.name : null,
      avatarUrl: linked ? data.avatarUrl : null,
      source: github.source,
      todayCount: mood.todayCount,
      level: mood.level,
      streak: mood.streak,
      week: mood.week,
      fetchedAt: data.fetchedAt,
      error: data.error,
      signInAvailable: clientId() !== '',
      ghAvailable: (await github.ghToken()) !== null
    },
    startWithWindows: startWithWindows()
  }
}

function sanitize(input: Settings): Settings {
  const cur = store.state.settings
  const num = (v: unknown, def: number, lo: number, hi: number) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def
  }
  return {
    petName: String(input.petName ?? '').trim().slice(0, 24) || cur.petName,
    petSize: Math.round(num(input.petSize, DEFAULT_SETTINGS.petSize, PET_SIZE_MIN, PET_SIZE_MAX)),
    petSpeed: Math.round(num(input.petSpeed, DEFAULT_SETTINGS.petSpeed, 10, 150)),
    movement: input.movement === 'ground' ? 'ground' : 'roam',
    onTopOfApps: Boolean(input.onTopOfApps),
    followCursor: Boolean(input.followCursor)
  }
}

const deviceFlow = new DeviceFlow()

/** Tell the settings window how a sign-in attempt ended. */
function signInResult(win: BrowserWindow | null, result: SignInResult): void {
  if (win && !win.isDestroyed()) win.webContents.send(IPC.githubAuthResult, result)
}

function registerSettingsIpc(): void {
  ipcMain.handle(IPC.settingsGet, () => settingsView())
  ipcMain.handle(IPC.settingsSave, async (_e, s: Settings, sww: boolean) => {
    store.state.settings = sanitize(s)
    overlays.setOnTop(store.state.settings.onTopOfApps)
    if (sww !== startWithWindows()) setStartWithWindows(Boolean(sww))
    changed()
    return settingsView()
  })
  ipcMain.handle(IPC.githubRefresh, async () => {
    await github.refresh()
    return settingsView()
  })

  // "Sign in with GitHub": get a one-time code, copy it, open github.com, then
  // wait for the user to approve GitGremlin on GitHub.
  ipcMain.handle(IPC.githubSignIn, async (e): Promise<SignInCode> => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const code = await deviceFlow.start(async ({ token, error }) => {
      if (!token) return signInResult(win, { ok: false, error })
      try {
        await github.linkOAuth(token)
        changed()
        overlays.sendToPet(IPC.say, `LINKED TO @${github.data.login}! LET'S SEE YOUR SQUARES.`)
        signInResult(win, { ok: true })
      } catch (err) {
        signInResult(win, { ok: false, error: (err as Error).message })
      }
    })
    clipboard.writeText(code.userCode)
    void shell.openExternal(code.verificationUri)
    return code
  })
  ipcMain.handle(IPC.githubCancelSignIn, () => deviceFlow.cancel())
  ipcMain.handle(IPC.githubUseCli, async (): Promise<SignInResult> => {
    try {
      await github.linkCli()
      changed()
      overlays.sendToPet(IPC.say, `LINKED TO @${github.data.login}! LET'S SEE YOUR SQUARES.`)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
  ipcMain.handle(IPC.githubSignOut, async () => {
    deviceFlow.cancel()
    github.signOut()
    changed()
    return settingsView()
  })
  ipcMain.handle(IPC.openExternal, (_e, url: string) => {
    // Only ever open GitHub pages from the settings window.
    if (/^https:\/\/github\.com\//.test(url)) void shell.openExternal(url)
  })
}

app.on('window-all-closed', () => {
  // Stay alive in the tray.
})

app.on('before-quit', () => {
  if (overlays?.snapshot) store.state.pet = overlays.snapshot
  store?.flush()
  github?.stop()
  tracker?.stop()
  overlays?.stop()
  tray?.destroy()
})
