import type { PetId, Settings } from './types'

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
/**
 * Client ID of GitGremlin's GitHub OAuth App (device flow enabled). Client IDs
 * are public identifiers, not secrets. Override with GITGREMLIN_GITHUB_CLIENT_ID.
 */
export const GITHUB_CLIENT_ID = 'Ov23liMmQHenWg4oCugu'
/** Read-only access to the profile, enough to read your own contribution calendar. */
export const GITHUB_SCOPES = 'read:user'

/** Allowed pet heights: big enough to see, small enough not to get in the way. */
export const PET_SIZE_MIN = 48
export const PET_SIZE_MAX = 112

/** Every pet, in the order the GitGremlin panel lists them. */
export const PET_IDS: PetId[] = ['catbot', 'dusty', 'syncy']

/** What each pet is for (shown in the panel). */
export const PET_PURPOSE: Record<PetId, string> = {
  catbot: 'Robot cat fed by your GitHub contributions',
  dusty: 'Raccoon that eats junk files and caches',
  syncy: "Beaver that guards work you haven't pushed to GitHub"
}

export const DEFAULT_SETTINGS: Settings = {
  onTopOfApps: false,
  theme: 'system',
  pets: {
    catbot: { enabled: true, name: 'Catbot', petSize: 72, petSpeed: 45, movement: 'roam', followCursor: true },
    dusty: { enabled: true, name: 'Dusty', petSize: 64, petSpeed: 40, movement: 'roam', followCursor: false },
    syncy: { enabled: true, name: 'Syncy', petSize: 64, petSpeed: 38, movement: 'roam', followCursor: false }
  },
  dusty: {
    mode: 'ask',
    targets: { devCaches: true, recycleBin: true, temp: false, browser: false },
    scanEveryMinutes: 60
  },
  syncy: {
    autoFind: true,
    folders: [],
    ignored: [],
    staleHours: 24,
    scanEveryMinutes: 10,
    summaryHour: 18,
    trackBranches: true
  }
}

/** Below this much junk Dusty doesn't bother you about it. */
export const JUNK_ALERT_BYTES = 50 * 1024 * 1024

/** A text line equal to this is drawn as a row of contribution squares in speech bubbles. */
export const GRID_MARK = '▦'

/** IPC channel names, shared by main, preload and renderer. Pet events carry the pet id first. */
export const IPC = {
  getInit: 'overlay:get-init',
  openHub: 'pet:open-hub',
  petMenu: 'pet:menu',
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
  hubGet: 'hub:get',
  hubChanged: 'hub:changed',
  hubShowPage: 'hub:show-page',
  settingsSave: 'settings:save',
  dustyScan: 'hub:dusty-scan',
  dustyClean: 'hub:dusty-clean',
  syncyScan: 'hub:syncy-scan',
  syncyAction: 'hub:syncy-action',
  pickFolder: 'hub:pick-folder',
  hidePets: 'hub:hide-pets',
  githubRefresh: 'settings:github-refresh',
  githubSignIn: 'settings:github-sign-in',
  githubCancelSignIn: 'settings:github-cancel-sign-in',
  githubUseCli: 'settings:github-use-cli',
  githubSignOut: 'settings:github-sign-out',
  githubAuthResult: 'settings:github-auth-result',
  openExternal: 'settings:open-external'
} as const
