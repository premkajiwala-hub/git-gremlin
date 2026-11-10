import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { APP_NAME } from '../shared/constants'

let win: BrowserWindow | null = null

export function openSettingsWindow(): BrowserWindow {
  if (win && !win.isDestroyed()) {
    win.show()
    win.focus()
    return win
  }
  win = new BrowserWindow({
    width: 500,
    height: 720,
    minWidth: 420,
    minHeight: 500,
    title: `${APP_NAME} Settings`,
    backgroundColor: '#1b1f1a',
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
  if (url) void win.loadURL(`${url}/settings.html`)
  else void win.loadFile(join(__dirname, '../renderer/settings.html'))
  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => {
    win = null
  })
  return win
}

export function settingsWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null
}
