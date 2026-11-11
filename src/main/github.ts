import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { net, safeStorage } from 'electron'
import { GITHUB_POLL_MS } from '../shared/constants'
import type { ContributionDay, ContributionLevel, GitHubSource } from '../shared/types'
import type { Store } from './store'

export interface GitHubData {
  login: string | null
  name: string | null
  avatarUrl: string | null
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

/** The signed-in user's own profile and contribution calendar. */
const VIEWER_QUERY = `query {
  viewer {
    login
    name
    avatarUrl(size: 96)
    contributionsCollection { contributionCalendar { weeks { contributionDays { date contributionCount contributionLevel } } } }
  }
}`

const GH_PATHS = ['gh', 'C:\\Program Files\\GitHub CLI\\gh.exe', `${process.env.LOCALAPPDATA}\\Programs\\GitHub CLI\\gh.exe`]

const EMPTY: Omit<GitHubData, 'error'> = { login: null, name: null, avatarUrl: null, days: [], source: 'none', fetchedAt: 0 }

/**
 * Reads the linked GitHub account's contribution calendar (the green squares
 * on its profile) a few times an hour. An account is only linked after the
 * user authenticates with GitHub: either "Sign in with GitHub" (OAuth device
 * flow, token stored encrypted) or explicitly choosing their GitHub CLI login.
 */
export class GitHubWatcher {
  data: GitHubData
  private timer: NodeJS.Timeout | null = null
  private busy = false

  constructor(
    private store: Store,
    private onUpdate: (data: GitHubData, previous: GitHubData) => void
  ) {
    const auth = store.state.githubAuth
    this.data = auth ? { ...store.state.github, source: auth, error: null } : { ...EMPTY, error: null }
  }

  start(): void {
    void this.refresh()
    this.timer = setInterval(() => void this.refresh(), GITHUB_POLL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  get source(): GitHubSource {
    return this.store.state.githubAuth ?? 'none'
  }

  // --- linking -------------------------------------------------------------------------
  /** Link with a token from "Sign in with GitHub". Verifies it before keeping it. */
  async linkOAuth(token: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows can't encrypt the GitHub token on this PC.")
    const data = await this.fetchViewer(token, 'oauth')
    this.store.state.githubTokenEnc = safeStorage.encryptString(token).toString('base64')
    this.store.state.githubAuth = 'oauth'
    this.apply(data)
  }

  /** Link using the GitHub CLI's login (the user authenticated it with GitHub via gh auth login). */
  async linkCli(): Promise<void> {
    const token = await this.ghToken()
    if (!token) throw new Error('The GitHub CLI is not signed in. Run "gh auth login" first.')
    const data = await this.fetchViewer(token, 'gh')
    this.store.state.githubTokenEnc = null
    this.store.state.githubAuth = 'gh'
    this.apply(data)
  }

  /** Unlink: forget the token and the cached contributions. */
  signOut(): void {
    const previous = this.data
    this.store.state.githubTokenEnc = null
    this.store.state.githubAuth = null
    this.store.state.github = { ...EMPTY }
    this.store.saveSoon()
    this.data = { ...EMPTY, error: null }
    this.onUpdate(this.data, previous)
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

  private async token(): Promise<string | null> {
    const auth = this.store.state.githubAuth
    if (auth === 'gh') return this.ghToken()
    if (auth !== 'oauth' || !this.store.state.githubTokenEnc) return null
    try {
      return safeStorage.decryptString(Buffer.from(this.store.state.githubTokenEnc, 'base64'))
    } catch {
      return null
    }
  }

  // --- fetching ----------------------------------------------------------------------------
  async refresh(): Promise<GitHubData> {
    if (this.busy || !this.store.state.githubAuth) return this.data
    this.busy = true
    try {
      const token = await this.token()
      if (!token) {
        this.setError(this.source === 'gh' ? 'The GitHub CLI is no longer signed in.' : 'Your GitHub sign-in is missing. Please sign in again.')
      } else {
        try {
          this.apply(await this.fetchViewer(token, this.source))
        } catch (err) {
          this.setError((err as Error).message)
        }
      }
      return this.data
    } finally {
      this.busy = false
    }
  }

  private apply(next: GitHubData): void {
    const previous = this.data
    this.data = next
    this.store.state.github = {
      login: next.login,
      name: next.name,
      avatarUrl: next.avatarUrl,
      days: next.days.slice(-30),
      source: next.source,
      fetchedAt: next.fetchedAt
    }
    this.store.saveSoon()
    this.onUpdate(this.data, previous)
  }

  private setError(error: string): void {
    const previous = this.data
    this.data = { ...previous, error }
    this.onUpdate(this.data, previous)
  }

  private async fetchViewer(token: string, source: GitHubSource): Promise<GitHubData> {
    const res = await net.fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'GitGremlin-desktop-pet' },
      body: JSON.stringify({ query: VIEWER_QUERY })
    })
    if (res.status === 401) {
      throw new Error(source === 'gh' ? 'The GitHub CLI login has expired (run gh auth login).' : 'GitHub sign-in expired or was revoked. Please sign in again.')
    }
    if (!res.ok) throw new Error(`GitHub API error ${res.status}`)
    const json = (await res.json()) as {
      data?: {
        viewer: {
          login: string
          name: string | null
          avatarUrl: string
          contributionsCollection: {
            contributionCalendar: { weeks: { contributionDays: { date: string; contributionCount: number; contributionLevel: string }[] }[] }
          }
        } | null
      }
      errors?: { message: string }[]
    }
    const v = json.data?.viewer
    if (!v) throw new Error(json.errors?.[0]?.message ?? 'GitHub did not return your profile.')
    const days = v.contributionsCollection.contributionCalendar.weeks.flatMap((w) =>
      w.contributionDays.map((d) => ({ date: d.date, count: d.contributionCount, level: LEVELS[d.contributionLevel] ?? 0 }))
    )
    return { login: v.login, name: v.name, avatarUrl: v.avatarUrl, days, source, fetchedAt: Date.now(), error: null }
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
