import { join } from 'node:path'
import { app, Menu, nativeImage, Tray } from 'electron'
import { APP_NAME } from '../shared/constants'
import type { PetStatus } from '../shared/types'

export interface TrayActions {
  feedNow(): void
  refreshGitHub(): void
  hideForHour(): void
  showPet(): void
  openSettings(): void
  toggleStartWithWindows(): void
  quit(): void
}

export interface TrayState {
  status: PetStatus
  hidden: boolean
  startWithWindows: boolean
}

const LEVEL_WORD = ['none', 'less', 'some', 'lots', 'more']

export function moodLabel(s: PetStatus): string {
  if (!s.connected) return 'GitHub not linked'
  const stage = s.stage === 'fed' ? 'Fed' : s.stage === 'hungry' ? 'Hungry' : 'Starving'
  return `${stage}, ${s.todayCount} contribution${s.todayCount === 1 ? '' : 's'} today (${LEVEL_WORD[s.level]})`
}

export class AppTray {
  private tray: Tray

  constructor(private actions: TrayActions) {
    const icon = nativeImage.createFromPath(join(app.getAppPath(), 'assets', 'icon.png'))
    this.tray = new Tray(icon.isEmpty() ? icon : icon.resize({ width: 16, height: 16, quality: 'good' }))
    this.tray.on('click', () => this.tray.popUpContextMenu())
  }

  update(s: TrayState): void {
    const label = moodLabel(s.status)
    this.tray.setToolTip(`${APP_NAME}: ${s.status.name} (${label})`)
    const a = this.actions
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: `${s.status.name}: ${label}`, enabled: false },
        { label: s.status.login ? `GitHub: ${s.status.login}` : 'GitHub: not linked', enabled: false },
        { type: 'separator' },
        { label: 'Refresh GitHub now', click: () => a.refreshGitHub() },
        { label: 'Feed now (debug)', click: () => a.feedNow() },
        { type: 'separator' },
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
