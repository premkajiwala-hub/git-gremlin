import { net } from 'electron'
import { GITHUB_CLIENT_ID, GITHUB_SCOPES } from '../shared/constants'

/**
 * "Sign in with GitHub" using GitHub's OAuth device flow, the same flow the
 * GitHub CLI and VS Code use for desktop apps:
 *
 *   1. ask GitHub for a one-time user code,
 *   2. the user enters it at github.com/login/device and approves GitGremlin,
 *   3. we poll GitHub until it hands back an access token.
 *
 * No password ever passes through the app, and no client secret is needed.
 * Requires a GitHub OAuth App with "Enable Device Flow" ticked; its client ID
 * goes in GITHUB_CLIENT_ID (or the GITGREMLIN_GITHUB_CLIENT_ID env var).
 */

export interface DeviceCode {
  userCode: string
  verificationUri: string
  /** Seconds until the code expires. */
  expiresIn: number
}

export function clientId(): string {
  return (process.env.GITGREMLIN_GITHUB_CLIENT_ID ?? GITHUB_CLIENT_ID).trim()
}

async function post<T>(url: string, body: Record<string, string>): Promise<T> {
  const res = await net.fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'GitGremlin-desktop-pet' },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`GitHub returned ${res.status}`)
  return (await res.json()) as T
}

export class DeviceFlow {
  private cancelled = false
  private timer: NodeJS.Timeout | null = null

  /**
   * Start signing in. Resolves with the code to show; `done` is called once
   * with the access token, or with an error message.
   */
  async start(done: (result: { token?: string; error?: string }) => void): Promise<DeviceCode> {
    const id = clientId()
    if (!id) throw new Error('GitHub sign-in isn\'t set up in this build yet (no OAuth client ID).')
    this.cancel()
    this.cancelled = false
    const code = await post<{
      device_code?: string
      user_code?: string
      verification_uri?: string
      expires_in?: number
      interval?: number
      error?: string
      error_description?: string
    }>('https://github.com/login/device/code', { client_id: id, scope: GITHUB_SCOPES })
    if (!code.device_code || !code.user_code) {
      throw new Error(code.error_description ?? code.error ?? 'GitHub did not return a sign-in code.')
    }

    let interval = Math.max(5, code.interval ?? 5)
    const deadline = Date.now() + (code.expires_in ?? 900) * 1000
    const poll = async () => {
      if (this.cancelled) return
      if (Date.now() > deadline) return done({ error: 'The sign-in code expired. Please try again.' })
      try {
        const res = await post<{ access_token?: string; error?: string; error_description?: string }>(
          'https://github.com/login/oauth/access_token',
          { client_id: id, device_code: code.device_code!, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }
        )
        if (this.cancelled) return
        if (res.access_token) return done({ token: res.access_token })
        if (res.error === 'slow_down') interval += 5
        else if (res.error === 'access_denied') return done({ error: 'Sign-in was cancelled on GitHub.' })
        else if (res.error === 'expired_token') return done({ error: 'The sign-in code expired. Please try again.' })
        else if (res.error && res.error !== 'authorization_pending') return done({ error: res.error_description ?? res.error })
      } catch {
        // Network hiccup: keep trying until the code expires.
      }
      this.timer = setTimeout(poll, interval * 1000)
    }
    this.timer = setTimeout(poll, interval * 1000)

    return {
      userCode: code.user_code,
      verificationUri: code.verification_uri ?? 'https://github.com/login/device',
      expiresIn: code.expires_in ?? 900
    }
  }

  cancel(): void {
    this.cancelled = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
