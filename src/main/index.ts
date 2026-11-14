import { spawn } from 'node:child_process'
import { lstatSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, powerMonitor, shell, type MenuItemConstructorOptions } from 'electron'
import { APP_ID, IPC, PET_IDS } from '../shared/constants'
import { formatBytes } from '../shared/format'
import type { ActionResult, FeedEvent, HubView, PetId, PetStatus, RepoAction, Settings, SignInCode, SignInResult } from '../shared/types'
import { clientId, DeviceFlow } from './github-auth'
import { GitHubWatcher, moodFrom, type GitHubData } from './github'
import { hubWindow, openHub } from './hub-window'
import { installStartMenuShortcut, rebuildIfStale } from './launcher'
import { OverlayManager } from './overlay'
import { catbotFeedText, catbotStatus, newContributions } from './pets/catbot'
import { DustyService } from './pets/dusty'
import { SyncyService } from './pets/syncy'
import { normalizeSettings, Store } from './store'
import { AppTray } from './tray'
import { WindowTracker } from './windows'

if (process.argv.includes('--install-shortcut')) {
  // `npm run install-app`: add GitGremlin to the Start menu, then exit.
  app.whenReady().then(() => {
    try {
      console.log(`[GitGremlin] Start menu shortcut: ${installStartMenuShortcut()}`)
      app.exit(0)
    } catch (err) {
      console.error(`[GitGremlin] ${(err as Error).message}`)
      app.exit(1)
    }
  })
} else if (!app.requestSingleInstanceLock()) {
  // Already running: the running copy got our arguments. Exit at once, before
  // Chromium starts up and fights the running copy over its cache folders.
  app.exit(0)
} else if (rebuildIfStale()) {
  // Relaunching with the fresh build.
} else {
  app.setAppUserModelId(APP_ID)
  app.whenReady().then(start)
  // A second launch forwards its arguments here: `GitGremlin --feed [pet]`
  // (debug snack), `--say "text"` (Catbot speaks), `--settings`; otherwise open the panel.
  app.on('second-instance', (_e, argv) => {
    if (!store) return
    // Chromium inserts its own --switches into argv, so take the first non-switch after a flag.
    const after = (flag: string) => {
      const at = argv.indexOf(flag)
      return at >= 0 ? argv.slice(at + 1).find((a) => !a.startsWith('--')) : undefined
    }
    const petArg = (flag: string): PetId => (PET_IDS.includes(after(flag) as PetId) ? (after(flag) as PetId) : 'catbot')
    const sayText = after('--say')
    if (argv.includes('--feed')) {
      const pet = petArg('--feed')
      const text = pet === 'dusty' ? 'MMM, A TEST CRUMB!' : pet === 'syncy' ? 'CRUNCHY LOG!' : catbotFeedText(1)
      feed(pet, { text, debug: true })
    } else if (argv.includes('--scan')) void dusty.scan()
    else if (argv.includes('--check')) void syncy.check()
    else if (sayText) overlays.sendToPet('catbot', IPC.say, sayText.toUpperCase())
    else if (argv.includes('--settings')) openHub()
    else if (overlays.isHidden) setHidden(false)
    else openHub()
  })
}

let store: Store
let overlays: OverlayManager
let tracker: WindowTracker
let github: GitHubWatcher
let dusty: DustyService
let syncy: SyncyService
let tray: AppTray
let hideTimer: NodeJS.Timeout | null = null
let hinted = false

function start(): void {
  store = new Store()
  store.load()
  nativeTheme.themeSource = store.state.settings.theme

  tracker = new WindowTracker(
    (ledge) => overlays.broadcast(IPC.ledge, ledge),
    (pet, hwnd) => overlays.sendToPet(pet as PetId, IPC.standingLost, hwnd)
  )
  overlays = new OverlayManager({
    getSettings: () => store.state.settings,
    getStatus: status,
    getLedge: () => tracker.ledge,
    initialSnapshots: store.state.pets,
    onSnapshot: (id, snap) => {
      store.state.pets[id] = snap
      store.saveSoon()
    },
    onStanding: (id, hwnd) => tracker.setStanding(id, hwnd),
    onOpenHub: (id) => openHub(id)
  })
  github = new GitHubWatcher(store, onGitHub)
  dusty = new DustyService(store, {
    changed: () => pushStatus(),
    feed: (text) => feed('dusty', { text }),
    say: (text) => overlays.sendToPet('dusty', IPC.say, text)
  })
  syncy = new SyncyService(store, {
    changed: () => pushStatus(),
    feed: (text) => feed('syncy', { text }),
    say: (text) => overlays.sendToPet('syncy', IPC.say, text)
  })
  tray = new AppTray({
    openHub: (page) => openHub(page),
    setPetEnabled: (id, enabled) => {
      store.state.settings.pets[id].enabled = enabled
      overlays.syncPets()
      changed()
    },
    catbotRefresh: () => void github.refresh(),
    catbotFeed: () => feed('catbot', { text: catbotFeedText(1), debug: true }),
    dustyScan: () => void dusty.scan(),
    dustyReview: () => openHub('dusty'),
    syncyCheck: () => void syncy.check(),
    syncyReview: () => openHub('syncy'),
    hideForHour: () => setHidden(true, 60 * 60_000),
    showPets: () => setHidden(false),
    toggleStartWithWindows: () => {
      setStartWithWindows(!startWithWindows())
      changed()
    },
    quit: () => app.quit()
  })

  overlays.start()
  tracker.start()
  github.start()
  dusty.start()
  syncy.start()
  if (github.source === 'none') hintSignIn(6000)
  registerHubIpc()

  // Catch up as soon as the PC wakes or unlocks.
  powerMonitor.on('unlock-screen', () => void github.refresh())
  powerMonitor.on('resume', () => void github.refresh())

  // Re-evaluate every minute (the new day starts at midnight).
  setInterval(pushStatus, 60_000)
  pushStatus()
}

function hintSignIn(delay: number): void {
  if (hinted || !store.state.settings.pets.catbot.enabled) return
  hinted = true
  setTimeout(() => overlays.sendToPet('catbot', IPC.say, 'SIGN IN WITH GITHUB SO I KNOW IF YOU CODED TODAY! RIGHT-CLICK ME.'), delay)
}

function status(id: PetId): PetStatus {
  const cfg = store.state.settings.pets[id]
  if (id === 'catbot') return catbotStatus(cfg, github.data, github.source !== 'none')
  return id === 'dusty' ? dusty.status(cfg) : syncy.status(cfg)
}

function allStatus(): Record<PetId, PetStatus> {
  return Object.fromEntries(PET_IDS.map((id) => [id, status(id)])) as Record<PetId, PetStatus>
}

/** Push fresh status to the pets, the tray and the panel. */
function pushStatus(): void {
  const all = allStatus()
  for (const id of PET_IDS) overlays.sendToPet(id, IPC.status, all[id])
  tray.update({ settings: store.state.settings, status: all, hidden: overlays.isHidden, startWithWindows: startWithWindows() })
  notifyHub()
}

let hubTimer: NodeJS.Timeout | null = null
/** Tell the panel to re-read its view (debounced). */
function notifyHub(): void {
  if (!hubWindow() || hubTimer) return
  hubTimer = setTimeout(() => {
    hubTimer = null
    hubWindow()?.webContents.send(IPC.hubChanged)
  }, 150)
}

/** New contribution data: update Catbot's mood, and feed it for any new contributions today. */
function onGitHub(data: GitHubData, previous: GitHubData): void {
  pushStatus()
  const { delta, level, prevLevel } = newContributions(data, previous)
  if (delta > 0) {
    feed('catbot', { text: catbotFeedText(delta) })
    if (level > prevLevel && prevLevel > 0) {
      setTimeout(() => overlays.sendToPet('catbot', IPC.say, `LEVEL UP! TODAY'S SQUARE IS NOW ${level}/4`), 4500)
    }
  }
  if (github.source === 'none') hintSignIn(5000)
}

/** Play a pet's eating animation. */
function feed(id: PetId, ev: FeedEvent): void {
  overlays.sendToPet(id, IPC.feed, ev)
}

/** Settings changed: tell everyone and save. */
function changed(): void {
  store.saveSoon()
  overlays.broadcast(IPC.settingsChanged, store.state.settings)
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

/** Whether the GitHub CLI is signed in (cached briefly: it spawns a process). */
let ghCache = { at: 0, ok: false }
async function ghAvailable(): Promise<boolean> {
  if (Date.now() - ghCache.at > 60_000) ghCache = { at: Date.now(), ok: (await github.ghToken()) !== null }
  return ghCache.ok
}

async function hubView(): Promise<HubView> {
  const data = github.data
  const linked = github.source !== 'none'
  const mood = moodFrom(data.days)
  return {
    version: app.getVersion(),
    hidden: overlays.isHidden,
    settings: store.state.settings,
    startWithWindows: startWithWindows(),
    status: allStatus(),
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
      ghAvailable: await ghAvailable()
    },
    dusty: dusty.view(),
    syncy: syncy.view()
  }
}

const deviceFlow = new DeviceFlow()

/** Tell the panel how a sign-in attempt ended. */
function signInResult(win: BrowserWindow | null, result: SignInResult): void {
  if (win && !win.isDestroyed()) win.webContents.send(IPC.githubAuthResult, result)
}

function linkedHello(): void {
  overlays.sendToPet('catbot', IPC.say, `LINKED TO @${github.data.login}! LET'S SEE YOUR SQUARES.`)
}

/** The menu you get by right-clicking a pet: its own actions, then GitGremlin's. */
function showPetMenu(id: PetId): void {
  const cfg = store.state.settings.pets[id]
  const s = status(id)
  const own: MenuItemConstructorOptions[] = []
  if (id === 'catbot') {
    if (github.source === 'none') own.push({ label: 'Sign in with GitHub...', click: () => openHub('catbot') })
    else own.push({ label: 'Refresh GitHub now', click: () => void github.refresh() }, { label: 'Show my contributions...', click: () => openHub('catbot') })
  } else if (id === 'dusty') {
    const junk = dusty.cleanable().reduce((n, c) => n + c.bytes, 0)
    own.push(
      { label: junk ? `Review ${formatBytes(junk)} of junk...` : 'Review junk...', click: () => openHub('dusty') },
      { label: 'Scan for junk now', enabled: !dusty.busy, click: () => void dusty.scan() }
    )
  } else {
    own.push(
      { label: s.alert ? 'Review unsaved work...' : 'Show my repos...', click: () => openHub('syncy') },
      { label: 'Check my repos now', enabled: !syncy.busy, click: () => void syncy.check() }
    )
  }
  const menu = Menu.buildFromTemplate([
    { label: cfg.name, enabled: false },
    { type: 'separator' },
    ...own,
    { type: 'separator' },
    { label: 'Open GitGremlin', click: () => openHub(id) },
    {
      label: `Put ${cfg.name} away`,
      click: () => {
        store.state.settings.pets[id].enabled = false
        overlays.syncPets()
        changed()
      }
    }
  ])
  tray.popUp(menu)
}

function registerHubIpc(): void {
  ipcMain.on(IPC.petMenu, (_e, id: unknown) => {
    if (PET_IDS.includes(id as PetId)) showPetMenu(id as PetId)
  })
  ipcMain.handle(IPC.hubGet, () => hubView())
  ipcMain.handle(IPC.settingsSave, async (_e, s: Settings, sww: boolean) => {
    const before = store.state.settings
    const next = normalizeSettings(s)
    store.state.settings = next
    overlays.setOnTop(next.onTopOfApps)
    nativeTheme.themeSource = next.theme
    overlays.syncPets()
    if (next.dusty.scanEveryMinutes !== before.dusty.scanEveryMinutes) dusty.reschedule()
    // A newly enabled place to look (or Dusty switched on): sniff around right away.
    const newTarget = (Object.keys(next.dusty.targets) as (keyof typeof next.dusty.targets)[]).some(
      (t) => next.dusty.targets[t] && !before.dusty.targets[t]
    )
    if (newTarget || (next.pets.dusty.enabled && !before.pets.dusty.enabled)) setTimeout(() => void dusty.scan(), 500)
    // Syncy: new interval, or new places to look (or switched on): check again right away.
    const a = before.syncy
    const b = next.syncy
    if (b.scanEveryMinutes !== a.scanEveryMinutes) syncy.reschedule()
    const where = (c: typeof a) => JSON.stringify([c.autoFind, c.folders, c.ignored, c.trackBranches])
    if (where(a) !== where(b) || (next.pets.syncy.enabled && !before.pets.syncy.enabled)) setTimeout(() => void syncy.check(), 500)
    if (sww !== startWithWindows()) setStartWithWindows(Boolean(sww))
    changed()
    return hubView()
  })

  // --- Syncy ---------------------------------------------------------------------------
  ipcMain.handle(IPC.syncyScan, async () => {
    await syncy.check()
    return hubView()
  })
  ipcMain.handle(IPC.syncyAction, (_e, action: RepoAction) => repoAction(action))
  ipcMain.handle(IPC.hidePets, (_e, hide: boolean) => {
    if (hide) setHidden(true, 60 * 60_000)
    else setHidden(false)
    return hubView()
  })
  ipcMain.handle(IPC.pickFolder, async (e): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = { title: 'Choose a folder with your repos', properties: ['openDirectory' as const] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })

  // --- Dusty ---------------------------------------------------------------------------
  ipcMain.handle(IPC.dustyScan, async () => {
    await dusty.scan()
    return hubView()
  })
  ipcMain.handle(IPC.dustyClean, async (_e, ids: unknown) => {
    // Only categories from the last scan that are currently cleanable.
    const allowed = new Set(dusty.cleanable().map((c) => c.id))
    const which = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string' && allowed.has(x)) : []
    if (which.length) await dusty.clean(which)
    return hubView()
  })

  // --- Catbot / GitHub -----------------------------------------------------------------
  ipcMain.handle(IPC.githubRefresh, async () => {
    await github.refresh()
    return hubView()
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
        linkedHello()
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
      linkedHello()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
  ipcMain.handle(IPC.githubSignOut, async () => {
    deviceFlow.cancel()
    github.signOut()
    changed()
    return hubView()
  })
  ipcMain.handle(IPC.openExternal, (_e, url: string) => {
    // Only ever open GitHub pages from the panel.
    if (/^https:\/\/github\.com\//.test(url)) void shell.openExternal(url)
  })
}

app.on('window-all-closed', () => {
  // Stay alive in the tray.
})

app.on('before-quit', () => {
  if (overlays) for (const id of PET_IDS) store.state.pets[id] = overlays.snapshot(id) ?? store.state.pets[id]
  store?.flush()
  github?.stop()
  dusty?.stop()
  syncy?.stop()
  tracker?.stop()
  overlays?.stop()
  tray?.destroy()
})

/** A repo the panel may act on: one from Syncy's last check, or an ignored one. */
function knownRepo(path: unknown): string | null {
  if (typeof path !== 'string') return null
  const key = resolve(path).toLowerCase()
  const known = [...(store.state.syncy.lastScan?.repos.map((r) => r.path) ?? []), ...store.state.settings.syncy.ignored]
  return known.find((p) => resolve(p).toLowerCase() === key) ?? null
}

/** Is this file there? (lstat, because Windows Terminal is an app alias that existsSync can't follow.) */
function present(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

/** A new PowerShell window in a folder. `start` gives it its own visible console. */
function openPowerShell(dir: string): void {
  spawn('cmd.exe', ['/c', 'start', '', 'powershell.exe', '-NoExit'], { cwd: dir, detached: true, stdio: 'ignore', windowsHide: true }).unref()
}

/** Open a terminal in a folder: Windows Terminal if installed, otherwise PowerShell. */
function openTerminal(dir: string): void {
  const wt = join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WindowsApps', 'wt.exe')
  if (!present(wt)) return openPowerShell(dir)
  const child = spawn(wt, ['-d', dir], { cwd: dir, detached: true, stdio: 'ignore' })
  child.on('error', () => openPowerShell(dir))
  child.unref()
}

async function repoAction(action: RepoAction): Promise<ActionResult> {
  const path = knownRepo(action?.path)
  if (!path) return { ok: false, message: 'Unknown repo.' }
  const cfg = store.state.settings.syncy
  switch (action.kind) {
    case 'open': {
      const err = await shell.openPath(path)
      return { ok: !err, message: err || 'Opened.' }
    }
    case 'terminal':
      openTerminal(path)
      return { ok: true, message: 'Opened a terminal.' }
    case 'ignore': {
      if (!cfg.ignored.some((p) => resolve(p).toLowerCase() === resolve(path).toLowerCase())) cfg.ignored.push(path)
      const scan = store.state.syncy.lastScan
      if (scan) scan.repos = scan.repos.filter((r) => r.path !== path)
      changed()
      return { ok: true, message: 'Syncy will leave that repo alone.' }
    }
    case 'unignore':
      cfg.ignored = cfg.ignored.filter((p) => resolve(p).toLowerCase() !== resolve(path).toLowerCase())
      changed()
      setTimeout(() => void syncy.check(), 300)
      return { ok: true, message: 'Syncy is watching that repo again.' }
    case 'deleteBranches':
      return syncy.deleteMerged(path, Array.isArray(action.branches) ? action.branches.filter((b) => typeof b === 'string') : [])
  }
}
