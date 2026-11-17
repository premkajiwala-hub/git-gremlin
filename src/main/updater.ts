/**
 * Updates for copies of GitGremlin that run from their own folder (a git
 * clone or a ZIP download): checks updates.json on GitHub every few hours,
 * shows a Windows notification for a new release, and installs it on request.
 * See update-core.ts for how files are replaced safely.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, net, Notification } from 'electron'
import { UPDATE_REPO } from '../shared/constants'
import type { InstallKind, PackageChange, UpdateRelease, UpdateView } from '../shared/types'
import {
  copyRelease,
  depsFingerprint,
  fingerprintOf,
  gitApply,
  gitPrepare,
  gitShow,
  HELPER_SOURCE,
  lastLine,
  newerThan,
  packageChanges,
  parseManifest,
  tagOf,
  tarballRoot,
  type HelperJob,
  type Runner
} from './update-core'

const FIRST_CHECK_MS = 20_000
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

/** Where releases come from. GITGREMLIN_UPDATE_SOURCE (a folder) replaces GitHub, for testing. */
interface Source {
  manifest(): Promise<unknown>
  file(tag: string, name: string): Promise<string | null>
  tarball(tag: string, dest: string): Promise<void>
  gitUrl: string
}

async function download(url: string): Promise<Response> {
  const res = await net.fetch(url, { headers: { 'User-Agent': 'GitGremlin', 'Cache-Control': 'no-cache' } })
  if (!res.ok) throw new Error(`GitHub answered ${res.status}.`)
  return res
}

function githubSource(repo: string): Source {
  return {
    // A query string skips GitHub's few-minute raw cache.
    manifest: async () => {
      const res = await net.fetch(`https://raw.githubusercontent.com/${repo}/main/updates.json?t=${Date.now()}`, { headers: { 'User-Agent': 'GitGremlin' } })
      // No updates.json published yet: nothing to offer.
      if (res.status === 404) return { releases: [] }
      if (!res.ok) throw new Error(`GitHub answered ${res.status}.`)
      return res.json()
    },
    file: async (tag, name) => {
      try {
        return await (await download(`https://raw.githubusercontent.com/${repo}/${tag}/${name}`)).text()
      } catch {
        return null
      }
    },
    tarball: async (tag, dest) => writeFileSync(dest, Buffer.from(await (await download(`https://codeload.github.com/${repo}/tar.gz/refs/tags/${tag}`)).arrayBuffer())),
    gitUrl: `https://github.com/${repo}.git`
  }
}

function folderSource(dir: string): Source {
  const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : null)
  return {
    manifest: async () => JSON.parse(read(join(dir, 'updates.json')) ?? 'null'),
    file: async (tag, name) => read(join(dir, 'raw', tag, name)),
    tarball: async (tag, dest) => writeFileSync(dest, readFileSync(join(dir, `${tag}.tar.gz`))),
    gitUrl: join(dir, 'repo.git')
  }
}

const run: Runner = (cmd, args, cwd, timeoutMs = 60_000) => {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
    // Never wait for a password prompt.
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  })
  return { code: r.status ?? -1, out: r.stdout ?? '', err: r.stderr ?? (r.error ? String(r.error.message) : '') }
}

/** Full path of a program on PATH (where.exe), or null. */
function which(exe: string): string | null {
  const r = run('where.exe', [exe], process.cwd(), 10_000)
  return r.code === 0 ? (r.out.split(/\r?\n/).find((l) => l.trim()) ?? '').trim() || null : null
}

interface Saved {
  autoCheck: boolean
  /** The newest version we already showed a notification for. */
  notified: string | null
  checkedAt: number | null
}

interface Outcome {
  ok: boolean
  error?: string
  from: string
  to: string
}

export interface UpdaterHooks {
  changed(): void
  /** Open the panel on the updates card. */
  show(): void
  /** Quit the app normally (saves state); `relaunch` starts it again afterwards. */
  quit(relaunch: boolean): void
}

export class Updater {
  private readonly root = app.getAppPath()
  private readonly dir = join(app.getPath('userData'), 'update')
  private readonly source: Source = process.env['GITGREMLIN_UPDATE_SOURCE'] ? folderSource(process.env['GITGREMLIN_UPDATE_SOURCE']) : githubSource(UPDATE_REPO)
  private readonly kind: InstallKind
  private saved: Saved
  private timer: NodeJS.Timeout | null = null
  private state: UpdateView['state'] = 'idle'
  private releases: UpdateRelease[] = []
  /** Every release we know of (for the "just updated" note). */
  private all: UpdateRelease[] = []
  private packages: PackageChange[] = []
  private blocked: string | null = null
  private error: string | null = null
  private needsRestart = false
  private updated: UpdateView['updated'] = null
  private failed: string | null = null

  constructor(private hooks: UpdaterHooks) {
    mkdirSync(this.dir, { recursive: true })
    this.kind = app.isPackaged ? 'installer' : process.env['ELECTRON_RENDERER_URL'] ? 'dev' : existsSync(join(this.root, '.git')) && which('git.exe') ? 'git' : 'zip'
    this.saved = { autoCheck: true, notified: null, checkedAt: null, ...this.readJson<Saved>('state.json') }
    this.finishPrevious()
  }

  start(): void {
    this.stop()
    if (!this.saved.autoCheck) return
    this.timer = setTimeout(() => {
      void this.check(true)
      this.timer = setInterval(() => void this.check(true), CHECK_EVERY_MS)
    }, FIRST_CHECK_MS)
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  setAuto(on: boolean): void {
    this.saved.autoCheck = on
    this.save()
    this.start()
    this.hooks.changed()
  }

  seen(): void {
    this.updated = null
    this.failed = null
    this.hooks.changed()
  }

  /** The newest release this copy doesn't have yet, or null. */
  get available(): UpdateRelease | null {
    return this.releases[0] ?? null
  }

  view(): UpdateView {
    return {
      current: app.getVersion(),
      kind: this.kind,
      state: this.state,
      checkedAt: this.saved.checkedAt,
      releases: this.releases,
      packages: this.packages,
      blocked: this.blocked,
      error: this.error,
      autoCheck: this.saved.autoCheck,
      updated: this.updated,
      failed: this.failed,
      needsRestart: this.needsRestart
    }
  }

  // --- checking -----------------------------------------------------------------------------------
  async check(automatic = false): Promise<void> {
    if (this.state !== 'idle') return
    this.state = 'checking'
    this.error = null
    this.hooks.changed()
    try {
      this.all = parseManifest(await this.source.manifest())
      this.releases = newerThan(this.all, app.getVersion())
      this.blocked = null
      this.packages = []
      this.needsRestart = false
      const next = this.available
      if (next) await this.inspect(next)
      this.saved.checkedAt = Date.now()
      this.save()
      if (next && automatic && this.saved.notified !== next.version) this.notify(next)
    } catch (err) {
      this.error = (err as Error).message.startsWith("Couldn't") ? (err as Error).message : `Couldn't check for updates: ${(err as Error).message}`
    } finally {
      this.state = 'idle'
      this.hooks.changed()
    }
  }

  /** What the release changes: packages, and whether this copy can install it. */
  private async inspect(next: UpdateRelease): Promise<void> {
    const tag = tagOf(next.version)
    const localPkg = this.readText('package.json')
    let newPkg: string | null
    let newLock: string | null
    if (this.kind === 'git') {
      const prep = gitPrepare(run, this.root, this.source.gitUrl, tag)
      this.blocked = prep.blocked
      if (prep.error) throw new Error(prep.error)
      if (prep.blocked) return
      newPkg = gitShow(run, this.root, tag, 'package.json')
      newLock = gitShow(run, this.root, tag, 'package-lock.json')
    } else {
      newPkg = await this.source.file(tag, 'package.json')
      newLock = await this.source.file(tag, 'package-lock.json')
    }
    if (newPkg && localPkg) this.packages = packageChanges(JSON.parse(localPkg), JSON.parse(newPkg))
    this.needsRestart = fingerprintOf(newPkg, newLock) !== depsFingerprint(this.root)
    if (this.kind === 'installer') this.blocked = 'This copy came from the Windows installer. Download the new installer from GitHub to update it.'
    else if (this.kind === 'dev') this.blocked = 'GitGremlin is running with npm start (development). Update it with git.'
  }

  private notify(next: UpdateRelease): void {
    this.saved.notified = next.version
    this.save()
    if (!Notification.isSupported()) return
    const pets = this.releases.flatMap((r) => r.pets.map((p) => p.name))
    const body = pets.length
      ? `${pets.length === 1 ? 'A new pet' : `${pets.length} new pets`}: ${list(pets)}. Click to see what's new.`
      : `${next.title || 'New features and fixes'}. Click to see what's new.`
    const n = new Notification({ title: `GitGremlin ${next.version} is ready`, body, icon: join(this.root, 'assets', 'icon.png') })
    n.on('click', () => this.hooks.show())
    n.show()
  }

  // --- installing ---------------------------------------------------------------------------------
  async apply(): Promise<{ ok: boolean; message?: string }> {
    const next = this.available
    if (!next) return { ok: false, message: 'GitGremlin is up to date.' }
    if (this.state !== 'idle') return { ok: false, message: 'Already working on it.' }
    if (this.blocked) return { ok: false, message: this.blocked }
    const from = app.getVersion()
    const tag = tagOf(next.version)
    this.state = 'downloading'
    this.error = null
    this.hooks.changed()
    try {
      // 1. Get the release without touching the install yet.
      let head: string | null = null
      let staged: string | null = null
      let newPkg: string | null
      let newLock: string | null
      if (this.kind === 'git') {
        const prep = gitPrepare(run, this.root, this.source.gitUrl, tag)
        if (prep.blocked || prep.error) throw new Error(prep.blocked ?? prep.error ?? '')
        head = prep.head
        newPkg = gitShow(run, this.root, tag, 'package.json')
        newLock = gitShow(run, this.root, tag, 'package-lock.json')
      } else {
        const tarball = join(this.dir, `${tag}.tar.gz`)
        const staging = join(this.dir, 'staging')
        rmSync(staging, { recursive: true, force: true })
        mkdirSync(staging, { recursive: true })
        await this.source.tarball(tag, tarball)
        const tar = existsSync('C:\\Windows\\System32\\tar.exe') ? 'C:\\Windows\\System32\\tar.exe' : 'tar'
        const x = run(tar, ['-xzf', tarball, '-C', staging], this.dir, 120_000)
        if (x.code !== 0) throw new Error(`Couldn't unpack the update (${lastLine(x)}).`)
        staged = tarballRoot(staging)
        const read = (f: string) => (existsSync(join(staged!, f)) ? readFileSync(join(staged!, f), 'utf8') : null)
        newPkg = read('package.json')
        newLock = read('package-lock.json')
      }
      const needsNpm = fingerprintOf(newPkg, newLock) !== depsFingerprint(this.root)
      const node = needsNpm ? which('node.exe') : null
      const npm = needsNpm ? which('npm.cmd') : null
      if (needsNpm && (!node || !npm))
        throw new Error('This update brings new packages, which need Node.js (with npm). Install Node.js LTS from nodejs.org, then try again.')

      // 2. Replace the files (the running app isn't affected: it runs from out/ and node_modules).
      this.state = 'installing'
      this.hooks.changed()
      const backup = join(this.dir, 'backup')
      if (this.kind === 'git') gitApply(run, this.root, tag)
      else copyRelease(staged!, this.root, backup)

      // 3. Restart. The launcher rebuilds out/ because package.json is now newer than the build.
      const now = new Date()
      utimesSync(join(this.root, 'package.json'), now, now)
      this.writeJson('last-releases.json', { releases: this.releases })
      if (!needsNpm) {
        this.writeJson('status.json', { ok: true, from, to: next.version, at: Date.now() })
        this.hooks.quit(true)
        return { ok: true }
      }
      // New packages: Electron's own files may change, so npm install runs after GitGremlin quits.
      const job: HelperJob = {
        pid: process.pid,
        root: this.root,
        relaunch: { path: process.execPath, args: app.isPackaged ? [] : [this.root] },
        npm: npm!,
        statusFile: join(this.dir, 'status.json'),
        logFile: join(this.dir, 'update.log'),
        rollback: this.kind === 'git' ? { kind: 'git', head: head! } : { kind: 'zip', backup },
        from,
        to: next.version
      }
      writeFileSync(join(this.dir, 'helper.cjs'), HELPER_SOURCE)
      writeFileSync(join(this.dir, 'job.json'), JSON.stringify(job))
      writeFileSync(job.logFile, '')
      const env = { ...process.env }
      delete env['ELECTRON_RUN_AS_NODE']
      spawn(node!, [join(this.dir, 'helper.cjs'), join(this.dir, 'job.json')], { cwd: this.root, detached: true, stdio: 'ignore', windowsHide: true, env }).unref()
      this.hooks.quit(false)
      return { ok: true }
    } catch (err) {
      this.state = 'idle'
      this.error = (err as Error).message
      this.hooks.changed()
      return { ok: false, message: this.error }
    }
  }

  /** After a restart: did the update work? */
  private finishPrevious(): void {
    const s = this.readJson<Outcome>('status.json')
    if (!s) return
    rmSync(join(this.dir, 'status.json'), { force: true })
    if (s.ok && app.getVersion() === s.to) {
      const releases = this.readJson<{ releases: UpdateRelease[] }>('last-releases.json')?.releases ?? []
      this.updated = { from: s.from, to: s.to, releases }
      setTimeout(() => this.notifyDone(s.to, releases), 4000)
    } else this.failed = s.error ?? `The update to ${s.to} didn't finish. GitGremlin is still on ${app.getVersion()}.`
  }

  private notifyDone(to: string, releases: UpdateRelease[]): void {
    if (!Notification.isSupported()) return
    const pets = releases.flatMap((r) => r.pets.map((p) => p.name))
    const n = new Notification({
      title: `GitGremlin is now ${to}`,
      body: pets.length ? `Say hi to ${list(pets)}! Turn them on in the panel.` : 'Click to see what changed.',
      icon: join(this.root, 'assets', 'icon.png')
    })
    n.on('click', () => this.hooks.show())
    n.show()
  }

  // --- small helpers --------------------------------------------------------------------------------
  private readText(name: string): string | null {
    try {
      return readFileSync(join(this.root, name), 'utf8')
    } catch {
      return null
    }
  }

  private readJson<T>(name: string): T | null {
    try {
      return JSON.parse(readFileSync(join(this.dir, name), 'utf8')) as T
    } catch {
      return null
    }
  }

  private writeJson(name: string, data: unknown): void {
    writeFileSync(join(this.dir, name), JSON.stringify(data))
  }

  private save(): void {
    this.writeJson('state.json', this.saved)
  }
}

/** "A, B and C" */
function list(names: string[]): string {
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
