import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/constants'
import type {
  DisplayInfo,
  FeedEvent,
  OverlayInit,
  PetPose,
  PetSnapshot,
  PetStatus,
  Settings,
  SettingsView,
  SignInCode,
  SignInResult,
  WindowLedge
} from '../shared/types'

type Unsub = () => void

function on<T extends unknown[]>(channel: string, cb: (...args: T) => void): Unsub {
  const listener = (_e: Electron.IpcRendererEvent, ...args: unknown[]) => cb(...(args as T))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  // Overlay
  getInit: (): Promise<OverlayInit | null> => ipcRenderer.invoke(IPC.getInit),
  setInteractive: (interactive: boolean): void => ipcRenderer.send(IPC.setInteractive, interactive),
  handoff: (targetDisplayId: number, snap: PetSnapshot): void => ipcRenderer.send(IPC.handoff, targetDisplayId, snap),
  sendPose: (pose: PetPose | null): void => ipcRenderer.send(IPC.pose, pose),
  sendSnapshot: (snap: PetSnapshot): void => ipcRenderer.send(IPC.snapshot, snap),
  setStanding: (hwnd: number): void => ipcRenderer.send(IPC.standing, hwnd),
  getCursor: (): Promise<{ x: number; y: number; visible: boolean }> => ipcRenderer.invoke(IPC.cursor),

  onAdopt: (cb: (snap: PetSnapshot | null) => void): Unsub => on(IPC.adopt, cb),
  onRelease: (cb: () => void): Unsub => on(IPC.release, cb),
  onMirror: (cb: (pose: PetPose | null) => void): Unsub => on(IPC.mirror, cb),
  onDisplaysChanged: (cb: (display: DisplayInfo, displays: DisplayInfo[]) => void): Unsub =>
    on(IPC.displaysChanged, cb),
  onStatus: (cb: (status: PetStatus) => void): Unsub => on(IPC.status, cb),
  onFeed: (cb: (ev: FeedEvent) => void): Unsub => on(IPC.feed, cb),
  onLedge: (cb: (ledge: WindowLedge | null) => void): Unsub => on(IPC.ledge, cb),
  onStandingLost: (cb: (hwnd: number) => void): Unsub => on(IPC.standingLost, cb),
  onSay: (cb: (text: string) => void): Unsub => on(IPC.say, cb),
  onSettings: (cb: (settings: Settings) => void): Unsub => on(IPC.settingsChanged, cb),

  // Settings window
  getSettings: (): Promise<SettingsView> => ipcRenderer.invoke(IPC.settingsGet),
  saveSettings: (s: Settings, startWithWindows: boolean): Promise<SettingsView> =>
    ipcRenderer.invoke(IPC.settingsSave, s, startWithWindows),
  refreshGitHub: (): Promise<SettingsView> => ipcRenderer.invoke(IPC.githubRefresh),
  /** Start "Sign in with GitHub"; resolves with the one-time code (already copied, github.com opened). */
  signInWithGitHub: (): Promise<SignInCode> => ipcRenderer.invoke(IPC.githubSignIn),
  cancelSignIn: (): Promise<void> => ipcRenderer.invoke(IPC.githubCancelSignIn),
  useGitHubCli: (): Promise<SignInResult> => ipcRenderer.invoke(IPC.githubUseCli),
  signOutGitHub: (): Promise<SettingsView> => ipcRenderer.invoke(IPC.githubSignOut),
  openGitHub: (url: string): Promise<void> => ipcRenderer.invoke(IPC.openExternal, url),
  onSignInResult: (cb: (result: SignInResult) => void): Unsub => on(IPC.githubAuthResult, cb)
}

export type GremlinApi = typeof api

contextBridge.exposeInMainWorld('gremlin', api)
