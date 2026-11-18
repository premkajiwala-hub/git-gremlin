/**
 * The update logic, without Electron (so it can be tested on its own).
 *
 * An update is a published release: an entry in updates.json on the repo's
 * main branch, plus a git tag `v<version>`. Pushes to main without a new
 * updates.json entry (README fixes, unfinished pets) are never offered.
 *
 * - A git clone updates with `git fetch` + a fast-forward merge to the tag.
 * - A ZIP download gets the tag's tarball, which is copied over its files.
 * Either way, files that would be replaced are kept for a rollback, and
 * `npm install` runs only when package.json or package-lock.json changed.
 */
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import type { PackageChange, UpdateRelease } from '../shared/types'

// --- versions and the release list ----------------------------------------------------------------
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split(/[.-]/).map((n) => parseInt(n, 10) || 0)
  const pb = b.replace(/^v/, '').split(/[.-]/).map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return Math.sign(d)
  }
  return 0
}

const str = (v: unknown, max = 300): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean).slice(0, 40) : [])

/** Read updates.json defensively: it comes from the network. */
export function parseManifest(raw: unknown): UpdateRelease[] {
  const list = (raw as { releases?: unknown })?.releases
  if (!Array.isArray(list)) throw new Error('The update list has no releases.')
  const out: UpdateRelease[] = []
  for (const r of list) {
    const version = str((r as { version?: unknown }).version, 20)
    if (!/^\d+\.\d+\.\d+$/.test(version)) continue
    const o = r as Record<string, unknown>
    out.push({
      version,
      date: str(o.date, 20),
      title: str(o.title, 120),
      pets: Array.isArray(o.pets)
        ? o.pets
            .map((p) => {
              const o = p as Record<string, unknown>
              const id = str(o.id, 30).toLowerCase()
              return { name: str(o.name, 40), summary: str(o.summary, 120), id: /^[a-z0-9-]+$/.test(id) ? id : null, image: null }
            })
            .filter((p) => p.name)
            .slice(0, 20)
        : [],
      features: strList(o.features),
      fixes: strList(o.fixes)
    })
  }
  return out.sort((a, b) => compareVersions(b.version, a.version))
}

/** Releases newer than `current`, newest first. */
export function newerThan(releases: UpdateRelease[], current: string): UpdateRelease[] {
  return releases.filter((r) => compareVersions(r.version, current) > 0)
}

export const tagOf = (version: string) => `v${version}`

type Pkg = { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }

/** Packages added, upgraded or removed between two package.json files. */
export function packageChanges(oldPkg: Pkg, newPkg: Pkg): PackageChange[] {
  const all = (p: Pkg) => ({ ...(p.devDependencies ?? {}), ...(p.dependencies ?? {}) })
  const a = all(oldPkg)
  const b = all(newPkg)
  const clean = (v: string | undefined) => (v ? v.replace(/^[\^~>=<\s]+/, '') : null)
  const names = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
  return names.filter((n) => a[n] !== b[n]).map((n) => ({ name: n, from: clean(a[n]), to: clean(b[n]) }))
}

/** A fingerprint of package.json + package-lock.json: if it changes, `npm install` must run. */
export function fingerprintOf(pkg: string | null, lock: string | null): string {
  // Only what npm installs counts: a release bumps "version" in both files, which needs no install.
  const deps = (t: string | null) => {
    if (t === null) return '-'
    try {
      const p = JSON.parse(t) as Record<string, unknown>
      return JSON.stringify([p.dependencies, p.devDependencies, p.optionalDependencies, p.overrides, p.allowScripts])
    } catch {
      return t.replace(/\r\n/g, '\n')
    }
  }
  const locked = (t: string | null) => {
    if (t === null) return '-'
    try {
      const l = JSON.parse(t) as { version?: string; packages?: Record<string, { version?: string }> }
      delete l.version
      if (l.packages?.['']) delete l.packages[''].version
      return JSON.stringify(l)
    } catch {
      return t.replace(/\r\n/g, '\n')
    }
  }
  return createHash('sha256').update(deps(pkg)).update('\0').update(locked(lock)).digest('hex')
}

export function depsFingerprint(root: string): string {
  const read = (f: string) => {
    try {
      return readFileSync(join(root, f), 'utf8')
    } catch {
      return null
    }
  }
  return fingerprintOf(read('package.json'), read('package-lock.json'))
}

// --- running commands ------------------------------------------------------------------------------
export interface RunResult {
  code: number
  out: string
  err: string
}
export type Runner = (cmd: string, args: string[], cwd: string, timeoutMs?: number) => RunResult

/** The last useful line of a command's error output, for messages. */
export const lastLine = (r: RunResult) =>
  (r.err || r.out)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .pop() ?? `exit code ${r.code}`

// --- git installs ----------------------------------------------------------------------------------
/** Rewritten by npm install, so a local change to it is noise, not work. */
const GENERATED = new Set(['package-lock.json'])

export interface GitCheck {
  /** Git can't work with this folder at all: why. */
  blocked: string | null
  /** The download failed (try again later). */
  error: string | null
  head: string | null
  /** Files the user changed (besides generated ones): set aside, then put back after the update. */
  changed: string[]
  /** The copy has commits of its own: the release is merged in instead of fast-forwarded. */
  ownCommits: boolean
}

/** Fetch the release tag and find out how this copy can move to it. */
export function gitPrepare(run: Runner, root: string, gitUrl: string, tag: string): GitCheck {
  const none = { changed: [], ownCommits: false }
  const head = run('git', ['rev-parse', 'HEAD'], root)
  if (head.code !== 0) return { blocked: `Git couldn't read this folder (${lastLine(head)}).`, error: null, head: null, ...none }
  const at = head.out.trim()
  run('git', ['update-index', '-q', '--refresh'], root)
  const dirty = run('git', ['status', '--porcelain', '--untracked-files=no'], root)
  if (dirty.code !== 0) return { blocked: `Git couldn't check this folder (${lastLine(dirty)}).`, error: null, head: at, ...none }
  const changed = dirty.out
    .split(/\r?\n/)
    .map((l) => l.slice(3).trim().replace(/^"|"$/g, ''))
    .filter((f) => f && !GENERATED.has(f))
  const fetch = run('git', ['fetch', '--no-tags', gitUrl, `+refs/tags/${tag}:refs/tags/${tag}`], root, 120_000)
  if (fetch.code !== 0) return { blocked: null, error: `Couldn't download the update (${lastLine(fetch)}).`, head: at, changed, ownCommits: false }
  const ff = run('git', ['merge-base', '--is-ancestor', 'HEAD', tag], root)
  return { blocked: null, error: null, head: at, changed, ownCommits: ff.code !== 0 }
}

/** git needs a name to stash or merge; use the user's, or a stand-in when none is set. */
function identity(run: Runner, root: string): string[] {
  const named = run('git', ['config', 'user.name'], root).out.trim() && run('git', ['config', 'user.email'], root).out.trim()
  return named ? [] : ['-c', 'user.name=GitGremlin', '-c', 'user.email=gitgremlin@users.noreply.github.com']
}

/**
 * Move to the release, keeping the user's work:
 * - package-lock.json changes are dropped (npm install rewrites it);
 * - other changed files are stashed, then put back on top of the release;
 * - own commits are kept: the release is merged in.
 * Returns a note for the user, or null.
 */
export function gitApply(run: Runner, root: string, tag: string, check: GitCheck): string | null {
  const id = identity(run, root)
  // A past update bumped package.json's time: let git see its content is unchanged.
  run('git', ['update-index', '-q', '--refresh'], root)
  for (const f of GENERATED) run('git', ['checkout', '--', f], root)
  const message = `GitGremlin: your changes from before updating to ${tag}`
  let stashed = false
  if (check.changed.length) {
    const s = run('git', [...id, 'stash', 'push', '-m', message], root)
    if (s.code !== 0) throw new Error(`Git couldn't set your changes aside (${lastLine(s)}).`)
    stashed = true
  }
  const putBack = () => {
    if (stashed) run('git', ['stash', 'pop'], root)
  }
  if (check.ownCommits) {
    const m = run('git', [...id, 'merge', '--no-edit', '-m', `Update GitGremlin to ${tag}`, tag], root, 120_000)
    if (m.code !== 0) {
      run('git', ['merge', '--abort'], root)
      putBack()
      throw new Error("Your own commits clash with this update, so nothing was changed. Merge it with git yourself.")
    }
  } else {
    const r = run('git', ['merge', '--ff-only', tag], root, 120_000)
    if (r.code !== 0) {
      putBack()
      throw new Error(`Git couldn't update the files (${lastLine(r)}).`)
    }
  }
  if (!stashed) return null
  const a = run('git', ['stash', 'apply'], root)
  if (a.code === 0) {
    run('git', ['stash', 'drop'], root)
    return null
  }
  // Clashes with the release: keep the release clean; the changes stay safe in the stash.
  run('git', ['reset', '--hard', 'HEAD'], root)
  return `Your own changes clashed with the update, so they're saved in git stash ("${message}").`
}

export function gitShow(run: Runner, root: string, tag: string, file: string): string | null {
  const r = run('git', ['show', `${tag}:${file}`], root)
  return r.code === 0 ? r.out : null
}

// --- ZIP installs ----------------------------------------------------------------------------------
/** Never copied over or backed up: local-only folders. */
const SKIP = new Set(['node_modules', 'out', 'dist', '.git'])

function walk(dir: string, base = dir, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (dir === base && SKIP.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, base, acc)
    else acc.push(relative(base, p))
  }
  return acc
}

/** The single top folder a GitHub tarball extracts to (git-gremlin-0.4.0/). */
export function tarballRoot(staging: string): string {
  const dirs = readdirSync(staging).filter((n) => statSync(join(staging, n)).isDirectory())
  if (dirs.length !== 1) throw new Error('The downloaded update has an unexpected layout.')
  return join(staging, dirs[0])
}

export interface CopyPlan {
  /** Files that existed and were replaced (a copy is in the backup folder). */
  replaced: string[]
  /** Files that didn't exist before (removed again on rollback). */
  added: string[]
}

/** Copy the new release over the install, keeping what it replaces in `backup`. */
export function copyRelease(src: string, root: string, backup: string): CopyPlan {
  rmSync(backup, { recursive: true, force: true })
  const plan: CopyPlan = { replaced: [], added: [] }
  for (const rel of walk(src)) {
    const to = join(root, rel)
    if (existsSync(to)) {
      const b = join(backup, rel)
      mkdirSync(dirname(b), { recursive: true })
      copyFileSync(to, b)
      plan.replaced.push(rel)
    } else plan.added.push(rel)
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(join(src, rel), to)
  }
  writeFileSync(join(backup, '.plan.json'), JSON.stringify(plan))
  return plan
}

/** Undo copyRelease. */
export function restoreBackup(root: string, backup: string): void {
  const plan = JSON.parse(readFileSync(join(backup, '.plan.json'), 'utf8')) as CopyPlan
  for (const rel of plan.replaced) copyFileSync(join(backup, rel), join(root, rel))
  for (const rel of plan.added) {
    try {
      unlinkSync(join(root, rel))
    } catch {
      /* already gone */
    }
  }
}

// --- finishing after GitGremlin quits ---------------------------------------------------------------
export interface HelperJob {
  pid: number
  root: string
  /** Program + args that start GitGremlin again. */
  relaunch: { path: string; args: string[] }
  npm: string
  statusFile: string
  logFile: string
  /** How to undo the file update if npm install fails. */
  rollback: { kind: 'git'; head: string } | { kind: 'zip'; backup: string }
  from: string
  to: string
}

/**
 * A small Node script that waits for GitGremlin to quit, runs npm install
 * (Electron's own files can't be replaced while it runs), then starts it
 * again. On failure it puts the old files back first.
 */
export const HELPER_SOURCE = String.raw`'use strict'
const fs = require('fs')
const path = require('path')
const { spawnSync, spawn } = require('child_process')
const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const log = (s) => fs.appendFileSync(job.logFile, '[' + new Date().toISOString() + '] ' + s + '\n')
const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const npm = (label) => {
  log(label)
  // npm.cmd needs a shell; quote its path ("C:\Program Files\nodejs\npm.cmd").
  const r = spawnSync('"' + job.npm + '"', ['install', '--no-audit', '--no-fund'], { cwd: job.root, shell: true, encoding: 'utf8', timeout: 15 * 60 * 1000, windowsHide: true })
  fs.appendFileSync(job.logFile, (r.stdout || '') + (r.stderr || ''))
  return r.status === 0
}
const status = (s) => fs.writeFileSync(job.statusFile, JSON.stringify({ ...s, from: job.from, to: job.to, at: Date.now() }))
try {
  for (let i = 0; i < 120 && alive(job.pid); i++) sleep(500)
  if (npm('npm install for ' + job.to)) status({ ok: true })
  else {
    log('npm install failed: rolling back')
    if (job.rollback.kind === 'git') {
      // package.json's time was bumped (to force a rebuild): let git see its content is unchanged.
      spawnSync('git', ['update-index', '-q', '--refresh'], { cwd: job.root, windowsHide: true })
      const g = spawnSync('git', ['reset', '--keep', job.rollback.head], { cwd: job.root, encoding: 'utf8', windowsHide: true })
      log('git reset --keep: ' + g.status + ' ' + (g.stdout || '') + (g.stderr || '') + (g.error ? g.error.message : ''))
      if (g.status !== 0) throw new Error("Installing the new packages failed, and the old files couldn't be put back (see the log).")
    } else {
      const b = job.rollback.backup
      const plan = JSON.parse(fs.readFileSync(path.join(b, '.plan.json'), 'utf8'))
      for (const rel of plan.replaced) fs.copyFileSync(path.join(b, rel), path.join(job.root, rel))
      for (const rel of plan.added) { try { fs.unlinkSync(path.join(job.root, rel)) } catch {} }
    }
    npm('npm install for ' + job.from + ' (after rollback)')
    status({ ok: false, error: "Installing the new packages failed (see the log). GitGremlin is back on " + job.from + "." })
  }
} catch (e) {
  log('helper error: ' + (e && e.stack || e))
  status({ ok: false, error: 'The update stopped halfway: ' + (e && e.message || e) })
}
const now = new Date()
try { fs.utimesSync(path.join(job.root, 'package.json'), now, now) } catch {}
spawn(job.relaunch.path, job.relaunch.args, { cwd: job.root, detached: true, stdio: 'ignore', windowsHide: false }).unref()
`
