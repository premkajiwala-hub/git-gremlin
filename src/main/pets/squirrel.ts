import { basename, resolve } from 'node:path'
import { net, safeStorage, shell } from 'electron'
import { ago } from '../../shared/format'
import type {
  ActionResult,
  LivePlatform,
  PetConfig,
  PetStatus,
  SquirrelAction,
  SquirrelMeter,
  SquirrelNotice,
  SquirrelPlatform,
  SquirrelProject,
  SquirrelView
} from '../../shared/types'
import { periodStart, readCloudflare, readCloudinary, readSupabase, runsOutAt, type Fetcher, type Reading } from '../freetier'
import { detect, PLATFORMS, SAFE_HOSTS, usageLink, type PlatformId } from '../platforms'
import type { Store } from '../store'

const RANDOM_LINES = ['ACORNS STASHED. TIERS LOOK FINE.', 'SAVING UP FOR WINTER.', 'NO FREE TIER IS RUNNING LOW.', 'COUNTING YOUR ACORNS...']
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)]
const s = (n: number) => (n === 1 ? '' : 'S')

export const LIVE: LivePlatform[] = ['supabase', 'cloudinary', 'cloudflare']

const READERS: Record<LivePlatform, (f: Fetcher, secret: string) => Promise<Reading>> = {
  supabase: readSupabase,
  cloudinary: readCloudinary,
  cloudflare: readCloudflare
}

const fetcher: Fetcher = (url, init) => net.fetch(url, init as RequestInit)

export interface SquirrelHooks {
  changed(): void
  feed(text: string): void
  say(text: string): void
  /** Repo folders to look in (Syncy's watched repos). */
  repos(): string[]
}

/**
 * Squirrel's purpose: know which of your projects runs on which hosting and
 * cloud platform, what each free tier allows (and its catch), and, where you
 * connect a read-only key, how much of each free allowance is used. It warns
 * before a tier runs out (at your threshold), when a free Supabase project
 * goes quiet before its 7-day pause, and when it pauses; and it celebrates
 * each reset. Keys are stored encrypted and only ever read usage.
 */
export class SquirrelService {
  busy: 'checking' | null = null
  private timer: NodeJS.Timeout | null = null
  private first: NodeJS.Timeout | null = null
  private mapCache: { at: number; projects: SquirrelProject[] } | null = null

  constructor(
    private store: Store,
    private hooks: SquirrelHooks
  ) {}

  private get cfg() {
    return this.store.state.settings.squirrel
  }
  private get st() {
    return this.store.state.squirrel
  }
  private get enabled(): boolean {
    return this.store.state.settings.pets.squirrel.enabled
  }

  start(): void {
    this.first = setTimeout(() => void this.check(), 30_000)
    this.reschedule()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    if (this.first) clearTimeout(this.first)
  }

  reschedule(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = setInterval(() => void this.check(), this.cfg.checkEveryMinutes * 60_000)
  }

  // --- the map ---------------------------------------------------------------------------------
  /** Which project uses which platform (re-read at most once a minute). */
  projects(force = false): SquirrelProject[] {
    if (!force && this.mapCache && Date.now() - this.mapCache.at < 60_000) return this.mapCache.projects
    const seen = new Set<string>()
    const projects: SquirrelProject[] = []
    for (const path of this.hooks.repos()) {
      const k = resolve(path).toLowerCase()
      if (seen.has(k)) continue
      seen.add(k)
      const found = detect(path)
      if (!found.length) continue
      projects.push({
        path,
        name: basename(path),
        platforms: found.map((f) => ({ id: f.id, name: PLATFORMS[f.id].name, evidence: f.evidence, link: usageLink(f.id, f.ref) }))
      })
    }
    projects.sort((a, b) => a.name.localeCompare(b.name))
    this.mapCache = { at: Date.now(), projects }
    return projects
  }

  // --- keys ------------------------------------------------------------------------------------
  private secret(p: LivePlatform): string | null {
    const enc = this.st.keys[p]
    if (!enc) return null
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'))
    } catch {
      return null
    }
  }

  /** Try the key; keep it (encrypted) only if the platform accepts it. */
  async connect(p: LivePlatform, secret: string): Promise<ActionResult> {
    const key = secret.trim()
    if (!key) return { ok: false, message: 'Paste the key first.' }
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, message: "Windows can't encrypt the key on this PC, so Squirrel won't keep it." }
    let reading: Reading
    try {
      reading = await READERS[p](fetcher, key)
    } catch (err) {
      return { ok: false, message: (err as Error).message }
    }
    this.st.keys[p] = safeStorage.encryptString(key).toString('base64')
    this.st.readings[p] = { at: Date.now(), label: reading.label, error: null, meters: reading.meters, notices: reading.notices }
    this.store.saveSoon()
    this.hooks.changed()
    return { ok: true, message: `Connected to ${PLATFORMS[p].name} (${reading.label}).` }
  }

  disconnect(p: LivePlatform): ActionResult {
    delete this.st.keys[p]
    delete this.st.readings[p]
    this.store.saveSoon()
    this.hooks.changed()
    return { ok: true, message: `Squirrel forgot the ${PLATFORMS[p].name} key.` }
  }

  // --- checking --------------------------------------------------------------------------------
  /** Read every connected platform's usage, then react to what changed. */
  async check(): Promise<void> {
    if (this.busy || !this.enabled) return
    this.busy = 'checking'
    this.hooks.changed()
    const before = this.view()
    try {
      this.projects(true)
      for (const p of LIVE) {
        const secret = this.secret(p)
        if (!secret) continue
        try {
          const r = await READERS[p](fetcher, secret)
          this.st.readings[p] = { at: Date.now(), label: r.label, error: null, meters: r.meters, notices: r.notices }
        } catch (err) {
          const prev = this.st.readings[p]
          this.st.readings[p] = { at: prev?.at ?? Date.now(), label: prev?.label ?? '', error: (err as Error).message, meters: prev?.meters ?? [], notices: prev?.notices ?? [] }
        }
      }
      this.st.checkedAt = Date.now()
      this.store.saveSoon()
    } finally {
      this.busy = null
      this.hooks.changed()
    }
    this.react(before, this.view())
  }

  /** A tier crossed the warning line, or a project paused: say so. A tier reset: eat an acorn. */
  private react(before: SquirrelView, after: SquirrelView): void {
    const prev = new Map(before.meters.map((m) => [m.key, m]))
    for (const m of after.meters) {
      const p = prev.get(m.key)
      if (p && m.used < p.used * 0.5 && p.percent >= 25) {
        this.hooks.feed(`FRESH ACORNS! ${PLATFORMS[m.platform].name.toUpperCase()} RESET.`)
        return
      }
    }
    const warned = after.meters.find((m) => m.percent >= this.cfg.warnAt && (prev.get(m.key)?.percent ?? 0) < this.cfg.warnAt)
    if (warned) return this.hooks.say(`${PLATFORMS[warned.platform].name.toUpperCase()}: ${Math.round(warned.percent)}% OF THE FREE TIER USED!`)
    const was = new Map(before.notices.map((n) => [n.key, n.state]))
    const bad = after.notices.find((n) => (n.state === 'paused' || n.state === 'quiet') && was.get(n.key) !== n.state)
    if (bad) this.hooks.say(bad.state === 'paused' ? `SUPABASE: ${bad.project.toUpperCase()} IS PAUSED!` : `SUPABASE: ${bad.project.toUpperCase()} MAY PAUSE SOON.`)
  }

  async act(a: SquirrelAction): Promise<ActionResult> {
    if (a?.kind === 'open') {
      let host = ''
      try {
        host = new URL(String(a.url)).hostname
      } catch {
        // invalid
      }
      if (!SAFE_HOSTS.includes(host) || !String(a.url).startsWith('https://')) return { ok: false, message: "Squirrel only opens the platforms' own pages." }
      void shell.openExternal(String(a.url))
      return { ok: true, message: 'Opening it in your browser...' }
    }
    const p = a?.platform
    if (!LIVE.includes(p as LivePlatform)) return { ok: false, message: 'Unknown platform.' }
    if (a.kind === 'connect') return this.connect(p as LivePlatform, String(a.secret ?? ''))
    if (a.kind === 'disconnect') return this.disconnect(p as LivePlatform)
    return { ok: false, message: 'Unknown action.' }
  }

  // --- views -----------------------------------------------------------------------------------
  view(): SquirrelView {
    const now = Date.now()
    const projects = this.projects()
    const used = new Set<PlatformId>(projects.flatMap((p) => p.platforms.map((x) => x.id as PlatformId)))
    for (const p of LIVE) if (this.st.keys[p]) used.add(p)
    const platforms: SquirrelPlatform[] = [...used]
      .map((id) => {
        const info = PLATFORMS[id]
        const r = info.live ? this.st.readings[id as LivePlatform] : undefined
        return {
          id,
          name: info.name,
          rules: info.rules,
          watch: info.watch,
          usageUrl: info.usageUrl,
          live: info.live,
          connected: info.live ? Boolean(this.st.keys[id as LivePlatform]) : false,
          label: r?.label ?? null,
          error: r?.error ?? null,
          checkedAt: r?.at ?? null,
          projects: projects.filter((p) => p.platforms.some((x) => x.id === id)).map((p) => p.name)
        }
      })
      .sort((a, b) => Number(b.live) - Number(a.live) || a.name.localeCompare(b.name))
    const meters: SquirrelMeter[] = []
    const notices: SquirrelNotice[] = []
    for (const p of LIVE) {
      const r = this.st.readings[p]
      if (!r || !this.st.keys[p]) continue
      for (const m of r.meters) {
        const percent = m.limit > 0 ? (m.used / m.limit) * 100 : 0
        meters.push({ ...m, percent, runsOutAt: runsOutAt(m, periodStart(m, now), now) })
      }
      notices.push(...r.notices)
    }
    meters.sort((a, b) => b.percent - a.percent)
    return { projects, platforms, meters, notices, busy: this.busy, at: this.st.checkedAt, warnAt: this.cfg.warnAt }
  }

  status(cfg: PetConfig): PetStatus {
    const base = { name: cfg.name, grid: null, busy: null, connected: true }
    if (this.busy) return { ...base, stage: 'fed', level: 3, alert: null, report: ['COUNTING YOUR ACORNS...', '', '> CHECKING YOUR FREE TIERS.'] }
    const v = this.view()
    const warn = v.meters.filter((m) => m.percent >= this.cfg.warnAt)
    const paused = v.notices.filter((n) => n.state === 'paused')
    const quiet = v.notices.filter((n) => n.state === 'quiet')
    const top = warn[0]
    const alert = top
      ? `${PLATFORMS[top.platform].name.toUpperCase()}: ${Math.round(top.percent)}% OF THE FREE TIER USED! RIGHT-CLICK ME.`
      : paused.length
        ? `SUPABASE: ${paused[0].project.toUpperCase()} IS PAUSED! RIGHT-CLICK ME.`
        : quiet.length
          ? `SUPABASE: ${quiet[0].project.toUpperCase()} MAY PAUSE SOON. RIGHT-CLICK ME.`
          : null
    const lines = [`${v.platforms.length} PLATFORM${s(v.platforms.length)} IN ${v.projects.length} PROJECT${s(v.projects.length)}`]
    for (const m of v.meters.slice(0, 3)) lines.push(`- ${short(PLATFORMS[m.platform].name)}: ${Math.round(m.percent)}% USED`)
    for (const n of [...paused, ...quiet].slice(0, 2)) lines.push(`- ${short(n.project)}: ${n.state === 'paused' ? 'PAUSED' : 'GOING QUIET'}`)
    if (!v.meters.length && !v.notices.length) lines.push(v.platforms.some((p) => p.live) ? 'CONNECT A KEY FOR LIVE USAGE.' : 'SHOWING FREE-TIER LIMITS.')
    if (v.at) lines.push(`LAST CHECK: ${ago(v.at).toUpperCase()}`)
    lines.push('', `> ${alert ? 'RIGHT-CLICK ME TO SEE IT.' : pick(RANDOM_LINES)}`)
    const level = top && top.percent >= 95 ? 1 : top || paused.length ? 1 : quiet.length ? 2 : v.meters.length ? 4 : 3
    return { ...base, stage: 'fed', level, alert, report: lines }
  }
}

const short = (name: string) => (name.length > 14 ? `${name.slice(0, 13)}..` : name).toUpperCase()
