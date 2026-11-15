/**
 * Reads public repos from GitHub for Rex: the list of an account's public
 * repos, each repo's default branch as one tarball, and recent commits'
 * diffs. Read-only GET requests; `fetcher` is Electron's net.fetch in the
 * app (plain fetch in tests).
 */
import { keep, readTarGz, scanFile, scanPatch, skipPath, riskyFile, type Hit } from './secrets'

export type Fetcher = (url: string, init?: { headers?: Record<string, string>; redirect?: 'follow' }) => Promise<Response>

export interface PublicRepo {
  name: string
  fullName: string
  branch: string
  fork: boolean
  archived: boolean
  /** Size in KB, as GitHub reports it. */
  size: number
  pushedAt: string
  url: string
}

export interface CommitRef {
  sha: string
  date: string
  message: string
}

export class RateLimited extends Error {}

/** Bigger repos are skipped (a tarball this size takes a while to download). */
export const MAX_REPO_KB = 150 * 1024

export class GitHubReader {
  /** Requests left this hour, as GitHub last said. */
  remaining: number | null = null
  resetAt: number | null = null
  constructor(
    private fetcher: Fetcher,
    private token: string | null
  ) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'GitGremlin-desktop-pet', 'X-GitHub-Api-Version': '2022-11-28' }
    if (this.token) h.Authorization = `Bearer ${this.token}`
    return h
  }

  private async get(url: string): Promise<Response> {
    if (this.remaining !== null && this.remaining < 5) throw new RateLimited('GitHub rate limit reached')
    const res = await this.fetcher(url, { headers: this.headers(), redirect: 'follow' })
    const left = res.headers.get('x-ratelimit-remaining')
    if (left !== null) this.remaining = Number(left)
    const reset = res.headers.get('x-ratelimit-reset')
    if (reset !== null) this.resetAt = Number(reset) * 1000
    if ((res.status === 403 || res.status === 429) && this.remaining === 0) throw new RateLimited('GitHub rate limit reached')
    if (!res.ok) throw new Error(`GitHub said ${res.status} for ${url.replace('https://api.github.com', '')}`)
    return res
  }

  private async json<T>(url: string): Promise<T> {
    return (await (await this.get(url)).json()) as T
  }

  /** The account's own public repos (forks and archived ones included; the caller filters). */
  async publicRepos(login: string): Promise<PublicRepo[]> {
    const out: PublicRepo[] = []
    for (let page = 1; page <= 5; page++) {
      const list = await this.json<any[]>(`https://api.github.com/users/${encodeURIComponent(login)}/repos?type=owner&sort=pushed&per_page=100&page=${page}`)
      for (const r of list) {
        if (r.private) continue
        out.push({
          name: r.name,
          fullName: r.full_name,
          branch: r.default_branch,
          fork: Boolean(r.fork),
          archived: Boolean(r.archived),
          size: Number(r.size) || 0,
          pushedAt: r.pushed_at,
          url: r.html_url
        })
      }
      if (list.length < 100) break
    }
    return out
  }

  /** The commit at the tip of the default branch. */
  async head(repo: PublicRepo): Promise<string> {
    const c = await this.json<{ sha: string }>(`https://api.github.com/repos/${repo.fullName}/commits/${encodeURIComponent(repo.branch)}`)
    return c.sha
  }

  /** Every file on the default branch, as one download. */
  async scanFiles(repo: PublicRepo, sha: string): Promise<Hit[]> {
    const res = await this.get(`https://api.github.com/repos/${repo.fullName}/tarball/${sha}`)
    const files = readTarGz(Buffer.from(await res.arrayBuffer()))
    return files.flatMap((f) => scanFile(f.path, f.text))
  }

  /** The last `n` commits on the default branch, newest first. */
  async recentCommits(repo: PublicRepo, n: number): Promise<CommitRef[]> {
    if (n <= 0) return []
    const list = await this.json<any[]>(`https://api.github.com/repos/${repo.fullName}/commits?sha=${encodeURIComponent(repo.branch)}&per_page=${Math.min(100, n)}`)
    return list.slice(0, n).map((c) => ({ sha: c.sha, date: c.commit?.author?.date ?? c.commit?.committer?.date ?? '', message: String(c.commit?.message ?? '').split('\n')[0] }))
  }

  /** What a commit added: secrets in its diff, and risky files it added. */
  async scanCommit(repo: PublicRepo, sha: string): Promise<Hit[]> {
    const c = await this.json<{ files?: { filename: string; status: string; patch?: string }[] }>(`https://api.github.com/repos/${repo.fullName}/commits/${sha}`)
    const hits: Hit[] = []
    for (const f of c.files ?? []) {
      if (skipPath(f.filename) || f.status === 'removed') continue
      if (f.status === 'added' || f.status === 'renamed' || f.status === 'copied') {
        const r = riskyFile(f.filename, f.patch ? f.patch.split('\n').filter((l) => l.startsWith('+')).map((l) => l.slice(1)).join('\n') : null)
        if (r && keep(r)) hits.push(r)
      }
      if (f.patch) hits.push(...scanPatch(f.filename, f.patch))
    }
    return hits
  }
}
