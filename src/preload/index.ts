import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/constants'
import type {
  DisplayInfo,
  FeedEvent,
  HubView,
  OverlayInit,
  PetId,
  PetPose,
  PetSnapshot,
  PetStatus,
  Settings,
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
  // Overlay (shared by all pets; pet events carry the pet id first)
  getInit: (): Promise<OverlayInit | null> => ipcRenderer.invoke(IPC.getInit),
  setInteractive: (interactive: boolean): void => ipcRenderer.send(IPC.setInteractive, interactive),
  getCursor: (): Promise<{ x: number; y: number; visible: boolean }> => ipcRenderer.invoke(IPC.cursor),
  handoff: (id: PetId, targetDisplayId: number, snap: PetSnapshot): void => ipcRenderer.send(IPC.handoff, id, targetDisplayId, snap),
  sendPose: (id: PetId, pose: PetPose | null): void => ipcRenderer.send(IPC.pose, id, pose),
  sendSnapshot: (id: PetId, snap: PetSnapshot): void => ipcRenderer.send(IPC.snapshot, id, snap),
  setStanding: (id: PetId, hwnd: number): void => ipcRenderer.send(IPC.standing, id, hwnd),
  openHub: (id: PetId): void => ipcRenderer.send(IPC.openHub, id),

  onAdopt: (cb: (id: PetId, snap: PetSnapshot | null, status: PetStatus) => void): Unsub => on(IPC.adopt, cb),
  onRelease: (cb: (id: PetId) => void): Unsub => on(IPC.release, cb),
  onMirror: (cb: (id: PetId, pose: PetPose | null) => void): Unsub => on(IPC.mirror, cb),
  onDisplaysChanged: (cb: (display: DisplayInfo, displays: DisplayInfo[]) => void): Unsub => on(IPC.displaysChanged, cb),
  onStatus: (cb: (id: PetId, status: PetStatus) => void): Unsub => on(IPC.status, cb),
  onFeed: (cb: (id: PetId, ev: FeedEvent) => void): Unsub => on(IPC.feed, cb),
  onLedge: (cb: (ledge: WindowLedge | null) => void): Unsub => on(IPC.ledge, cb),
  onStandingLost: (cb: (id: PetId, hwnd: number) => void): Unsub => on(IPC.standingLost, cb),
  onSay: (cb: (id: PetId, text: string) => void): Unsub => on(IPC.say, cb),
  onSettings: (cb: (settings: Settings) => void): Unsub => on(IPC.settingsChanged, cb),

  // GitGremlin panel
  getHub: (): Promise<HubView> => ipcRenderer.invoke(IPC.hubGet),
  onHubChanged: (cb: () => void): Unsub => on(IPC.hubChanged, cb),
  onShowPage: (cb: (page: string) => void): Unsub => on(IPC.hubShowPage, cb),
  saveSettings: (s: Settings, startWithWindows: boolean): Promise<HubView> => ipcRenderer.invoke(IPC.settingsSave, s, startWithWindows),
  dustyScan: (): Promise<HubView> => ipcRenderer.invoke(IPC.dustyScan),
  dustyClean: (ids: string[]): Promise<HubView> => ipcRenderer.invoke(IPC.dustyClean, ids),
  refreshGitHub: (): Promise<HubView> => ipcRenderer.invoke(IPC.githubRefresh),
  /** Start "Sign in with GitHub"; resolves with the one-time code (already copied, github.com opened). */
  signInWithGitHub: (): Promise<SignInCode> => ipcRenderer.invoke(IPC.githubSignIn),
  cancelSignIn: (): Promise<void> => ipcRenderer.invoke(IPC.githubCancelSignIn),
  useGitHubCli: (): Promise<SignInResult> => ipcRenderer.invoke(IPC.githubUseCli),
  signOutGitHub: (): Promise<HubView> => ipcRenderer.invoke(IPC.githubSignOut),
  openGitHub: (url: string): Promise<void> => ipcRenderer.invoke(IPC.openExternal, url),
  onSignInResult: (cb: (result: SignInResult) => void): Unsub => on(IPC.githubAuthResult, cb)
}

export type GremlinApi = typeof api

contextBridge.exposeInMainWorld('gremlin', api)
