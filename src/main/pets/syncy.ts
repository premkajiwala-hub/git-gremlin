import { watch, type FSWatcher } from 'node:fs'
import { basename, resolve } from 'node:path'
import { ago } from '../../shared/format'
import type { ActionResult, PetConfig, PetStatus, RepoInfo, RepoScan, SyncyView } from '../../shared/types'
import { findVSCode } from '../editor'
import { autoRoots, deleteBranches, inspectRepo, repoRoot, scanRepos, type SearchRoot } from '../repos'
import type { Store } from '../store'

const RANDOM_LINES = [
  'ALL SAFE BEHIND MY DAM.',
  'PUSH EARLY, PUSH OFTEN.',
  'A COMMIT A DAY KEEPS DATA LOSS AWAY.',
  'GNAWING ON YOUR GIT LOG.',
  'NOTHING LEAKS PAST THIS BEAVER.',
  'SMALL COMMITS BUILD STRONG DAMS.'
]
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)]
const HOUR = 3_600_000
const DAY = 24 * HOUR
const s = (n: number) => (n === 1 ? '' : 'S')

/** "4H", "3D", "2W": how long ago, for the speech bubble. */
function age(since: number, now = Date.now()): string {
  const h = (now - since) / HOUR
  return h < 1 ? 'NOW' : h < 48 ? `${Math.round(h)}H` : h < 24 * 14 ? `${Math.round(h / 24)}D` : `${Math.round(h / 24 / 7)}W`
}

/** Does this repo have work that isn't on GitHub? */
export function hasUnsaved(r: RepoInfo): boolean {
  return !r.error && (r.changes > 0 || r.unpushed > 0 || r.stashes > 0)
}

/** The oldest unsaved thing in a repo (ms), or null. */
function oldest(r: RepoInfo): number | null {
  const t = [r.changesSince, r.unpushedSince, r.stashSince].filter((x): x is number => x !== null)
  return t.length ? Math.min(...t) : null
}

export interface SyncyHooks {
  changed(): void
  feed(text: string): void
  say(text: string): void
}

/** File changes that never affect what Syncy reports (dependencies, git's object store and logs). */
const NOISE = /(^|\/)node_modules\/|^\.git\/(objects|logs)\/|\.lock$/
/** Wait this long after the last change before re-checking a repo, but never longer than MAX_WAIT. */
const SETTLE_MS = 2500
const MAX_WAIT_MS = 15_000

const key = (p: string) => resolve(p).toLowerCase()

/** What Syncy reports about a repo, to tell whether a re-check changed anything. */
const summary = (r: RepoInfo) =>
  JSON.stringify([r.branch, r.hasRemote, r.changes, r.changesSince, r.unpushed, r.unpushedSince, r.stashes, r.merged, r.base, r.error])

/**
 * Syncy's purpose: watch your repos for uncommitted changes, commits that
 * aren't on GitHub, forgotten stashes and merged branches; nudge you when
 * work has been sitting unsaved too long; and celebrate when you push.
 *
 * Every watched repo is watched live (a file watcher re-checks it a couple
 * of seconds after anything in it changes); a full check every few minutes
 * finds newly created repos.
 */
export class SyncyService {
  busy: 'scanning' | 'cleaning' | null = null
  private timer: NodeJS.Timeout | null = null
  private firstScan: NodeJS.Timeout | null = null
  private watchers = new Map<string, FSWatcher>()
  private pending = new Map<string, { timer: NodeJS.Timeout; since: number }>()

  constructor(
    private store: Store,
    private hooks: SyncyHooks
  ) {}

  private get cfg() {
    return this.store.state.settings.syncy
  }
  private get enabled(): boolean {
    return this.store.state.settings.pets.syncy.enabled
  }
  private get scan(): RepoScan | null {
    return this.store.state.syncy.lastScan
  }

  start(): void {
    this.reschedule()
    this.firstScan = setTimeout(() => void this.check(), 20_000)
    // Watch the repos from last time right away; the first full check refreshes the list.
    this.syncWatchers()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    if (this.firstScan) clearTimeout(this.firstScan)
    for (const w of this.watchers.values()) w.close()
    this.watchers.clear()
    for (const p of this.pending.values()) clearTimeout(p.timer)
    this.pending.clear()
  }

  reschedule(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = setInterval(() => void this.check(), this.cfg.scanEveryMinutes * 60_000)
  }

  roots(): SearchRoot[] {
    return this.cfg.autoFind ? autoRoots() : []
  }

  // --- live watching ---------------------------------------------------------------------------
  /** Watch exactly the repos in the last check (none while Syncy is off). */
  syncWatchers(): void {
    const want = new Map(this.enabled ? (this.scan?.repos ?? []).map((r) => [key(r.path), r.path]) : [])
    for (const [k, w] of this.watchers) {
      if (want.has(k)) continue
      w.close()
      this.watchers.delete(k)
    }
    for (const [k, path] of want) {
      if (this.watchers.has(k)) continue
      try {
        const w = watch(path, { recursive: true, persistent: false }, (_e, file) => this.changedOnDisk(path, file))
        w.on('error', () => {
          w.close()
          this.watchers.delete(k)
        })
        this.watchers.set(k, w)
      } catch {
        // Can't watch it (removed, no access): the periodic check still covers it.
      }
    }
  }

  private changedOnDisk(path: string, file: string | Buffer | null): void {
    const f = String(file ?? '').replace(/\\/g, '/')
    if (NOISE.test(f)) return
    const k = key(path)
    const p = this.pending.get(k)
    const since = p?.since ?? Date.now()
    if (p) clearTimeout(p.timer)
    // Settle for a moment (a commit touches many files), but don't wait forever during a long build.
    const wait = Math.max(0, Math.min(SETTLE_MS, since + MAX_WAIT_MS - Date.now()))
    this.pending.set(k, { since, timer: setTimeout(() => void this.recheck(path), wait) })
  }

  /** Re-check one repo after its files changed; react if what Syncy reports changed. */
  private async recheck(path: string): Promise<void> {
    this.pending.delete(key(path))
    if (!this.enabled || this.busy === 'scanning' || !this.scan) return
    const fresh = await inspectRepo(path, this.cfg.trackBranches)
    const scan = this.scan
    const i = scan?.repos.findIndex((r) => key(r.path) === key(path)) ?? -1
    if (!scan || i < 0) return
    const prev = scan.repos[i]
    if (summary(prev) === summary(fresh)) return
    scan.repos[i] = fresh
    this.store.saveSoon()
    this.hooks.changed()
    this.react({ ...scan, repos: [prev] }, { ...scan, repos: [fresh] })
  }

  /** Add a repo you chose: it must be a git repo, and not one Syncy already watches. */
  async addRepo(folder: string): Promise<ActionResult> {
    const root = await repoRoot(folder)
    const name = basename(root ?? folder)
    if (!root) return { ok: false, message: `${name} isn't a git repository. Pick a folder where you ran git init (it has a .git folder).` }
    const k = key(root)
    if (this.cfg.ignored.some((p) => key(p) === k)) return { ok: false, message: `${name} is in your ignored repos. Click Watch again to bring it back.` }
    if (this.cfg.folders.some((p) => key(p) === k)) return { ok: false, message: `${name} is already in your list.` }
    if (this.scan?.repos.some((r) => key(r.path) === k)) return { ok: false, message: `Syncy already watches ${name} (it found it automatically).` }
    this.cfg.folders.push(root)
    this.store.saveSoon()
    const info = await inspectRepo(root, this.cfg.trackBranches)
    this.scan?.repos.push(info)
    this.syncWatchers()
    this.hooks.changed()
    return { ok: true, message: `Now watching ${name}.` }
  }

  /** Check every repo, then react to what changed since last time. */
  async check(): Promise<RepoScan | null> {
    if (this.busy || !this.enabled) return this.scan
    this.busy = 'scanning'
    this.hooks.changed()
    const previous = this.scan
    let next: RepoScan
    try {
      next = await scanRepos(this.roots(), this.cfg.ignored, this.cfg.trackBranches, this.cfg.folders)
      this.store.state.syncy.lastScan = next
      this.store.saveSoon()
    } finally {
      this.busy = null
      this.hooks.changed()
    }
    this.syncWatchers()
    if (previous) this.react(previous, next)
    return next
  }

  /** You pushed (unpushed went down): Syncy eats a log. You committed: it reminds you to push. */
  private react(prev: RepoScan, next: RepoScan): void {
    const before = new Map(prev.repos.map((r) => [r.path, r]))
    let pushed = 0
    const pushedRepos: string[] = []
    let committed: string | null = null
    for (const r of next.repos) {
      const p = before.get(r.path)
      if (!p || r.error || p.error) continue
      if (p.unpushed > r.unpushed) {
        pushed += p.unpushed - r.unpushed
        pushedRepos.push(r.name)
      } else if (r.unpushed > p.unpushed && r.changes < p.changes) committed = r.name
    }
    if (pushed > 0) {
      const where = pushedRepos.length === 1 ? pushedRepos[0].toUpperCase() : `${pushedRepos.length} REPOS`
      this.hooks.feed(`${pushed} COMMIT${s(pushed)} FROM ${where} SAFE ON GITHUB!`)
    } else if (committed) {
      this.hooks.say(`NICE COMMIT IN ${committed.toUpperCase()}! PUSH IT TO GITHUB WHEN READY.`)
    }
  }

  /** Delete merged local branches the user picked in the panel. */
  async deleteMerged(path: string, branches: string[]): Promise<ActionResult> {
    const scan = this.scan
    const repo = scan?.repos.find((r) => resolve(r.path).toLowerCase() === resolve(path).toLowerCase())
    if (!scan || !repo) return { ok: false, message: 'That repo is not in the last check.' }
    // Only branches the last check found merged.
    const which = branches.filter((b) => repo.merged.includes(b))
    if (!which.length || this.busy) return { ok: false, message: 'Nothing to delete right now.' }
    this.busy = 'cleaning'
    this.hooks.changed()
    let result: { deleted: string[]; failed: string[] }
    try {
      result = await deleteBranches(repo.path, which)
      const fresh = await inspectRepo(repo.path, this.cfg.trackBranches)
      scan.repos = scan.repos.map((r) => (r.path === repo.path ? fresh : r))
      this.store.saveSoon()
    } finally {
      this.busy = null
      this.hooks.changed()
    }
    const n = result.deleted.length
    if (n) this.hooks.feed(`CLEARED ${n} OLD BRANCH${n === 1 ? '' : 'ES'} FROM ${repo.name.toUpperCase()}!`)
    const failed = result.failed.length ? ` Git kept ${result.failed.join(', ')} (not fully merged into the current branch).` : ''
    return { ok: n > 0, message: `Deleted ${n} branch${n === 1 ? '' : 'es'}.${failed}` }
  }

  isStale(r: RepoInfo, now = Date.now()): boolean {
    const limit = this.cfg.staleHours * HOUR
    return [r.changesSince, r.unpushedSince, r.stashSince].some((t) => t !== null && now - t > limit)
  }

  view(): SyncyView {
    return { scan: this.scan, busy: this.busy, autoRoots: autoRoots().map((r) => r.path), vscode: findVSCode() !== null }
  }

  status(cfg: PetConfig): PetStatus {
    const scan = this.scan
    const now = Date.now()
    const base = { name: cfg.name, grid: null, busy: this.busy, connected: true }
    if (!scan) {
      return { ...base, stage: 'fed', level: 3, alert: null, report: ['CHECKING YOUR REPOS SOON...', '', '> I KEEP YOUR WORK SAFE.'] }
    }
    if (scan.gitMissing) {
      const alert = 'I NEED GIT TO CHECK YOUR REPOS. INSTALL GIT, THEN RIGHT-CLICK ME.'
      return { ...base, stage: 'fed', level: 2, alert, report: ['GIT NOT FOUND.', '', `> ${alert}`] }
    }
    const repos = scan.repos.filter((r) => !r.error)
    const unsaved = repos.filter(hasUnsaved).sort((a, b) => (oldest(a) ?? now) - (oldest(b) ?? now))
    const stale = unsaved.filter((r) => this.isStale(r, now))
    const oldestStale = Math.min(...stale.map((r) => oldest(r) ?? now))
    const level = !unsaved.length ? 4 : !stale.length ? 3 : stale.length >= 3 || now - oldestStale > 7 * DAY ? 1 : 2
    const alert = stale.length ? `${stale.length} REPO${s(stale.length)} HAVE WORK THAT ISN'T ON GITHUB! RIGHT-CLICK ME.` : null

    const lines: string[] = []
    if (this.busy === 'scanning') lines.push('CHECKING YOUR REPOS...')
    lines.push(`WATCHING ${repos.length} REPO${s(repos.length)}`)
    lines.push(unsaved.length ? `NOT ON GITHUB: ${unsaved.length} REPO${s(unsaved.length)}` : 'ALL WORK IS ON GITHUB!')
    for (const r of unsaved.slice(0, 3)) lines.push(`- ${short(r.name)}: ${what(r, now)}`)
    if (unsaved.length > 3) lines.push(`  ...AND ${unsaved.length - 3} MORE`)
    lines.push(`LAST CHECK: ${ago(scan.at).toUpperCase()}`)
    lines.push('', `> ${stale.length ? 'RIGHT-CLICK ME TO SEE THEM.' : unsaved.length ? 'FRESH WORK. PUSH WHEN READY!' : repos.length ? pick(RANDOM_LINES) : 'NO REPOS FOUND. ADD A FOLDER ON MY PAGE.'}`)
    return { ...base, stage: level === 1 ? 'hungry' : 'fed', level, alert, report: lines }
  }
}

const short = (name: string) => (name.length > 12 ? `${name.slice(0, 11)}..` : name).toUpperCase()

/** The most important unsaved thing in a repo, e.g. "2 UNPUSHED, 4D". */
function what(r: RepoInfo, now: number): string {
  if (r.unpushed) return `${r.unpushed} UNPUSHED, ${age(r.unpushedSince ?? now, now)}`
  if (r.changes) return `${r.changes} CHANGE${s(r.changes)}, ${age(r.changesSince ?? now, now)}`
  return `${r.stashes} STASH${r.stashes === 1 ? '' : 'ES'}, ${age(r.stashSince ?? now, now)}`
}
