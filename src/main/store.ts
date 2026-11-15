import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { DEFAULT_SETTINGS, PET_IDS, PET_SIZE_MAX, PET_SIZE_MIN } from '../shared/constants'
import type { CleanResult, ContributionDay, GitHubSource, MoleConfig, PetConfig, PetId, PetSnapshot, RepoScan, RexConfig, RexScan, ScanResult, Settings, SyncyConfig } from '../shared/types'
import type { Hit } from './secrets'

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
  syncy: { lastScan: RepoScan | null }
  /** The port each project usually runs on (learned), keyed by lower-case project folder. */
  mole: { usual: Record<string, number> }
  /** Rex's last scan, and what it already read (by commit), so unchanged repos aren't downloaded again. */
  rex: { scan: RexScan | null; cache: Record<string, RexCache>; rules?: number }
}

/** Per repo: the file findings at one commit, and findings per commit already read (masked previews only). */
export interface RexCache {
  head: string
  files: Hit[]
  commits: Record<string, Hit[]>
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

function defaults(): AppState {
  return {
    version: 4,
    settings: clone(DEFAULT_SETTINGS),
    githubAuth: null,
    githubTokenEnc: null,
    github: { login: null, name: null, avatarUrl: null, days: [], source: 'none', fetchedAt: 0 },
    pets: { catbot: null, dusty: null, syncy: null, mole: null, rex: null },
    dusty: { lastScan: null, lastClean: null },
    syncy: { lastScan: null },
    mole: { usual: {} },
    rex: { scan: null, cache: {} }
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
  return {
    folders: r.folders === undefined ? def.folders : strings(r.folders),
    ignored: r.ignored === undefined ? def.ignored : strings(r.ignored),
    staleHours: Math.min(24 * 30, Math.max(1, Number(r.staleHours) || def.staleHours)),
    scanEveryMinutes: Math.min(24 * 60, Math.max(5, Number(r.scanEveryMinutes) || def.scanEveryMinutes)),
    trackBranches: typeof r.trackBranches === 'boolean' ? r.trackBranches : def.trackBranches
  }
}

function moleConfig(raw: Partial<MoleConfig> | undefined, def: MoleConfig): MoleConfig {
  const r = raw ?? {}
  const m = Number(r.leftoverMinutes)
  return {
    leftoverMinutes: Number.isFinite(m) && r.leftoverMinutes !== undefined ? Math.min(24 * 60, Math.max(0, m)) : def.leftoverMinutes,
    clashAlerts: typeof r.clashAlerts === 'boolean' ? r.clashAlerts : def.clashAlerts,
    showServices: typeof r.showServices === 'boolean' ? r.showServices : def.showServices
  }
}

function rexConfig(raw: Partial<RexConfig> | undefined, def: RexConfig): RexConfig {
  const r = raw ?? {}
  const h = Number(r.history)
  return {
    afterPush: typeof r.afterPush === 'boolean' ? r.afterPush : def.afterPush,
    daily: typeof r.daily === 'boolean' ? r.daily : def.daily,
    history: r.history !== undefined && Number.isFinite(h) ? Math.min(100, Math.max(0, Math.round(h))) : def.history,
    includeForks: typeof r.includeForks === 'boolean' ? r.includeForks : def.includeForks,
    ignored: r.ignored === undefined ? def.ignored : strings(r.ignored).slice(0, 500)
  }
}

/** Fill in / clamp settings from anything (old versions, hand edits, the panel). */
export function normalizeSettings(raw: Partial<Settings> | undefined): Settings {
  const d = DEFAULT_SETTINGS
  const r = raw ?? {}
  const dusty = r.dusty ?? d.dusty
  return {
    onTopOfApps: Boolean(r.onTopOfApps),
    theme: r.theme === 'light' || r.theme === 'dark' ? r.theme : 'system',
    pets: {
      catbot: petConfig(r.pets?.catbot, d.pets.catbot),
      dusty: petConfig(r.pets?.dusty, d.pets.dusty),
      syncy: petConfig(r.pets?.syncy, d.pets.syncy),
      mole: petConfig(r.pets?.mole, d.pets.mole),
      rex: petConfig(r.pets?.rex, d.pets.rex)
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
    syncy: syncyConfig(r.syncy, d.syncy),
    mole: moleConfig(r.mole, d.mole),
    rex: rexConfig(r.rex, d.rex)
  }
}

function usualPorts(v: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (v && typeof v === 'object')
    for (const [k, n] of Object.entries(v as Record<string, unknown>)) if (typeof n === 'number' && n > 0 && n < 65536) out[k] = n
  return out
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
            syncy: d.settings.pets.syncy,
            mole: d.settings.pets.mole,
            rex: d.settings.pets.rex
          }
        })
        pets = { catbot: raw.pet ?? null, dusty: null, syncy: null, mole: null, rex: null }
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
        syncy: { lastScan: raw.syncy?.lastScan ?? null },
        mole: { usual: usualPorts(raw.mole?.usual) },
        rex: { scan: raw.rex?.scan ?? null, cache: raw.rex?.cache && typeof raw.rex.cache === 'object' ? raw.rex.cache : {}, rules: Number(raw.rex?.rules) || 0 }
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
