import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/constants'
import type { DisplayInfo, OverlayInit, PetPose, PetSnapshot } from '../shared/types'

type Unsub = () => void

function on<T extends unknown[]>(channel: string, cb: (...args: T) => void): Unsub {
  const listener = (_e: Electron.IpcRendererEvent, ...args: unknown[]) => cb(...(args as T))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  getInit: (): Promise<OverlayInit | null> => ipcRenderer.invoke(IPC.getInit),
  setInteractive: (interactive: boolean): void => ipcRenderer.send(IPC.setInteractive, interactive),
  getCursor: (): Promise<{ x: number; y: number }> => ipcRenderer.invoke(IPC.cursor),
  handoff: (targetDisplayId: number, snap: PetSnapshot): void => ipcRenderer.send(IPC.handoff, targetDisplayId, snap),
  sendPose: (pose: PetPose | null): void => ipcRenderer.send(IPC.pose, pose),
  sendSnapshot: (snap: PetSnapshot): void => ipcRenderer.send(IPC.snapshot, snap),

  onAdopt: (cb: (snap: PetSnapshot | null) => void): Unsub => on(IPC.adopt, cb),
  onRelease: (cb: () => void): Unsub => on(IPC.release, cb),
  onMirror: (cb: (pose: PetPose | null) => void): Unsub => on(IPC.mirror, cb),
  onDisplaysChanged: (cb: (display: DisplayInfo, displays: DisplayInfo[]) => void): Unsub =>
    on(IPC.displaysChanged, cb)
}

export type GremlinApi = typeof api

contextBridge.exposeInMainWorld('gremlin', api)
