import { screen } from 'electron'
import type { WindowLedge } from '../shared/types'
import { getForegroundHwnd, getWindowInfo, nativeAvailable } from './native'

/** Shell surfaces that aren't real app windows. */
const IGNORED_CLASSES = new Set([
  'Shell_TrayWnd',
  'Shell_SecondaryTrayWnd',
  'Progman',
  'WorkerW',
  'Windows.UI.Core.CoreWindow',
  'XamlExplorerHostIslandWindow',
  'TopLevelWindowForOverflowXamlIsland',
  'NotifyIconOverflowWindow',
  'ForegroundStaging',
  'MultitaskingViewFrame',
  'TaskListThumbnailWnd',
  'LockScreenBackstopFrame'
])

/**
 * Watches the focused window (pets can hop onto its top edge, and a starving
 * pet taps on its side) and the windows pets are standing on (so they fall
 * when that window moves, closes or is minimised).
 */
export class WindowTracker {
  ledge: WindowLedge | null = null
  private fgTimer: NodeJS.Timeout | null = null
  private standTimer: NodeJS.Timeout | null = null
  /** Window each pet is standing on, with the bounds it had when the pet landed. */
  private standing = new Map<string, WindowLedge>()

  constructor(
    private onLedge: (ledge: WindowLedge | null) => void,
    private onStandingLost: (pet: string, hwnd: number) => void
  ) {}

  start(): void {
    if (!nativeAvailable || this.fgTimer) return
    this.fgTimer = setInterval(() => this.pollForeground(), 500)
  }

  stop(): void {
    if (this.fgTimer) clearInterval(this.fgTimer)
    this.fgTimer = null
    this.standing.clear()
    this.syncStandTimer()
  }

  /** A pet landed on (hwnd) or left (0) a window. */
  setStanding(pet: string, hwnd: number): void {
    this.standing.delete(pet)
    if (hwnd && nativeAvailable) {
      const rect = this.describe(hwnd, true)
      if (rect) this.standing.set(pet, rect)
      else this.onStandingLost(pet, hwnd)
    }
    this.syncStandTimer()
  }

  private syncStandTimer(): void {
    if (this.standing.size && !this.standTimer) {
      this.standTimer = setInterval(() => this.pollStanding(), 200)
    } else if (!this.standing.size && this.standTimer) {
      clearInterval(this.standTimer)
      this.standTimer = null
    }
  }

  private pollStanding(): void {
    for (const [pet, was] of [...this.standing]) {
      const cur = this.describe(was.hwnd, true)
      const moved = !cur || Math.abs(cur.x - was.x) > 2 || Math.abs(cur.y - was.y) > 2 || Math.abs(cur.width - was.width) > 2
      if (moved) {
        this.standing.delete(pet)
        this.onStandingLost(pet, was.hwnd)
      }
    }
    this.syncStandTimer()
  }

  private pollForeground(): void {
    const ledge = this.describe(getForegroundHwnd(), false)
    const key = (l: WindowLedge | null) => (l ? `${l.hwnd}:${l.x},${l.y},${l.width},${l.height}` : '')
    if (key(ledge) === key(this.ledge)) return
    this.ledge = ledge
    this.onLedge(ledge)
  }

  /** A window's bounds in DIP, or null if it isn't something Catbot should stand on. */
  private describe(hwnd: number, allowMaximized: boolean): WindowLedge | null {
    const info = getWindowInfo(hwnd)
    if (!info || info.pid === process.pid) return null
    if (!info.visible || info.minimized || info.cloaked) return null
    if (!allowMaximized && info.maximized) return null
    if (IGNORED_CLASSES.has(info.className)) return null
    const { left, top, right, bottom } = info.rect
    if (right - left < 150 || bottom - top < 80) return null
    const dip = screen.screenToDipRect(null, { x: left, y: top, width: right - left, height: bottom - top })
    // Skip full-screen windows (games, videos): there's no top edge to stand on.
    const fullscreen = screen
      .getAllDisplays()
      .some((d) => Math.abs(d.bounds.x - dip.x) < 2 && Math.abs(d.bounds.y - dip.y) < 2 && Math.abs(d.bounds.width - dip.width) < 2)
    if (fullscreen && !allowMaximized) return null
    return { hwnd, x: Math.round(dip.x), y: Math.round(dip.y), width: Math.round(dip.width), height: Math.round(dip.height) }
  }
}
