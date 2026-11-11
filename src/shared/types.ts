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

/** GitHub's contribution levels: 0 = no contributions, 1..4 = "Less" .. "More" on the profile chart. */
export type ContributionLevel = 0 | 1 | 2 | 3 | 4

export interface ContributionDay {
  date: string
  count: number
  level: ContributionLevel
}

/** Where the contribution data came from. */
export type GitHubSource = 'token' | 'gh' | 'public' | 'none'

export type HungerStage = 'fed' | 'hungry' | 'starving'

export interface PetStatus {
  name: string
  /** fed = contributed today; hungry = nothing today; starving = nothing today or yesterday. */
  stage: HungerStage
  /** Today's square on the contribution chart (0..4). */
  level: ContributionLevel
  todayCount: number
  /** Consecutive days with contributions, up to today (or yesterday). */
  streak: number
  /** Levels of the last 7 days, oldest first. */
  week: ContributionLevel[]
  login: string | null
  /** Whether contribution data has been loaded at least once. */
  connected: boolean
  quiet: boolean
}

export interface FeedEvent {
  /** New contributions since the last check. */
  commits: number
  debug?: boolean
}

/** Where the pet may wander: anywhere on screen, or only along the bottom edge. */
export type Movement = 'roam' | 'ground'

export interface Settings {
  petName: string
  /** On-screen height in DIP. */
  petSize: number
  /** Walking speed in DIP per second. */
  petSpeed: number
  movement: Movement
  /** true = drawn on top of every app; false = only on the desktop, behind app windows. */
  onTopOfApps: boolean
  /** Catbot follows the cursor while it moves over the desktop. */
  followCursor: boolean
  /** GitHub username whose contribution chart drives Catbot's mood (empty = the signed-in account). */
  githubUser: string
  quietHoursEnabled: boolean
  /** "HH:MM", 24h clock. */
  quietStart: string
  quietEnd: string
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

export interface GitHubView {
  login: string | null
  source: GitHubSource
  todayCount: number
  level: ContributionLevel
  streak: number
  /** Levels of the last 7 days, oldest first. */
  week: ContributionLevel[]
  fetchedAt: number
  error: string | null
  hasSavedToken: boolean
  ghAvailable: boolean
}

export interface SettingsView {
  settings: Settings
  github: GitHubView
  startWithWindows: boolean
}