export const APP_NAME = 'GitGremlin'
export const APP_ID = 'com.premkajiwala.gitgremlin'
export const DEFAULT_PET_NAME = 'Mossy'

/** Target render rate for the overlay. */
export const FPS = 30
export const FRAME_MS = 1000 / FPS

/** How often the overlays are pushed back to the top of the topmost z-band. */
export const TOPMOST_REASSERT_MS = 1500

/** Default on-screen height of the pet in DIP. */
export const DEFAULT_PET_SIZE = 80
/** Default walking speed in DIP per second. */
export const DEFAULT_PET_SPEED = 45

/** IPC channel names, shared by main, preload and renderer. */
export const IPC = {
  getInit: 'overlay:get-init',
  setInteractive: 'overlay:set-interactive',
  displaysChanged: 'overlay:displays-changed',
  cursor: 'overlay:cursor',
  handoff: 'pet:handoff',
  adopt: 'pet:adopt',
  release: 'pet:release',
  pose: 'pet:pose',
  mirror: 'pet:mirror',
  snapshot: 'pet:snapshot'
} as const
