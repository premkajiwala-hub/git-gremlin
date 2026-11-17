/**
 * Squirrel's map: which of your projects runs on which hosting / cloud
 * platform, found from files in the repo (no sign-in), and what each
 * platform's free tier allows. Pure functions (no Electron).
 *
 * Secrets are never read into memory as values: .env files are only matched
 * for service host names and variable names.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export type PlatformId =
  | 'cloudflare'
  | 'supabase'
  | 'cloudinary'
  | 'firebase'
  | 'github-actions'
  | 'vercel'
  | 'netlify'
  | 'render'
  | 'railway'
  | 'fly'
  | 'mongodb-atlas'
  | 'neon'
  | 'upstash'

export interface FreeTierRule {
  /** What is limited, e.g. "Workers requests". */
  what: string
  /** The free allowance, e.g. "100,000 a day". */
  limit: string
  resets: 'daily' | 'monthly' | null
}

export interface PlatformInfo {
  id: PlatformId
  name: string
  /** Known free-tier limits (only figures from the platform's own docs). */
  rules: FreeTierRule[]
  /** The catch worth knowing on the free tier, if any. */
  watch: string | null
  /** Where to see usage on the platform's own site. */
  usageUrl: string
  /** Squirrel can read live usage with a read-only key. */
  live: boolean
}

/** Free-tier facts as the platforms document them (checked November 2026). */
export const PLATFORMS: Record<PlatformId, PlatformInfo> = {
  cloudflare: {
    id: 'cloudflare',
    name: 'Cloudflare Workers',
    rules: [
      { what: 'Workers + Pages Functions requests', limit: '100,000 a day', resets: 'daily' },
      { what: 'CPU time', limit: '10 ms per request', resets: null }
    ],
    watch: 'Over 100,000 requests a day, Workers return errors until midnight UTC.',
    usageUrl: 'https://dash.cloudflare.com/',
    live: true
  },
  supabase: {
    id: 'supabase',
    name: 'Supabase',
    rules: [{ what: 'Database size', limit: '500 MB', resets: null }],
    watch: 'Free projects pause after 7 days of low activity.',
    usageUrl: 'https://supabase.com/dashboard/projects',
    live: true
  },
  cloudinary: {
    id: 'cloudinary',
    name: 'Cloudinary',
    rules: [{ what: 'Credits (storage, bandwidth and transformations share them)', limit: '25 a month', resets: 'monthly' }],
    watch: 'Storage, bandwidth and transformations all draw on the same 25 credits.',
    usageUrl: 'https://console.cloudinary.com/settings/billing',
    live: true
  },
  firebase: {
    id: 'firebase',
    name: 'Firebase (Spark)',
    rules: [
      { what: 'Firestore reads', limit: '50,000 a day', resets: 'daily' },
      { what: 'Firestore writes', limit: '20,000 a day', resets: 'daily' },
      { what: 'Firestore deletes', limit: '20,000 a day', resets: 'daily' }
    ],
    watch: 'Daily Firestore quotas reset around midnight Pacific time; past them, requests fail.',
    usageUrl: 'https://console.firebase.google.com/',
    live: false
  },
  'github-actions': {
    id: 'github-actions',
    name: 'GitHub Actions',
    rules: [{ what: 'Minutes on public repos', limit: 'free, no limit', resets: null }],
    watch: "Only private repos use your account's monthly Actions minutes.",
    usageUrl: 'https://github.com/settings/billing',
    live: false
  },
  vercel: { id: 'vercel', name: 'Vercel', rules: [], watch: 'The Hobby plan has monthly usage limits.', usageUrl: 'https://vercel.com/dashboard/usage', live: false },
  netlify: { id: 'netlify', name: 'Netlify', rules: [], watch: 'The free plan has monthly bandwidth and build limits.', usageUrl: 'https://app.netlify.com/', live: false },
  render: { id: 'render', name: 'Render', rules: [], watch: 'Free web services sleep when idle and wake slowly.', usageUrl: 'https://dashboard.render.com/', live: false },
  railway: { id: 'railway', name: 'Railway', rules: [], watch: null, usageUrl: 'https://railway.com/dashboard', live: false },
  fly: { id: 'fly', name: 'Fly.io', rules: [], watch: null, usageUrl: 'https://fly.io/dashboard', live: false },
  'mongodb-atlas': { id: 'mongodb-atlas', name: 'MongoDB Atlas', rules: [], watch: 'Free (M0) clusters have a small storage cap.', usageUrl: 'https://cloud.mongodb.com/', live: false },
  neon: { id: 'neon', name: 'Neon', rules: [], watch: null, usageUrl: 'https://console.neon.tech/', live: false },
  upstash: { id: 'upstash', name: 'Upstash', rules: [], watch: null, usageUrl: 'https://console.upstash.com/', live: false }
}

/** Files that prove a platform is used. */
const FILES: [PlatformId, string[]][] = [
  ['cloudflare', ['wrangler.toml', 'wrangler.json', 'wrangler.jsonc']],
  ['supabase', ['supabase/config.toml']],
  ['firebase', ['firebase.json', '.firebaserc']],
  ['vercel', ['vercel.json', '.vercel/project.json']],
  ['netlify', ['netlify.toml', '.netlify/state.json']],
  ['render', ['render.yaml']],
  ['railway', ['railway.json', 'railway.toml']],
  ['fly', ['fly.toml']]
]

/** Host names and variable names in .env files (values are never kept). */
const ENV_HINTS: [PlatformId, RegExp][] = [
  ['supabase', /\.supabase\.co\b|^\s*(NEXT_PUBLIC_|VITE_)?SUPABASE_/m],
  ['cloudinary', /cloudinary:\/\/|res\.cloudinary\.com|^\s*(NEXT_PUBLIC_|VITE_)?CLOUDINARY_/m],
  ['firebase', /firebaseapp\.com|^\s*(NEXT_PUBLIC_|VITE_|REACT_APP_)?FIREBASE_/m],
  ['mongodb-atlas', /mongodb\.net/],
  ['neon', /neon\.tech/],
  ['upstash', /upstash\.io/],
  ['cloudflare', /^\s*CLOUDFLARE_/m]
]

/** npm packages that prove a platform is used. */
const PACKAGES: [PlatformId, (name: string) => boolean][] = [
  ['supabase', (n) => n === '@supabase/supabase-js'],
  ['firebase', (n) => n === 'firebase' || n === 'firebase-admin'],
  ['cloudinary', (n) => n === 'cloudinary' || n.startsWith('next-cloudinary')],
  ['cloudflare', (n) => n === 'wrangler'],
  ['vercel', (n) => n === 'vercel' || n.startsWith('@vercel/')],
  ['netlify', (n) => n === 'netlify-cli' || n.startsWith('@netlify/')],
  ['upstash', (n) => n.startsWith('@upstash/')]
]

const ENV_FILES = ['.env', '.env.local', '.env.production', '.env.development']
/** Also look one folder down (monorepos: frontend/, backend/, apps/x...). */
const SUBDIRS = (root: string) => {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
      .map((d) => d.name)
      .slice(0, 12)
  } catch {
    return []
  }
}

export interface Found {
  id: PlatformId
  /** How Squirrel knows, e.g. "wrangler.toml" or ".env: *.supabase.co". */
  evidence: string
  /** A platform-side project name or id, when the repo says (Firebase project id). */
  ref?: string
}

const readText = (p: string) => {
  try {
    return readFileSync(p, 'utf8').slice(0, 200_000)
  } catch {
    return null
  }
}

/** Which platforms a project uses. */
export function detect(root: string): Found[] {
  const found = new Map<PlatformId, Found>()
  const add = (f: Found) => {
    if (!found.has(f.id)) found.set(f.id, f)
  }
  for (const dir of ['', ...SUBDIRS(root)]) {
    const base = dir ? join(root, dir) : root
    const where = (file: string) => (dir ? `${dir}/${file}` : file)
    for (const [id, files] of FILES) for (const f of files) if (existsSync(join(base, f))) add({ id, evidence: where(f) })
    if (!dir && existsSync(join(base, '.github', 'workflows'))) add({ id: 'github-actions', evidence: '.github/workflows' })
    for (const env of ENV_FILES) {
      const text = readText(join(base, env))
      if (!text) continue
      for (const [id, re] of ENV_HINTS) if (re.test(text)) add({ id, evidence: where(env) })
    }
    const pkg = readText(join(base, 'package.json'))
    if (pkg) {
      try {
        const j = JSON.parse(pkg)
        const names = Object.keys({ ...(j.dependencies ?? {}), ...(j.devDependencies ?? {}) })
        for (const [id, test] of PACKAGES) {
          const n = names.find(test)
          if (n) add({ id, evidence: `${where('package.json')}: ${n}` })
        }
      } catch {
        // not JSON
      }
    }
    // The Firebase project id, so Squirrel can link straight to its usage page.
    const rc = readText(join(base, '.firebaserc'))
    if (rc) {
      try {
        const ref = JSON.parse(rc)?.projects?.default
        const f = found.get('firebase')
        // Skip template placeholders like "your-project-id".
        if (f && typeof ref === 'string' && !/your|example|placeholder|<|project-id$/i.test(ref)) f.ref = ref
      } catch {
        // ignore
      }
    }
  }
  return [...found.values()]
}

/** A platform's usage page, deep-linked when Squirrel knows the project. */
export function usageLink(id: PlatformId, ref?: string): string {
  if (id === 'firebase' && ref) return `https://console.firebase.google.com/project/${encodeURIComponent(ref)}/usage`
  return PLATFORMS[id].usageUrl
}

/** Every site Squirrel may open in the browser. */
export const SAFE_HOSTS = [
  'dash.cloudflare.com',
  'supabase.com',
  'console.cloudinary.com',
  'console.firebase.google.com',
  'github.com',
  'vercel.com',
  'app.netlify.com',
  'dashboard.render.com',
  'railway.com',
  'fly.io',
  'cloud.mongodb.com',
  'console.neon.tech',
  'console.upstash.com',
  'developers.cloudflare.com',
  'cloudinary.com'
]
