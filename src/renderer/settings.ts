import type { Settings, SettingsView } from '../shared/types'

const api = window.gremlin
const form = document.getElementById('form') as HTMLFormElement
const savedEl = document.getElementById('saved')!
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const signedOut = $('ghSignedOut')
const pending = $('ghPending')
const signedIn = $('ghSignedIn')
const ghStatus = $('ghStatus')
const ghError = $('ghError')
const signInBtn = $<HTMLButtonElement>('signIn')
const useCliBtn = $<HTMLButtonElement>('useCli')
const refreshBtn = $<HTMLButtonElement>('refresh')

const field = <T extends HTMLInputElement>(name: string) => form.elements.namedItem(name) as T
const GRID = ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353']
const LEVEL_WORD = ['no', 'a few', 'some', 'lots of', 'loads of']
let verificationUri = 'https://github.com/login/device'

function render(view: SettingsView): void {
  const s = view.settings
  field('petName').value = s.petName
  field('petSize').value = String(s.petSize)
  field('petSpeed').value = String(s.petSpeed)
  ;(form.elements.namedItem('movement') as RadioNodeList).value = s.movement
  field('onTopOfApps').checked = s.onTopOfApps
  field('followCursor').checked = s.followCursor
  field('startWithWindows').checked = view.startWithWindows
  renderGitHub(view)
  updateValues()
}

function showError(msg: string | null | undefined): void {
  ghError.hidden = !msg
  ghError.textContent = msg ?? ''
}

function renderGitHub(view: SettingsView): void {
  const g = view.github
  const linked = g.source !== 'none' && g.login
  pending.hidden = true
  signedOut.hidden = Boolean(linked)
  signedIn.hidden = !linked

  if (!linked) {
    signInBtn.disabled = !g.signInAvailable
    $('signInHint').textContent = g.signInAvailable
      ? 'Opens github.com in your browser. You approve GitGremlin on GitHub itself (read-only access to your profile), so your password never touches this app.'
      : "GitHub sign-in isn't set up in this build yet: it needs GitGremlin's GitHub OAuth App client ID (see the README)."
    useCliBtn.hidden = !g.ghAvailable
    showError(null)
    return
  }

  const avatar = $<HTMLImageElement>('avatar')
  if (g.avatarUrl) avatar.src = g.avatarUrl
  avatar.hidden = !g.avatarUrl
  $('ghName').textContent = g.name || g.login
  $('ghLogin').textContent = `@${g.login} · ${g.source === 'oauth' ? 'signed in with GitHub' : 'via the GitHub CLI login'}`

  ghStatus.replaceChildren()
  const week = document.createElement('span')
  week.className = 'gh-week'
  week.title = 'Last 7 days, today on the right'
  g.week.forEach((level, i) => {
    const sq = document.createElement('span')
    sq.style.background = GRID[level]
    if (i === g.week.length - 1) sq.className = 'today'
    week.append(sq)
  })
  const today = document.createElement('span')
  const mood = g.todayCount === 0 ? 'Catbot is hungry' : `${LEVEL_WORD[g.level]} contributions, Catbot is fed`
  today.textContent = `Today: ${g.todayCount} (${mood}) · streak ${g.streak} day${g.streak === 1 ? '' : 's'} · updated ${ago(g.fetchedAt)}`
  ghStatus.append(week, today)
  showError(g.error ? `Last refresh failed: ${g.error}` : null)
}

function ago(at: number): string {
  if (!at) return 'never'
  const m = Math.round((Date.now() - at) / 60000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`
}

function updateValues(): void {
  for (const el of document.querySelectorAll<HTMLElement>('.val')) {
    const name = el.dataset.for!
    el.textContent = name === 'petSize' ? `${field(name).value} px` : `${field(name).value} px/s`
  }
}

function collect(): Settings {
  return {
    petName: field('petName').value,
    petSize: Number(field('petSize').value),
    petSpeed: Number(field('petSpeed').value),
    movement: (form.elements.namedItem('movement') as RadioNodeList).value === 'ground' ? 'ground' : 'roam',
    onTopOfApps: field('onTopOfApps').checked,
    followCursor: field('followCursor').checked
  }
}

const cleanError = (err: unknown) => (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

form.addEventListener('input', updateValues)
form.addEventListener('submit', async (e) => {
  e.preventDefault()
  render(await api.saveSettings(collect(), field('startWithWindows').checked))
  savedEl.textContent = 'Saved'
  setTimeout(() => (savedEl.textContent = ''), 2000)
})

// --- GitHub sign-in ---------------------------------------------------------------------
signInBtn.addEventListener('click', async () => {
  showError(null)
  signInBtn.disabled = true
  try {
    const code = await api.signInWithGitHub()
    verificationUri = code.verificationUri
    $('deviceCode').textContent = code.userCode
    signedOut.hidden = true
    pending.hidden = false
  } catch (err) {
    showError(cleanError(err))
  } finally {
    signInBtn.disabled = false
  }
})
$('openGitHub').addEventListener('click', () => void api.openGitHub(verificationUri))
$('cancelSignIn').addEventListener('click', async () => {
  await api.cancelSignIn()
  renderGitHub(await api.getSettings())
})
api.onSignInResult(async (result) => {
  const view = await api.getSettings()
  renderGitHub(view)
  if (!result.ok) showError(result.error ?? 'Sign-in failed.')
})
useCliBtn.addEventListener('click', async () => {
  showError(null)
  const result = await api.useGitHubCli()
  renderGitHub(await api.getSettings())
  if (!result.ok) showError(result.error ?? 'Could not use the GitHub CLI login.')
})
$('signOut').addEventListener('click', async () => renderGitHub(await api.signOutGitHub()))
refreshBtn.addEventListener('click', async () => {
  refreshBtn.disabled = true
  refreshBtn.textContent = 'Refreshing...'
  renderGitHub(await api.refreshGitHub())
  refreshBtn.disabled = false
  refreshBtn.textContent = 'Refresh now'
})
api.onSettings(() => {
  if (pending.hidden) void api.getSettings().then(renderGitHub)
})

void api.getSettings().then(render)
