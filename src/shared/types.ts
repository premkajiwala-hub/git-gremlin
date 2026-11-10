export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type TaskbarEdge = 'bottom' | 'top' | 'left' | 'right' | 'autohide' | 'none'

/** One monitor, in global DIP (device-independent pixel) coordinates. */
export interface DisplayInfo {
  id: number
  bounds: Rect
  workArea: Rect
  scaleFactor: number
  primary: boolean
  taskbar: TaskbarEdge
  /** Global y of the surface the pet walks on (top edge of the taskbar, or screen bottom). */
  groundY: number
}

/** A surface the pet can stand on, other than the taskbar (e.g. the focused window's top edge). */
export interface Ledge {
  hwnd: number
  /** Global DIP coordinates of the window's top edge. */
  x: number
  y: number
  width: number
}

/**
 * Everything needed to move the pet from one overlay window to another
 * (when it walks onto a neighbouring monitor) or to restore it after a restart.
 */
export interface PetSnapshot {
  x: number
  y: number
  vx: number
  vy: number
  facing: 1 | -1
  grounded: boolean
  /** Behaviour-specific state carried across monitors. */
  brain?: Record<string, unknown>
}

/** A render-only pose broadcast to neighbouring monitors while the pet straddles an edge. */
export interface PetPose {
  x: number
  y: number
  grounded: boolean
  /** Opaque model pose (part rotations etc.). */
  model: Record<string, unknown>
}

export interface OverlayInit {
  display: DisplayInfo
  displays: DisplayInfo[]
  isOwner: boolean
  snapshot: PetSnapshot | null
  petSize: number
  petSpeed: number
}
