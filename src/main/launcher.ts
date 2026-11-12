/**
 * Running GitGremlin as an app on this PC without an installer (Smart App
 * Control blocks unsigned installers, but the signed Electron runtime in
 * node_modules runs fine):
 *
 * - a Start menu shortcut "GitGremlin" launches `electron.exe <project>`;
 * - before starting, an out-of-date build in out/ is rebuilt automatically,
 *   so launching from the Start menu always runs the current code.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { app, shell } from 'electron'
import { APP_ID, APP_NAME } from '../shared/constants'

/** Not packaged, and not `npm start` (which serves the renderer from the dev server). */
export function runningFromSource(): boolean {
  return !app.isPackaged && !process.env['ELECTRON_RENDERER_URL']
}

/** Newest modification time of the files under the given paths. */
function newest(paths: string[]): number {
  let latest = 0
  const visit = (p: string) => {
    let st
    try {
      st = statSync(p)
    } catch {
      return
    }
    if (st.isDirectory()) {
      for (const name of readdirSync(p)) visit(join(p, name))
    } else latest = Math.max(latest, st.mtimeMs)
  }
  paths.forEach(visit)
  return latest
}

/**
 * Rebuild out/ if the source changed since the last full build. Returns true
 * when the app was rebuilt and is relaunching (the caller should stop).
 */
export function rebuildIfStale(): boolean {
  if (!runningFromSource()) return false
  const root = app.getAppPath()
  const builtAt = (() => {
    try {
      // Only a full build writes the renderer; `npm start` writes main/preload only.
      return statSync(join(root, 'out', 'renderer', 'index.html')).mtimeMs
    } catch {
      return 0
    }
  })()
  const sources = ['src', 'assets', 'electron.vite.config.ts', 'package.json'].map((p) => join(root, p))
  if (builtAt >= newest(sources)) return false

  const cli = join(root, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
  if (!existsSync(cli)) return false
  console.log('[GitGremlin] Source changed since the last build: rebuilding...')
  // Electron's own Node runs the build, so no separate Node install is needed.
  const r = spawnSync(process.execPath, [cli, 'build'], {
    cwd: root,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
    windowsHide: true
  })
  if (r.status !== 0) {
    console.error('[GitGremlin] Rebuild failed; starting the previous build.')
    return false
  }
  app.relaunch()
  app.exit(0)
  return true
}

export function startMenuShortcutPath(): string {
  return join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${APP_NAME}.lnk`)
}

/** Create (or refresh) the Start menu shortcut, so GitGremlin can be found in Windows search. */
export function installStartMenuShortcut(): string {
  const root = app.getAppPath()
  const path = startMenuShortcutPath()
  const ok = shell.writeShortcutLink(path, existsSync(path) ? 'replace' : 'create', {
    target: process.execPath,
    args: app.isPackaged ? '' : `"${root}"`,
    cwd: root,
    description: 'Desktop pets with a purpose',
    icon: join(root, 'assets', 'icon.ico'),
    iconIndex: 0,
    appUserModelId: APP_ID
  })
  if (!ok) throw new Error(`Could not write ${path}`)
  return path
}
