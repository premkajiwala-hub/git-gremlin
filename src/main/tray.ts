import { join } from 'node:path'
import { app, Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron'
import { APP_NAME, PET_IDS } from '../shared/constants'
import type { PetId, PetStatus, Settings } from '../shared/types'

export interface TrayActions {
  openHub(page?: string): void
  setPetEnabled(id: PetId, enabled: boolean): void
  catbotRefresh(): void
  catbotFeed(): void
  dustyScan(): void
  dustyReview(): void
  syncyCheck(): void
  syncyReview(): void
  hideForHour(): void
  showPets(): void
  toggleStartWithWindows(): void
  quit(): void
}

export interface TrayState {
  settings: Settings
  status: Record<PetId, PetStatus>
  hidden: boolean
  startWithWindows: boolean
}

/** One line about a pet for the tray, e.g. "Fed, level 2" or "1.2 GB of junk found". */
function summary(s: PetStatus): string {
  const first = (s.report[0] ?? '').toLowerCase().replace(/\b(\d+(?:\.\d+)?) (b|kb|mb|gb|tb)\b/g, (_m, n: string, u: string) => `${n} ${u.toUpperCase()}`)
  return first.charAt(0).toUpperCase() + first.slice(1)
}

/** The GitGremlin tray icon: opens the panel and gives quick access to every pet. */
export class AppTray {
  private tray: Tray

  constructor(private actions: TrayActions) {
    const icon = nativeImage.createFromPath(join(app.getAppPath(), 'assets', 'icon.png'))
    this.tray = new Tray(icon.isEmpty() ? icon : icon.resize({ width: 16, height: 16, quality: 'good' }))
    this.tray.setToolTip(APP_NAME)
    this.tray.on('click', () => this.actions.openHub())
  }

  update(s: TrayState): void {
    const a = this.actions
    const pets: MenuItemConstructorOptions[] = PET_IDS.map((id) => {
      const cfg = s.settings.pets[id]
      const status = s.status[id]
      const extras: Record<PetId, MenuItemConstructorOptions[]> = {
        catbot: [
          { label: 'Refresh GitHub now', enabled: cfg.enabled, click: () => a.catbotRefresh() },
          { label: 'Feed (debug)', enabled: cfg.enabled, click: () => a.catbotFeed() }
        ],
        dusty: [
          { label: 'Scan for junk now', enabled: cfg.enabled, click: () => a.dustyScan() },
          { label: 'Review and clean...', enabled: cfg.enabled, click: () => a.dustyReview() }
        ],
        syncy: [
          { label: 'Check my repos now', enabled: cfg.enabled, click: () => a.syncyCheck() },
          { label: 'Show unsaved work...', enabled: cfg.enabled, click: () => a.syncyReview() }
        ]
      }
      const extra = extras[id]
      return {
        label: cfg.name,
        submenu: [
          { label: cfg.enabled ? summary(status) : 'Turned off', enabled: false },
          { type: 'separator' },
          { label: 'Show on desktop', type: 'checkbox', checked: cfg.enabled, click: (item) => a.setPetEnabled(id, item.checked) },
          ...extra,
          { type: 'separator' },
          { label: 'Settings...', click: () => a.openHub(id) }
        ]
      }
    })
    const on = PET_IDS.filter((id) => s.settings.pets[id].enabled).map((id) => s.settings.pets[id].name)
    this.tray.setToolTip(`${APP_NAME}: ${on.length ? on.join(', ') : 'no pets out'}`)
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: `Open ${APP_NAME}`, click: () => a.openHub() },
        { type: 'separator' },
        ...pets,
        { type: 'separator' },
        { label: 'Hide all pets for 1 hour', enabled: !s.hidden, click: () => a.hideForHour() },
        { label: 'Show pets', enabled: s.hidden, click: () => a.showPets() },
        { label: 'Start with Windows', type: 'checkbox', checked: s.startWithWindows, click: () => a.toggleStartWithWindows() },
        { type: 'separator' },
        { label: 'Quit', click: () => a.quit() }
      ])
    )
  }

  destroy(): void {
    this.tray.destroy()
  }
}
