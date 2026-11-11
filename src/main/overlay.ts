import { join } from 'node:path'
import { BrowserWindow, ipcMain, screen, type IpcMainEvent } from 'electron'
import { DESKTOP_REASSERT_MS, IPC, TOPMOST_REASSERT_MS } from '../shared/constants'
import type { DisplayInfo, OverlayInit, PetPose, PetSnapshot, PetStatus, Settings, WindowLedge } from '../shared/types'
import { getDisplayInfos } from './displays'
import { desktopVisibleAt, forceTopmost, hwndOf, keepAboveDesktop, nativeAvailable } from './native'

export interface OverlayOptions {
  getSettings: () => Settings
  getStatus: () => PetStatus
  getLedge: () => WindowLedge | null
  /** Last known pet state (restored from disk on startup). */
  initialSnapshot: PetSnapshot | null
  onSnapshot?: (snap: PetSnapshot) => void
  /** Catbot started (hwnd) or stopped (0) standing on a window. */
  onStanding?: (hwnd: number) => void
}

interface Overlay {
  win: BrowserWindow
  display: DisplayInfo
  hwnd: number
}

/**
 * One transparent, frameless, click-through window per monitor. Exactly one
 * overlay "owns" the pet at a time and runs its simulation; the others sleep
 * until the pet walks onto their monitor.
 *
 * Layering:
 * - desktop mode (default): the overlays sit just above the desktop, so app
 *   windows cover the pet and it only shows where the wallpaper shows;
 * - on-top mode: the overlays sit at the top of the topmost band, above every
 *   app and the taskbar.
 */
export class OverlayManager {
  private overlays = new Map<number, Overlay>()
  private displays: DisplayInfo[] = []
  private ownerId = -1
  private lastSnapshot: PetSnapshot | null
  private hidden = false
  private onTop: boolean
  private zTimer: NodeJS.Timeout | null = null
  private rebuildTimer: NodeJS.Timeout | null = null

  constructor(private opts: OverlayOptions) {
    this.lastSnapshot = opts.initialSnapshot
    this.onTop = opts.getSettings().onTopOfApps
    this.registerIpc()
  }

  start(): void {
    this.rebuild()
    screen.on('display-added', () => this.scheduleRebuild())
    screen.on('display-removed', () => this.scheduleRebuild())
    screen.on('display-metrics-changed', () => this.scheduleRebuild())
    this.startZTimer()
  }

  stop(): void {
    if (this.zTimer) clearInterval(this.zTimer)
    for (const o of this.overlays.values()) o.win.destroy()
    this.overlays.clear()
  }

  /** Switch between "only on the desktop" and "on top of every app". */
  setOnTop(onTop: boolean): void {
    if (onTop === this.onTop) return
    this.onTop = onTop
    for (const o of this.overlays.values()) {
      if (o.win.isDestroyed()) continue
      o.win.setAlwaysOnTop(onTop, 'screen-saver')
    }
    this.startZTimer()
    this.reassertZ()
  }

  get snapshot(): PetSnapshot | null {
    return this.lastSnapshot
  }

  get ownerWindow(): BrowserWindow | null {
    return this.overlays.get(this.ownerId)?.win ?? null
  }

  /** Send a message to whichever overlay currently owns the pet. */
  sendToPet(channel: string, ...args: unknown[]): void {
    const win = this.ownerWindow
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
  }

  broadcast(channel: string, ...args: unknown[]): void {
    for (const o of this.overlays.values()) {
      if (!o.win.isDestroyed()) o.win.webContents.send(channel, ...args)
    }
  }

  setHidden(hidden: boolean): void {
    this.hidden = hidden
    for (const o of this.overlays.values()) {
      if (hidden) o.win.hide()
      else o.win.showInactive()
    }
    if (!hidden) this.reassertZ()
  }

  get isHidden(): boolean {
    return this.hidden
  }

  // ---------------------------------------------------------------------------

  private startZTimer(): void {
    if (this.zTimer) clearInterval(this.zTimer)
    this.zTimer = setInterval(() => this.reassertZ(), this.onTop ? TOPMOST_REASSERT_MS : DESKTOP_REASSERT_MS)
  }

  private scheduleRebuild(): void {
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer)
    this.rebuildTimer = setTimeout(() => this.rebuild(), 400)
  }

  /** Create, update or destroy overlay windows to match the current monitors. */
  private rebuild(): void {
    this.displays = getDisplayInfos()
    const ids = new Set(this.displays.map((d) => d.id))

    for (const [id, o] of this.overlays) {
      if (!ids.has(id)) {
        o.win.destroy()
        this.overlays.delete(id)
      }
    }

    for (const d of this.displays) {
      const existing = this.overlays.get(d.id)
      if (existing) {
        existing.display = d
        existing.win.setBounds(overlayBounds(d))
      } else {
        this.overlays.set(d.id, this.createOverlay(d))
      }
    }

    // Pick (or re-pick) the owner: the monitor containing the pet, else primary.
    if (!this.overlays.has(this.ownerId)) {
      this.ownerId = this.displayForSnapshot(this.lastSnapshot)?.id ?? this.primaryId()
      this.sendToPet(IPC.adopt, this.clampSnapshot(this.lastSnapshot, this.ownerId))
    }

    for (const o of this.overlays.values()) {
      if (!o.win.isDestroyed() && !o.win.webContents.isLoading()) {
        o.win.webContents.send(IPC.displaysChanged, o.display, this.displays)
      }
    }
  }

  private createOverlay(d: DisplayInfo): Overlay {
    const win = new BrowserWindow({
      ...overlayBounds(d),
      type: 'toolbar', // WS_EX_TOOLWINDOW on Windows: hidden from Alt+Tab
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      thickFrame: false,
      roundedCorners: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false, // never steals focus from the app you're working in
      skipTaskbar: true,
      alwaysOnTop: this.onTop,
      enableLargerThanScreen: true,
      title: 'GitGremlin',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        spellcheck: false
      }
    })

    if (this.onTop) win.setAlwaysOnTop(true, 'screen-saver')
    win.setIgnoreMouseEvents(true, { forward: true })
    win.setMenu(null)

    const url = process.env['ELECTRON_RENDERER_URL']
    if (url) void win.loadURL(`${url}/index.html`)
    else void win.loadFile(join(__dirname, '../renderer/index.html'))

    win.once('ready-to-show', () => {
      // Windows may nudge frameless windows on creation; pin them back exactly.
      win.setBounds(overlayBounds(d))
      if (!this.hidden) win.showInactive()
      this.reassertZ()
    })
    win.on('always-on-top-changed', (_e, isOnTop) => {
      if (this.onTop && !isOnTop) win.setAlwaysOnTop(true, 'screen-saver')
    })

    return { win, display: d, hwnd: hwndOf(win) }
  }

  private reassertZ(): void {
    if (this.hidden) return
    for (const o of this.overlays.values()) {
      if (o.win.isDestroyed() || !o.win.isVisible()) continue
      if (this.onTop) {
        if (!nativeAvailable || !forceTopmost(o.hwnd)) {
          o.win.setAlwaysOnTop(true, 'screen-saver')
          o.win.moveTop()
        }
      } else if (nativeAvailable) {
        keepAboveDesktop(o.hwnd)
      }
    }
  }

  private registerIpc(): void {
    ipcMain.handle(IPC.getInit, (e): OverlayInit | null => {
      const o = this.overlayFor(e.sender.id)
      if (!o) return null
      const isOwner = o.display.id === this.ownerId
      return {
        display: o.display,
        displays: this.displays,
        isOwner,
        snapshot: isOwner ? this.clampSnapshot(this.lastSnapshot, o.display.id) : null,
        settings: this.opts.getSettings(),
        status: this.opts.getStatus(),
        ledge: this.opts.getLedge()
      }
    })

    ipcMain.on(IPC.standing, (e: IpcMainEvent, hwnd: number) => {
      const o = this.overlayFor(e.sender.id)
      if (!o || o.display.id !== this.ownerId) return
      this.opts.onStanding?.(hwnd)
    })

    // Where the cursor is, and whether the desktop is what's visible under it
    // (in desktop mode an app window may be covering Catbot).
    ipcMain.handle(IPC.cursor, () => {
      const p = screen.getCursorScreenPoint()
      let visible = true
      if (!this.onTop && nativeAvailable) {
        const phys = screen.dipToScreenPoint(p)
        const ours = new Set([...this.overlays.values()].map((o) => o.hwnd))
        visible = desktopVisibleAt(phys.x, phys.y, ours)
      }
      return { x: p.x, y: p.y, visible }
    })

    ipcMain.on(IPC.setInteractive, (e: IpcMainEvent, interactive: boolean) => {
      const o = this.overlayFor(e.sender.id)
      if (!o) return
      o.win.setIgnoreMouseEvents(!interactive, { forward: true })
    })

    ipcMain.on(IPC.handoff, (e: IpcMainEvent, targetId: number, snap: PetSnapshot) => {
      const from = this.overlayFor(e.sender.id)
      if (!from || from.display.id !== this.ownerId) return
      const target = this.overlays.get(targetId)
      this.lastSnapshot = snap
      if (!target) {
        from.win.webContents.send(IPC.adopt, snap)
        return
      }
      this.ownerId = targetId
      from.win.webContents.send(IPC.release)
      from.win.setIgnoreMouseEvents(true, { forward: true })
      target.win.webContents.send(IPC.adopt, snap)
    })

    ipcMain.on(IPC.pose, (e: IpcMainEvent, pose: PetPose | null) => {
      for (const o of this.overlays.values()) {
        if (o.win.webContents.id !== e.sender.id && !o.win.isDestroyed()) {
          o.win.webContents.send(IPC.mirror, pose)
        }
      }
    })

    ipcMain.on(IPC.snapshot, (e: IpcMainEvent, snap: PetSnapshot) => {
      const o = this.overlayFor(e.sender.id)
      if (!o || o.display.id !== this.ownerId) return
      this.lastSnapshot = snap
      this.opts.onSnapshot?.(snap)
    })
  }

  private overlayFor(webContentsId: number): Overlay | undefined {
    for (const o of this.overlays.values()) {
      if (!o.win.isDestroyed() && o.win.webContents.id === webContentsId) return o
    }
    return undefined
  }

  private primaryId(): number {
    return this.displays.find((d) => d.primary)?.id ?? this.displays[0]?.id ?? -1
  }

  private displayForSnapshot(snap: PetSnapshot | null): DisplayInfo | undefined {
    if (!snap) return undefined
    return this.displays.find(
      (d) =>
        snap.x >= d.bounds.x &&
        snap.x < d.bounds.x + d.bounds.width &&
        snap.y >= d.bounds.y &&
        snap.y <= d.bounds.y + d.bounds.height
    )
  }

  /** Make sure a restored snapshot actually lies on the given display. */
  private clampSnapshot(snap: PetSnapshot | null, displayId: number): PetSnapshot | null {
    const d = this.displays.find((x) => x.id === displayId)
    if (!snap || !d) return snap
    if (this.displayForSnapshot(snap)?.id === displayId) return snap
    return { ...snap, x: d.workArea.x + d.workArea.width / 2, y: d.groundY, vx: 0, vy: 0, grounded: true }
  }
}

/**
 * Full display bounds (not the work area) so the pet can reach the taskbar in
 * on-top mode. One pixel shorter than the monitor so Windows doesn't treat the
 * overlay as a full-screen app (which can trigger Do Not Disturb or hide the taskbar).
 */
function overlayBounds(d: DisplayInfo) {
  return { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height - 1 }
}
