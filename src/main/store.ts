import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { DEFAULT_SETTINGS, PET_SIZE_MAX, PET_SIZE_MIN } from '../shared/constants'
import type { PetSnapshot, Settings } from '../shared/types'

export interface RepoState {
  /** Author timestamps (unix seconds) of the user's commits already eaten or ignored. */
  seen: number[]
  /** When the repo was added (ms); older commits never count as food. */
  addedAt: number
}

export interface AppState {
  version: 1
  settings: Settings
  hunger: {
    /** Effective hours without food (stage thresholds compare against this). */
    hours: number
    lastCommitAt: number | null
    paused: boolean
  }
  repos: Record<string, RepoState>
  pet: PetSnapshot | null
}

function defaults(): AppState {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS, repos: [] },
    hunger: { hours: 0, lastCommitAt: null, paused: false },
    repos: {},
    pet: null
  }
}

/** JSON state in Electron's userData folder, written atomically and debounced. */
export class Store {
  readonly path = join(app.getPath('userData'), 'state.json')
  state: AppState = defaults()
  private timer: NodeJS.Timeout | null = null

  load(): void {
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<AppState>
      const d = defaults()
      this.state = {
        version: 1,
        settings: { ...d.settings, ...(raw.settings ?? {}) },
        hunger: { ...d.hunger, ...(raw.hunger ?? {}) },
        repos: raw.repos ?? {},
        pet: raw.pet ?? null
      }
      this.state.settings.repos = [...new Set(this.state.settings.repos ?? [])]
      this.migrate()
    } catch {
      this.state = defaults()
    }
  }

  /** Mossy -> Catbot: carry over the old defaults to the new ones, keep anything customised. */
  private migrate(): void {
    const s = this.state.settings
    if (s.petName === 'Mossy') s.petName = DEFAULT_SETTINGS.petName
    if (s.petSize === 80) s.petSize = DEFAULT_SETTINGS.petSize
    s.petSize = Math.min(PET_SIZE_MAX, Math.max(PET_SIZE_MIN, s.petSize))
    if (s.movement !== 'ground') s.movement = 'roam'
    s.onTopOfApps = Boolean(s.onTopOfApps)
  }

  saveSoon(): void {
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), 1000)
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const tmp = `${this.path}.tmp`
      writeFileSync(tmp, JSON.stringify(this.state, null, 2))
      renameSync(tmp, this.path)
    } catch (err) {
      console.error('[store] save failed', err)
    }
  }
}
