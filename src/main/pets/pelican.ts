/**
 * Pelican: carries files from your PC to your phone.
 *
 * Drop files on Pelican (or add them in the panel) and they wait in its
 * pouch. "Show QR code" starts a share (see share.ts): the phone scans it,
 * downloads everything at once or file by file, and the QR code switches off.
 * Pelican also opens your running dev servers on your phone (Mole knows them).
 */
import { randomBytes } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { connect } from 'node:net'
import { hostname } from 'node:os'
import { basename, join, relative } from 'node:path'
import { app, BrowserWindow, clipboard, dialog } from 'electron'
import type { ActionResult, PelicanAction, PelicanFile, PelicanSite, PelicanView, PetConfig, PetStatus, ServerInfo } from '../../shared/types'
import { formatSize, lanAddresses, Share, type ShareFile } from '../share'

/** Folders added whole: these are skipped inside them. */
const SKIP_DIRS = new Set(['.git', 'node_modules'])
const MAX_FILES = 2000

export interface PelicanHooks {
  changed(): void
  say(text: string): void
  feed(text: string): void
  /** Running dev servers (from Mole). */
  servers(): ServerInfo[]
}

interface PouchFile extends ShareFile {
  added: number
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 'S'}`

export class PelicanService {
  private pouch: PouchFile[] = []
  private share: Share | null = null
  /** The current share's progress (kept after it ends, until files change). */
  private shared: PelicanView['share'] = null
  private sharedIds = new Set<string>()

  constructor(private hooks: PelicanHooks) {}

  get count(): number {
    return this.pouch.length
  }

  get sharing(): boolean {
    return Boolean(this.share) && this.shared?.state !== 'stopped'
  }

  stop(): void {
    this.share?.stop()
  }

  // --- the pouch ----------------------------------------------------------------------------------
  /** Add files and folders (folders bring every file inside, with their paths). */
  add(paths: string[]): number {
    const before = this.pouch.length
    const have = new Set(this.pouch.map((f) => f.path.toLowerCase()))
    const put = (path: string, name: string, size: number) => {
      if (this.pouch.length >= MAX_FILES || have.has(path.toLowerCase())) return
      have.add(path.toLowerCase())
      this.pouch.push({ id: randomBytes(6).toString('hex'), name, path, size, added: Date.now() })
    }
    const walk = (dir: string, root: string) => {
      let entries
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        if (this.pouch.length >= MAX_FILES) return
        const p = join(dir, e.name)
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name)) walk(p, root)
        } else if (e.isFile()) {
          try {
            put(p, `${basename(root)}/${relative(root, p).replace(/\\/g, '/')}`, statSync(p).size)
          } catch {
            /* unreadable: skip */
          }
        }
      }
    }
    for (const raw of paths) {
      if (typeof raw !== 'string' || !raw) continue
      let st
      try {
        st = statSync(raw)
      } catch {
        continue
      }
      if (st.isDirectory()) walk(raw, raw)
      else if (st.isFile()) put(raw, basename(raw), st.size)
    }
    const added = this.pouch.length - before
    if (added) this.filesChanged()
    return added
  }

  remove(id: string): void {
    this.pouch = this.pouch.filter((f) => f.id !== id)
    this.filesChanged()
  }

  clear(): void {
    this.pouch = []
    this.filesChanged()
  }

  /** The pouch changed: a QR code nobody has opened yet is redone with the new files. */
  private filesChanged(): void {
    if (this.share && this.shared?.state === 'waiting') {
      this.share.removeAllListeners()
      this.share.stop()
      this.share = null
      this.shared = null
      if (this.pouch.length) void this.startShare()
    } else if (this.shared?.state === 'stopped') this.shared = null
    this.hooks.changed()
  }

  // --- sharing ------------------------------------------------------------------------------------
  async startShare(): Promise<ActionResult> {
    if (!this.pouch.length) return { ok: false, message: 'Add some files first: drop them on Pelican or click Add files.' }
    if (this.sharing) return { ok: true, message: '' }
    const address = lanAddresses()[0]?.address
    if (!address) return { ok: false, message: "Your PC isn't connected to a Wi-Fi or local network, so your phone can't reach it." }
    const files = this.pouch.filter((f) => existsSync(f.path)).map(({ id, name, path, size }) => ({ id, name, path, size }))
    if (!files.length) return { ok: false, message: 'Those files are no longer on your PC.' }
    let brand: Buffer | undefined
    try {
      brand = readFileSync(join(app.getAppPath(), 'assets', 'pets', 'pelican', 'portrait.png'))
    } catch {
      brand = undefined
    }
    const share = new Share(files, { host: address, brand, from: hostname() })
    this.share = share
    this.sharedIds = new Set(files.map((f) => f.id))
    share.on('change', (p) => {
      if (this.share !== share) return
      const was = this.shared?.state
      this.shared = { url: share.url, ...p }
      if (p.state === 'opened' && was !== 'opened') this.hooks.say(`${(p.device ?? 'YOUR PHONE').toUpperCase()} IS HERE! TAP DOWNLOAD ALL.`)
      if (p.state === 'delivered' && was !== 'delivered') {
        // Delivered: those files leave the pouch.
        this.pouch = this.pouch.filter((f) => !this.sharedIds.has(f.id))
        this.hooks.feed(`DELIVERED! ${plural(p.files, 'FILE')} ON YOUR PHONE.`)
      }
      this.hooks.changed()
    })
    share.on('stop', (reason: string) => {
      if (this.share !== share) return
      if (reason === 'idle') this.hooks.say('NOBODY CAME, SO I PUT THE QR CODE AWAY.')
      this.hooks.changed()
    })
    try {
      await share.start()
    } catch (err) {
      this.share = null
      return { ok: false, message: `Pelican couldn't start sharing: ${(err as Error).message}` }
    }
    this.shared = { url: share.url, ...share.progress() }
    this.hooks.changed()
    return { ok: true, message: '' }
  }

  stopShare(): void {
    if (!this.share) return
    this.share.stop()
    this.shared = null
    this.share = null
    this.hooks.changed()
  }

  // --- the panel ----------------------------------------------------------------------------------
  async act(a: PelicanAction): Promise<ActionResult> {
    switch (a?.kind) {
      case 'add': {
        const win = BrowserWindow.getFocusedWindow()
        const opts = { title: 'Add files to Pelican', properties: ['openFile', 'multiSelections'] as ('openFile' | 'multiSelections')[] }
        const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
        if (r.canceled || !r.filePaths.length) return { ok: true, message: '' }
        const n = this.add(r.filePaths)
        if (n) this.hooks.feed(`GULP! ${plural(n, 'FILE')} IN MY POUCH.`)
        return { ok: true, message: '' }
      }
      case 'addPaths': {
        const n = this.add(Array.isArray(a.paths) ? a.paths.slice(0, MAX_FILES) : [])
        if (n) this.hooks.feed(`GULP! ${plural(n, 'FILE')} IN MY POUCH.`)
        return { ok: true, message: '' }
      }
      case 'remove':
        this.remove(String(a.id))
        return { ok: true, message: '' }
      case 'clear':
        this.stopShare()
        this.clear()
        return { ok: true, message: '' }
      case 'share':
        return this.startShare()
      case 'stop':
        this.stopShare()
        return { ok: true, message: '' }
      case 'copy':
        if (typeof a.url !== 'string' || !/^http:\/\/[\d.]+:\d+\//.test(a.url)) return { ok: false, message: '' }
        clipboard.writeText(a.url)
        return { ok: true, message: 'Link copied.' }
      default:
        return { ok: false, message: '' }
    }
  }

  view(): PelicanView {
    const address = lanAddresses()[0]?.address ?? null
    const files: PelicanFile[] = this.pouch.map(({ id, name, size }) => ({ id, name, size }))
    return {
      files,
      total: files.reduce((n, f) => n + f.size, 0),
      share: this.shared,
      address,
      sites: address ? this.sites(address) : []
    }
  }

  /** Whether each port answers on the Wi-Fi address (a server bound to localhost refuses). */
  private reach = new Map<string, boolean>()
  private probing = new Set<string>()

  private probe(address: string, port: number): void {
    const key = `${address}:${port}`
    if (this.probing.has(key)) return
    this.probing.add(key)
    const sock = connect({ host: address, port, timeout: 600 })
    const done = (ok: boolean) => {
      sock.destroy()
      this.probing.delete(key)
      if (this.reach.get(key) !== ok) {
        this.reach.set(key, ok)
        this.hooks.changed()
      }
    }
    sock.once('connect', () => done(true))
    sock.once('error', () => done(false))
    sock.once('timeout', () => done(false))
  }

  /** Dev servers you can open on your phone: one row per port. */
  private sites(address: string): PelicanSite[] {
    const out: PelicanSite[] = []
    for (const s of this.hooks.servers()) {
      if (s.kind !== 'dev') continue
      for (const port of s.ports) {
        this.probe(address, port)
        const ok = this.reach.get(`${address}:${port}`)
        const local = ok === undefined ? s.local : !ok
        out.push({ name: s.name, port, url: `http://${address}:${port}/`, local, hint: local ? hostHint(s.command) : null })
      }
    }
    return out
  }

  status(cfg: PetConfig): PetStatus {
    const base = { name: cfg.name, stage: 'fed' as const, level: 3 as const, grid: null, connected: true, accent: this.pouch.length > 0 }
    const s = this.shared
    const n = this.pouch.length
    const size = formatSize(this.pouch.reduce((t, f) => t + f.size, 0)).toUpperCase()
    if (s && s.state !== 'stopped') {
      const pct = Math.min(100, Math.round((s.sent * 100) / Math.max(1, s.total)))
      const line =
        s.state === 'waiting'
          ? 'SCAN MY QR CODE WITH YOUR PHONE.'
          : s.state === 'opened'
            ? `${(s.device ?? 'YOUR PHONE').toUpperCase()} IS LOOKING.`
            : s.state === 'downloading'
              ? `SENDING... ${pct}%`
              : 'DELIVERED!'
      if (s.state === 'delivered') return { ...base, level: 4, busy: null, alert: null, report: [`DELIVERED ${plural(s.files, 'FILE')}`, 'THEY ARE ON YOUR PHONE.'] }
      return { ...base, level: 4, busy: s.state === 'downloading' ? 'scanning' : null, alert: null, report: [`SHARING ${plural(s.files, 'FILE')}`, line] }
    }
    if (!n) return { ...base, busy: null, alert: null, report: ['MY POUCH IS EMPTY.', 'DROP FILES ON ME TO SEND', 'THEM TO YOUR PHONE.'] }
    return {
      ...base,
      level: 4,
      busy: null,
      alert: `${plural(n, 'FILE')} READY. CLICK ME FOR THE QR CODE.`,
      report: [`${plural(n, 'FILE')} IN MY POUCH`, size, '', '> CLICK ME FOR THE QR CODE.']
    }
  }
}

/** How to let other devices open a dev server that only listens on this PC. */
export function hostHint(command: string): string {
  const c = command.toLowerCase()
  if (c.includes('vite') || c.includes('astro') || c.includes('nuxt')) return 'Start it with --host, for example: npm run dev -- --host'
  if (c.includes('next')) return 'Start it with -H 0.0.0.0, for example: npm run dev -- -H 0.0.0.0'
  if (c.includes('react-scripts')) return 'Set HOST=0.0.0.0 before npm start.'
  if (c.includes('ng ') || c.includes('angular')) return 'Start it with --host 0.0.0.0'
  if (c.includes('manage.py')) return 'Run it as: python manage.py runserver 0.0.0.0:8000'
  if (c.includes('flask')) return 'Run it as: flask run --host=0.0.0.0'
  return 'Make it listen on 0.0.0.0 instead of localhost.'
}
