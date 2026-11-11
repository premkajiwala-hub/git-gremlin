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
 * Tracks the focused app window's bounds (DIP). A starving pet crawls over to
 * its edge and taps on it.
 */
export class WindowTracker {
  ledge: WindowLedge | null = null
  private timer: NodeJS.Timeout | null = null

  constructor(private onLedge: (ledge: WindowLedge | null) => void) {}

  start(): void {
    if (!nativeAvailable || this.timer) return
    this.timer = setInterval(() => this.poll(), 1000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private poll(): void {
    const ledge = this.describe(getForegroundHwnd())
    const key = (l: WindowLedge | null) => (l ? `${l.hwnd}:${l.x},${l.y},${l.width},${l.height}` : '')
    if (key(ledge) === key(this.ledge)) return
    this.ledge = ledge
    this.onLedge(ledge)
  }

  private describe(hwnd: number): WindowLedge | null {
    const info = getWindowInfo(hwnd)
    if (!info || info.pid === process.pid) return null
    if (!info.visible || info.minimized || info.cloaked || info.maximized) return null
    if (IGNORED_CLASSES.has(info.className)) return null
    const { left, top, right, bottom } = info.rect
    if (right - left < 150 || bottom - top < 80) return null
    const dip = screen.screenToDipRect(null, { x: left, y: top, width: right - left, height: bottom - top })
    return { hwnd, x: Math.round(dip.x), y: Math.round(dip.y), width: Math.round(dip.width), height: Math.round(dip.height) }
  }
}
