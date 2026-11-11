import { JUNK_ALERT_BYTES } from '../../shared/constants'
import { ago, formatBytes } from '../../shared/format'
import type { DustyView, PetConfig, PetStatus, ScanResult } from '../../shared/types'
import { JunkScanner } from '../junk'
import type { Store } from '../store'

const RANDOM_LINES = [
  "ONE DEV'S CACHE IS MY LUNCH.",
  'TRASH PANDA REPORTING FOR DUTY.',
  'I ALWAYS WASH MY PAWS AFTER A JOB.',
  'NO FILE LEFT BEHIND (UNLESS IT IS JUNK).',
  'SNIFF SNIFF... SMELLS LIKE NODE_MODULES.',
  'YOUR DISK IS MY BUFFET.'
]
const MODE_LABEL = { ask: 'ASK FIRST', auto: 'AUTO-CLEAN', report: 'REPORT ONLY' }
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)]

export interface DustyHooks {
  /** Status or results changed: refresh the pet and the panel. */
  changed(): void
  /** Play the eating animation with this line. */
  feed(text: string): void
  say(text: string): void
}

/**
 * Dusty's purpose: scan known junk locations on a schedule and, depending on
 * the mode, ask before cleaning, clean safe things automatically, or only report.
 */
export class DustyService {
  busy: 'scanning' | 'cleaning' | null = null
  private scanner = new JunkScanner()
  private timer: NodeJS.Timeout | null = null
  private firstScan: NodeJS.Timeout | null = null

  constructor(
    private store: Store,
    private hooks: DustyHooks
  ) {}

  private get cfg() {
    return this.store.state.settings.dusty
  }
  private get enabled(): boolean {
    return this.store.state.settings.pets.dusty.enabled
  }

  start(): void {
    this.reschedule()
    // First look around shortly after start-up, unless a recent scan exists.
    const last = this.store.state.dusty.lastScan?.at ?? 0
    const due = Math.max(15_000, last + this.cfg.scanEveryMinutes * 60_000 - Date.now())
    this.firstScan = setTimeout(() => void this.scan(), Math.min(due, this.cfg.scanEveryMinutes * 60_000))
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    if (this.firstScan) clearTimeout(this.firstScan)
  }

  /** Call when the scan interval changes. */
  reschedule(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = setInterval(() => void this.scan(), this.cfg.scanEveryMinutes * 60_000)
  }

  async scan(): Promise<ScanResult | null> {
    if (this.busy || !this.enabled) return this.store.state.dusty.lastScan
    this.busy = 'scanning'
    this.hooks.changed()
    try {
      const result = await this.scanner.scan(this.cfg.targets)
      this.store.state.dusty.lastScan = result
      this.store.saveSoon()
    } finally {
      this.busy = null
      this.hooks.changed()
    }
    if (this.cfg.mode === 'auto') {
      // Auto-clean only the safe kinds. The Recycle Bin is permanent, so it always asks.
      const ids = this.cleanable().filter((c) => c.target !== 'recycleBin').map((c) => c.id)
      if (ids.length) await this.clean(ids)
    } else if (this.cfg.mode === 'ask' && this.cleanableBytes() >= JUNK_ALERT_BYTES) {
      this.hooks.say(`I SNIFFED OUT ${formatBytes(this.cleanableBytes())} OF JUNK! CLICK ME TO REVIEW.`)
    }
    return this.store.state.dusty.lastScan
  }

  /** Clean the given categories (default: everything cleanable). Never runs in report-only mode. */
  async clean(ids?: string[]): Promise<void> {
    if (this.busy || this.cfg.mode === 'report' || !this.enabled) return
    const which = ids ?? this.cleanable().map((c) => c.id)
    if (!which.length) return
    this.busy = 'cleaning'
    this.hooks.changed()
    try {
      const { result, after } = await this.scanner.clean(which, this.cfg.targets)
      this.store.state.dusty.lastClean = result
      this.store.state.dusty.lastScan = after
      this.store.saveSoon()
      this.busy = null
      this.hooks.changed()
      this.hooks.feed(result.freedBytes > 0 ? `MUNCHED ${formatBytes(result.freedBytes)} OF JUNK!` : 'HMM, NOTHING LEFT TO EAT.')
    } finally {
      this.busy = null
      this.hooks.changed()
    }
  }

  /** Categories that can be cleaned right now (target enabled, not blocked). */
  cleanable() {
    const scan = this.store.state.dusty.lastScan
    if (!scan) return []
    return scan.categories.filter((c) => this.cfg.targets[c.target] && !c.blocked && c.bytes > 0)
  }

  private cleanableBytes(): number {
    return this.cleanable().reduce((s, c) => s + c.bytes, 0)
  }

  view(): DustyView {
    return { scan: this.store.state.dusty.lastScan, lastClean: this.store.state.dusty.lastClean, busy: this.busy }
  }

  status(cfg: PetConfig): PetStatus {
    const { lastScan, lastClean } = this.store.state.dusty
    const junk = this.cleanableBytes()
    const recycle = this.cleanable().find((c) => c.target === 'recycleBin')
    const cleanedRecently = lastClean && Date.now() - lastClean.at < 2 * 3_600_000 && lastClean.freedBytes > 0
    const mode = this.cfg.mode

    let alert: string | null = null
    if (mode === 'ask' && junk >= JUNK_ALERT_BYTES) alert = `I SNIFFED OUT ${formatBytes(junk)} OF JUNK! CLICK ME TO REVIEW.`
    else if (mode === 'auto' && recycle && recycle.bytes >= JUNK_ALERT_BYTES) {
      alert = `THE RECYCLE BIN HAS ${formatBytes(recycle.bytes)}. CLICK ME TO EMPTY IT.`
    }

    const report = [
      this.busy === 'scanning' ? 'SNIFFING FOR JUNK...' : this.busy === 'cleaning' ? 'MUNCHING JUNK...' : junk > 0 ? `JUNK FOUND: ${formatBytes(junk)}` : 'ALL CLEAN!',
      `MODE: ${MODE_LABEL[mode]}`,
      `LAST SCAN: ${lastScan ? ago(lastScan.at).toUpperCase() : 'NOT YET'}`,
      `LAST CLEAN: ${lastClean ? `${ago(lastClean.at).toUpperCase()} (${formatBytes(lastClean.freedBytes)})` : 'NOT YET'}`,
      '',
      `> ${alert ? 'CLICK ME TO REVIEW AND CLEAN.' : mode === 'report' ? 'I ONLY LOOK, I NEVER TOUCH.' : pick(RANDOM_LINES)}`
    ]
    return {
      name: cfg.name,
      stage: 'fed',
      level: cleanedRecently ? 4 : junk < JUNK_ALERT_BYTES ? 3 : 2,
      report,
      grid: null,
      alert,
      busy: this.busy,
      connected: true
    }
  }
}
