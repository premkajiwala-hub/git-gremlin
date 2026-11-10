import { existsSync } from 'node:fs'
import { normalize } from 'node:path'
import { simpleGit } from 'simple-git'
import { GIT_POLL_MS } from '../shared/constants'
import type { RepoResult } from '../shared/types'
import type { Store } from './store'

export interface NewCommit {
  repo: string
  hash: string
  /** Author time, unix ms. */
  at: number
  linesChanged: number
}

interface LogEntry {
  hash: string
  email: string
  /** Author time, unix seconds. */
  at: number
  lines: number
}

const LOOKBACK = '8 days ago'
const FRESH_MS = 24 * 3_600_000
const EMAIL_CACHE_MS = 10 * 60_000

/** Polls watched repos with `git log` and reports the user's new commits. */
export class GitWatcher {
  private timer: NodeJS.Timeout | null = null
  private polling = false
  private emailCache = new Map<string, { email: string; at: number }>()

  constructor(
    private store: Store,
    private onCommits: (commits: NewCommit[]) => void
  ) {}

  start(): void {
    setTimeout(() => void this.poll(), 4000)
    this.timer = setInterval(() => void this.poll(), GIT_POLL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  /** `git config --global user.email`, for display in settings. */
  async detectedEmail(): Promise<string> {
    try {
      return (await simpleGit().raw(['config', '--global', 'user.email'])).trim()
    } catch {
      return ''
    }
  }

  async addRepo(dir: string): Promise<RepoResult> {
    const top = await this.toplevel(dir)
    if (!top) return { ok: false, error: `"${dir}" isn't inside a git repository.` }
    const s = this.store.state.settings
    if (s.repos.some((r) => r.toLowerCase() === top.toLowerCase())) {
      return { ok: false, error: `Already watching ${top}.` }
    }
    s.repos.push(top)
    this.store.state.repos[top] = { seen: [], addedAt: Date.now() }
    // Existing history isn't food: mark everything already there as seen.
    try {
      const entries = await this.readLog(top)
      this.store.state.repos[top].seen = entries.map((e) => e.at)
    } catch {
      /* empty repo, etc. */
    }
    this.store.saveSoon()
    return { ok: true, path: top }
  }

  removeRepo(path: string): void {
    const s = this.store.state.settings
    s.repos = s.repos.filter((r) => r !== path)
    delete this.store.state.repos[path]
    this.store.saveSoon()
  }

  async poll(): Promise<void> {
    if (this.polling) return
    this.polling = true
    try {
      const found: NewCommit[] = []
      for (const repo of [...this.store.state.settings.repos]) {
        try {
          found.push(...(await this.pollRepo(repo)))
        } catch (err) {
          console.warn(`[git] ${repo}:`, (err as Error).message)
        }
      }
      if (found.length) {
        this.store.saveSoon()
        this.onCommits(found.sort((a, b) => a.at - b.at))
      }
    } finally {
      this.polling = false
    }
  }

  private async pollRepo(repo: string): Promise<NewCommit[]> {
    if (!existsSync(repo)) return []
    const state = (this.store.state.repos[repo] ??= { seen: [], addedAt: Date.now() })
    const email = (await this.emailFor(repo)).toLowerCase()
    if (!email) return []
    const entries = (await this.readLog(repo)).filter((e) => e.email.toLowerCase() === email)
    const seen = new Set(state.seen)
    const now = Date.now()
    const fresh: NewCommit[] = []
    for (const e of entries) {
      // Dedupe by author time: amends and rebases keep it, so they aren't eaten twice.
      if (seen.has(e.at)) continue
      seen.add(e.at)
      const atMs = e.at * 1000
      if (atMs < state.addedAt || now - atMs > FRESH_MS) continue
      fresh.push({ repo, hash: e.hash, at: atMs, linesChanged: e.lines })
    }
    // Keep only what's inside the lookback window.
    const cutoff = now / 1000 - 9 * 86400
    state.seen = [...seen].filter((t) => t > cutoff)
    return fresh
  }

  private async emailFor(repo: string): Promise<string> {
    const override = this.store.state.settings.gitEmail.trim()
    if (override) return override
    const cached = this.emailCache.get(repo)
    if (cached && Date.now() - cached.at < EMAIL_CACHE_MS) return cached.email
    let email = ''
    try {
      email = (await simpleGit(repo).raw(['config', 'user.email'])).trim()
    } catch {
      email = ''
    }
    this.emailCache.set(repo, { email, at: Date.now() })
    return email
  }

  private async readLog(repo: string): Promise<LogEntry[]> {
    const out = await simpleGit(repo).raw([
      'log',
      '--all',
      '--no-merges',
      `--since=${LOOKBACK}`,
      '--format=%x1e%H%x1f%ae%x1f%at',
      '--shortstat'
    ])
    const entries: LogEntry[] = []
    for (const block of out.split('\x1e')) {
      const trimmed = block.trim()
      if (!trimmed) continue
      const [head, ...rest] = trimmed.split('\n')
      const [hash, email, at] = head.split('\x1f')
      const stat = rest.join(' ')
      const ins = Number(/(\d+) insertion/.exec(stat)?.[1] ?? 0)
      const del = Number(/(\d+) deletion/.exec(stat)?.[1] ?? 0)
      entries.push({ hash, email: email ?? '', at: Number(at), lines: ins + del })
    }
    return entries
  }

  private async toplevel(dir: string): Promise<string | null> {
    try {
      const top = (await simpleGit(dir).revparse(['--show-toplevel'])).trim()
      return top ? normalize(top) : null
    } catch {
      return null
    }
  }
}
