import { basename, join } from 'node:path'
import { app, Menu, nativeImage, Tray } from 'electron'
import { APP_NAME } from '../shared/constants'
import type { PetStatus } from '../shared/types'

export interface TrayActions {
  feedNow(): void
  addRepo(): void
  removeRepo(path: string): void
  togglePause(): void
  hideForHour(): void
  showPet(): void
  openSettings(): void
  toggleStartWithWindows(): void
  quit(): void
}

export interface TrayState {
  status: PetStatus
  repos: string[]
  paused: boolean
  hidden: boolean
  startWithWindows: boolean
}

const STAGE_LABEL = { full: 'Full', peckish: 'Peckish', hungry: 'Hungry', starving: 'Starving' }

export class AppTray {
  private tray: Tray

  constructor(private actions: TrayActions) {
    const icon = nativeImage.createFromPath(join(app.getAppPath(), 'assets', 'icon.png'))
    this.tray = new Tray(icon.isEmpty() ? icon : icon.resize({ width: 16, height: 16, quality: 'good' }))
    this.tray.on('click', () => this.tray.popUpContextMenu())
  }

  update(s: TrayState): void {
    const pct = Math.round(s.status.fullness * 100)
    const mood = `${STAGE_LABEL[s.status.stage]} (${pct}% full)`
    this.tray.setToolTip(`${APP_NAME}: ${s.status.name} is ${mood.toLowerCase()}`)
    const a = this.actions
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: `${s.status.name}: ${mood}`, enabled: false },
        { type: 'separator' },
        { label: 'Feed now (debug)', click: () => a.feedNow() },
        { label: 'Add repo...', click: () => a.addRepo() },
        {
          label: 'Remove repo',
          submenu: s.repos.length
            ? s.repos.map((r) => ({ label: `${basename(r)}  (${r})`, click: () => a.removeRepo(r) }))
            : [{ label: '(no repos watched)', enabled: false }]
        },
        { type: 'separator' },
        { label: 'Pause hunger', type: 'checkbox', checked: s.paused, click: () => a.togglePause() },
        { label: 'Hide for 1 hour', enabled: !s.hidden, click: () => a.hideForHour() },
        { label: 'Show pet', enabled: s.hidden, click: () => a.showPet() },
        { type: 'separator' },
        { label: 'Settings...', click: () => a.openSettings() },
        {
          label: 'Start with Windows',
          type: 'checkbox',
          checked: s.startWithWindows,
          click: () => a.toggleStartWithWindows()
        },
        { type: 'separator' },
        { label: 'Quit', click: () => a.quit() }
      ])
    )
  }

  destroy(): void {
    this.tray.destroy()
  }
}
