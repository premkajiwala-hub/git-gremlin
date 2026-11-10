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
/** How often watched repos are checked for new commits. */
export const GIT_POLL_MS = 60_000

/** Food from one commit, in hours of hunger removed. */
export const FOOD_BASE_HOURS = 3
/** Extra food for bigger diffs: +1h per 10x lines changed, capped. */
export const FOOD_BONUS_PER_DECADE = 1
export const FOOD_BONUS_CAP_HOURS = 3

export const DEFAULT_SETTINGS: Settings = {
  petName: 'Mossy',
  petSize: 80,
  petSpeed: 45,
  peckishAfterHours: 2,
  hungryAfterHours: 4,
  starvingAfterHours: 8,
  quietHoursEnabled: true,
  quietStart: '23:00',
  quietEnd: '08:00',
  gitEmail: '',
  repos: []
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
  say: 'pet:say',
  settingsChanged: 'settings:changed',
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  repoPick: 'settings:repo-pick',
  repoRemove: 'settings:repo-remove'
} as const
