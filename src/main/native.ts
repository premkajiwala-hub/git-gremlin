/**
 * Tiny Win32 helper built on koffi (FFI with prebuilt binaries, no compiler needed).
 * Everything here is optional: if koffi fails to load, the app keeps working with
 * Electron-only fallbacks (no window-top walking, plain setAlwaysOnTop).
 */
import type { BrowserWindow } from 'electron'
import koffi from 'koffi'

type Fn = (...args: any[]) => any

interface Win32 {
  SetWindowPos: Fn
  GetForegroundWindow: Fn
  GetWindowRect: Fn
  IsWindow: Fn
  IsWindowVisible: Fn
  IsIconic: Fn
  IsZoomed: Fn
  GetClassNameW: Fn
  GetWindowThreadProcessId: Fn
  GetAncestor: Fn
  DwmGetWindowAttribute: Fn
  SHAppBarMessage: Fn
}

let api: Win32 | null = null
try {
  const user32 = koffi.load('user32.dll')
  const dwmapi = koffi.load('dwmapi.dll')
  const shell32 = koffi.load('shell32.dll')
  api = {
    SetWindowPos: user32.func(
      'bool __stdcall SetWindowPos(intptr_t hWnd, intptr_t hWndInsertAfter, int X, int Y, int cx, int cy, uint32_t uFlags)'
    ),
    GetForegroundWindow: user32.func('intptr_t __stdcall GetForegroundWindow()'),
    GetWindowRect: user32.func('bool __stdcall GetWindowRect(intptr_t hWnd, void *lpRect)'),
    IsWindow: user32.func('bool __stdcall IsWindow(intptr_t hWnd)'),
    IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(intptr_t hWnd)'),
    IsIconic: user32.func('bool __stdcall IsIconic(intptr_t hWnd)'),
    IsZoomed: user32.func('bool __stdcall IsZoomed(intptr_t hWnd)'),
    GetClassNameW: user32.func('int __stdcall GetClassNameW(intptr_t hWnd, void *lpClassName, int nMaxCount)'),
    GetWindowThreadProcessId: user32.func('uint32_t __stdcall GetWindowThreadProcessId(intptr_t hWnd, void *lpdwProcessId)'),
    GetAncestor: user32.func('intptr_t __stdcall GetAncestor(intptr_t hWnd, uint32_t gaFlags)'),
    DwmGetWindowAttribute: dwmapi.func(
      'long __stdcall DwmGetWindowAttribute(intptr_t hwnd, uint32_t dwAttribute, void *pvAttribute, uint32_t cbAttribute)'
    ),
    SHAppBarMessage: shell32.func('uintptr_t __stdcall SHAppBarMessage(uint32_t dwMessage, void *pData)')
  }
} catch (err) {
  console.warn('[native] koffi unavailable, using fallbacks:', err)
  api = null
}

export const nativeAvailable = api !== null

const HWND_TOPMOST = -1
const SWP_NOSIZE = 0x0001
const SWP_NOMOVE = 0x0002
const SWP_NOACTIVATE = 0x0010
const SWP_NOOWNERZORDER = 0x0200
const SWP_NOSENDCHANGING = 0x0400
const GA_ROOT = 2
const DWMWA_EXTENDED_FRAME_BOUNDS = 9
const DWMWA_CLOAKED = 14
const ABM_GETSTATE = 4
const ABS_AUTOHIDE = 1

export function hwndOf(win: BrowserWindow): number {
  const buf = win.getNativeWindowHandle()
  return buf.length >= 8 ? Number(buf.readBigUInt64LE(0)) : buf.readUInt32LE(0)
}

/**
 * Push a window to the top of the topmost z-band without moving, resizing or
 * activating it. Windows lets the taskbar jump above other topmost windows when
 * it is clicked, so we call this periodically.
 */
export function forceTopmost(hwnd: number): boolean {
  if (!api) return false
  return api.SetWindowPos(
    hwnd,
    HWND_TOPMOST,
    0,
    0,
    0,
    0,
    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_NOSENDCHANGING
  )
}

/** Whether the (primary) taskbar is set to auto-hide. */
export function isTaskbarAutoHide(): boolean {
  if (!api) return false
  try {
    const data = Buffer.alloc(48) // APPBARDATA on x64
    data.writeUInt32LE(48, 0)
    const state = Number(api.SHAppBarMessage(ABM_GETSTATE, data))
    return (state & ABS_AUTOHIDE) !== 0
  } catch {
    return false
  }
}

export interface NativeWindowInfo {
  hwnd: number
  /** Physical-pixel bounds (excluding the invisible resize border). */
  rect: { left: number; top: number; right: number; bottom: number }
  className: string
  pid: number
  visible: boolean
  minimized: boolean
  maximized: boolean
  cloaked: boolean
}

export function getForegroundHwnd(): number {
  if (!api) return 0
  const h = Number(api.GetForegroundWindow())
  return h ? Number(api.GetAncestor(h, GA_ROOT)) || h : 0
}

export function getWindowInfo(hwnd: number): NativeWindowInfo | null {
  if (!api || !hwnd || !api.IsWindow(hwnd)) return null
  const rectBuf = Buffer.alloc(16)
  let ok = api.DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, rectBuf, 16) === 0
  if (!ok) ok = api.GetWindowRect(hwnd, rectBuf)
  if (!ok) return null
  const cloakBuf = Buffer.alloc(4)
  const cloaked =
    api.DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, cloakBuf, 4) === 0 && cloakBuf.readUInt32LE(0) !== 0
  const nameBuf = Buffer.alloc(512)
  const n = api.GetClassNameW(hwnd, nameBuf, 256)
  const pidBuf = Buffer.alloc(4)
  api.GetWindowThreadProcessId(hwnd, pidBuf)
  return {
    hwnd,
    rect: {
      left: rectBuf.readInt32LE(0),
      top: rectBuf.readInt32LE(4),
      right: rectBuf.readInt32LE(8),
      bottom: rectBuf.readInt32LE(12)
    },
    className: nameBuf.toString('utf16le', 0, Math.max(0, n) * 2),
    pid: pidBuf.readUInt32LE(0),
    visible: api.IsWindowVisible(hwnd),
    minimized: api.IsIconic(hwnd),
    maximized: api.IsZoomed(hwnd),
    cloaked
  }
}
