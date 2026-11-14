import { join } from 'node:path'
import { app, BrowserWindow, nativeTheme } from 'electron'
import { APP_NAME, IPC } from '../shared/constants'

let win: BrowserWindow | null = null

/**
 * The GitGremlin panel: one window to manage every pet and its settings.
 * `page` selects what to show: a pet id, or 'general'.
 */
export function openHub(page?: string): BrowserWindow {
  if (win && !win.isDestroyed()) {
    if (page) win.webContents.send(IPC.hubShowPage, page)
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    return win
  }
  win = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 760,
    minHeight: 560,
    title: APP_NAME,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0C0D0F' : '#F1F1EE',
    autoHideMenuBar: true,
    icon: join(app.getAppPath(), 'assets', 'icon.png'),
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  win.setMenu(null)
  const url = process.env['ELECTRON_RENDERER_URL']
  if (url) void win.loadURL(`${url}/hub.html${page ? `?page=${encodeURIComponent(page)}` : ''}`)
  else void win.loadFile(join(__dirname, '../renderer/hub.html'), page ? { query: { page } } : undefined)
  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => {
    win = null
  })
  return win
}

export function hubWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null
}
