import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { DEFAULT_SETTINGS, PET_SIZE_MAX, PET_SIZE_MIN } from '../shared/constants'
import type { ContributionDay, GitHubSource, PetSnapshot, Settings } from '../shared/types'

export interface AppState {
  version: 2
  settings: Settings
  /** Last contribution data, so Catbot's mood is right even before the first fetch. */
  github: {
    login: string | null
    days: ContributionDay[]
    source: GitHubSource
    fetchedAt: number
  }
  /** Personal access token, encrypted with Electron safeStorage (base64), or null. */
  githubTokenEnc: string | null
  pet: PetSnapshot | null
}

function defaults(): AppState {
  return {
    version: 2,
    settings: { ...DEFAULT_SETTINGS },
    github: { login: null, days: [], source: 'none', fetchedAt: 0 },
    githubTokenEnc: null,
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
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<AppState> & { settings?: Partial<Settings> }
      const d = defaults()
      // Only keep known settings (older versions had repo/hunger-hour settings).
      const settings = { ...d.settings }
      for (const key of Object.keys(settings) as (keyof Settings)[]) {
        if (raw.settings && key in raw.settings) (settings as Record<string, unknown>)[key] = raw.settings[key]
      }
      this.state = {
        version: 2,
        settings,
        github: { ...d.github, ...(raw.github ?? {}) },
        githubTokenEnc: raw.githubTokenEnc ?? null,
        pet: raw.pet ?? null
      }
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
    s.petSize = Math.min(PET_SIZE_MAX, Math.max(PET_SIZE_MIN, Number(s.petSize) || DEFAULT_SETTINGS.petSize))
    if (s.movement !== 'ground') s.movement = 'roam'
    s.onTopOfApps = Boolean(s.onTopOfApps)
    if (typeof s.followCursor !== 'boolean') s.followCursor = DEFAULT_SETTINGS.followCursor
    if (typeof s.githubUser !== 'string') s.githubUser = ''
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
