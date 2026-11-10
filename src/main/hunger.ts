import { FOOD_BASE_HOURS, FOOD_BONUS_CAP_HOURS, FOOD_BONUS_PER_DECADE } from '../shared/constants'
import type { HungerStage, Settings } from '../shared/types'
import type { Store } from './store'

const HOUR = 3_600_000
/** A gap between ticks longer than this means the PC was asleep: don't count it. */
const MAX_TICK_GAP = 3 * 60_000

export function inQuietHours(s: Settings, now = new Date()): boolean {
  if (!s.quietHoursEnabled) return false
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number)
    return (h || 0) * 60 + (m || 0)
  }
  const start = toMin(s.quietStart)
  const end = toMin(s.quietEnd)
  const cur = now.getHours() * 60 + now.getMinutes()
  if (start === end) return false
  return start < end ? cur >= start && cur < end : cur >= start || cur < end
}

/** Food value of one commit: a base meal plus a small, capped bonus for bigger diffs. */
export function foodFor(linesChanged: number): number {
  const bonus = Math.min(FOOD_BONUS_CAP_HOURS, FOOD_BONUS_PER_DECADE * Math.log10(1 + Math.max(0, linesChanged)))
  return FOOD_BASE_HOURS + bonus
}

/**
 * Hunger is "effective hours since the pet last ate". It only grows while the
 * app is running, the PC is awake and unlocked, hunger isn't paused, and it's
 * outside quiet hours. Each commit removes some hours.
 */
export class Hunger {
  private lastTick = Date.now()
  private asleep = false

  constructor(private store: Store) {}

  private get s(): Settings {
    return this.store.state.settings
  }

  tick(now = Date.now()): void {
    let dt = now - this.lastTick
    this.lastTick = now
    if (dt < 0 || dt > MAX_TICK_GAP) dt = 0
    const h = this.store.state.hunger
    if (h.paused || this.asleep || inQuietHours(this.s, new Date(now))) return
    h.hours += dt / HOUR
    this.store.saveSoon()
  }

  /** PC locked or suspended (true), or back (false). */
  setAsleep(asleep: boolean): void {
    this.tick()
    this.asleep = asleep
    this.lastTick = Date.now()
  }

  setPaused(paused: boolean): void {
    this.tick()
    this.store.state.hunger.paused = paused
    this.store.saveSoon()
  }

  get paused(): boolean {
    return this.store.state.hunger.paused
  }

  /** Eat one commit. Returns the hours of hunger removed. */
  feed(linesChanged: number, commitAt?: number): number {
    this.tick()
    const food = foodFor(linesChanged)
    const h = this.store.state.hunger
    h.hours = Math.max(0, h.hours - food)
    if (commitAt) h.lastCommitAt = Math.max(h.lastCommitAt ?? 0, commitAt)
    this.store.saveSoon()
    return food
  }

  stage(): HungerStage {
    const hours = this.store.state.hunger.hours
    if (hours >= this.s.starvingAfterHours) return 'starving'
    if (hours >= this.s.hungryAfterHours) return 'hungry'
    if (hours >= this.s.peckishAfterHours) return 'peckish'
    return 'full'
  }

  fullness(): number {
    const hours = this.store.state.hunger.hours
    return Math.max(0, Math.min(1, 1 - hours / Math.max(0.1, this.s.starvingAfterHours)))
  }

  quiet(): boolean {
    return inQuietHours(this.s)
  }
}
