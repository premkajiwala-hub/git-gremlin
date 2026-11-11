import type { Settings } from './types'

export const APP_NAME = 'GitGremlin'
export const APP_ID = 'com.premkajiwala.gitgremlin'

/** Target render rate for the overlay. */
export const FPS = 30
export const FRAME_MS = 1000 / FPS
/** Tick rate used when nothing on screen is changing. */
export const IDLE_FRAME_MS = 100

/** How often the overlays are pushed back to the top of the topmost z-band. */
export const TOPMOST_REASSERT_MS = 1500
/** How often desktop-mode overlays are tucked back just above the desktop. */
export const DESKTOP_REASSERT_MS = 600
/** How often the GitHub contribution chart is re-read. */
export const GITHUB_POLL_MS = 3 * 60_000

/** Allowed pet heights: big enough to see, small enough not to get in the way. */
export const PET_SIZE_MIN = 48
export const PET_SIZE_MAX = 112

export const DEFAULT_SETTINGS: Settings = {
  petName: 'Catbot',
  petSize: 72,
  petSpeed: 45,
  movement: 'roam',
  onTopOfApps: false,
  followCursor: true,
  githubUser: '',
  quietHoursEnabled: true,
  quietStart: '23:00',
  quietEnd: '08:00'
}

/** IPC channel names, shared by main, preload and renderer. */
export const IPC = {
  getInit: 'overlay:get-init',
  setInteractive: 'overlay:set-interactive',
  displaysChanged: 'overlay:displays-changed',
  handoff: 'pet:handoff',
  adopt: 'pet:adopt',
  release: 'pet:release',
  pose: 'pet:pose',
  mirror: 'pet:mirror',
  snapshot: 'pet:snapshot',
  status: 'pet:status',
  feed: 'pet:feed',
  ledge: 'pet:ledge',
  standing: 'pet:standing',
  standingLost: 'pet:standing-lost',
  cursor: 'overlay:cursor',
  say: 'pet:say',
  settingsChanged: 'settings:changed',
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  githubRefresh: 'settings:github-refresh'
} as const
