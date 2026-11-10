import { app, Menu, nativeImage, Tray } from 'electron'
import { APP_ID, APP_NAME, DEFAULT_PET_SIZE, DEFAULT_PET_SPEED } from '../shared/constants'
import { OverlayManager } from './overlay'

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.setAppUserModelId(APP_ID)
  app.whenReady().then(start)
}

let tray: Tray | null = null
let overlays: OverlayManager | null = null

function start(): void {
  overlays = new OverlayManager({
    getPetSize: () => DEFAULT_PET_SIZE,
    getPetSpeed: () => DEFAULT_PET_SPEED,
    initialSnapshot: null
  })
  overlays.start()
  createTray()
}

function createTray(): void {
  tray = new Tray(placeholderIcon())
  tray.setToolTip(APP_NAME)
  const menu = Menu.buildFromTemplate([
    { label: APP_NAME, enabled: false },
    { type: 'separator' },
    {
      label: 'Hide pet',
      type: 'checkbox',
      checked: false,
      click: (item) => overlays?.setHidden(item.checked)
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ])
  tray.setContextMenu(menu)
}

/** 16x16 mossy block, used until the generated texture icon exists. */
function placeholderIcon(): Electron.NativeImage {
  const size = 16
  const buf = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const edge = x === 0 || y === 0 || x === size - 1 || y === size - 1
      const moss = y < 6
      const [r, g, b] = edge ? [30, 40, 25] : moss ? [90, 150, 60] : [125, 125, 125]
      buf[i] = b // BGRA
      buf[i + 1] = g
      buf[i + 2] = r
      buf[i + 3] = 255
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size })
}

app.on('window-all-closed', () => {
  // Stay alive in the tray; overlays are recreated on display changes.
})

app.on('before-quit', () => {
  overlays?.stop()
  tray?.destroy()
})
