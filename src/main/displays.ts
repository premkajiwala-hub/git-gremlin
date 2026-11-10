import { screen, type Display } from 'electron'
import type { DisplayInfo, TaskbarEdge } from '../shared/types'
import { isTaskbarAutoHide } from './native'

/**
 * Work out where the taskbar is on a display by comparing its full bounds with
 * its work area. Windows 11 only officially supports a bottom taskbar, but we
 * handle the other edges by falling back to the bottom of the screen.
 */
export function describeDisplay(d: Display, primaryId: number, autoHide: boolean): DisplayInfo {
  const b = d.bounds
  const w = d.workArea
  const bottom = b.y + b.height
  let taskbar: TaskbarEdge
  let groundY = bottom

  if (w.y + w.height < bottom - 1) {
    taskbar = 'bottom'
    groundY = w.y + w.height
  } else if (w.y > b.y + 1) {
    taskbar = 'top'
  } else if (w.x > b.x + 1) {
    taskbar = 'left'
  } else if (w.x + w.width < b.x + b.width - 1) {
    taskbar = 'right'
  } else {
    // Work area == bounds: the taskbar is auto-hidden, or this monitor has none.
    // Either way the pet walks on the bottom of the screen.
    taskbar = autoHide ? 'autohide' : 'none'
  }

  // Overlay windows are 1px shorter than the display (see overlay.ts), so keep
  // the ground inside the window.
  groundY = Math.min(groundY, bottom - 2)

  return {
    id: d.id,
    bounds: { ...b },
    workArea: { ...w },
    scaleFactor: d.scaleFactor,
    primary: d.id === primaryId,
    taskbar,
    groundY
  }
}

export function getDisplayInfos(): DisplayInfo[] {
  const primaryId = screen.getPrimaryDisplay().id
  const autoHide = isTaskbarAutoHide()
  return screen
    .getAllDisplays()
    .map((d) => describeDisplay(d, primaryId, autoHide))
    .sort((a, b) => a.bounds.x - b.bounds.x)
}
