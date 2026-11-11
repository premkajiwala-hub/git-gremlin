import { GRID_MARK } from '../../shared/constants'
import type { PetConfig, PetStatus } from '../../shared/types'
import { localDate, moodFrom, type GitHubData } from '../github'

const RANDOM_LINES = [
  'BEEP BOOP. COMMIT DETECTED?',
  'SMALL COMMITS = HAPPY CIRCUITS.',
  'HAVE YOU TRIED GIT ADD -P?',
  'MERGE CONFLICTS MAKE MY FANS SPIN.',
  'MEOW.EXE HAS STARTED.',
  'MY TAIL IS 40% CABLE.',
  'I DREAM IN GREEN SQUARES.',
  'WIP COMMITS STILL COUNT AS FOOD.',
  'PURRING AT 60 HZ.'
]
const EAT_LINES = ['NOM.EXE COMPLETE!', 'CRUNCHY COMMIT!', 'BYTES DIGESTED!', 'MMM, FRESH CODE.']
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)]

/** Catbot's mood and status report, straight from today's square on the GitHub chart. */
export function catbotStatus(cfg: PetConfig, data: GitHubData, linked: boolean): PetStatus {
  const mood = moodFrom(data.days)
  const connected = linked && data.days.length > 0
  const n = mood.todayCount
  const report = connected
    ? [
        `TODAY: ${n} CONTRIBUTION${n === 1 ? '' : 'S'}`,
        `MOOD: ${mood.stage === 'fed' ? `FED, LEVEL ${mood.level}/4` : mood.stage.toUpperCase()}`,
        `STREAK: ${mood.streak} DAY${mood.streak === 1 ? '' : 'S'}`,
        'LAST 7 DAYS:',
        GRID_MARK,
        '',
        `> ${mood.stage === 'fed' ? pick(RANDOM_LINES) : 'NO CONTRIBUTIONS TODAY. ONE COMMIT WOULD FEED ME!'}`
      ]
    : ['GITHUB NOT LINKED YET.', '', '> CLICK ME, THEN SIGN IN WITH GITHUB.']
  return {
    name: cfg.name,
    stage: connected ? mood.stage : 'fed',
    level: connected ? mood.level : 1,
    report,
    grid: connected ? mood.week : null,
    alert: connected ? null : 'SIGN IN WITH GITHUB SO I KNOW IF YOU CODED TODAY! CLICK ME.',
    busy: null,
    connected
  }
}

/** New contributions since the last check today, or 0. */
export function newContributions(data: GitHubData, previous: GitHubData): { delta: number; level: number; prevLevel: number } {
  const today = localDate()
  const before = previous.days.find((d) => d.date === today)
  const now = data.days.find((d) => d.date === today)
  const same = previous.login === data.login && previous.days.length > 0
  const delta = same ? (now?.count ?? 0) - (before?.count ?? 0) : 0
  return { delta: Math.max(0, delta), level: now?.level ?? 0, prevLevel: before?.level ?? 0 }
}

export function catbotFeedText(delta: number): string {
  return `${pick(EAT_LINES)} +${delta} CONTRIBUTION${delta === 1 ? '' : 'S'}`
}
