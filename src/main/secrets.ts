/**
 * Rex's nose: finds things that shouldn't be on GitHub in file contents,
 * file names and commit diffs. Pure functions (no Electron), so they can be
 * tested with plain Node.
 */
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'

export type Severity = 'high' | 'medium'

/** One thing Rex sniffed out. The secret itself is never kept: only a masked preview and a fingerprint. */
export interface Hit {
  /** Stable fingerprint of rule + secret (or rule + path for risky files). */
  fp: string
  rule: string
  label: string
  severity: Severity
  path: string
  line: number | null
  /** e.g. "AKIA••••••••LE" */
  preview: string
}

interface Rule {
  id: string
  label: string
  severity: Severity
  re: RegExp
  /** Which capture group holds the secret (default 1). */
  group?: number
  /** Generic rules: skip placeholders and low-entropy values. */
  loose?: boolean
}

/** Token formats with a recognisable prefix: these are almost never false alarms. */
const RULES: Rule[] = [
  { id: 'private-key', label: 'Private key', severity: 'high', re: /-----BEGIN ((?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?)-----/g },
  { id: 'aws-key', label: 'AWS access key', severity: 'high', re: /\b((?:AKIA|ASIA)[0-9A-Z]{16})\b/g },
  { id: 'aws-secret', label: 'AWS secret key', severity: 'high', re: /aws_?secret_?access_?key["']?\s*[:=]\s*["']?([A-Za-z0-9/+=]{40})(?![A-Za-z0-9/+=])/gi },
  { id: 'github-token', label: 'GitHub token', severity: 'high', re: /\b((?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b/g },
  { id: 'openai-key', label: 'OpenAI API key', severity: 'high', re: /\b(sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{16,}T3BlbkFJ[A-Za-z0-9_-]{16,}|sk-proj-[A-Za-z0-9_-]{40,})\b/g },
  { id: 'anthropic-key', label: 'Anthropic API key', severity: 'high', re: /\b(sk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{80,})\b/g },
  { id: 'google-key', label: 'Google API key', severity: 'medium', re: /\b(AIza[0-9A-Za-z_-]{35})(?![0-9A-Za-z_-])/g },
  { id: 'slack-token', label: 'Slack token', severity: 'high', re: /\b(xox[abposr]-[0-9A-Za-z-]{10,})\b/g },
  { id: 'slack-webhook', label: 'Slack webhook', severity: 'high', re: /(https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]{16,})/g },
  { id: 'stripe-live', label: 'Stripe live key', severity: 'high', re: /\b((?:sk|rk)_live_[0-9a-zA-Z]{20,})\b/g },
  { id: 'stripe-test', label: 'Stripe test key', severity: 'medium', re: /\b(sk_test_[0-9a-zA-Z]{20,})\b/g },
  { id: 'sendgrid-key', label: 'SendGrid API key', severity: 'high', re: /\b(SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43})\b/g },
  { id: 'npm-token', label: 'npm token', severity: 'high', re: /\b(npm_[A-Za-z0-9]{36})\b/g },
  { id: 'twilio-key', label: 'Twilio API key', severity: 'medium', re: /\b(SK[0-9a-f]{32})\b/g },
  { id: 'mailgun-key', label: 'Mailgun API key', severity: 'medium', re: /\b(key-[0-9a-f]{32})\b/g },
  { id: 'discord-webhook', label: 'Discord webhook', severity: 'high', re: /(https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]{20,})/g },
  { id: 'telegram-token', label: 'Telegram bot token', severity: 'high', re: /\b(\d{8,10}:AA[0-9A-Za-z_-]{33})\b/g },
  // Databases and passwords: checked against placeholders.
  {
    id: 'db-url',
    label: 'Database URL with password',
    severity: 'high',
    re: /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|amqps?|mssql|sqlserver):\/\/[^\s:/@'"`]+:([^\s@'"`]+)@[^\s'"`]+/g,
    loose: true
  },
  {
    id: 'conn-string',
    label: 'Database connection string',
    severity: 'high',
    re: /(?:Server|Data Source|Host)\s*=[^;'"\n]+;[^'"\n]*?(?:Password|Pwd)\s*=\s*([^;'"\n]{3,})/gi,
    loose: true
  },
  {
    id: 'db-password',
    label: 'Database password',
    severity: 'high',
    re: /\b(?:DB_PASS(?:WORD)?|DATABASE_PASSWORD|MYSQL_(?:ROOT_)?PASSWORD|POSTGRES_PASSWORD|PGPASSWORD|MONGO(?:DB)?_PASSWORD|REDIS_PASSWORD)["']?\s*[:=,]\s*["']?([^"'\s,);]{4,})/gi,
    loose: true
  },
  { id: 'django-secret', label: 'Django SECRET_KEY', severity: 'medium', re: /\bSECRET_KEY\s*=\s*["']([^"']{20,})["']/g, loose: true },
  { id: 'url-password', label: 'Password in a URL', severity: 'medium', re: /\bhttps?:\/\/[^\s:/@'"`]+:([^\s@'"`/]{3,})@[\w.-]+\.[a-z]{2,}/gi, loose: true },
  {
    id: 'generic-secret',
    label: 'Hard-coded secret',
    severity: 'medium',
    re: /\b(?:password|passwd|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key)["']?\s*[:=]\s*["']([^"'\s]{8,})["']/gi,
    loose: true
  }
]

/** Values that are clearly not real secrets. */
const PLACEHOLDER =
  /example|sample|dummy|placeholder|your[_-]?|xxxx|\*{3}|•|changeme|change[_-]?me|<|>|\$\{|\{\{|%\(|process\.env|os\.environ|getenv|env\(|redacted|secret_here|password_here|^pass(word)?$|^secret$|^(test|demo|fake|todo|none|null|undefined|admin|root)$|^\[|^\.\.\./i
const KNOWN_FAKE = new Set(['AKIAIOSFODNN7EXAMPLE', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'])

function entropy(s: string): number {
  const counts = new Map<string, number>()
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1)
  let e = 0
  for (const n of counts.values()) e -= (n / s.length) * Math.log2(n / s.length)
  return e
}

/** "AKIA••••••••LE": enough to recognise it, never enough to use it. */
export function mask(secret: string): string {
  const s = secret.trim()
  if (s.length <= 8) return `${s.slice(0, 2)}••••`
  return `${s.slice(0, 4)}${'•'.repeat(Math.min(8, s.length - 6))}${s.slice(-2)}`
}

export const fingerprint = (rule: string, value: string) => createHash('sha256').update(`${rule}\0${value}`).digest('hex').slice(0, 16)

// --- files that shouldn't be committed at all ----------------------------------------------------
const ENV_FILE = /(^|\/)\.env(\.[\w-]+)?$/i
const ENV_SAFE = /\.(example|sample|template|dist|defaults?|tpl|schema|test|ci)$/i
const KEY_FILE = /(^|\/)(id_rsa|id_dsa|id_ecdsa|id_ed25519)$|\.(p12|pfx|jks|keystore|ppk|key)$/i
const CRED_FILE = /(^|\/)(\.git-credentials|\.netrc|_netrc|\.pypirc|\.htpasswd|credentials\.json|client_secrets?\.json|service[-_]?account[\w-]*\.json|[\w-]*firebase-adminsdk[\w-]*\.json)$|\.tfstate(\.backup)?$/i
const DB_FILE = /\.(sqlite3?|db|mdb|accdb|bak)$|(^|\/)dump\.rdb$|\.(sql|dump)$/i

/** Files we don't read (huge, generated, or full of hashes). */
const SKIP = /(^|\/)(node_modules|vendor|\.git|dist|build|\.next|coverage)\/|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|Cargo\.lock|poetry\.lock|go\.sum|Gemfile\.lock)$|\.min\.(js|css)$|\.map$/i

export function skipPath(path: string): boolean {
  return SKIP.test(path)
}

/** Risky by its name alone (or name + a peek at the content). */
export function riskyFile(path: string, text: string | null): Hit | null {
  const hit = (rule: string, label: string, severity: Severity): Hit => ({ fp: fingerprint(rule, path), rule, label, severity, path, line: null, preview: path.split('/').pop() ?? path })
  if (ENV_FILE.test(path) && !ENV_SAFE.test(path)) {
    // Only when it actually holds values (not an empty template).
    const filled = text === null || /^[ \t]*[A-Za-z_][\w.]*[ \t]*=[ \t]*["']?[^\s"'#]{3,}/m.test(text)
    return filled ? hit('env-file', '.env file with values', 'high') : null
  }
  if (KEY_FILE.test(path)) {
    if (text !== null && /\.key$/i.test(path) && !/PRIVATE KEY/.test(text)) return null
    return hit('key-file', 'Private key file', 'high')
  }
  if (CRED_FILE.test(path)) return hit('cred-file', 'Credentials file', 'high')
  if (/(^|\/)\.npmrc$/i.test(path) && text && /_authToken\s*=\s*[^\s$]{8,}|_password\s*=/.test(text)) return hit('npmrc', '.npmrc with a token', 'high')
  if (DB_FILE.test(path)) {
    if (/\.(sql|dump)$/i.test(path) && text !== null && !/\bINSERT INTO\b/i.test(text)) return null
    return hit('db-file', 'Database file or dump', 'medium')
  }
  return null
}

/** Every secret in a text, with 1-based line numbers (or `lineOf` to map positions to lines). */
export function scanText(path: string, text: string, lineOf?: (index: number) => number | null): Hit[] {
  const hits: Hit[] = []
  const seen = new Set<string>()
  const starts: number[] = [0]
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1)
  const line = (idx: number) => {
    if (lineOf) return lineOf(idx)
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= idx) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }
  for (const rule of RULES) {
    rule.re.lastIndex = 0
    for (const m of text.matchAll(rule.re)) {
      const value = (m[rule.group ?? 1] ?? m[0]).trim()
      if (!value || KNOWN_FAKE.has(value) || /EXAMPLE/.test(value)) continue
      if (rule.loose) {
        if (PLACEHOLDER.test(value)) continue
        if (rule.id === 'generic-secret' && (entropy(value) < 3.2 || !/\d/.test(value) || /^[a-z_.]+$/i.test(value))) continue
        if (rule.id === 'django-secret' && entropy(value) < 3.5) continue
      }
      const fp = fingerprint(rule.id, value)
      if (seen.has(fp)) continue
      seen.add(fp)
      const preview = rule.id === 'private-key' ? `${value.toLowerCase()} block` : mask(value)
      hits.push({ fp, rule: rule.id, label: rule.label, severity: rule.severity, path, line: line(m.index ?? 0), preview })
    }
  }
  // A more specific rule already covers this spot: drop the generic one.
  const specific = new Set(hits.filter((h) => h.rule !== 'generic-secret').map((h) => h.line))
  return hits.filter((h) => h.rule !== 'generic-secret' || !specific.has(h.line))
}

/** Everything wrong with one file: its name and its contents. */
export function scanFile(path: string, text: string | null): Hit[] {
  const hits: Hit[] = []
  const risky = riskyFile(path, text)
  if (risky) hits.push(risky)
  if (text !== null) hits.push(...scanText(path, text))
  return hits
}

// --- GitHub tarballs ------------------------------------------------------------------------------
export interface TarFile {
  path: string
  size: number
  /** UTF-8 text, or null for binary and oversized files. */
  text: string | null
}

const MAX_FILE = 1024 * 1024

/** Read a .tar.gz (as GitHub serves a repo), dropping the top "owner-repo-sha/" folder. */
export function readTarGz(gz: Buffer): TarFile[] {
  const tar = gunzipSync(gz)
  const out: TarFile[] = []
  let off = 0
  let longName: string | null = null
  const str = (b: Buffer) => b.toString('utf8').replace(/\0.*$/s, '')
  while (off + 512 <= tar.length) {
    const head = tar.subarray(off, off + 512)
    if (head.every((b) => b === 0)) break
    const size = parseInt(str(head.subarray(124, 136)).trim() || '0', 8)
    const type = String.fromCharCode(head[156] || 48)
    const body = tar.subarray(off + 512, off + 512 + size)
    off += 512 + Math.ceil(size / 512) * 512
    if (type === 'x') {
      const m = /\d+ path=([^\n]+)\n/.exec(body.toString('utf8'))
      if (m) longName = m[1]
      continue
    }
    if (type === 'L') {
      longName = str(body)
      continue
    }
    if (type === 'g') continue
    const prefix = str(head.subarray(345, 500))
    const raw = longName ?? (prefix ? `${prefix}/${str(head.subarray(0, 100))}` : str(head.subarray(0, 100)))
    longName = null
    if (type !== '0' && type !== '\0' && type !== '7') continue
    const path = raw.split('/').slice(1).join('/')
    if (!path || skipPath(path)) continue
    const binary = size > MAX_FILE || body.subarray(0, 8000).includes(0)
    out.push({ path, size, text: binary ? null : body.toString('utf8') })
  }
  return out
}

/** Lines a commit added, from its unified diff, with their line numbers in the new file. */
export function addedLines(patch: string): { text: string; lines: number[] } {
  const keep: string[] = []
  const lines: number[] = []
  let n = 0
  for (const l of patch.split('\n')) {
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(l)
    if (h) {
      n = Number(h[1])
      continue
    }
    if (l.startsWith('+')) {
      keep.push(l.slice(1))
      lines.push(n)
      n++
    } else if (!l.startsWith('-')) n++
  }
  return { text: keep.join('\n'), lines }
}

/** Secrets a commit added to a file (scans only its "+" lines). */
export function scanPatch(path: string, patch: string): Hit[] {
  const { text, lines } = addedLines(patch)
  const starts: number[] = [0]
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1)
  const lineOf = (idx: number) => {
    let k = 0
    while (k + 1 < starts.length && starts[k + 1] <= idx) k++
    return lines[k] ?? null
  }
  return scanText(path, text, lineOf)
}
