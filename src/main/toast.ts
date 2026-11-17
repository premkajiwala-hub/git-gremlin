/**
 * Windows notifications shown as GitGremlin.
 *
 * Electron's Notification can't be used here: for an app started from
 * electron.exe, Electron gives notifications their own Start menu shortcut,
 * "Electron.lnk", under GitGremlin's app ID, so Windows search and the
 * taskbar then show "Electron" with Electron's logo. Instead the toast is
 * sent through Windows directly, under GitGremlin's app ID, which Windows
 * ties to the "GitGremlin" Start menu shortcut (its name and pixel icon).
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { APP_ID } from '../shared/constants'
import { startMenuShortcutPath } from './launcher'

const xml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!)

/**
 * Show a toast. Returns false when it can't: Windows only shows toasts for an
 * app ID that a Start menu shortcut carries (`npm run install-app` makes it).
 */
export function toast(title: string, body: string): boolean {
  if (process.platform !== 'win32' || !existsSync(startMenuShortcutPath())) return false
  // XML-escaped text has no single quotes left, so it's safe inside a PowerShell '...' string.
  const doc = `<toast><visual><binding template="ToastGeneric"><text>${xml(title)}</text><text>${xml(body)}</text></binding></visual></toast>`
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]',
    '[void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime]',
    '$x = New-Object Windows.Data.Xml.Dom.XmlDocument',
    `$x.LoadXml('${doc}')`,
    `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${APP_ID}').Show([Windows.UI.Notifications.ToastNotification]::new($x))`
  ].join('; ')
  spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
    windowsHide: true,
    stdio: 'ignore'
  }).unref()
  return true
}
