/**
 * Pelican: opens the sites you're building on your phone.
 *
 * For every dev server Mole sees, Pelican shows a QR code with this PC's Wi-Fi
 * address, so your phone opens the site without typing anything. It checks each
 * port over the Wi-Fi address itself: a server that only listens on localhost
 * gets the fix for its tool (Vite --host, Next -H 0.0.0.0, ...).
 */
import { connect } from 'node:net'
import { clipboard } from 'electron'
import type { ActionResult, PelicanAction, PelicanSite, PelicanView, PetConfig, PetStatus, ServerInfo } from '../../shared/types'
import { lanAddresses } from '../lan'

export interface PelicanHooks {
  changed(): void
  say(text: string): void
  /** Running dev servers (from Mole). */
  servers(): ServerInfo[]
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 'S'}`

export class PelicanService {
  /** Whether each port answers on the Wi-Fi address (a server bound to localhost refuses). */
  private reach = new Map<string, boolean>()
  private probing = new Set<string>()
  /** Sites Pelican already pointed out, so it says so once per site. */
  private announced = new Set<string>()
  /** The site whose QR code the panel should show (from the right-click menu). */
  private focus: string | null = null

  constructor(private hooks: PelicanHooks) {}

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
  sites(): PelicanSite[] {
    const address = lanAddresses()[0]?.address
    if (!address) return []
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

  /** Show this site's QR code when the panel opens (from the right-click menu). */
  show(url: string | null): void {
    this.focus = url
    this.hooks.changed()
  }

  async act(a: PelicanAction): Promise<ActionResult> {
    switch (a?.kind) {
      case 'focus':
        this.focus = typeof a.url === 'string' ? a.url : null
        return { ok: true, message: '' }
      case 'copy':
        if (typeof a.url !== 'string' || !/^http:\/\/[\d.]+:\d+\/$/.test(a.url)) return { ok: false, message: '' }
        clipboard.writeText(a.url)
        return { ok: true, message: 'Link copied.' }
      default:
        return { ok: false, message: '' }
    }
  }

  view(): PelicanView {
    return { address: lanAddresses()[0]?.address ?? null, sites: this.sites(), focus: this.focus }
  }

  status(cfg: PetConfig): PetStatus {
    const base = { name: cfg.name, stage: 'fed' as const, grid: null, connected: true, busy: null, alert: null }
    if (!lanAddresses()[0]) return { ...base, level: 2, report: ['NO WI-FI.', 'CONNECT THIS PC TO WI-FI', 'TO OPEN SITES ON YOUR PHONE.'] }
    const sites = this.sites()
    // A new site your phone can open: say so once.
    for (const s of sites) {
      if (s.local || this.announced.has(s.url)) continue
      this.announced.add(s.url)
      this.hooks.say(`${s.name.toUpperCase()} :${s.port} IS UP. WANT IT ON YOUR PHONE? RIGHT-CLICK ME.`)
    }
    if (!sites.length) return { ...base, level: 3, report: ['NO SITES RUNNING.', 'START ONE (NPM RUN DEV) AND', "I'LL OPEN IT ON YOUR PHONE."] }
    const open = sites.filter((s) => !s.local)
    const lines = sites.slice(0, 3).map((s) => `:${s.port} ${s.name.toUpperCase()}${s.local ? ' (THIS PC ONLY)' : ''}`)
    return {
      ...base,
      level: open.length ? 4 : 3,
      report: [plural(sites.length, 'SITE') + ' RUNNING', ...lines, '', open.length ? '> RIGHT-CLICK ME FOR THE QR CODE.' : '> CLICK ME TO SEE HOW TO OPEN IT.']
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
