import { join } from 'node:path'
import { BrowserWindow, ipcMain, screen, type IpcMainEvent } from 'electron'
import { DESKTOP_REASSERT_MS, IPC, PET_IDS, TOPMOST_REASSERT_MS } from '../shared/constants'
import type { DisplayInfo, OverlayInit, PetId, PetPose, PetSnapshot, PetStatus, Settings, WindowLedge } from '../shared/types'
import { getDisplayInfos } from './displays'
import { desktopVisibleAt, forceTopmost, hwndOf, keepAboveDesktop, nativeAvailable } from './native'

export interface OverlayOptions {
  getSettings: () => Settings
  getStatus: (id: PetId) => PetStatus
  getLedge: () => WindowLedge | null
  /** Last known pet positions (restored from disk on startup). */
  initialSnapshots: Record<PetId, PetSnapshot | null>
  onSnapshot?: (id: PetId, snap: PetSnapshot) => void
  /** A pet started (hwnd) or stopped (0) standing on a window. */
  onStanding?: (id: PetId, hwnd: number) => void
  /** A pet asked to open its page in the GitGremlin panel. */
  onOpenHub?: (id: PetId) => void
}

interface Overlay {
  win: BrowserWindow
  display: DisplayInfo
  hwnd: number
}

/**
 * One transparent, frameless, click-through window per monitor, shared by all
 * pets. For each pet exactly one overlay "owns" it and runs its simulation;
 * when it walks onto another monitor, that overlay takes over.
 *
 * Layering:
 * - desktop mode (default): the overlays sit just above the desktop, so app
 *   windows cover the pets and they only show where the wallpaper shows;
 * - on-top mode: the overlays sit at the top of the topmost band, above every
 *   app and the taskbar.
 */
export class OverlayManager {
  private overlays = new Map<number, Overlay>()
  private displays: DisplayInfo[] = []
  /** Which display owns each enabled pet. */
  private owners = new Map<PetId, number>()
  private snapshots: Record<PetId, PetSnapshot | null>
  private hidden = false
  private onTop: boolean
  private zTimer: NodeJS.Timeout | null = null
  private rebuildTimer: NodeJS.Timeout | null = null

  constructor(private opts: OverlayOptions) {
    this.snapshots = { ...opts.initialSnapshots }
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

  private enabledPets(): PetId[] {
    const s = this.opts.getSettings()
    return PET_IDS.filter((id) => s.pets[id].enabled)
  }

  /** Re-read which pets are enabled: adopt newly enabled ones, release disabled ones. */
  syncPets(): void {
    const enabled = new Set(this.enabledPets())
    for (const [id, displayId] of this.owners) {
      if (enabled.has(id)) continue
      this.owners.delete(id)
      this.overlays.get(displayId)?.win.webContents.send(IPC.release, id)
    }
    this.assignOwners()
  }

  /** Give every enabled pet without an owner a monitor (where it was last, else the primary). */
  private assignOwners(): void {
    for (const id of this.enabledPets()) {
      if (this.owners.has(id) && this.overlays.has(this.owners.get(id)!)) continue
      const displayId = this.displayFor(this.snapshots[id])?.id ?? this.primaryId()
      this.owners.set(id, displayId)
      const o = this.overlays.get(displayId)
      if (o && !o.win.webContents.isLoading()) o.win.webContents.send(IPC.adopt, id, this.clampSnapshot(this.snapshots[id], displayId), this.opts.getStatus(id))
    }
  }

  /** Switch between "only on the desktop" and "on top of every app". */
  setOnTop(onTop: boolean): void {
    if (onTop === this.onTop) return
    this.onTop = onTop
    for (const o of this.overlays.values()) {
      if (!o.win.isDestroyed()) o.win.setAlwaysOnTop(onTop, 'screen-saver')
    }
    this.startZTimer()
    this.reassertZ()
  }

  snapshot(id: PetId): PetSnapshot | null {
    return this.snapshots[id]
  }

  /** Send a pet-specific message to whichever overlay owns that pet. */
  sendToPet(id: PetId, channel: string, ...args: unknown[]): void {
    const o = this.overlays.get(this.owners.get(id) ?? -1)
    if (o && !o.win.isDestroyed()) o.win.webContents.send(channel, id, ...args)
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

    this.assignOwners()

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
      return {
        display: o.display,
        displays: this.displays,
        settings: this.opts.getSettings(),
        pets: this.enabledPets().map((id) => {
          const isOwner = this.owners.get(id) === o.display.id
          return {
            id,
            isOwner,
            snapshot: isOwner ? this.clampSnapshot(this.snapshots[id], o.display.id) : null,
            status: this.opts.getStatus(id)
          }
        }),
        ledge: this.opts.getLedge()
      }
    })

    ipcMain.on(IPC.standing, (e: IpcMainEvent, id: PetId, hwnd: number) => {
      if (this.isOwner(e.sender.id, id)) this.opts.onStanding?.(id, hwnd)
    })

    ipcMain.on(IPC.openHub, (_e: IpcMainEvent, id: PetId) => this.opts.onOpenHub?.(id))

    // Where the cursor is, and whether the desktop is what's visible under it
    // (in desktop mode an app window may be covering the pets).
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

    ipcMain.on(IPC.handoff, (e: IpcMainEvent, id: PetId, targetId: number, snap: PetSnapshot) => {
      const from = this.overlayFor(e.sender.id)
      if (!from || this.owners.get(id) !== from.display.id) return
      const target = this.overlays.get(targetId)
      this.snapshots[id] = snap
      if (!target) {
        from.win.webContents.send(IPC.adopt, id, snap, this.opts.getStatus(id))
        return
      }
      this.owners.set(id, targetId)
      from.win.webContents.send(IPC.release, id)
      target.win.webContents.send(IPC.adopt, id, snap, this.opts.getStatus(id))
    })

    ipcMain.on(IPC.pose, (e: IpcMainEvent, id: PetId, pose: PetPose | null) => {
      for (const o of this.overlays.values()) {
        if (o.win.webContents.id !== e.sender.id && !o.win.isDestroyed()) o.win.webContents.send(IPC.mirror, id, pose)
      }
    })

    ipcMain.on(IPC.snapshot, (e: IpcMainEvent, id: PetId, snap: PetSnapshot) => {
      if (!this.isOwner(e.sender.id, id)) return
      this.snapshots[id] = snap
      this.opts.onSnapshot?.(id, snap)
    })
  }

  private isOwner(webContentsId: number, id: PetId): boolean {
    const o = this.overlayFor(webContentsId)
    return Boolean(o && this.owners.get(id) === o.display.id)
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

  private displayFor(snap: PetSnapshot | null): DisplayInfo | undefined {
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
    if (this.displayFor(snap)?.id === displayId) return snap
    return { ...snap, x: d.workArea.x + d.workArea.width / 2, y: d.groundY, vx: 0, vy: 0, grounded: true }
  }
}

/**
 * Full display bounds (not the work area) so pets can reach the taskbar in
 * on-top mode. One pixel shorter than the monitor so Windows doesn't treat the
 * overlay as a full-screen app (which can trigger Do Not Disturb or hide the taskbar).
 */
function overlayBounds(d: DisplayInfo) {
  return { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height - 1 }
}
