/**
 * Pelican's file sharing: a small web server, only while you share, on your
 * local network. Your phone opens its page from a QR code and downloads the
 * files: all at once (one ZIP) or one by one.
 *
 * - The address holds a random 128-bit key, so it can't be guessed.
 * - It's single-use: the first device to open it gets it; others are refused.
 * - It stops by itself once that device has downloaded every file, or after
 *   30 minutes without any activity. Nothing is ever sent to the internet.
 *
 * Plain Node only (no Electron), so it can be tested on its own.
 */
import { randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { createReadStream, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { hostname, networkInterfaces } from 'node:os'

export interface ShareFile {
  id: string
  /** Name shown on the phone; may hold folders ("trip/photo.jpg"), kept inside the ZIP. */
  name: string
  path: string
  size: number
}

export type ShareState = 'waiting' | 'opened' | 'downloading' | 'delivered' | 'stopped'

export interface ShareProgress {
  state: ShareState
  /** The phone that opened the link (its browser, roughly). */
  device: string | null
  /** Bytes sent so far, and the total to send. */
  sent: number
  total: number
  delivered: number
  files: number
  /** Why it stopped: delivered, idle, stopped by you, or an error. */
  reason: string | null
}

// --- local network addresses ---------------------------------------------------------------------
const VIRTUAL = /vethernet|wsl|hyper-v|virtualbox|vmware|docker|loopback|bluetooth|tailscale|zerotier|npcap|vpn|tap-|tun/i

/** This PC's addresses on the local network, the likeliest (Wi-Fi, then Ethernet) first. */
export function lanAddresses(): { name: string; address: string }[] {
  const out: { name: string; address: string; score: number }[] = []
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue
      if (VIRTUAL.test(name)) continue
      const priv = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)
      const score = (/wi-?fi|wlan|wireless/i.test(name) ? 4 : /ethernet|^eth/i.test(name) ? 2 : 0) + (priv ? 1 : 0)
      out.push({ name, address: a.address, score })
    }
  }
  return out.sort((x, y) => y.score - x.score).map(({ name, address }) => ({ name, address }))
}

// --- ZIP (stored, no compression: photos and videos are compressed already) -----------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crcUpdate(crc: number, buf: Buffer): number {
  let c = crc ^ 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function crcOfFile(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let crc = 0
    createReadStream(path, { highWaterMark: 1 << 20 })
      .on('data', (b) => (crc = crcUpdate(crc, b as Buffer)))
      .on('end', () => resolve(crc))
      .on('error', reject)
  })
}

function dosDateTime(d: Date): [number, number] {
  const y = Math.max(1980, d.getFullYear())
  const date = ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)
  return [time, date]
}

const MAX32 = 0xffffffff

interface ZipEntry {
  name: Buffer
  path: string
  size: number
  crc: number
  offset: number
  time: number
  date: number
}

/** Names inside the ZIP: forward slashes, no drive or parent parts, no duplicates. */
export function zipNames(names: string[]): string[] {
  const seen = new Set<string>()
  return names.map((raw) => {
    let n = raw
      .replace(/\\/g, '/')
      .split('/')
      .filter((p) => p && p !== '.' && p !== '..' && !/^[a-z]:$/i.test(p))
      .join('/')
    if (!n) n = 'file'
    const dot = n.lastIndexOf('.')
    const [stem, ext] = dot > n.lastIndexOf('/') + 1 ? [n.slice(0, dot), n.slice(dot)] : [n, '']
    let k = 2
    while (seen.has(n.toLowerCase())) n = `${stem} (${k++})${ext}`
    seen.add(n.toLowerCase())
    return n
  })
}

/** The bytes of a stored ZIP around the file contents: per-entry headers, then the directory. */
export function zipLayout(files: { name: string; path: string; size: number; crc: number; mtime: Date }[]): {
  locals: Buffer[]
  directory: Buffer
  length: number
  entries: ZipEntry[]
} {
  const names = zipNames(files.map((f) => f.name))
  let offset = 0
  const entries: ZipEntry[] = []
  const locals: Buffer[] = []
  files.forEach((f, i) => {
    const [time, date] = dosDateTime(f.mtime)
    const e: ZipEntry = { name: Buffer.from(names[i], 'utf8'), path: f.path, size: f.size, crc: f.crc, offset, time, date }
    const big = f.size >= MAX32
    const extra = big ? Buffer.alloc(20) : Buffer.alloc(0)
    if (big) {
      extra.writeUInt16LE(0x0001, 0)
      extra.writeUInt16LE(16, 2)
      extra.writeBigUInt64LE(BigInt(f.size), 4)
      extra.writeBigUInt64LE(BigInt(f.size), 12)
    }
    const h = Buffer.alloc(30)
    h.writeUInt32LE(0x04034b50, 0)
    h.writeUInt16LE(big ? 45 : 20, 4)
    h.writeUInt16LE(0x0800, 6) // UTF-8 names
    h.writeUInt16LE(0, 8) // stored
    h.writeUInt16LE(time, 10)
    h.writeUInt16LE(date, 12)
    h.writeUInt32LE(f.crc, 14)
    h.writeUInt32LE(big ? MAX32 : f.size, 18)
    h.writeUInt32LE(big ? MAX32 : f.size, 22)
    h.writeUInt16LE(e.name.length, 26)
    h.writeUInt16LE(extra.length, 28)
    const local = Buffer.concat([h, e.name, extra])
    locals.push(local)
    entries.push(e)
    offset += local.length + f.size
  })
  const cdStart = offset
  const central: Buffer[] = []
  for (const e of entries) {
    const bigSize = e.size >= MAX32
    const bigOff = e.offset >= MAX32
    const fields: bigint[] = []
    if (bigSize) fields.push(BigInt(e.size), BigInt(e.size))
    if (bigOff) fields.push(BigInt(e.offset))
    const extra = fields.length ? Buffer.alloc(4 + fields.length * 8) : Buffer.alloc(0)
    if (fields.length) {
      extra.writeUInt16LE(0x0001, 0)
      extra.writeUInt16LE(fields.length * 8, 2)
      fields.forEach((v, i) => extra.writeBigUInt64LE(v, 4 + i * 8))
    }
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0)
    c.writeUInt16LE(fields.length ? 45 : 20, 4)
    c.writeUInt16LE(fields.length ? 45 : 20, 6)
    c.writeUInt16LE(0x0800, 8)
    c.writeUInt16LE(0, 10)
    c.writeUInt16LE(e.time, 12)
    c.writeUInt16LE(e.date, 14)
    c.writeUInt32LE(e.crc, 16)
    c.writeUInt32LE(bigSize ? MAX32 : e.size, 20)
    c.writeUInt32LE(bigSize ? MAX32 : e.size, 24)
    c.writeUInt16LE(e.name.length, 28)
    c.writeUInt16LE(extra.length, 30)
    c.writeUInt32LE(bigOff ? MAX32 : e.offset, 42)
    central.push(c, e.name, extra)
  }
  const cd = Buffer.concat(central)
  const zip64 = entries.length > 0xffff || cdStart >= MAX32 || cd.length >= MAX32
  const tail: Buffer[] = []
  if (zip64) {
    const r = Buffer.alloc(56)
    r.writeUInt32LE(0x06064b50, 0)
    r.writeBigUInt64LE(44n, 4)
    r.writeUInt16LE(45, 12)
    r.writeUInt16LE(45, 14)
    r.writeBigUInt64LE(BigInt(entries.length), 24)
    r.writeBigUInt64LE(BigInt(entries.length), 32)
    r.writeBigUInt64LE(BigInt(cd.length), 40)
    r.writeBigUInt64LE(BigInt(cdStart), 48)
    const loc = Buffer.alloc(20)
    loc.writeUInt32LE(0x07064b50, 0)
    loc.writeBigUInt64LE(BigInt(cdStart + cd.length), 8)
    loc.writeUInt32LE(1, 16)
    tail.push(r, loc)
  }
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Math.min(entries.length, 0xffff), 8)
  end.writeUInt16LE(Math.min(entries.length, 0xffff), 10)
  end.writeUInt32LE(zip64 ? MAX32 : cd.length, 12)
  end.writeUInt32LE(zip64 ? MAX32 : cdStart, 16)
  tail.push(end)
  const directory = Buffer.concat([cd, ...tail])
  return { locals, directory, length: cdStart + directory.length, entries }
}

// --- the phone page ------------------------------------------------------------------------------
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  const u = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${u[i]}`
}

function icon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (/^(jpe?g|png|gif|webp|heic|bmp|svg)$/.test(ext)) return '🖼️'
  if (/^(mp4|mov|mkv|avi|webm)$/.test(ext)) return '🎬'
  if (/^(mp3|wav|m4a|flac|ogg)$/.test(ext)) return '🎵'
  if (ext === 'pdf') return '📕'
  if (/^(zip|rar|7z|gz|tar)$/.test(ext)) return '📦'
  return '📄'
}

export function phonePage(files: ShareFile[], base: string, from: string): string {
  const total = files.reduce((n, f) => n + f.size, 0)
  const rows = files
    .map(
      (f) => `<li><span class="ic">${icon(f.name)}</span><span class="nm">${esc(f.name)}<small>${formatSize(f.size)}</small></span><a class="one" href="${base}/f/${encodeURIComponent(f.id)}" download>Download</a></li>`
    )
    .join('')
  const all =
    files.length > 1
      ? `<a class="all" href="${base}/all.zip" download>Download all<small>${files.length} files · ${formatSize(total)} · one ZIP</small></a>`
      : `<a class="all" href="${base}/f/${encodeURIComponent(files[0].id)}" download>Download<small>${formatSize(total)}</small></a>`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pelican</title>
<style>
:root{color-scheme:light dark;--bg:#f6f4ef;--card:#fff;--ink:#141518;--ink2:#5c6068;--line:#e4e1da;--accent:#f08b3b}
@media (prefers-color-scheme:dark){:root{--bg:#131417;--card:#1d1f24;--ink:#f3f1ec;--ink2:#a2a6ae;--line:#2c2f36}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:520px;margin:0 auto;padding:22px 16px 40px}
header{display:flex;align-items:center;gap:12px;margin-bottom:18px}header img{width:56px;height:auto;image-rendering:pixelated}
h1{font-size:20px;margin:0}header p{margin:2px 0 0;color:var(--ink2);font-size:14px}
.all{display:block;text-align:center;background:var(--ink);color:var(--bg);text-decoration:none;font-weight:700;font-size:18px;padding:16px;border-radius:14px}
.all small{display:block;font-weight:400;font-size:13px;opacity:.75;margin-top:2px}
ul{list-style:none;margin:18px 0 0;padding:0;background:var(--card);border:1px solid var(--line);border-radius:14px}
li{display:flex;align-items:center;gap:10px;padding:12px 14px;border-top:1px solid var(--line)}li:first-child{border-top:0}
.ic{font-size:22px}.nm{flex:1;min-width:0;overflow-wrap:anywhere}.nm small{display:block;color:var(--ink2);font-size:13px}
.one{color:var(--ink);font-weight:600;text-decoration:none;border:1px solid var(--line);border-radius:10px;padding:7px 10px;font-size:14px}
#status{margin:16px 2px 0;color:var(--ink2);font-size:14px;min-height:20px}
.done .all,.done .one{opacity:.4;pointer-events:none}
</style></head><body><main>
<header><img src="${base}/pelican.png" alt=""><div><h1>Files from ${esc(from)}</h1><p>Delivered by Pelican, over your Wi-Fi.</p></div></header>
${all}
<ul>${rows}</ul>
<p id="status">Tap Download all to get everything at once.</p>
</main><script>
(function(){var s=document.getElementById('status');var t=setInterval(function(){fetch('${base}/status').then(function(r){return r.json()}).then(function(j){
if(j.state==='downloading'){s.textContent='Downloading… '+Math.min(100,Math.round(j.sent*100/Math.max(1,j.total)))+'%'}
if(j.state==='delivered'){s.textContent='All done! The files are on your phone. This link no longer works.';document.body.className='done';clearInterval(t)}
}).catch(function(){clearInterval(t)})},1500)})();
</script></body></html>`
}

const message = (title: string, text: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pelican</title><style>body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#f6f4ef;color:#141518;display:grid;place-items:center;min-height:100vh;text-align:center;padding:24px}@media (prefers-color-scheme:dark){body{background:#131417;color:#f3f1ec}}</style></head><body><div><h1 style="font-size:20px">${title}</h1><p>${text}</p></div></body></html>`

// --- the server ----------------------------------------------------------------------------------
export interface ShareOptions {
  /** The address to listen on (this PC on the local network). */
  host: string
  /** Stop after this long without any request. */
  idleMs?: number
  /** Stop this long after everything is delivered (lets the page show "All done"). */
  lingerMs?: number
  /** Pelican's portrait for the page. */
  brand?: Buffer
  /** Shown as "Files from …". */
  from?: string
}

/**
 * One sharing session. Emits 'change' (progress) and 'stop'.
 */
export class Share extends EventEmitter {
  readonly token = randomBytes(16).toString('base64url')
  url = ''
  private server: Server | null = null
  private ip: string | null = null
  private ua: string | null = null
  private state: ShareState = 'waiting'
  private reason: string | null = null
  private sent = 0
  private delivered = new Set<string>()
  private idle: NodeJS.Timeout | null = null
  private crcs = new Map<string, Promise<number>>()
  private readonly total: number

  constructor(
    private readonly files: ShareFile[],
    private readonly opts: ShareOptions
  ) {
    super()
    this.total = files.reduce((n, f) => n + f.size, 0)
  }

  async start(): Promise<string> {
    if (!this.files.length) throw new Error('Add some files first.')
    this.server = createServer((req, res) => void this.handle(req, res).catch(() => res.destroy()))
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(0, this.opts.host, () => resolve())
    })
    const port = (this.server.address() as AddressInfo).port
    this.url = `http://${this.opts.host}:${port}/${this.token}`
    this.touch()
    // Work out the ZIP checksums in the background, so "Download all" starts at once.
    if (this.files.length > 1) for (const f of this.files) this.crc(f)
    return this.url
  }

  progress(): ShareProgress {
    return { state: this.state, device: this.ua, sent: this.sent, total: this.total, delivered: this.delivered.size, files: this.files.length, reason: this.reason }
  }

  stop(reason = 'stopped'): void {
    if (this.state === 'stopped') return
    if (this.idle) clearTimeout(this.idle)
    this.idle = null
    this.reason = this.state === 'delivered' ? 'delivered' : reason
    this.state = 'stopped'
    this.server?.close()
    this.server?.closeAllConnections?.()
    this.server = null
    this.emit('change', this.progress())
    this.emit('stop', this.reason)
  }

  private touch(): void {
    if (this.idle) clearTimeout(this.idle)
    if (this.state === 'stopped' || this.state === 'delivered') return
    this.idle = setTimeout(() => this.stop('idle'), this.opts.idleMs ?? 30 * 60_000)
  }

  private set(state: ShareState): void {
    if (this.state === state || this.state === 'stopped') return
    this.state = state
    this.emit('change', this.progress())
  }

  private crc(f: ShareFile): Promise<number> {
    let p = this.crcs.get(f.id)
    if (!p) {
      p = crcOfFile(f.path)
      p.catch(() => undefined)
      this.crcs.set(f.id, p)
    }
    return p
  }

  private markDelivered(ids: string[]): void {
    for (const id of ids) this.delivered.add(id)
    this.emit('change', this.progress())
    if (this.delivered.size >= this.files.length && this.state !== 'stopped') {
      this.set('delivered')
      if (this.idle) clearTimeout(this.idle)
      setTimeout(() => this.stop('delivered'), this.opts.lingerMs ?? 20_000)
    }
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0])
    const base = `/${this.token}`
    if (path !== base && !path.startsWith(`${base}/`)) return this.plain(res, 404, 'Not found')
    if (req.method !== 'GET' && req.method !== 'HEAD') return this.plain(res, 405, 'Not allowed')
    this.touch()
    const ip = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '')
    const sub = path.slice(base.length) || '/'
    // Single use: the first device to open the link keeps it.
    if (this.ip === null && (sub === '/' || sub === '')) {
      this.ip = ip
      this.ua = deviceName(req.headers['user-agent'] ?? '')
      this.set('opened')
    }
    if (this.ip !== ip)
      return this.html(res, 410, message('This link was already used', 'Pelican only gives a QR code to one phone. Ask for a new one on the PC.'))
    if (this.state === 'stopped') return this.html(res, 410, message('This link has ended', 'Ask for a new QR code on the PC.'))
    if (sub === '/' || sub === '') return this.html(res, 200, phonePage(this.files, base, this.opts.from ?? hostname()))
    if (sub === '/status') return this.json(res, this.progress())
    if (sub === '/pelican.png') {
      if (!this.opts.brand) return this.plain(res, 404, 'Not found')
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=3600' })
      return void res.end(this.opts.brand)
    }
    if (sub === '/all.zip') return this.sendZip(req, res)
    const m = /^\/f\/(.+)$/.exec(sub)
    const f = m && this.files.find((x) => x.id === m[1])
    if (f) return this.sendFile(req, res, f)
    return this.plain(res, 404, 'Not found')
  }

  private sendFile(req: IncomingMessage, res: ServerResponse, f: ShareFile): void {
    let size: number
    try {
      size = statSync(f.path).size
    } catch {
      return this.plain(res, 410, 'This file is no longer on the PC.')
    }
    const name = f.name.split(/[\\/]/).pop() ?? 'file'
    const headers: Record<string, string | number> = {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': disposition(name),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store'
    }
    // Download managers resume with a Range request.
    const range = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range ?? ''))
    let start = 0
    let end = size - 1
    if (range) {
      start = Number(range[1])
      end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
      if (start > end || start >= size) return void res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end()
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`
    }
    headers['Content-Length'] = end - start + 1
    res.writeHead(range ? 206 : 200, headers)
    if (req.method === 'HEAD' || size === 0) {
      res.end()
      if (size === 0 && req.method !== 'HEAD') this.markDelivered([f.id])
      return
    }
    this.set('downloading')
    const stream = createReadStream(f.path, { start, end })
    stream.on('data', (b) => {
      this.sent += (b as Buffer).length
      this.touch()
    })
    stream.on('error', () => res.destroy())
    res.on('finish', () => {
      if (end === size - 1) this.markDelivered([f.id])
    })
    stream.pipe(res)
  }

  private async sendZip(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const listed = this.files.map((f) => {
      const st = statSync(f.path)
      return { ...f, size: st.size, mtime: st.mtime }
    })
    const crcs = await Promise.all(this.files.map((f) => this.crc(f)))
    const zip = zipLayout(listed.map((f, i) => ({ ...f, crc: crcs[i] })))
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': disposition(`Files from ${this.opts.from ?? hostname()}.zip`),
      'Content-Length': zip.length,
      'Cache-Control': 'no-store'
    })
    if (req.method === 'HEAD') return void res.end()
    this.set('downloading')
    let ok = true
    let current: { stream: ReturnType<typeof createReadStream>; done: () => void } | null = null
    res.on('close', () => {
      if (res.writableFinished) return
      ok = false
      current?.stream.destroy()
      current?.done()
    })
    for (let i = 0; i < zip.entries.length && ok; i++) {
      if (!res.write(zip.locals[i])) await new Promise((r) => res.once('drain', r))
      if (!ok) break
      await new Promise<void>((resolve) => {
        const stream = createReadStream(zip.entries[i].path, { highWaterMark: 1 << 20 })
        current = { stream, done: resolve }
        stream.on('data', (b) => {
          this.sent += (b as Buffer).length
          this.touch()
          if (!res.write(b)) {
            stream.pause()
            res.once('drain', () => stream.resume())
          }
        })
        stream.on('end', () => resolve())
        stream.on('error', () => {
          ok = false
          res.destroy()
          resolve()
        })
      })
      current = null
    }
    if (!ok) return
    res.end(zip.directory)
    res.on('finish', () => this.markDelivered(this.files.map((f) => f.id)))
  }

  private plain(res: ServerResponse, code: number, text: string): void {
    res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' }).end(text)
  }

  private html(res: ServerResponse, code: number, html: string): void {
    res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(html)
  }

  private json(res: ServerResponse, data: unknown): void {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(data))
  }
}

/** Content-Disposition with a plain fallback and the full UTF-8 name. */
function disposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

/** "iPhone", "Android phone", "iPad"... from the browser's user agent. */
export function deviceName(ua: string): string {
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet'
  if (/Windows/.test(ua)) return 'Windows PC'
  if (/Mac OS X|Macintosh/.test(ua)) return 'Mac'
  return 'a device'
}
