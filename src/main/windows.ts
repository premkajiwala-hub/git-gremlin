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
  'TaskListThumbnailWnd'
])

/**
 * Watches the focused window (so the pet can hop onto its top edge) and the
 * window the pet is standing on (so it falls when that window moves or closes).
 */
export class WindowTracker {
  ledge: WindowLedge | null = null
  private fgTimer: NodeJS.Timeout | null = null
  private standTimer: NodeJS.Timeout | null = null
  private standing: WindowLedge | null = null

  constructor(
    private onLedge: (ledge: WindowLedge | null) => void,
    private onStandingLost: (hwnd: number) => void
  ) {}

  start(): void {
    if (!nativeAvailable || this.fgTimer) return
    this.fgTimer = setInterval(() => this.pollForeground(), 500)
  }

  stop(): void {
    if (this.fgTimer) clearInterval(this.fgTimer)
    this.fgTimer = null
    this.setStanding(0)
  }

  /** The pet landed on (hwnd) or left (0) a window. */
  setStanding(hwnd: number): void {
    if (this.standTimer) clearInterval(this.standTimer)
    this.standTimer = null
    this.standing = null
    if (!hwnd || !nativeAvailable) return
    const rect = this.describe(hwnd, true)
    if (!rect) {
      this.onStandingLost(hwnd)
      return
    }
    this.standing = rect
    this.standTimer = setInterval(() => {
      const cur = this.describe(hwnd, true)
      const was = this.standing
      if (!was) return
      const moved =
        !cur || Math.abs(cur.x - was.x) > 2 || Math.abs(cur.y - was.y) > 2 || Math.abs(cur.width - was.width) > 2
      if (moved) {
        this.setStanding(0)
        this.onStandingLost(hwnd)
      }
    }, 200)
  }

  private pollForeground(): void {
    const ledge = this.describe(getForegroundHwnd(), false)
    const key = ledge ? `${ledge.hwnd}:${ledge.x},${ledge.y},${ledge.width},${ledge.height}` : ''
    const prev = this.ledge ? `${this.ledge.hwnd}:${this.ledge.x},${this.ledge.y},${this.ledge.width},${this.ledge.height}` : ''
    if (key === prev) return
    this.ledge = ledge
    this.onLedge(ledge)
  }

  /** A window's bounds in DIP, or null if it isn't something the pet should stand on. */
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
