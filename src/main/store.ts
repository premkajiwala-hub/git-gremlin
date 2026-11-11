import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { DEFAULT_SETTINGS, PET_SIZE_MAX, PET_SIZE_MIN } from '../shared/constants'
import type { ContributionDay, GitHubSource, PetSnapshot, Settings } from '../shared/types'

export interface AppState {
  version: 3
  settings: Settings
  /** How the GitHub account was linked (null = not linked). */
  githubAuth: 'oauth' | 'gh' | null
  /** "Sign in with GitHub" token, encrypted with Electron safeStorage (base64), or null. */
  githubTokenEnc: string | null
  /** Last contribution data, so Catbot's mood is right even before the first fetch. */
  github: {
    login: string | null
    name: string | null
    avatarUrl: string | null
    days: ContributionDay[]
    source: GitHubSource
    fetchedAt: number
  }
  pet: PetSnapshot | null
}

function defaults(): AppState {
  return {
    version: 3,
    settings: { ...DEFAULT_SETTINGS },
    githubAuth: null,
    githubTokenEnc: null,
    github: { login: null, name: null, avatarUrl: null, days: [], source: 'none', fetchedAt: 0 },
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
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<AppState> & { settings?: Partial<Settings>; version?: number }
      const d = defaults()
      // Only keep known settings (older versions had repo, hunger-hour and quiet-hour settings).
      const settings = { ...d.settings }
      for (const key of Object.keys(settings) as (keyof Settings)[]) {
        if (raw.settings && key in raw.settings) (settings as Record<string, unknown>)[key] = raw.settings[key]
      }
      // Version 2 linked GitHub silently (CLI token or a typed username). Linking now
      // needs an explicit, authenticated sign-in, so start unlinked.
      const linked = raw.version === 3 && (raw.githubAuth === 'oauth' || raw.githubAuth === 'gh')
      this.state = {
        version: 3,
        settings,
        githubAuth: linked ? raw.githubAuth! : null,
        githubTokenEnc: linked ? (raw.githubTokenEnc ?? null) : null,
        github: linked ? { ...d.github, ...(raw.github ?? {}) } : d.github,
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
