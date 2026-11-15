import { basename } from 'node:path'
import { clipboard, shell } from 'electron'
import { ago } from '../../shared/format'
import type { ActionResult, MoleAction, MoleView, PetConfig, PetStatus, PortClash, PortLookup, ServerInfo, ServerKind } from '../../shared/types'
import { findVSCode, openInVSCode } from '../editor'
import {
  commandLabel,
  details,
  envPort,
  explicitPort,
  isDatabase,
  isRuntime,
  isShell,
  isSystem,
  listeners,
  processes,
  projectFromCommand,
  projectRoot,
  scriptPort,
  started,
  stopTree,
  toolPort,
  type Listener,
  type Proc,
  type ProcDetails
} from '../ports'
import type { Store } from '../store'

const RANDOM_LINES = ['DIGGING THROUGH YOUR PORTS.', 'ALL TUNNELS CLEAR.', 'NO PORT FIGHTS DOWN HERE.', 'I CAN SMELL A FREE PORT.', 'LOCALHOST IS MY HOME.']
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)]
const s = (n: number) => (n === 1 ? '' : 'S')

/** How often Mole looks at ports and processes. */
const POLL_MS = 1000
/** A process started this recently counts as "just started" (a project you're launching). */
const FRESH_MS = 90_000
/** Keep showing a clash this long after the project that hit it was last seen starting. */
const CLASH_KEEP_MS = 3 * 60_000

interface Tracked {
  started: number | null
  d: ProcDetails
  project: string | null
  label: string
  /** The port it wants (worked out the first time it's seen starting). */
  want?: number | null
}

const keyOf = (p: string) => p.toLowerCase()
const loopback = (a: string) => a.startsWith('127.') || a === '::1'
const NAME = (n: string) => (n.length > 14 ? `${n.slice(0, 13)}..` : n).toUpperCase()

export interface MoleHooks {
  changed(): void
  feed(text: string): void
  say(text: string): void
}

/** What Mole says about a clash, e.g. "WEB WANTS :3000 BUT API HAS IT." */
export function clashText(c: PortClash): string {
  const who = NAME(c.name)
  if (c.holder.project && keyOf(c.holder.project) === keyOf(c.project)) return `${who} IS ALREADY RUNNING ON :${c.port}.`
  if (c.movedTo) return `${who} MOVED TO :${c.movedTo}. :${c.port} IS TAKEN BY ${NAME(c.holder.name)}.`
  return `${who} WANTS :${c.port} BUT ${NAME(c.holder.name)} HAS IT.`
}

/**
 * Mole's purpose: know what's listening on which port, catch the moment a
 * project you start finds its port taken (or quietly moves to another one),
 * spot dev servers left running after their terminal closed, and free a port
 * when you ask, by stopping whatever holds it (after you confirm).
 *
 * Reads ports and processes straight from Windows every second (cheap: a few
 * milliseconds); never touches anything until you ask it to stop a server.
 */
export class MoleService {
  private timer: NodeJS.Timeout | null = null
  private polling = false
  private procs = new Map<number, Proc>()
  private tracked = new Map<number, Tracked>()
  private startTimes = new Map<number, number | null>()
  private orphanSince = new Map<number, number>()
  private clashMap = new Map<string, PortClash & { seen: number }>()
  private known = new Set<number>()
  private all: ServerInfo[] = []
  private lastAt = 0
  private first = true
  private lastSig = ''

  constructor(
    private store: Store,
    private hooks: MoleHooks
  ) {}

  private get cfg() {
    return this.store.state.settings.mole
  }
  private get enabled(): boolean {
    return this.store.state.settings.pets.mole.enabled
  }

  start(): void {
    this.refresh()
  }

  /** Start or stop watching (Mole switched on or off). */
  refresh(): void {
    if (this.enabled && !this.timer) {
      this.first = true
      this.timer = setInterval(() => void this.poll(), POLL_MS)
      void this.poll()
    } else if (!this.enabled && this.timer) {
      this.stop()
      this.all = []
      this.clashMap.clear()
      this.hooks.changed()
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  // --- reading ---------------------------------------------------------------------------------
  private startTime(pid: number): number | null {
    if (!this.startTimes.has(pid)) this.startTimes.set(pid, started(pid))
    return this.startTimes.get(pid) ?? null
  }

  private track(pid: number, name: string): Tracked {
    let t = this.tracked.get(pid)
    if (!t) {
      const d = details(pid)
      const project = projectRoot(d.cwd) ?? projectFromCommand(d.cmd)
      t = { started: d.started, d, project, label: commandLabel(d.cmd, name) }
      this.tracked.set(pid, t)
      this.startTimes.set(pid, d.started)
    }
    return t
  }

  /** Is `pid` GitGremlin itself or one of its child processes? */
  private ours(pid: number): boolean {
    let cur = this.procs.get(pid)
    for (let i = 0; i < 6 && cur; i++) {
      if (cur.pid === process.pid) return true
      cur = this.procs.get(cur.ppid)
    }
    return false
  }

  /** Is `a` an ancestor or descendant of `b` (the same launch)? */
  private related(a: number, b: number): boolean {
    const up = (from: number, target: number) => {
      let cur = this.procs.get(from)
      for (let i = 0; i < 10 && cur; i++) {
        if (cur.ppid === target) return true
        cur = this.procs.get(cur.ppid)
      }
      return false
    }
    return up(a, b) || up(b, a)
  }

  /**
   * Left running in the background: somewhere between it and the app that
   * launched it (terminal, VS Code, Explorer), a parent has gone.
   */
  private orphaned(pid: number): boolean {
    let cur = this.procs.get(pid)
    let childStart = this.startTime(pid)
    for (let i = 0; i < 10 && cur; i++) {
      const parent = this.procs.get(cur.ppid)
      if (!parent) return true
      const ps = this.startTime(parent.pid)
      // Same PID reused by a newer process: the real parent is gone.
      if (ps !== null && childStart !== null && ps > childStart + 1000) return true
      if (!isRuntime(parent.name) && !isShell(parent.name)) return false
      // A live interactive shell is the terminal itself. Shells that only run one
      // command (npm's `cmd /d /s /c ...`) are launchers: keep climbing.
      if (isShell(parent.name) && !/\s[/-](c|command)\b/i.test(this.track(parent.pid, parent.name).d.cmd ?? '')) return false
      cur = parent
      childStart = ps
    }
    return false
  }

  private kindOf(pid: number, name: string, t: Tracked): ServerKind {
    if (isSystem(name, pid)) return 'system'
    if (isDatabase(name)) return 'db'
    if (this.ours(pid)) return 'app'
    const insideProject = Boolean(t.project && t.d.exe && keyOf(t.d.exe).startsWith(`${keyOf(t.project)}\\`))
    return t.project && (isRuntime(name) || insideProject) ? 'dev' : 'app'
  }

  private async poll(): Promise<void> {
    if (this.polling || !this.enabled) return
    this.polling = true
    try {
      this.read(await listeners())
    } catch (err) {
      console.warn('[mole] poll failed', err)
    } finally {
      this.polling = false
    }
  }

  private read(ls: Listener[]): void {
    const now = Date.now()
    this.procs = processes()
    for (const m of [this.tracked, this.startTimes, this.orphanSince] as Map<number, unknown>[])
      for (const pid of m.keys()) if (!this.procs.has(pid)) m.delete(pid)

    // One entry per listening process.
    const byPid = new Map<number, Listener[]>()
    for (const l of ls) byPid.set(l.pid, [...(byPid.get(l.pid) ?? []), l])
    const servers: ServerInfo[] = []
    for (const [pid, list] of byPid) {
      const name = this.procs.get(pid)?.name ?? (pid === 4 ? 'System' : 'unknown')
      const t = this.track(pid, name)
      const kind = this.kindOf(pid, name, t)
      const orphan = kind === 'dev' && this.orphaned(pid)
      if (orphan && !this.orphanSince.has(pid)) this.orphanSince.set(pid, now)
      if (!orphan) this.orphanSince.delete(pid)
      servers.push({
        pid,
        process: name,
        ports: [...new Set(list.map((l) => l.port))].sort((a, b) => a - b),
        local: list.every((l) => loopback(l.address)),
        kind,
        project: t.project,
        name: t.project ? basename(t.project) : name.replace(/\.exe$/i, ''),
        command: t.label,
        started: t.started,
        orphan,
        orphanSince: this.orphanSince.get(pid) ?? null,
        locked: t.d.locked
      })
    }
    servers.sort((a, b) => a.ports[0] - b.ports[0])
    this.all = servers
    this.lastAt = now

    const holderOf = new Map<number, ServerInfo>()
    for (const sv of servers) for (const p of sv.ports) if (!holderOf.has(p)) holderOf.set(p, sv)
    this.findClashes(now, holderOf, servers)
    this.learn(servers)
    this.announce(now, servers)
    this.first = false

    const sig = JSON.stringify([servers.map((x) => [x.pid, x.ports, x.kind, x.orphan]), [...this.clashMap.keys()], this.leftovers(now).length])
    if (sig !== this.lastSig) {
      this.lastSig = sig
      this.hooks.changed()
    }
  }

  /** Projects you just started whose port is held by something else. */
  private findClashes(now: number, holderOf: Map<number, ServerInfo>, servers: ServerInfo[]): void {
    const usual = this.store.state.mole.usual
    for (const [pid, p] of this.procs) {
      if (!isRuntime(p.name)) continue
      const t = this.track(pid, p.name)
      if (!t.project || t.started === null || now - t.started > FRESH_MS || this.ours(pid)) continue
      // Worked out once per process (it reads .env and the script).
      if (t.want === undefined) {
        t.want =
          explicitPort(t.d.cmd) ??
          envPort(t.project) ??
          usual[`${keyOf(t.project)}|${t.label.toLowerCase()}`] ??
          scriptPort(t.d.cmd, t.d.cwd) ??
          toolPort(t.d.cmd)
      }
      const want = t.want
      if (!want) continue
      const holder = holderOf.get(want)
      if (!holder || holder.pid === pid || this.related(holder.pid, pid)) continue
      // The holder must be the older one (it was there first).
      if (holder.started !== null && holder.started >= t.started - 1500) continue
      const mine = servers.filter((sv) => sv.pid === pid || this.related(sv.pid, pid))
      const movedTo = mine.flatMap((sv) => sv.ports).find((x) => x !== want) ?? null
      const key = `${keyOf(t.project)}|${want}`
      const prev = this.clashMap.get(key)
      const clash = { project: t.project, name: basename(t.project), port: want, holder, movedTo: movedTo ?? prev?.movedTo ?? null, at: prev?.at ?? now, seen: now }
      this.clashMap.set(key, clash)
      if (!prev && this.cfg.clashAlerts && !this.first) this.hooks.say(`${clashText(clash)} RIGHT-CLICK ME TO FREE IT.`)
    }
    // Over when the port changes hands, or a while after the project stopped trying.
    for (const [key, c] of this.clashMap) {
      if (holderOf.get(c.port)?.pid !== c.holder.pid || now - c.seen > CLASH_KEEP_MS) this.clashMap.delete(key)
      else c.holder = holderOf.get(c.port)!
    }
  }

  /** Remember the port each project's server uses, to know what it wants next time. */
  private learn(servers: ServerInfo[]): void {
    const usual = this.store.state.mole.usual
    const clashing = new Set([...this.clashMap.values()].map((c) => keyOf(c.project)))
    let changed = false
    for (const sv of servers) {
      if (sv.kind !== 'dev' || !sv.project || clashing.has(keyOf(sv.project))) continue
      const port = sv.ports.find((p) => p >= 1024 && p < 49152)
      const k = `${keyOf(sv.project)}|${sv.command.toLowerCase()}`
      if (port && usual[k] !== port) {
        usual[k] = port
        changed = true
      }
    }
    if (changed) this.store.saveSoon()
  }

  /** "WEB IS UP ON :5173!" when a project's server starts (not for ones already running at launch). */
  private announce(now: number, servers: ServerInfo[]): void {
    const dev = servers.filter((sv) => sv.kind === 'dev')
    for (const sv of dev) {
      if (this.known.has(sv.pid)) continue
      this.known.add(sv.pid)
      const fresh = sv.started !== null && now - sv.started < FRESH_MS
      const clashing = [...this.clashMap.values()].some((c) => sv.project && keyOf(c.project) === keyOf(sv.project))
      if (!this.first && fresh && !clashing) this.hooks.say(`${NAME(sv.name)} IS UP ON :${sv.ports[0]}!`)
    }
    for (const pid of this.known) if (!dev.some((sv) => sv.pid === pid)) this.known.delete(pid)
  }

  private leftovers(now = Date.now()): ServerInfo[] {
    const mins = this.cfg.leftoverMinutes
    if (!mins) return []
    return this.all.filter((sv) => sv.kind === 'dev' && sv.orphan && sv.orphanSince !== null && now - sv.orphanSince >= mins * 60_000)
  }

  get clashes(): PortClash[] {
    return [...this.clashMap.values()].map(({ seen: _seen, ...c }) => c).sort((a, b) => b.at - a.at)
  }

  /** Servers shown in the panel and menus. */
  shown(): ServerInfo[] {
    return this.all.filter((sv) => sv.kind === 'dev' || (this.cfg.showServices && sv.kind !== 'system'))
  }

  server(pid: number): ServerInfo | undefined {
    return this.all.find((sv) => sv.pid === pid)
  }

  /** Who holds `port`, and the next free port after it. */
  lookup(port: number): PortLookup {
    const p = Math.round(Number(port))
    return { port: p, holder: this.all.find((sv) => sv.ports.includes(p)) ?? null, next: this.nextFree(p) }
  }

  nextFree(from: number): number {
    const used = new Set(this.all.flatMap((sv) => sv.ports))
    for (let p = from + 1; p < Math.min(65536, from + 200); p++) if (!used.has(p)) return p
    return from + 1
  }

  // --- acting ----------------------------------------------------------------------------------
  /** The process to stop for a server: climb to the launcher in the same project (npm, nodemon...), never past a shell. */
  private stopRoot(sv: ServerInfo): number {
    let root = sv.pid
    for (let i = 0; i < 5; i++) {
      const parent = this.procs.get(this.procs.get(root)?.ppid ?? -1)
      if (!parent || !isRuntime(parent.name) || this.ours(parent.pid)) break
      const t = this.track(parent.pid, parent.name)
      if (!t.project || !sv.project || keyOf(t.project) !== keyOf(sv.project)) break
      root = parent.pid
    }
    return root
  }

  /** Stop a server (and what it started), so its ports are free. The caller has already confirmed. */
  async stopServer(pid: number): Promise<ActionResult> {
    await this.poll()
    const sv = this.server(pid)
    if (!sv) return { ok: false, message: "That server isn't running any more." }
    if (sv.kind === 'system' || this.ours(pid)) return { ok: false, message: `${sv.name} is part of Windows (or GitGremlin), so Mole leaves it alone.` }
    const r = await stopTree(this.stopRoot(sv))
    if (!r.ok && r.denied)
      return { ok: false, message: `Windows won't let GitGremlin stop ${sv.name}: it runs as a service or as admin. Stop it from Services, or from a terminal opened as administrator.` }
    await new Promise((done) => setTimeout(done, 600))
    await this.poll()
    const still = sv.ports.filter((p) => this.all.some((x) => x.ports.includes(p)))
    const ports = sv.ports.map((p) => `:${p}`).join(', ')
    if (!r.ok && still.length) return { ok: false, message: `Couldn't stop ${sv.name}: ${r.message}` }
    if (still.length) return { ok: false, message: `${sv.name} stopped, but :${still[0]} is still in use (something else took it).` }
    this.hooks.feed(`${ports.toUpperCase()} IS FREE! SLURP.`)
    return { ok: true, message: `Stopped ${sv.name}. ${ports} ${sv.ports.length === 1 ? 'is' : 'are'} free.` }
  }

  async act(a: MoleAction): Promise<ActionResult> {
    switch (a?.kind) {
      case 'stop':
        return this.stopServer(Number(a.pid))
      case 'browser': {
        const port = Math.round(Number(a.port))
        const sv = this.all.find((x) => x.ports.includes(port))
        if (!sv || sv.kind === 'system') return { ok: false, message: 'Nothing is listening there any more.' }
        void shell.openExternal(`http://localhost:${port}/`)
        return { ok: true, message: `Opening localhost:${port}...` }
      }
      case 'folder':
      case 'vscode': {
        const project = this.server(Number(a.pid))?.project
        if (!project) return { ok: false, message: 'No project folder for that server.' }
        if (a.kind === 'folder') {
          const err = await shell.openPath(project)
          return { ok: !err, message: err || 'Opened.' }
        }
        return openInVSCode(project) ? { ok: true, message: 'Opening it in VS Code...' } : { ok: false, message: "VS Code isn't installed." }
      }
      case 'copy': {
        const text = String(a.text ?? '')
        if (!/^:?\d{2,5}$/.test(text)) return { ok: false, message: 'Nothing to copy.' }
        clipboard.writeText(text.replace(/^:/, ''))
        return { ok: true, message: `Copied ${text.replace(/^:/, '')}` }
      }
      default:
        return { ok: false, message: 'Unknown action.' }
    }
  }

  // --- views -----------------------------------------------------------------------------------
  view(): MoleView {
    const shown = this.shown()
    return {
      at: this.lastAt,
      servers: shown,
      clashes: this.cfg.clashAlerts ? this.clashes : [],
      hiddenServices: this.cfg.showServices ? 0 : this.all.filter((sv) => sv.kind === 'db' || sv.kind === 'app').length,
      vscode: findVSCode() !== null
    }
  }

  status(cfg: PetConfig): PetStatus {
    const base = { name: cfg.name, grid: null, busy: null, connected: true }
    if (!this.lastAt) return { ...base, stage: 'fed', level: 3, alert: null, report: ['DIGGING FOR PORTS...', '', '> I FIND WHO HOLDS YOUR PORTS.'] }
    const dev = this.all.filter((sv) => sv.kind === 'dev')
    const clash = this.cfg.clashAlerts ? this.clashes[0] : undefined
    const left = this.leftovers()
    const alert = clash
      ? `${clashText(clash)} RIGHT-CLICK ME TO FREE IT.`
      : left.length
        ? `${left.length} SERVER${s(left.length)} LEFT RUNNING WITH NO TERMINAL. RIGHT-CLICK ME.`
        : null
    const lines = [dev.length ? `${dev.length} DEV SERVER${s(dev.length)} RUNNING` : 'NO DEV SERVERS RUNNING']
    for (const sv of dev.slice(0, 4)) lines.push(`:${sv.ports[0]} ${NAME(sv.name)}${sv.orphan ? ' (LEFT RUNNING)' : ''}`)
    if (dev.length > 4) lines.push(`  ...AND ${dev.length - 4} MORE`)
    if (clash) lines.push(`PORT FIGHT: ${clashText(clash)}`)
    lines.push('', `> ${clash ? 'RIGHT-CLICK ME TO FREE IT.' : left.length ? 'RIGHT-CLICK ME TO STOP THEM.' : dev.length ? 'RIGHT-CLICK ME TO FREE A PORT.' : pick(RANDOM_LINES)}`)
    const level = clash ? 1 : left.length ? 2 : dev.length ? 3 : 4
    return { ...base, stage: 'fed', level, alert, report: lines }
  }

  /** "node.exe (PID 9344), started 2 hours ago" for confirm dialogs. */
  describe(sv: ServerInfo): string {
    const when = sv.started ? `, started ${ago(sv.started)}` : ''
    return `${sv.command} · ${sv.process} (PID ${sv.pid})${when}${sv.project ? `\n${sv.project}` : ''}`
  }
}
