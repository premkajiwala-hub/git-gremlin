/**
 * Squirrel's live usage readers, one per platform, each with a read-only key
 * the user pasted. Only GET requests (and Cloudflare's read-only analytics
 * query). `fetcher` is Electron's net.fetch in the app, plain fetch in tests.
 */
export type Fetcher = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<Response>

export interface Meter {
  /** Stable key for history, e.g. "cloudflare:requests". */
  key: string
  platform: 'supabase' | 'cloudinary' | 'cloudflare'
  label: string
  used: number
  limit: number
  unit: string
  resets: 'daily' | 'monthly' | null
  /** When the allowance resets (ms), if known. */
  resetAt: number | null
}

/** Not a usage number but something to know (a paused or quiet Supabase project). */
export interface Notice {
  key: string
  platform: 'supabase' | 'cloudinary' | 'cloudflare'
  project: string
  /** active | paused | quiet | unhealthy */
  state: 'active' | 'paused' | 'quiet' | 'unhealthy'
  text: string
  link: string | null
}

export interface Reading {
  meters: Meter[]
  notices: Notice[]
  /** A label for the connection, e.g. "my-cloud" or "2 projects". */
  label: string
}

async function json<T>(res: Response, what: string): Promise<T> {
  if (res.status === 400 || res.status === 401 || res.status === 403) throw new Error(`${what} didn't accept the key (it may be wrong, expired or missing a read permission).`)
  if (!res.ok) throw new Error(`${what} answered ${res.status}.`)
  return (await res.json()) as T
}

const startOfUtcDay = (now: number) => {
  const d = new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

// --- Supabase -------------------------------------------------------------------------------------
/** How many quiet days before Squirrel warns that a free project may pause (it pauses at 7). */
export const QUIET_DAYS = 5

/** Project status, and quiet projects (no API requests for days) that are about to be paused. */
export async function readSupabase(fetcher: Fetcher, token: string, now = Date.now()): Promise<Reading> {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  const projects = await json<{ ref?: string; id?: string; name: string; status: string }[]>(
    await fetcher('https://api.supabase.com/v1/projects', { headers }),
    'Supabase'
  )
  const notices: Notice[] = []
  for (const p of projects) {
    const ref = p.ref ?? p.id ?? ''
    const link = `https://supabase.com/dashboard/project/${encodeURIComponent(ref)}`
    if (p.status === 'INACTIVE' || p.status === 'PAUSING' || p.status === 'GOING_DOWN') {
      notices.push({ key: `supabase:${ref}`, platform: 'supabase', project: p.name, state: 'paused', text: `${p.name} is paused. Restore it from the Supabase dashboard.`, link })
      continue
    }
    if (p.status === 'ACTIVE_UNHEALTHY' || p.status === 'INIT_FAILED' || p.status === 'RESTORE_FAILED') {
      notices.push({ key: `supabase:${ref}`, platform: 'supabase', project: p.name, state: 'unhealthy', text: `${p.name} is unhealthy (${p.status.toLowerCase()}).`, link })
      continue
    }
    // When was it last used? (Days with any auth/REST/realtime/storage requests.)
    let lastActive: number | null = null
    try {
      const usage = await json<{ result?: { timestamp: string; total_auth_requests?: number; total_rest_requests?: number; total_realtime_requests?: number; total_storage_requests?: number }[] }>(
        await fetcher(`https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}/analytics/endpoints/usage.api-counts?interval=7day`, { headers }),
        'Supabase usage'
      )
      for (const r of usage.result ?? []) {
        const n = (r.total_auth_requests ?? 0) + (r.total_rest_requests ?? 0) + (r.total_realtime_requests ?? 0) + (r.total_storage_requests ?? 0)
        const t = Date.parse(r.timestamp)
        if (n > 0 && Number.isFinite(t)) lastActive = Math.max(lastActive ?? 0, t)
      }
      const quietDays = lastActive === null ? 7 : Math.floor((now - lastActive) / 86_400_000)
      if (quietDays >= QUIET_DAYS) {
        notices.push({
          key: `supabase:${ref}`,
          platform: 'supabase',
          project: p.name,
          state: 'quiet',
          text: `${p.name} has had no requests for ${quietDays >= 7 ? '7+' : quietDays} days. Free projects pause after 7 quiet days.`,
          link
        })
        continue
      }
    } catch {
      // Usage counts need an extra token permission; status alone still works.
    }
    notices.push({ key: `supabase:${ref}`, platform: 'supabase', project: p.name, state: 'active', text: `${p.name} is active.`, link })
  }
  return { meters: [], notices, label: `${projects.length} project${projects.length === 1 ? '' : 's'}` }
}

// --- Cloudinary -----------------------------------------------------------------------------------
/** Parse cloudinary://KEY:SECRET@CLOUD_NAME (the CLOUDINARY_URL format). */
export function parseCloudinaryUrl(text: string): { key: string; secret: string; cloud: string } | null {
  const m = /^cloudinary:\/\/([^:\s]+):([^@\s]+)@([\w-]+)\s*$/.exec(text.trim())
  return m ? { key: m[1], secret: m[2], cloud: m[3] } : null
}

type CloudinaryUsage = {
  plan?: string
  credits?: { usage: number; limit: number; used_percent?: number }
  storage?: { usage: number; limit?: number; used_percent?: number }
  bandwidth?: { usage: number; limit?: number; used_percent?: number }
  transformations?: { usage: number; limit?: number; used_percent?: number }
}

const nextMonthUtc = (now: number) => {
  const d = new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
}

/** Credits used this month (free plan), or the separate quotas on plans without credits. */
export async function readCloudinary(fetcher: Fetcher, cloudinaryUrl: string, now = Date.now()): Promise<Reading> {
  const c = parseCloudinaryUrl(cloudinaryUrl)
  if (!c) throw new Error('That doesn\'t look like a CLOUDINARY_URL (cloudinary://API_KEY:API_SECRET@CLOUD_NAME).')
  const auth = Buffer.from(`${c.key}:${c.secret}`).toString('base64')
  const u = await json<CloudinaryUsage>(
    await fetcher(`https://api.cloudinary.com/v1_1/${encodeURIComponent(c.cloud)}/usage`, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } }),
    'Cloudinary'
  )
  const meters: Meter[] = []
  const reset = nextMonthUtc(now)
  if (u.credits && u.credits.limit) {
    meters.push({ key: 'cloudinary:credits', platform: 'cloudinary', label: 'Credits this month', used: u.credits.usage, limit: u.credits.limit, unit: 'credits', resets: 'monthly', resetAt: reset })
  } else {
    for (const [k, label, unit] of [
      ['storage', 'Storage', 'bytes'],
      ['bandwidth', 'Bandwidth', 'bytes'],
      ['transformations', 'Transformations', '']
    ] as const) {
      const q = u[k]
      if (q?.limit) meters.push({ key: `cloudinary:${k}`, platform: 'cloudinary', label, used: q.usage, limit: q.limit, unit, resets: k === 'storage' ? null : 'monthly', resetAt: k === 'storage' ? null : reset })
    }
  }
  return { meters, notices: [], label: `${c.cloud}${u.plan ? ` · ${u.plan} plan` : ''}` }
}

// --- Cloudflare -----------------------------------------------------------------------------------
export const CLOUDFLARE_FREE_REQUESTS = 100_000

/** Workers (and Pages Functions) requests today, against the free 100,000 a day. */
/** Cloudflare's Global API Key (37 hex characters) or an Origin CA key: full-access keys Squirrel refuses. */
export function cloudflareKeyProblem(key: string): string | null {
  if (/^[0-9a-f]{37}$/i.test(key))
    return "That's your Cloudflare Global API Key. It can change everything in your account, so Squirrel won't use it. Create an API token instead: Create Token > Custom token, with the permission Account > Account Analytics > Read."
  if (/^v1\.0-/.test(key)) return "That's an Origin CA key. Squirrel needs an API token with the permission Account > Account Analytics > Read."
  return null
}

export async function readCloudflare(fetcher: Fetcher, token: string, now = Date.now()): Promise<Reading> {
  const problem = cloudflareKeyProblem(token)
  if (problem) throw new Error(problem)
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' }
  const accounts = await json<{ success: boolean; result: { id: string; name: string }[] }>(
    await fetcher('https://api.cloudflare.com/client/v4/accounts?per_page=50', { headers }),
    'Cloudflare'
  )
  const dayStart = startOfUtcDay(now)
  const meters: Meter[] = []
  for (const a of accounts.result ?? []) {
    const query = `query ($tag: string, $start: string, $end: string) { viewer { accounts(filter: {accountTag: $tag}) { workersInvocationsAdaptive(limit: 10000, filter: {datetime_geq: $start, datetime_leq: $end}) { sum { requests } } } } }`
    const body = JSON.stringify({ query, variables: { tag: a.id, start: new Date(dayStart).toISOString(), end: new Date(now).toISOString() } })
    const r = await json<{ data?: { viewer?: { accounts?: { workersInvocationsAdaptive?: { sum?: { requests?: number } }[] }[] } }; errors?: { message: string }[] | null }>(
      await fetcher('https://api.cloudflare.com/client/v4/graphql', { method: 'POST', headers, body }),
      'Cloudflare analytics'
    )
    if (r.errors?.length) throw new Error(`Cloudflare analytics: ${r.errors[0].message}`)
    const rows = r.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? []
    const used = rows.reduce((n, row) => n + (row.sum?.requests ?? 0), 0)
    meters.push({
      key: `cloudflare:${a.id}:requests`,
      platform: 'cloudflare',
      label: accounts.result.length > 1 ? `Workers requests today · ${a.name}` : 'Workers requests today',
      used,
      limit: CLOUDFLARE_FREE_REQUESTS,
      unit: 'requests',
      resets: 'daily',
      resetAt: dayStart + 86_400_000
    })
  }
  return { meters, notices: [], label: accounts.result.map((a) => a.name).join(', ') || 'no accounts' }
}

// --- forecasting ----------------------------------------------------------------------------------
/**
 * When a meter will run out at the current pace (ms), or null if it won't
 * before it resets. `periodStart` is when the current allowance started.
 */
export function runsOutAt(m: Meter, periodStart: number, now = Date.now()): number | null {
  if (m.used >= m.limit) return now
  const elapsed = now - periodStart
  if (elapsed <= 0 || m.used <= 0) return null
  const rate = m.used / elapsed
  const at = now + (m.limit - m.used) / rate
  return m.resetAt !== null && at >= m.resetAt ? null : at
}

/** When the current allowance period began. */
export function periodStart(m: Meter, now = Date.now()): number {
  const d = new Date(now)
  if (m.resets === 'daily') return startOfUtcDay(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
}
