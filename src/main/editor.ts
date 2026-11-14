/**
 * Opening a repo in Visual Studio Code, from Syncy's list in the panel: the
 * quickest way from "this repo has work that isn't on GitHub" to committing
 * and pushing it (VS Code's Source Control view, or its terminal).
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'

let cached: string | null | undefined

/** Code.exe: the usual install folders (user, then system), then a `code` command on PATH. Null if not installed. */
export function findVSCode(): string | null {
  if (cached !== undefined) return cached
  const local = process.env.LOCALAPPDATA ?? ''
  const candidates = [
    join(local, 'Programs', 'Microsoft VS Code', 'Code.exe'),
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Microsoft VS Code', 'Code.exe'),
    join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft VS Code', 'Code.exe'),
    join(local, 'Programs', 'Microsoft VS Code Insiders', 'Code - Insiders.exe')
  ]
  // `code` on PATH lives in "<install>\bin\code.cmd", next to "<install>\Code.exe".
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir && existsSync(join(dir, 'code.cmd'))) candidates.push(join(dirname(dir), 'Code.exe'))
  }
  cached = candidates.find((p) => existsSync(p)) ?? null
  return cached
}

/** Open a folder in VS Code. Returns false if VS Code isn't installed. */
export function openInVSCode(dir: string): boolean {
  const exe = findVSCode()
  if (!exe) return false
  // Don't pass on Electron's or a VS Code terminal's variables: they would
  // make Code.exe run as Node, or hand the folder to some other VS Code window.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ELECTRON_|VSCODE_)/i.test(k)))
  spawn(exe, [dir], { cwd: dir, env, detached: true, stdio: 'ignore' }).unref()
  return true
}
