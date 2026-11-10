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

/** The focused window, which the pet can hop onto (global DIP coordinates). */
export interface WindowLedge {
  hwnd: number
  x: number
  y: number
  width: number
  height: number
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

export type HungerStage = 'full' | 'peckish' | 'hungry' | 'starving'

export interface PetStatus {
  name: string
  stage: HungerStage
  /** 1 = completely full, 0 = starving. */
  fullness: number
  /** Unix ms of the newest commit eaten, or null if none yet. */
  lastCommitAt: number | null
  quiet: boolean
  paused: boolean
  repoCount: number
}

export interface FeedEvent {
  commits: number
  lines: number
  /** Hours of hunger the meal removed. */
  foodHours: number
  debug?: boolean
}

export interface Settings {
  petName: string
  /** On-screen height in DIP. */
  petSize: number
  /** Walking speed in DIP per second. */
  petSpeed: number
  peckishAfterHours: number
  hungryAfterHours: number
  starvingAfterHours: number
  quietHoursEnabled: boolean
  /** "HH:MM", 24h clock. */
  quietStart: string
  quietEnd: string
  /** Author email to count commits for; empty = use each repo's `git config user.email`. */
  gitEmail: string
  repos: string[]
}

export interface OverlayInit {
  display: DisplayInfo
  displays: DisplayInfo[]
  isOwner: boolean
  snapshot: PetSnapshot | null
  settings: Settings
  status: PetStatus
  ledge: WindowLedge | null
}

export interface SettingsView {
  settings: Settings
  detectedEmail: string
  startWithWindows: boolean
}

export interface RepoResult {
  ok: boolean
  path?: string
  error?: string
  canceled?: boolean
}
