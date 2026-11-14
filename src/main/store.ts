import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { DEFAULT_SETTINGS, PET_IDS, PET_SIZE_MAX, PET_SIZE_MIN } from '../shared/constants'
import type { CleanResult, ContributionDay, GitHubSource, PetConfig, PetId, PetSnapshot, RepoScan, ScanResult, Settings, SyncyConfig } from '../shared/types'

export interface AppState {
  version: 4
  settings: Settings
  /** How Catbot's GitHub account was linked (null = not linked). */
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
  /** Where each pet was, so it reappears there. */
  pets: Record<PetId, PetSnapshot | null>
  dusty: { lastScan: ScanResult | null; lastClean: CleanResult | null }
  syncy: { lastScan: RepoScan | null; lastSummaryDay: string | null }
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

function defaults(): AppState {
  return {
    version: 4,
    settings: clone(DEFAULT_SETTINGS),
    githubAuth: null,
    githubTokenEnc: null,
    github: { login: null, name: null, avatarUrl: null, days: [], source: 'none', fetchedAt: 0 },
    pets: { catbot: null, dusty: null, syncy: null },
    dusty: { lastScan: null, lastClean: null },
    syncy: { lastScan: null, lastSummaryDay: null }
  }
}

function petConfig(raw: Partial<PetConfig> | undefined, def: PetConfig): PetConfig {
  const r = raw ?? {}
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : def.enabled,
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 24) : def.name,
    petSize: Math.min(PET_SIZE_MAX, Math.max(PET_SIZE_MIN, Number(r.petSize) || def.petSize)),
    petSpeed: Math.min(150, Math.max(10, Number(r.petSpeed) || def.petSpeed)),
    movement: r.movement === 'ground' ? 'ground' : r.movement === 'roam' ? 'roam' : def.movement,
    followCursor: typeof r.followCursor === 'boolean' ? r.followCursor : def.followCursor
  }
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()))].slice(0, 100) : []

function syncyConfig(raw: Partial<SyncyConfig> | undefined, def: SyncyConfig): SyncyConfig {
  const r = raw ?? {}
  const hour = r.summaryHour === null ? null : Number(r.summaryHour ?? def.summaryHour)
  return {
    autoFind: typeof r.autoFind === 'boolean' ? r.autoFind : def.autoFind,
    folders: r.folders === undefined ? def.folders : strings(r.folders),
    ignored: r.ignored === undefined ? def.ignored : strings(r.ignored),
    staleHours: Math.min(24 * 30, Math.max(1, Number(r.staleHours) || def.staleHours)),
    scanEveryMinutes: Math.min(24 * 60, Math.max(5, Number(r.scanEveryMinutes) || def.scanEveryMinutes)),
    summaryHour: hour === null || !Number.isInteger(hour) || hour < 0 || hour > 23 ? null : hour,
    trackBranches: typeof r.trackBranches === 'boolean' ? r.trackBranches : def.trackBranches
  }
}

/** Fill in / clamp settings from anything (old versions, hand edits, the panel). */
export function normalizeSettings(raw: Partial<Settings> | undefined): Settings {
  const d = DEFAULT_SETTINGS
  const r = raw ?? {}
  const dusty = r.dusty ?? d.dusty
  return {
    onTopOfApps: Boolean(r.onTopOfApps),
    pets: {
      catbot: petConfig(r.pets?.catbot, d.pets.catbot),
      dusty: petConfig(r.pets?.dusty, d.pets.dusty),
      syncy: petConfig(r.pets?.syncy, d.pets.syncy)
    },
    dusty: {
      mode: dusty.mode === 'auto' || dusty.mode === 'report' ? dusty.mode : 'ask',
      targets: {
        devCaches: Boolean(dusty.targets?.devCaches ?? d.dusty.targets.devCaches),
        recycleBin: Boolean(dusty.targets?.recycleBin ?? d.dusty.targets.recycleBin),
        temp: Boolean(dusty.targets?.temp ?? d.dusty.targets.temp),
        browser: Boolean(dusty.targets?.browser ?? d.dusty.targets.browser)
      },
      scanEveryMinutes: Math.min(24 * 60, Math.max(15, Number(dusty.scanEveryMinutes) || d.dusty.scanEveryMinutes))
    },
    syncy: syncyConfig(r.syncy, d.syncy)
  }
}

/** JSON state in Electron's userData folder, written atomically and debounced. */
export class Store {
  readonly path = join(app.getPath('userData'), 'state.json')
  state: AppState = defaults()
  private timer: NodeJS.Timeout | null = null

  load(): void {
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as Record<string, any>
      const d = defaults()
      let settings: Settings
      let pets: Record<PetId, PetSnapshot | null> = d.pets
      if (raw.version === 4) {
        settings = normalizeSettings(raw.settings)
        for (const id of PET_IDS) pets[id] = raw.pets?.[id] ?? null
      } else {
        // Up to v3 there was one pet (Catbot) with flat settings.
        const s = raw.settings ?? {}
        settings = normalizeSettings({
          onTopOfApps: s.onTopOfApps,
          pets: {
            catbot: {
              ...d.settings.pets.catbot,
              name: s.petName === 'Mossy' ? 'Catbot' : s.petName,
              petSize: s.petSize,
              petSpeed: s.petSpeed,
              movement: s.movement,
              followCursor: s.followCursor
            },
            dusty: d.settings.pets.dusty,
            syncy: d.settings.pets.syncy
          }
        })
        pets = { catbot: raw.pet ?? null, dusty: null, syncy: null }
      }
      const linked = (raw.version ?? 0) >= 3 && (raw.githubAuth === 'oauth' || raw.githubAuth === 'gh')
      this.state = {
        version: 4,
        settings,
        githubAuth: linked ? raw.githubAuth : null,
        githubTokenEnc: linked ? (raw.githubTokenEnc ?? null) : null,
        github: linked ? { ...d.github, ...(raw.github ?? {}) } : d.github,
        pets,
        dusty: { lastScan: raw.dusty?.lastScan ?? null, lastClean: raw.dusty?.lastClean ?? null },
        syncy: { lastScan: raw.syncy?.lastScan ?? null, lastSummaryDay: raw.syncy?.lastSummaryDay ?? null }
      }
    } catch {
      this.state = defaults()
    }
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
