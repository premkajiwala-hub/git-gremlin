/**
 * Dusty's junk scanner and cleaner.
 *
 * Safety rules:
 * - Only known junk locations are ever touched (listed below), and only their
 *   *contents*: the folders themselves are left in place.
 * - Every path is checked to be inside %LOCALAPPDATA%, %APPDATA% or %TEMP%.
 * - Links/junctions are never followed (lstat + rm removes the link, not its target).
 * - Files in use are skipped one by one (counted, nothing else happens), so
 *   the rest of their folder is still cleaned.
 * - Browser caches are only cleaned while that browser is closed.
 * - The Recycle Bin is emptied through Windows itself, and only when asked.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { lstat, readdir, rmdir, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import type { CleanResult, JunkCategory, JunkTarget, ScanResult } from '../shared/types'
import { emptyRecycleBin, recycleBinInfo } from './native'

const LOCAL = process.env.LOCALAPPDATA ?? ''
const ROAMING = process.env.APPDATA ?? ''
const TEMP = tmpdir()

interface Location {
  id: string
  target: JunkTarget
  label: string
  /** Folders whose contents are junk. */
  roots: string[]
  /** Browser process that must be closed first. */
  process?: string
  browserName?: string
}

/** Chromium-based browser cache folders for every profile. */
async function chromiumCaches(userData: string): Promise<string[]> {
  if (!existsSync(userData)) return []
  const roots: string[] = []
  for (const d of await readdir(userData, { withFileTypes: true }).catch(() => [])) {
    if (!d.isDirectory() || !(d.name === 'Default' || d.name.startsWith('Profile '))) continue
    for (const sub of ['Cache', 'Code Cache', 'GPUCache']) roots.push(join(userData, d.name, sub))
  }
  return roots
}

async function firefoxCaches(): Promise<string[]> {
  const profiles = join(LOCAL, 'Mozilla', 'Firefox', 'Profiles')
  if (!existsSync(profiles)) return []
  const roots: string[] = []
  for (const d of await readdir(profiles, { withFileTypes: true }).catch(() => [])) {
    if (d.isDirectory()) roots.push(join(profiles, d.name, 'cache2'))
  }
  return roots
}

async function locations(): Promise<Location[]> {
  return [
    { id: 'npm', target: 'devCaches', label: 'npm cache', roots: [join(LOCAL, 'npm-cache', '_cacache'), join(ROAMING, 'npm-cache', '_cacache')] },
    { id: 'yarn', target: 'devCaches', label: 'Yarn cache', roots: [join(LOCAL, 'Yarn', 'Cache')] },
    { id: 'pnpm', target: 'devCaches', label: 'pnpm metadata cache', roots: [join(LOCAL, 'pnpm-cache')] },
    { id: 'pip', target: 'devCaches', label: 'pip cache', roots: [join(LOCAL, 'pip', 'Cache')] },
    { id: 'nuget', target: 'devCaches', label: 'NuGet HTTP cache', roots: [join(LOCAL, 'NuGet', 'v3-cache'), join(LOCAL, 'NuGet', 'plugins-cache')] },
    {
      id: 'electron',
      target: 'devCaches',
      label: 'Electron download cache',
      roots: [join(LOCAL, 'electron', 'Cache'), join(LOCAL, 'electron-builder', 'Cache')]
    },
    { id: 'temp', target: 'temp', label: 'Temp files', roots: [TEMP] },
    {
      id: 'chrome',
      target: 'browser',
      label: 'Chrome cache',
      roots: await chromiumCaches(join(LOCAL, 'Google', 'Chrome', 'User Data')),
      process: 'chrome.exe',
      browserName: 'Chrome'
    },
    {
      id: 'edge',
      target: 'browser',
      label: 'Edge cache',
      roots: await chromiumCaches(join(LOCAL, 'Microsoft', 'Edge', 'User Data')),
      process: 'msedge.exe',
      browserName: 'Edge'
    },
    {
      id: 'brave',
      target: 'browser',
      label: 'Brave cache',
      roots: await chromiumCaches(join(LOCAL, 'BraveSoftware', 'Brave-Browser', 'User Data')),
      process: 'brave.exe',
      browserName: 'Brave'
    },
    { id: 'firefox', target: 'browser', label: 'Firefox cache', roots: await firefoxCaches(), process: 'firefox.exe', browserName: 'Firefox' }
  ]
}

/** Never touch anything outside the user's local app data, roaming app data or temp folder. */
function isSafe(path: string): boolean {
  const p = resolve(path).toLowerCase() + sep
  return [LOCAL, ROAMING, TEMP]
    .filter(Boolean)
    .some((base) => p.startsWith(resolve(base).toLowerCase() + sep))
}

function runningProcesses(): Promise<Set<string>> {
  return new Promise((done) => {
    execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 10_000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
      if (err) return done(new Set())
      done(new Set(out.split(/\r?\n/).map((l) => l.split('","')[0]?.replace(/^"/, '').toLowerCase()).filter(Boolean)))
    })
  })
}

/** Total size and file count under a path, without following links. Yields regularly to stay light. */
async function measure(path: string, budget = { n: 0 }): Promise<{ bytes: number; items: number }> {
  let bytes = 0
  let items = 0
  let st
  try {
    st = await lstat(path)
  } catch {
    return { bytes, items }
  }
  if (st.isSymbolicLink()) return { bytes, items }
  if (!st.isDirectory()) return { bytes: st.size, items: 1 }
  let entries
  try {
    entries = await readdir(path, { withFileTypes: true })
  } catch {
    return { bytes, items }
  }
  for (const e of entries) {
    if (++budget.n % 400 === 0) await new Promise((r) => setImmediate(r))
    const child = join(path, e.name)
    if (e.isSymbolicLink()) continue
    if (e.isDirectory()) {
      const m = await measure(child, budget)
      bytes += m.bytes
      items += m.items
    } else {
      try {
        bytes += (await lstat(child)).size
        items++
      } catch {
        /* vanished or locked */
      }
    }
  }
  return { bytes, items }
}

/** Everything currently directly inside a root. */
async function entriesOf(root: string): Promise<string[]> {
  if (!isSafe(root) || !existsSync(root)) return []
  return (await readdir(root).catch(() => [] as string[])).map((name) => join(root, name))
}

/**
 * Delete a file or folder tree one entry at a time, without following links:
 * a file that's in use is skipped (and counted) instead of stopping the rest.
 * Folders are removed once they're empty. Returns how many entries failed.
 */
async function removeTree(path: string, budget = { n: 0 }): Promise<number> {
  if (++budget.n % 200 === 0) await new Promise((r) => setImmediate(r))
  let st
  try {
    st = await lstat(path)
  } catch {
    return 0 // already gone
  }
  if (st.isDirectory() && !st.isSymbolicLink()) {
    let failed = 0
    for (const name of await readdir(path).catch(() => [] as string[])) failed += await removeTree(join(path, name), budget)
    if (failed) return failed
    try {
      await rmdir(path)
      return 0
    } catch {
      return 1
    }
  }
  try {
    await unlink(path)
    return 0
  } catch {
    if (!st.isSymbolicLink()) return 1
  }
  // A directory link or junction: rmdir removes the link itself, never what it points to.
  try {
    await rmdir(path)
    return 0
  } catch {
    return 1
  }
}

export class JunkScanner {
  /** Scan every enabled target. Disabled targets are skipped entirely. */
  async scan(targets: Record<JunkTarget, boolean>): Promise<ScanResult> {
    const categories: JunkCategory[] = []
    const running = targets.browser ? await runningProcesses() : new Set<string>()
    for (const loc of await locations()) {
      if (!targets[loc.target]) continue
      let bytes = 0
      let items = 0
      for (const root of loc.roots) {
        for (const entry of await entriesOf(root)) {
          const m = await measure(entry)
          bytes += m.bytes
          items += m.items
        }
      }
      if (!items) continue
      const blocked = loc.process && running.has(loc.process) ? `Close ${loc.browserName} to clean this` : null
      categories.push({ id: loc.id, target: loc.target, label: loc.label, bytes, items, blocked })
    }
    if (targets.recycleBin) {
      const rb = recycleBinInfo()
      if (rb && rb.items > 0) {
        categories.push({ id: 'recycle', target: 'recycleBin', label: 'Recycle Bin', bytes: rb.bytes, items: rb.items, blocked: null })
      }
    }
    return { at: Date.now(), categories, totalBytes: categories.reduce((s, c) => s + c.bytes, 0) }
  }

  /**
   * Clean the given categories (by id). Returns what was freed and a fresh scan. Browser caches
   * are re-checked: if the browser has been opened since the scan, they're skipped.
   */
  async clean(ids: string[], targets: Record<JunkTarget, boolean>): Promise<{ result: CleanResult; after: ScanResult }> {
    const before = await this.scan(targets)
    const wanted = new Set(ids)
    const running = await runningProcesses()
    let failed = 0
    for (const loc of await locations()) {
      if (!wanted.has(loc.id) || !targets[loc.target]) continue
      if (loc.process && running.has(loc.process)) continue
      for (const root of loc.roots) {
        for (const entry of await entriesOf(root)) {
          if (isSafe(entry)) failed += await removeTree(entry)
        }
      }
    }
    if (wanted.has('recycle') && targets.recycleBin && !emptyRecycleBin()) failed++
    const after = await this.scan(targets)
    const freed = Math.max(0, before.totalBytes - after.totalBytes)
    return { result: { at: Date.now(), freedBytes: freed, failed }, after }
  }
}
