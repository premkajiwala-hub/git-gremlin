/**
 * Which programs are listening on which TCP ports, and what they are.
 *
 * Everything is read straight from Windows through koffi (no child process
 * per check): the listening sockets (iphlpapi GetExtendedTcpTable), every
 * process and its parent (a Toolhelp snapshot), and for processes we're
 * allowed to open, the exe, command line, working folder and start time
 * (from the process environment block). Falls back to `netstat -ano` if the
 * FFI isn't available.
 */
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, parse } from 'node:path'
import koffi from 'koffi'

type Fn = (...args: any[]) => any

interface Native {
  GetExtendedTcpTable: Fn
  CreateToolhelp32Snapshot: Fn
  Process32FirstW: Fn
  Process32NextW: Fn
  OpenProcess: Fn
  CloseHandle: Fn
  ReadProcessMemory: Fn
  NtQueryInformationProcess: Fn
  GetProcessTimes: Fn
  QueryFullProcessImageNameW: Fn
}

let w: Native | null = null
try {
  const k32 = koffi.load('kernel32.dll')
  const ip = koffi.load('iphlpapi.dll')
  const nt = koffi.load('ntdll.dll')
  w = {
    GetExtendedTcpTable: ip.func(
      'uint32_t __stdcall GetExtendedTcpTable(void *table, _Inout_ uint32_t *size, bool order, uint32_t af, int cls, uint32_t reserved)'
    ),
    CreateToolhelp32Snapshot: k32.func('intptr_t __stdcall CreateToolhelp32Snapshot(uint32_t flags, uint32_t pid)'),
    Process32FirstW: k32.func('bool __stdcall Process32FirstW(intptr_t snap, void *entry)'),
    Process32NextW: k32.func('bool __stdcall Process32NextW(intptr_t snap, void *entry)'),
    OpenProcess: k32.func('intptr_t __stdcall OpenProcess(uint32_t access, bool inherit, uint32_t pid)'),
    CloseHandle: k32.func('bool __stdcall CloseHandle(intptr_t h)'),
    ReadProcessMemory: k32.func('bool __stdcall ReadProcessMemory(intptr_t h, uintptr_t addr, void *buf, uintptr_t size, _Out_ uintptr_t *read)'),
    NtQueryInformationProcess: nt.func('long __stdcall NtQueryInformationProcess(intptr_t h, int cls, void *buf, uint32_t len, _Out_ uint32_t *ret)'),
    GetProcessTimes: k32.func('bool __stdcall GetProcessTimes(intptr_t h, _Out_ uint64_t *c, _Out_ uint64_t *e, _Out_ uint64_t *k, _Out_ uint64_t *u)'),
    QueryFullProcessImageNameW: k32.func('bool __stdcall QueryFullProcessImageNameW(intptr_t h, uint32_t flags, void *buf, _Inout_ uint32_t *size)')
  }
} catch (err) {
  console.warn('[ports] koffi unavailable, using netstat:', err)
  w = null
}

// --- listening sockets ------------------------------------------------------------------------
export interface Listener {
  port: number
  address: string
  pid: number
}

const ntohs = (v: number) => ((v & 0xff) << 8) | ((v >> 8) & 0xff)

function tcpTable(af: 2 | 23): Listener[] {
  if (!w) return []
  const size = [0]
  w.GetExtendedTcpTable(null, size, false, af, 3 /* TCP_TABLE_OWNER_PID_LISTENER */, 0)
  for (let attempt = 0; attempt < 3; attempt++) {
    const buf = Buffer.alloc(size[0] + 1024)
    size[0] = buf.length
    const rc = w.GetExtendedTcpTable(buf, size, false, af, 3, 0)
    if (rc === 122 /* ERROR_INSUFFICIENT_BUFFER */) continue
    if (rc !== 0) return []
    const n = buf.readUInt32LE(0)
    const out: Listener[] = []
    for (let i = 0; i < n; i++) {
      if (af === 2) {
        const o = 4 + i * 24
        const a = buf.subarray(o + 4, o + 8)
        out.push({ address: `${a[0]}.${a[1]}.${a[2]}.${a[3]}`, port: ntohs(buf.readUInt32LE(o + 8)), pid: buf.readUInt32LE(o + 20) })
      } else {
        const o = 4 + i * 56
        const a = buf.subarray(o, o + 16)
        const groups = Array.from({ length: 8 }, (_, g) => a.readUInt16BE(g * 2).toString(16))
        const address = groups.every((g) => g === '0') ? '::' : groups.join(':') === '0:0:0:0:0:0:0:1' ? '::1' : groups.join(':')
        out.push({ address, port: ntohs(buf.readUInt32LE(o + 20)), pid: buf.readUInt32LE(o + 52) })
      }
    }
    return out
  }
  return []
}

function netstat(): Promise<Listener[]> {
  return new Promise((done) => {
    execFile('netstat', ['-ano', '-p', 'TCP'], { windowsHide: true, timeout: 5000 }, (_err, out4) => {
      execFile('netstat', ['-ano', '-p', 'TCPv6'], { windowsHide: true, timeout: 5000 }, (_err2, out6) => {
        const out: Listener[] = []
        for (const line of `${out4 ?? ''}\n${out6 ?? ''}`.split(/\r?\n/)) {
          const m = /^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)/.exec(line)
          if (m) out.push({ address: m[1].replace(/^\[|\]$/g, ''), port: Number(m[2]), pid: Number(m[3]) })
        }
        done(out)
      })
    })
  })
}

/** Every listening TCP socket (IPv4 and IPv6). */
export async function listeners(): Promise<Listener[]> {
  if (!w) return netstat()
  return [...tcpTable(2), ...tcpTable(23)]
}

// --- processes --------------------------------------------------------------------------------
export interface Proc {
  pid: number
  ppid: number
  /** Image name, e.g. "node.exe". */
  name: string
}

/** Every running process with its parent (a Toolhelp snapshot). */
export function processes(): Map<number, Proc> {
  const out = new Map<number, Proc>()
  if (!w) return out
  const snap = w.CreateToolhelp32Snapshot(2 /* TH32CS_SNAPPROCESS */, 0)
  if (!snap || snap === -1) return out
  try {
    const e = Buffer.alloc(568)
    e.writeUInt32LE(568, 0)
    let ok = w.Process32FirstW(snap, e)
    while (ok) {
      const pid = e.readUInt32LE(8)
      const ppid = e.readUInt32LE(32)
      const raw = e.toString('utf16le', 44, 44 + 520)
      out.set(pid, { pid, ppid, name: raw.slice(0, raw.indexOf('\0') >>> 0) })
      ok = w.Process32NextW(snap, e)
    }
  } finally {
    w.CloseHandle(snap)
  }
  return out
}

export interface ProcDetails {
  exe: string | null
  cmd: string | null
  cwd: string | null
  /** Start time (ms), or null. */
  started: number | null
  /** We couldn't open it at all (a service, admin or system process): GitGremlin can't stop it. */
  locked: boolean
}

const PROCESS_QUERY_INFORMATION = 0x0400
const PROCESS_QUERY_LIMITED = 0x1000
const PROCESS_VM_READ = 0x0010

function readMem(h: unknown, addr: number, size: number): Buffer | null {
  if (!w || !addr) return null
  const buf = Buffer.alloc(size)
  return w.ReadProcessMemory(h, addr, buf, size, [0]) ? buf : null
}

/** A UNICODE_STRING (64-bit layout) at `off` inside `b`, read from the other process. */
function unicode(h: unknown, b: Buffer, off: number): string | null {
  const len = b.readUInt16LE(off)
  const ptr = Number(b.readBigUInt64LE(off + 8))
  if (!len || !ptr) return null
  return readMem(h, ptr, len)?.toString('utf16le') ?? null
}

function startTime(h: unknown): number | null {
  const c = [0n]
  if (!w!.GetProcessTimes(h, c, [0n], [0n], [0n])) return null
  return Number((BigInt(c[0]) - 116444736000000000n) / 10000n)
}

/** Exe, command line, working folder and start time of a process (what Windows lets us read). */
export function details(pid: number): ProcDetails {
  const none: ProcDetails = { exe: null, cmd: null, cwd: null, started: null, locked: true }
  if (!w || pid <= 4) return none
  let h = w.OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, pid)
  let full = true
  if (!h) {
    h = w.OpenProcess(PROCESS_QUERY_LIMITED, false, pid)
    full = false
  }
  if (!h) return none
  try {
    const out: ProcDetails = { exe: null, cmd: null, cwd: null, started: startTime(h), locked: false }
    const nb = Buffer.alloc(2048)
    const size = [1024]
    if (w.QueryFullProcessImageNameW(h, 0, nb, size)) out.exe = nb.toString('utf16le', 0, size[0] * 2)
    if (!full) return out
    // PROCESS_BASIC_INFORMATION -> PEB -> RTL_USER_PROCESS_PARAMETERS (64-bit layout).
    const pbi = Buffer.alloc(48)
    if (w.NtQueryInformationProcess(h, 0, pbi, 48, [0]) !== 0) return out
    const peb = readMem(h, Number(pbi.readBigUInt64LE(8)), 0x28)
    const params = peb && readMem(h, Number(peb.readBigUInt64LE(0x20)), 0x80)
    if (params) {
      out.cwd = unicode(h, params, 0x38)
      out.cmd = unicode(h, params, 0x70)
    }
    return out
  } catch {
    return none
  } finally {
    w.CloseHandle(h)
  }
}

/** Just the start time (cheap; works for most processes). */
export function started(pid: number): number | null {
  if (!w || pid <= 4) return null
  const h = w.OpenProcess(PROCESS_QUERY_LIMITED, false, pid)
  if (!h) return null
  try {
    return startTime(h)
  } finally {
    w.CloseHandle(h)
  }
}

// --- what is it? ------------------------------------------------------------------------------
/** Programs that run code you're developing. */
const RUNTIMES = new Set(
  [
    'node', 'bun', 'deno', 'python', 'pythonw', 'py', 'java', 'javaw', 'dotnet', 'ruby', 'php', 'php-cgi', 'go', 'air',
    'uvicorn', 'gunicorn', 'flask', 'hugo', 'caddy', 'nginx', 'httpd', 'rails', 'puma', 'esbuild', 'jekyll', 'perl'
  ].map((n) => `${n}.exe`)
)
const DATABASES = new Set(['mysqld', 'mariadbd', 'postgres', 'redis-server', 'memurai', 'mongod', 'sqlservr', 'couchdb', 'influxd'].map((n) => `${n}.exe`))
const SHELLS = new Set(['cmd.exe', 'powershell.exe', 'pwsh.exe', 'bash.exe', 'sh.exe', 'wsl.exe', 'conhost.exe', 'windowsterminal.exe', 'openconsole.exe'])
const SYSTEM = new Set(['system', 'idle', 'svchost.exe', 'lsass.exe', 'services.exe', 'wininit.exe', 'spoolsv.exe', 'smss.exe', 'csrss.exe'])

export const isRuntime = (name: string) => RUNTIMES.has(name.toLowerCase())
export const isDatabase = (name: string) => DATABASES.has(name.toLowerCase())
export const isShell = (name: string) => SHELLS.has(name.toLowerCase())
export const isSystem = (name: string, pid: number) => pid <= 4 || SYSTEM.has(name.toLowerCase())

/** Files that mark the root of a project. */
const MARKERS = ['package.json', '.git', 'pyproject.toml', 'requirements.txt', 'manage.py', 'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle', 'composer.json', 'Gemfile', 'deno.json']
/** Folders that are never a project (tools' own installs, the user folder itself). */
const NOT_PROJECT = /\\(windows|program files( \(x86\))?|programdata)\\|\\appdata\\(roaming\\npm|local\\programs|local\\microsoft)\\|\\(\.nvm|nvm|\.volta|scoop)\\|\\node_modules\\\.bin/i
const HOME = (process.env.USERPROFILE ?? '').toLowerCase().replace(/\\+$/, '')

const rootCache = new Map<string, string | null>()

/** The project a folder belongs to: the nearest folder up the tree with a project marker. */
export function projectRoot(dir: string | null): string | null {
  if (!dir) return null
  const start = dir.replace(/[\\/]+$/, '')
  if (rootCache.has(start)) return rootCache.get(start)!
  let found: string | null = null
  let d = start
  for (let i = 0; i < 8; i++) {
    const low = `${d.toLowerCase()}\\`
    if (NOT_PROJECT.test(low) || d.toLowerCase() === HOME || d === parse(d).root.replace(/\\$/, '')) break
    if (MARKERS.some((m) => existsSync(join(d, m)))) {
      found = d
      break
    }
    const up = dirname(d)
    if (up === d) break
    d = up
  }
  rootCache.set(start, found)
  return found
}

/** A project from absolute paths in a command line ("D:\app\node_modules\vite\bin\vite.js" -> "D:\app"). */
export function projectFromCommand(cmd: string | null): string | null {
  if (!cmd) return null
  const paths = cmd.match(/[A-Za-z]:\\[^"*?<>|\r\n]+?(?=["\s]|$)/g) ?? []
  for (const p of paths.slice(1)) {
    if (NOT_PROJECT.test(`${p}\\`)) continue
    const nm = p.toLowerCase().indexOf('\\node_modules\\')
    const root = nm > 0 ? p.slice(0, nm) : projectRoot(dirname(p))
    if (root) return root
  }
  return null
}

/** Dev tools we recognise in a command line, with the port they use by default. */
const TOOLS: [RegExp, string, number | null][] = [
  [/\bnext(\.js)?\b.*\b(dev|start)\b|[\\/]next[\\/]dist/i, 'next', 3000],
  [/\bnuxi?\b/i, 'nuxt', 3000],
  [/\breact-scripts\b/i, 'react-scripts', 3000],
  [/\bremix\b/i, 'remix', 3000],
  [/\bastro\b/i, 'astro', 4321],
  [/\bvite\b/i, 'vite', 5173],
  [/@angular|\bng(\.js)?\b.*\bserve\b/i, 'ng serve', 4200],
  [/\bgatsby\b/i, 'gatsby', 8000],
  [/\bstorybook\b/i, 'storybook', 6006],
  [/\bexpo\b/i, 'expo', 8081],
  [/webpack(-dev-server)?/i, 'webpack', 8080],
  [/\bhttp-server\b/i, 'http-server', 8080],
  [/\blive-server\b/i, 'live-server', 8080],
  [/\bjson-server\b/i, 'json-server', 3000],
  [/\bnodemon\b/i, 'nodemon', null],
  [/\b(tsx|ts-node)\b/i, 'ts-node', null],
  [/manage\.py\b.*\brunserver\b/i, 'django', 8000],
  [/\buvicorn\b/i, 'uvicorn', 8000],
  [/\bgunicorn\b/i, 'gunicorn', 8000],
  [/\bflask\b/i, 'flask', 5000],
  [/\brails\b.*\bs(erver)?\b/i, 'rails', 3000],
  [/\bphp(\.exe)?"?\s+-S\b/i, 'php -S', null],
  [/\bhugo\b/i, 'hugo', 1313],
  [/\bjekyll\b/i, 'jekyll', 4000],
  [/\bserve\b/i, 'serve', 3000]
]

/** A short name for what a process runs: "vite", "next", "server.js", or its exe name. */
export function commandLabel(cmd: string | null, name: string): string {
  if (cmd) {
    for (const [re, label] of TOOLS) if (re.test(cmd)) return label
    const script = /\s"?([^"\s]+\.(?:m?js|cjs|ts|py|rb|php))"?/i.exec(cmd)
    if (script) return basename(script[1])
  }
  return name.replace(/\.exe$/i, '')
}

/** The port a command asks for: --port 4000, -p 4000, runserver 8000, localhost:4000, listen(3000). */
export function explicitPort(cmd: string | null): number | null {
  if (!cmd) return null
  const m = /(?:--port[=\s]+|\s-p[=\s]*|runserver\s+(?:[\w.]+:)?|listen\(\s*|(?:localhost|127\.0\.0\.1|0\.0\.0\.0):)(\d{2,5})\b/i.exec(cmd)
  const n = m ? Number(m[1]) : 0
  return n >= 80 && n <= 65535 ? n : null
}

const portIn = (text: string, re: RegExp): number | null => {
  const n = Number(re.exec(text)?.[1] ?? 0)
  return n >= 80 && n <= 65535 ? n : null
}

/** PORT=4000 in the project's .env file. */
export function envPort(project: string | null): number | null {
  if (!project) return null
  try {
    return portIn(readFileSync(join(project, '.env'), 'utf8').slice(0, 20_000), /^\s*PORT\s*=\s*["']?(\d{2,5})/m)
  } catch {
    return null
  }
}

/** The port a script falls back to: `process.env.PORT || 3000`, `.listen(3000)`, `port=8000`. */
export function scriptPort(cmd: string | null, cwd: string | null): number | null {
  if (!cmd) return null
  const m = /\s"?((?:[A-Za-z]:\\)?[^"\s]+\.(?:m?js|cjs|ts|py))"?/i.exec(cmd)
  if (!m) return null
  const file = isAbsolute(m[1]) ? m[1] : cwd ? join(cwd, m[1]) : null
  if (!file || /\\node_modules\\/i.test(file)) return null
  try {
    const src = readFileSync(file, 'utf8').slice(0, 200_000)
    return portIn(src, /(?:PORT\s*(?:\|\||\?\?|or)\s*|\.listen\(\s*|\bport\s*[:=]\s*)(\d{2,5})\b/i)
  } catch {
    return null
  }
}

/** The port the dev tool in a command uses by default (vite 5173, next 3000...). */
export function toolPort(cmd: string | null): number | null {
  if (!cmd) return null
  for (const [re, , port] of TOOLS) if (re.test(cmd)) return port
  return null
}

/** Stop a process and everything it started (taskkill /T /F). */
export function stopTree(pid: number): Promise<{ ok: boolean; denied: boolean; message: string }> {
  return new Promise((done) => {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 10_000 }, (err, stdout, stderr) => {
      const text = `${stdout ?? ''}${stderr ?? ''}`.trim()
      if (!err) return done({ ok: true, denied: false, message: text })
      done({ ok: false, denied: /access is denied|denied/i.test(text), message: text || (err as Error).message })
    })
  })
}
