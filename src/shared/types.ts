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

/** How the GitHub account was linked: GitHub sign-in (OAuth device flow), the GitHub CLI's login, or not at all. */
export type GitHubSource = 'oauth' | 'gh' | 'none'

export type HungerStage = 'fed' | 'hungry' | 'starving'

/** Every pet GitGremlin can host. */
export type PetId = 'catbot' | 'dusty' | 'syncy'

/**
 * A pet's live state, built by its "purpose" service in the main process
 * (Catbot: GitHub contributions; Dusty: junk cleaning).
 */
export interface PetStatus {
  name: string
  /** Drives behaviour: hungry/starving pets droop; fed pets get livelier with `level`. */
  stage: HungerStage
  /** 0..4 energy/mood level. */
  level: ContributionLevel
  /** Lines for the hover/click status report; a line equal to GRID_MARK draws `grid` as squares. */
  report: string[]
  grid: ContributionLevel[] | null
  /** Something the pet wants you to act on. It says this now and then, and clicking it opens its page. */
  alert: string | null
  /** What the pet is busy doing for you right now. */
  busy: 'scanning' | 'cleaning' | null
  /** Catbot: whether a GitHub account is linked. */
  connected: boolean
}

/** Make the pet play its eating animation, saying `text`. */
export interface FeedEvent {
  text: string
  debug?: boolean
}

/** Where the pet may wander: anywhere on screen, or only along the bottom edge. */
export type Movement = 'roam' | 'ground'

/** Per-pet look and behaviour. */
export interface PetConfig {
  enabled: boolean
  name: string
  /** On-screen height in DIP. */
  petSize: number
  /** Walking speed in DIP per second. */
  petSpeed: number
  movement: Movement
  /** Follows the cursor while it moves over the desktop. */
  followCursor: boolean
}

/** How Dusty deals with the junk it finds. */
export type CleanMode = 'ask' | 'auto' | 'report'
export type JunkTarget = 'devCaches' | 'recycleBin' | 'temp' | 'browser'

export interface DustyConfig {
  mode: CleanMode
  targets: Record<JunkTarget, boolean>
  /** Minutes between automatic scans. */
  scanEveryMinutes: number
}

/** What Syncy watches, and when it nudges you. */
export interface SyncyConfig {
  /** Look for repos in common code folders and on data drives. */
  autoFind: boolean
  /** Extra folders to search (a few levels deep). */
  folders: string[]
  /** Repos to leave alone. */
  ignored: string[]
  /** Unsaved work older than this many hours gets a nudge. */
  staleHours: number
  /** Minutes between repo checks. */
  scanEveryMinutes: number
  /** Local hour (0-23) for the evening summary, or null for none. */
  summaryHour: number | null
  /** List local branches that are already merged, and offer to delete them. */
  trackBranches: boolean
}

/** The GitGremlin panel's colours: follow Windows, or always light / dark. */
export type ThemeMode = 'system' | 'light' | 'dark'

export interface Settings {
  /** true = pets are drawn on top of every app; false = only on the desktop, behind app windows. */
  onTopOfApps: boolean
  theme: ThemeMode
  pets: Record<PetId, PetConfig>
  dusty: DustyConfig
  syncy: SyncyConfig
}

export interface PetInit {
  id: PetId
  isOwner: boolean
  snapshot: PetSnapshot | null
  status: PetStatus
}

export interface OverlayInit {
  display: DisplayInfo
  displays: DisplayInfo[]
  settings: Settings
  pets: PetInit[]
  ledge: WindowLedge | null
}

/** One kind of junk Dusty found. */
export interface JunkCategory {
  id: string
  target: JunkTarget
  label: string
  bytes: number
  items: number
  /** Why it can't be cleaned right now (e.g. "Close Chrome first"), or null. */
  blocked: string | null
}

export interface ScanResult {
  at: number
  categories: JunkCategory[]
  totalBytes: number
}

export interface CleanResult {
  at: number
  freedBytes: number
  /** Files that couldn't be removed (in use, permissions). */
  failed: number
}

export interface DustyView {
  scan: ScanResult | null
  lastClean: CleanResult | null
  busy: 'scanning' | 'cleaning' | null
}
/** One git repository as Syncy last saw it. */
export interface RepoInfo {
  path: string
  name: string
  /** Current branch, or null when detached. */
  branch: string | null
  /** The repo has at least one remote (somewhere to push to). */
  hasRemote: boolean
  /** Uncommitted changes (modified, added, deleted and untracked files). */
  changes: number
  /** When the oldest uncommitted change was made (ms), or null. */
  changesSince: number | null
  /** Commits on local branches that aren't on any remote. */
  unpushed: number
  unpushedSince: number | null
  stashes: number
  stashSince: number | null
  /** Local branches already merged into the default branch (safe to delete). */
  merged: string[]
  /** The default branch they were checked against, e.g. "main". */
  base: string | null
  error: string | null
}

export interface RepoScan {
  at: number
  repos: RepoInfo[]
  /** Folders that were searched. */
  roots: string[]
  /** Git isn't installed (or not on PATH). */
  gitMissing: boolean
}

export interface SyncyView {
  scan: RepoScan | null
  busy: 'scanning' | 'cleaning' | null
  /** Folders Syncy searches automatically (when auto-find is on). */
  autoRoots: string[]
}

/** Something to do with a repo from the GitGremlin panel. */
export type RepoAction =
  | { kind: 'open' | 'terminal' | 'ignore' | 'unignore'; path: string }
  | { kind: 'deleteBranches'; path: string; branches: string[] }

export interface ActionResult {
  ok: boolean
  message: string
}

export interface GitHubView {
  /** The linked account, or null when not signed in. */
  login: string | null
  name: string | null
  avatarUrl: string | null
  source: GitHubSource
  todayCount: number
  level: ContributionLevel
  streak: number
  /** Levels of the last 7 days, oldest first. */
  week: ContributionLevel[]
  fetchedAt: number
  error: string | null
  /** "Sign in with GitHub" is available (an OAuth client ID is configured). */
  signInAvailable: boolean
  /** The GitHub CLI is installed and logged in. */
  ghAvailable: boolean
}

/** Everything the GitGremlin panel shows. */
export interface HubView {
  version: string
  /** Pets are hidden for a while (tray or panel). */
  hidden: boolean
  settings: Settings
  startWithWindows: boolean
  status: Record<PetId, PetStatus>
  github: GitHubView
  dusty: DustyView
  syncy: SyncyView
}

/** Shown while signing in: enter this code at the verification URL. */
export interface SignInCode {
  userCode: string
  verificationUri: string
  expiresIn: number
}

export interface SignInResult {
  ok: boolean
  error?: string
}