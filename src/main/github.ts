import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { net, safeStorage } from 'electron'
import { GITHUB_POLL_MS } from '../shared/constants'
import type { ContributionDay, ContributionLevel, GitHubSource } from '../shared/types'
import type { Store } from './store'

export interface GitHubData {
  login: string | null
  days: ContributionDay[]
  source: GitHubSource
  fetchedAt: number
  error: string | null
}

const LEVELS: Record<string, ContributionLevel> = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4
}

const QUERY = `query($login: String!) {
  user(login: $login) { login contributionsCollection { contributionCalendar { weeks { contributionDays { date contributionCount contributionLevel } } } } }
}`
const VIEWER_QUERY = `query {
  viewer { login contributionsCollection { contributionCalendar { weeks { contributionDays { date contributionCount contributionLevel } } } } }
}`

const GH_PATHS = ['gh', 'C:\\Program Files\\GitHub CLI\\gh.exe', `${process.env.LOCALAPPDATA}\\Programs\\GitHub CLI\\gh.exe`]

/**
 * Reads the user's GitHub contribution calendar (the green squares on their
 * profile) a few times an hour. Sources, in order:
 *   1. a personal access token saved in Settings (encrypted with safeStorage),
 *   2. the GitHub CLI's login (`gh auth token`), so it just works if gh is set up,
 *   3. the public profile page for the configured username (public contributions only).
 */
export class GitHubWatcher {
  data: GitHubData
  private timer: NodeJS.Timeout | null = null
  private busy = false

  constructor(
    private store: Store,
    private onUpdate: (data: GitHubData, previous: GitHubData) => void
  ) {
    const cached = store.state.github
    this.data = {
      login: cached.login,
      days: cached.days,
      source: cached.source,
      fetchedAt: cached.fetchedAt,
      error: null
    }
  }

  start(): void {
    void this.refresh()
    this.timer = setInterval(() => void this.refresh(), GITHUB_POLL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  // --- token handling ----------------------------------------------------------------
  get hasSavedToken(): boolean {
    return Boolean(this.store.state.githubTokenEnc)
  }

  /** Save (string), clear (null) or keep (undefined) the personal access token. */
  setToken(token: string | null | undefined): void {
    if (token === undefined) return
    const t = token?.trim()
    if (!t) {
      this.store.state.githubTokenEnc = null
    } else if (safeStorage.isEncryptionAvailable()) {
      this.store.state.githubTokenEnc = safeStorage.encryptString(t).toString('base64')
    } else {
      throw new Error("Windows can't encrypt the token on this PC, so it wasn't saved.")
    }
    this.store.saveSoon()
  }

  private savedToken(): string | null {
    const enc = this.store.state.githubTokenEnc
    if (!enc) return null
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'))
    } catch {
      return null
    }
  }

  /** The GitHub CLI's token, if gh is installed and logged in. */
  ghToken(): Promise<string | null> {
    return new Promise((resolve) => {
      const tryAt = (i: number) => {
        if (i >= GH_PATHS.length) return resolve(null)
        const exe = GH_PATHS[i]
        if (exe !== 'gh' && !existsSync(exe)) return tryAt(i + 1)
        execFile(exe, ['auth', 'token'], { timeout: 8000, windowsHide: true }, (err, stdout) => {
          const t = stdout?.trim()
          if (err || !t) tryAt(i + 1)
          else resolve(t)
        })
      }
      tryAt(0)
    })
  }

  // --- fetching ----------------------------------------------------------------------------
  async refresh(): Promise<GitHubData> {
    if (this.busy) return this.data
    this.busy = true
    const previous = this.data
    try {
      const wanted = this.store.state.settings.githubUser.trim() || null
      let next: GitHubData | null = null
      let lastError: string | null = null

      const saved = this.savedToken()
      const tokens: [string, GitHubSource][] = []
      if (saved) tokens.push([saved, 'token'])
      const gh = await this.ghToken()
      if (gh) tokens.push([gh, 'gh'])

      for (const [token, source] of tokens) {
        try {
          next = await this.fetchGraphQL(token, wanted, source)
          break
        } catch (err) {
          lastError = (err as Error).message
        }
      }
      if (!next && wanted) {
        try {
          next = await this.fetchPublic(wanted)
        } catch (err) {
          lastError = (err as Error).message
        }
      }

      if (next) {
        this.data = next
        this.store.state.github = {
          login: next.login,
          days: next.days.slice(-30),
          source: next.source,
          fetchedAt: next.fetchedAt
        }
        this.store.saveSoon()
      } else {
        this.data = {
          ...previous,
          error: lastError ?? 'Not connected: sign in with the GitHub CLI (gh auth login), or add your username or a token in Settings.'
        }
      }
      this.onUpdate(this.data, previous)
      return this.data
    } finally {
      this.busy = false
    }
  }

  private async fetchGraphQL(token: string, login: string | null, source: GitHubSource): Promise<GitHubData> {
    const res = await net.fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Authorization: `bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'GitGremlin-desktop-pet'
      },
      body: JSON.stringify(login ? { query: QUERY, variables: { login } } : { query: VIEWER_QUERY })
    })
    if (res.status === 401) throw new Error(source === 'token' ? 'The saved GitHub token was rejected.' : 'The GitHub CLI login has expired (run gh auth login).')
    if (!res.ok) throw new Error(`GitHub API error ${res.status}`)
    const json = (await res.json()) as {
      data?: Record<string, { login: string; contributionsCollection: { contributionCalendar: { weeks: { contributionDays: { date: string; contributionCount: number; contributionLevel: string }[] }[] } } } | null>
      errors?: { message: string }[]
    }
    const who = json.data?.[login ? 'user' : 'viewer']
    if (!who) throw new Error(json.errors?.[0]?.message ?? `GitHub user "${login}" not found.`)
    const days = who.contributionsCollection.contributionCalendar.weeks.flatMap((w) =>
      w.contributionDays.map((d) => ({ date: d.date, count: d.contributionCount, level: LEVELS[d.contributionLevel] ?? 0 }))
    )
    return { login: who.login, days, source, fetchedAt: Date.now(), error: null }
  }

  /** Read the public contributions calendar HTML (what the profile page embeds). */
  private async fetchPublic(login: string): Promise<GitHubData> {
    const res = await net.fetch(`https://github.com/users/${encodeURIComponent(login)}/contributions`, {
      headers: { 'User-Agent': 'GitGremlin-desktop-pet' }
    })
    if (res.status === 404) throw new Error(`GitHub user "${login}" not found.`)
    if (!res.ok) throw new Error(`GitHub returned ${res.status} for the public profile.`)
    const html = await res.text()
    const counts = new Map<string, number>()
    for (const m of html.matchAll(/<tool-tip[^>]*\bfor="([^"]+)"[^>]*>([^<]*)<\/tool-tip>/g)) {
      const n = /^(\d+) contribution/.exec(m[2].trim())
      counts.set(m[1], n ? Number(n[1]) : 0)
    }
    const days: ContributionDay[] = []
    for (const m of html.matchAll(/<td\b[^>]*\bdata-date="(\d{4}-\d{2}-\d{2})"[^>]*>/g)) {
      const tag = m[0]
      const id = /\bid="([^"]+)"/.exec(tag)?.[1] ?? ''
      const level = Number(/\bdata-level="(\d)"/.exec(tag)?.[1] ?? 0) as ContributionLevel
      days.push({ date: m[1], count: counts.get(id) ?? (level > 0 ? 1 : 0), level })
    }
    if (!days.length) throw new Error("Couldn't read the public contribution calendar.")
    days.sort((a, b) => a.date.localeCompare(b.date))
    return { login, days, source: 'public', fetchedAt: Date.now(), error: null }
  }
}

/** Local calendar date as YYYY-MM-DD. */
export function localDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export interface Mood {
  todayCount: number
  level: ContributionLevel
  stage: 'fed' | 'hungry' | 'starving'
  streak: number
  /** Levels of the last 7 days, oldest first, today last. */
  week: ContributionLevel[]
}

/**
 * Catbot's mood follows today's square on the contribution chart:
 * 0 contributions today = hungry (starving if yesterday was empty too);
 * levels 1-4 ("Less" -> "More") = fed, from content to ecstatic.
 */
export function moodFrom(days: ContributionDay[], now = new Date()): Mood {
  if (!days.length) return { todayCount: 0, level: 1, stage: 'fed', streak: 0, week: [0, 0, 0, 0, 0, 0, 0] }
  const today = localDate(now)
  let i = days.findIndex((d) => d.date === today)
  // GitHub's calendar may not have reached the local date yet (time zones): use its latest day.
  if (i < 0) i = days.length - 1
  const d = days[i]
  const prev = days[i - 1]
  const stage = d.count > 0 ? 'fed' : prev && prev.count > 0 ? 'hungry' : 'starving'
  let streak = 0
  for (let j = d.count > 0 ? i : i - 1; j >= 0 && days[j].count > 0; j--) streak++
  const week: ContributionLevel[] = []
  for (let j = i - 6; j <= i; j++) week.push(j >= 0 ? days[j].level : 0)
  return { todayCount: d.count, level: d.level, stage, streak, week }
}
