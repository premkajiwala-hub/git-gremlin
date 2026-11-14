/**
 * Syncy's repo watcher: finds your git repositories and checks each one for
 * work that isn't on GitHub yet.
 *
 * - Only reads. It runs `git status`, `git log`, `git stash list` and
 *   `git for-each-ref`, with GIT_OPTIONAL_LOCKS=0 so it never takes the index
 *   lock your own git commands need, and never fetches or pushes. "Unpushed"
 *   means "not on any remote branch git knows about", as of your last fetch.
 * - The only thing it ever changes is deleting local branches you picked,
 *   with `git branch -d`, which git itself refuses for unmerged branches.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { lstat, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import type { RepoInfo, RepoScan } from '../shared/types'
import { fixedDataDrives } from './native'

/** Folders that never contain your repos (or are huge and slow to walk). */
const SKIP = new Set(
  [
    'node_modules',
    'appdata',
    '$recycle.bin',
    'system volume information',
    'windows',
    'windows.old',
    'program files',
    'program files (x86)',
    'programdata',
    'recovery',
    'perflogs',
    'msocache',
    'config.msi',
    'vendor',
    'venv',
    '__pycache__',
    'dist',
    'build',
    'out',
    'target',
    'bin',
    'obj',
    'library',
    'steamapps',
    'riot games',
    'epic games'
  ].map((s) => s.toLowerCase())
)
const MAX_DIRS = 40_000

/** A folder to search, how many levels deep, and whether the folder itself may be a repo. */
export interface SearchRoot {
  path: string
  depth: number
  self?: boolean
}

/** Common places people keep code, searched automatically. */
export function autoRoots(): SearchRoot[] {
  const home = homedir()
  const near = ['source', 'code', 'Code', 'projects', 'Projects', 'dev', 'Dev', 'repos', 'git', 'src', 'workspace', 'Documents', 'Desktop']
  const roots = [
    // Inside your user folder, but not the folder itself: a stray `git init` there isn't a project.
    { path: home, depth: 1, self: false },
    ...near.map((n) => ({ path: join(home, n), depth: 3 })),
    ...fixedDataDrives().map((d) => ({ path: d, depth: 3 }))
  ]
  return roots.filter((r) => existsSync(r.path))
}

/** Find git repositories under the given roots (stopping at each repo: nested ones are skipped). */
export async function findRepos(roots: SearchRoot[]): Promise<string[]> {
  const found = new Map<string, string>()
  const budget = { n: 0 }
  const walk = async (dir: string, depth: number, self = true): Promise<void> => {
    if (budget.n++ > MAX_DIRS) return
    if (budget.n % 200 === 0) await new Promise((r) => setImmediate(r))
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    if (self && entries.some((e) => e.name === '.git')) {
      found.set(resolve(dir).toLowerCase(), resolve(dir))
      return
    }
    if (depth <= 0) return
    for (const e of entries) {
      if (!e.isDirectory() || e.isSymbolicLink()) continue
      if (e.name.startsWith('.') || e.name.startsWith('$') || SKIP.has(e.name.toLowerCase())) continue
      await walk(join(dir, e.name), depth - 1)
    }
  }
  for (const r of roots) await walk(r.path, r.depth, r.self ?? true)
  return [...found.values()].sort((a, b) => basename(a).localeCompare(basename(b)))
}

// --- git ---------------------------------------------------------------------------------------
const GIT_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', LANG: 'C' }
let gitExe: string | null | undefined

/** The git executable: on PATH, or Git for Windows' usual install folder. */
export async function findGit(): Promise<string | null> {
  if (gitExe !== undefined) return gitExe
  const candidates = ['git', join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'cmd', 'git.exe')]
  for (const c of candidates) {
    if (c !== 'git' && !existsSync(c)) continue
    const ok = await new Promise<boolean>((done) =>
      execFile(c, ['--version'], { windowsHide: true, timeout: 8000 }, (err) => done(!err))
    )
    if (ok) return (gitExe = c)
  }
  return (gitExe = null)
}

function git(repo: string, args: string[]): Promise<string> {
  return new Promise((done, fail) => {
    execFile(
      gitExe ?? 'git',
      ['-C', repo, ...args],
      { windowsHide: true, timeout: 20_000, maxBuffer: 16 * 1024 * 1024, env: GIT_ENV },
      (err, stdout, stderr) => (err ? fail(new Error((stderr || err.message).trim().split('\n')[0])) : done(stdout))
    )
  })
}

const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean)

/** Oldest modification time among (up to 200 of) the changed paths. */
async function oldestChange(repo: string, paths: string[]): Promise<number | null> {
  let oldest: number | null = null
  for (const p of paths.slice(0, 200)) {
    try {
      const t = (await lstat(join(repo, p))).mtimeMs
      if (oldest === null || t < oldest) oldest = t
    } catch {
      /* deleted file: no date */
    }
  }
  return oldest
}

/** Everything Syncy wants to know about one repo. */
export async function inspectRepo(path: string, trackBranches: boolean): Promise<RepoInfo> {
  const info: RepoInfo = {
    path,
    name: basename(path),
    branch: null,
    hasRemote: false,
    changes: 0,
    changesSince: null,
    unpushed: 0,
    unpushedSince: null,
    stashes: 0,
    stashSince: null,
    merged: [],
    base: null,
    error: null
  }
  try {
    // Uncommitted changes.
    const status = await git(path, ['status', '--porcelain=v2', '--branch', '--untracked-files=normal'])
    const changed: string[] = []
    for (const l of status.split('\n')) {
      if (l.startsWith('# branch.head ')) {
        const head = l.slice(14).trim()
        info.branch = head === '(detached)' ? null : head
      } else if (l.startsWith('1 ')) changed.push(l.split(' ').slice(8).join(' '))
      else if (l.startsWith('2 ')) changed.push(l.split(' ').slice(9).join(' ').split('\t')[0])
      else if (l.startsWith('u ')) changed.push(l.split(' ').slice(10).join(' '))
      else if (l.startsWith('? ')) changed.push(l.slice(2))
    }
    info.changes = changed.length
    if (changed.length) info.changesSince = await oldestChange(path, changed)

    // Commits that aren't on any remote (on every local branch).
    info.hasRemote = lines(await git(path, ['remote'])).length > 0
    if (info.hasRemote) {
      const times = lines(await git(path, ['log', '--branches', '--not', '--remotes', '--format=%ct', '--max-count=2000']))
      info.unpushed = times.length
      if (times.length) info.unpushedSince = Math.min(...times.map(Number)) * 1000
    }

    // Stashes.
    const stashes = lines(await git(path, ['stash', 'list', '--format=%ct']))
    info.stashes = stashes.length
    if (stashes.length) info.stashSince = Math.min(...stashes.map(Number)) * 1000

    if (trackBranches) await findMerged(path, info)
  } catch (err) {
    info.error = (err as Error).message.slice(0, 200)
  }
  return info
}

/** Local branches already merged into the default branch. */
async function findMerged(path: string, info: RepoInfo): Promise<void> {
  const exists = async (ref: string) => (await git(path, ['rev-parse', '--verify', '--quiet', ref]).catch(() => '')).trim()
  let base: string | null = null
  const originHead = (await git(path, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']).catch(() => '')).trim()
  const localName = originHead.replace(/^origin\//, '')
  for (const name of [localName, 'main', 'master'].filter(Boolean)) {
    if (await exists(`refs/heads/${name}`)) {
      base = name
      break
    }
  }
  if (!base && originHead && (await exists(`refs/remotes/${originHead}`))) base = originHead
  if (!base) return
  info.base = base
  const baseTip = await exists(base)
  const rows = lines(await git(path, ['for-each-ref', `--merged=${base}`, '--format=%(refname:short) %(objectname)', 'refs/heads/']))
  info.merged = rows
    .map((r) => r.split(' '))
    // Not the default branch, not the one you're on, and not a branch that was
    // just created from it (same commit, so probably about to be worked on).
    .filter(([name, tip]) => name !== base && name !== info.branch && tip !== baseTip)
    .map(([name]) => name)
}

/** Check many repos, a few at a time. */
export async function inspectAll(paths: string[], trackBranches: boolean): Promise<RepoInfo[]> {
  const out: RepoInfo[] = new Array(paths.length)
  let next = 0
  const worker = async () => {
    while (next < paths.length) {
      const i = next++
      out[i] = await inspectRepo(paths[i], trackBranches)
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  return out
}

/** Delete local branches with `git branch -d` (git refuses unmerged ones). */
export async function deleteBranches(path: string, branches: string[]): Promise<{ deleted: string[]; failed: string[] }> {
  const deleted: string[] = []
  const failed: string[] = []
  for (const b of branches) {
    // Branch names from our own scan; still refuse anything that looks like an option.
    if (b.startsWith('-')) {
      failed.push(b)
      continue
    }
    try {
      await git(path, ['branch', '-d', '--', b])
      deleted.push(b)
    } catch {
      failed.push(b)
    }
  }
  return { deleted, failed }
}

export async function scanRepos(roots: SearchRoot[], ignored: string[], trackBranches: boolean): Promise<RepoScan> {
  const at = Date.now()
  if (!(await findGit())) return { at, repos: [], roots: roots.map((r) => r.path), gitMissing: true }
  const skip = new Set(ignored.map((p) => resolve(p).toLowerCase()))
  const paths = (await findRepos(roots)).filter((p) => !skip.has(p.toLowerCase()))
  return { at, repos: await inspectAll(paths, trackBranches), roots: roots.map((r) => r.path), gitMissing: false }
}
