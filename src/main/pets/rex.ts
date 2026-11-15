import { execFile } from 'node:child_process'
import { net } from 'electron'
import { ago } from '../../shared/format'
import type { ActionResult, Leak, PetConfig, PetStatus, RexAction, RexRepo, RexScan, RexView } from '../../shared/types'
import { GitHubReader, MAX_REPO_KB, RateLimited, type PublicRepo } from '../ghscan'
import type { Hit } from '../secrets'
import type { RexCache, Store } from '../store'

const RANDOM_LINES = ['SNIFF SNIFF... ALL CLEAN.', 'NO SECRETS ON GITHUB. GOOD HUMAN.', 'GUARD DOG MODE: ON.', 'WOOF! NOTHING LEAKED.']
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)]
const s = (n: number) => (n === 1 ? '' : 'S')
const DAY = 24 * 3_600_000
/** Wait this long after a push before rescanning (GitHub needs a moment). */
const AFTER_PUSH_MS = 60_000

export interface RexHooks {
  changed(): void
  feed(text: string): void
  say(text: string): void
  /** The linked GitHub account (Catbot's sign-in) and its token. */
  account(): Promise<{ login: string | null; token: string | null }>
}

/** owner/repo from a git remote URL on github.com, or null. */
function githubRepo(url: string): string | null {
  const m = /github\.com[:/]+([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(url.trim())
  return m ? `${m[1]}/${m[2]}` : null
}

function originUrl(path: string): Promise<string | null> {
  return new Promise((done) =>
    execFile('git', ['-C', path, 'remote', 'get-url', 'origin'], { windowsHide: true, timeout: 8000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }, (err, out) =>
      done(err ? null : String(out).trim() || null)
    )
  )
}

const fetcher = (url: string, init?: { headers?: Record<string, string>; redirect?: 'follow' }) => net.fetch(url, init as RequestInit)

/**
 * Rex's purpose: sniff the linked account's public GitHub repos for things
 * that should never be pushed (API keys, tokens, private keys, database
 * passwords, .env files, credential and database files), in the current
 * files and in recent commits. Read-only: it reports and links to GitHub,
 * and never changes a repo.
 */
export class RexService {
  busy: 'scanning' | null = null
  progress: string | null = null
  private timer: NodeJS.Timeout | null = null
  private first: NodeJS.Timeout | null = null
  private pending = new Set<string>()
  private pendingTimer: NodeJS.Timeout | null = null
  private login: string | null = null

  constructor(
    private store: Store,
    private hooks: RexHooks
  ) {}

  private get cfg() {
    return this.store.state.settings.rex
  }
  private get enabled(): boolean {
    return this.store.state.settings.pets.rex.enabled
  }
  private get scanState(): RexScan | null {
    return this.store.state.rex.scan
  }

  start(): void {
    // Catch up on the daily sweep shortly after start, then check every hour.
    this.first = setTimeout(() => void this.dailyCheck(), 45_000)
    this.timer = setInterval(() => void this.dailyCheck(), 3_600_000)
    void this.hooks.account().then((a) => (this.login = a.login))
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    if (this.first) clearTimeout(this.first)
    if (this.pendingTimer) clearTimeout(this.pendingTimer)
  }

  private async dailyCheck(): Promise<void> {
    if (!this.enabled || !this.cfg.daily) return
    const last = this.scanState?.at ?? 0
    if (Date.now() - last >= DAY) await this.scan()
  }

  /** Syncy saw a push: rescan those repos in a minute, if they're public repos of the linked account. */
  async pushed(paths: string[]): Promise<void> {
    if (!this.enabled || !this.cfg.afterPush) return
    const { login } = await this.hooks.account()
    if (!login) return
    for (const p of paths) {
      const full = githubRepo((await originUrl(p)) ?? '')
      if (full && full.split('/')[0].toLowerCase() === login.toLowerCase()) this.pending.add(full)
    }
    if (!this.pending.size) return
    if (this.pendingTimer) clearTimeout(this.pendingTimer)
    this.pendingTimer = setTimeout(() => {
      const only = [...this.pending]
      this.pending.clear()
      void this.scan(only)
    }, AFTER_PUSH_MS)
  }

  /** Scan every public repo (or only `only`, as owner/name). */
  async scan(only?: string[]): Promise<RexScan | null> {
    if (this.busy || !this.enabled) return this.scanState
    const { login, token } = await this.hooks.account()
    this.login = login
    const prev = this.scanState
    if (!login) {
      this.store.state.rex.scan = { at: Date.now(), login: '', repos: [], leaks: [], error: 'Sign in with GitHub on Catbot\'s page, so Rex knows whose repos to guard.' }
      this.hooks.changed()
      return this.scanState
    }
    this.busy = 'scanning'
    this.progress = 'Fetching your public repos...'
    this.hooks.changed()
    const gh = new GitHubReader(fetcher, token)
    const cache = this.store.state.rex.cache
    const repos: RexRepo[] = []
    const leaks: Leak[] = []
    let error: string | null = null
    try {
      const all = await gh.publicRepos(login)
      const list = all.filter((r) => !only || only.some((o) => o.toLowerCase() === r.fullName.toLowerCase()))
      for (let i = 0; i < list.length; i++) {
        const r = list[i]
        const row: RexRepo = { fullName: r.fullName, name: r.name, url: r.url, head: null, scannedAt: Date.now(), leaks: 0, skipped: null, error: null }
        repos.push(row)
        if (r.fork && !this.cfg.includeForks) {
          row.skipped = 'fork'
          continue
        }
        if (r.size > MAX_REPO_KB) {
          row.skipped = `too big (${Math.round(r.size / 1024)} MB)`
          continue
        }
        if (r.size === 0) {
          row.skipped = 'empty'
          continue
        }
        this.progress = `Sniffing ${r.name} (${i + 1}/${list.length})`
        this.hooks.changed()
        try {
          const found = await this.scanRepo(gh, r, cache)
          row.head = found.head
          leaks.push(...found.leaks)
          row.leaks = found.leaks.length
        } catch (err) {
          if (err instanceof RateLimited) throw err
          row.error = (err as Error).message
        }
      }
      // A partial scan keeps everything else from last time.
      if (only && prev) {
        const done = new Set(repos.map((r) => r.fullName.toLowerCase()))
        repos.unshift(...prev.repos.filter((r) => !done.has(r.fullName.toLowerCase())))
        leaks.unshift(...prev.leaks.filter((l) => !done.has(l.repo.toLowerCase())))
      }
      // Forget cached repos that are gone (deleted or made private).
      if (!only) for (const k of Object.keys(cache)) if (!all.some((r) => r.fullName === k)) delete cache[k]
    } catch (err) {
      if (err instanceof RateLimited) {
        const when = gh.resetAt ? new Date(gh.resetAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'later'
        error = `GitHub's hourly limit ran out. Rex tries again after ${when}.`
      } else error = `Couldn't reach GitHub: ${(err as Error).message}`
      // Keep last time's results for repos not reached.
      if (prev) {
        const done = new Set(repos.map((r) => r.fullName.toLowerCase()))
        repos.push(...prev.repos.filter((r) => !done.has(r.fullName.toLowerCase())))
        leaks.push(...prev.leaks.filter((l) => !done.has(l.repo.toLowerCase())))
      }
    } finally {
      this.busy = null
      this.progress = null
    }
    const next: RexScan = { at: Date.now(), login, repos, leaks, error }
    this.store.state.rex.scan = next
    this.store.saveSoon()
    this.react(prev, next)
    this.hooks.changed()
    return next
  }

  /** One repo: its current files (unless unchanged since last time) and its recent commits. */
  private async scanRepo(gh: GitHubReader, r: PublicRepo, cache: Record<string, RexCache>): Promise<{ head: string; leaks: Leak[] }> {
    const head = await gh.head(r)
    const c = cache[r.fullName]
    const files = c && c.head === head ? c.files : await gh.scanFiles(r, head)
    const commits = await gh.recentCommits(r, this.cfg.history)
    const seen: Record<string, Hit[]> = {}
    for (const cm of commits) seen[cm.sha] = c?.commits[cm.sha] ?? (await gh.scanCommit(r, cm.sha))
    cache[r.fullName] = { head, files, commits: seen }

    const out: Leak[] = files.map((h) => ({
      ...h,
      repo: r.fullName,
      where: 'file' as const,
      commit: head,
      date: null,
      url: `${r.url}/blob/${head}/${h.path.split('/').map(encodeURIComponent).join('/')}${h.line ? `#L${h.line}` : ''}`
    }))
    // History: only what isn't in the current files any more. Oldest commit wins (where it first appeared).
    const now = new Set(files.map((h) => h.fp))
    const old = new Map<string, Leak>()
    for (const cm of commits) {
      for (const h of seen[cm.sha]) {
        if (now.has(h.fp)) continue
        old.set(h.fp, {
          ...h,
          repo: r.fullName,
          where: 'history',
          commit: cm.sha,
          date: cm.date,
          url: `${r.url}/blob/${cm.sha}/${h.path.split('/').map(encodeURIComponent).join('/')}${h.line ? `#L${h.line}` : ''}`
        })
      }
    }
    out.push(...old.values())
    return { head, leaks: out }
  }

  private active(scan: RexScan | null): Leak[] {
    const ignored = new Set(this.cfg.ignored)
    return (scan?.leaks ?? []).filter((l) => !ignored.has(l.fp))
  }

  /** New leak: bark. A leak gone since last time: a bone. */
  private react(prev: RexScan | null, next: RexScan): void {
    if (!prev || !prev.login) return
    const before = new Map(this.active(prev).map((l) => [l.fp, l]))
    const after = new Map(this.active(next).map((l) => [l.fp, l]))
    const scanned = new Set(next.repos.filter((r) => r.head).map((r) => r.fullName))
    const fresh = [...after.values()].filter((l) => !before.has(l.fp))
    const fixed = [...before.values()].filter((l) => !after.has(l.fp) && scanned.has(l.repo))
    if (fresh.length) {
      const l = fresh[0]
      this.hooks.say(`WOOF! ${fresh.length === 1 ? `${l.label.toUpperCase()} IN ${l.repo.split('/')[1].toUpperCase()}` : `${fresh.length} NEW SECRETS`} ON GITHUB! RIGHT-CLICK ME.`)
    } else if (fixed.length) {
      this.hooks.feed(`LEAK${fixed.length === 1 ? '' : 'S'} PLUGGED IN ${fixed[0].repo.split('/')[1].toUpperCase()}! CRUNCH.`)
    }
  }

  act(a: RexAction): ActionResult {
    const fp = String(a?.fp ?? '')
    if (!/^[0-9a-f]{16}$/.test(fp)) return { ok: false, message: 'Unknown finding.' }
    if (a.kind === 'ignore') {
      if (!this.cfg.ignored.includes(fp)) this.cfg.ignored.push(fp)
      this.store.saveSoon()
      this.hooks.changed()
      return { ok: true, message: "Rex won't bark about that one again." }
    }
    this.cfg.ignored = this.cfg.ignored.filter((x) => x !== fp)
    this.store.saveSoon()
    this.hooks.changed()
    return { ok: true, message: 'Rex is watching that one again.' }
  }

  view(): RexView {
    const scan = this.scanState
    const ignored = new Set(this.cfg.ignored)
    return {
      scan: scan ? { ...scan, leaks: scan.leaks.map((l) => ({ ...l, ignored: ignored.has(l.fp) })) } : null,
      busy: this.busy,
      progress: this.progress,
      login: this.login
    }
  }

  status(cfg: PetConfig): PetStatus {
    const base = { name: cfg.name, grid: null, busy: this.busy, connected: Boolean(this.login) }
    const scan = this.scanState
    if (this.busy) return { ...base, stage: 'fed', level: 3, alert: null, report: [this.progress?.toUpperCase() ?? 'SNIFFING...', '', '> ON THE TRAIL.'] }
    if (!this.login && (!scan || !scan.login)) {
      return { ...base, stage: 'fed', level: 3, alert: null, report: ['NOT LINKED TO GITHUB YET.', '', "> SIGN IN ON CATBOT'S PAGE AND I'LL GUARD YOUR PUBLIC REPOS."] }
    }
    if (!scan) return { ...base, stage: 'fed', level: 3, alert: null, report: ['FIRST SNIFF COMING SOON...', '', '> I GUARD YOUR PUBLIC REPOS.'] }
    const leaks = this.active(scan)
    const high = leaks.filter((l) => l.severity === 'high')
    const repos = scan.repos.filter((r) => !r.skipped)
    const alert = leaks.length ? `WOOF! ${leaks.length} SECRET${s(leaks.length)} ON GITHUB! RIGHT-CLICK ME.` : null
    const lines = [`GUARDING ${repos.length} PUBLIC REPO${s(repos.length)}`]
    lines.push(leaks.length ? `LEAKS FOUND: ${leaks.length}` : 'NO LEAKS FOUND!')
    for (const l of leaks.slice(0, 3)) lines.push(`- ${short(l.repo.split('/')[1])}: ${l.label.toUpperCase()}`)
    if (leaks.length > 3) lines.push(`  ...AND ${leaks.length - 3} MORE`)
    if (scan.error) lines.push('LAST SNIFF STOPPED EARLY.')
    lines.push(`LAST SNIFF: ${ago(scan.at).toUpperCase()}`)
    lines.push('', `> ${leaks.length ? 'RIGHT-CLICK ME TO SEE THEM.' : pick(RANDOM_LINES)}`)
    const level = high.length ? 1 : leaks.length ? 2 : 4
    return { ...base, stage: 'fed', level, alert, report: lines }
  }
}

const short = (name: string) => (name.length > 12 ? `${name.slice(0, 11)}..` : name).toUpperCase()
