import type { Settings, SettingsView } from '../shared/types'

const api = window.gremlin
const form = document.getElementById('form') as HTMLFormElement
const savedEl = document.getElementById('saved')!
const ghStatus = document.getElementById('ghStatus')!
const userHint = document.getElementById('userHint')!
const tokenHint = document.getElementById('tokenHint')!
const tokenInput = document.getElementById('token') as HTMLInputElement
const clearTokenBtn = document.getElementById('clearToken') as HTMLButtonElement
const refreshBtn = document.getElementById('refresh') as HTMLButtonElement

const field = <T extends HTMLInputElement>(name: string) => form.elements.namedItem(name) as T
const GRID = ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353']
const LEVEL_WORD = ['no', 'a few', 'some', 'lots of', 'loads of']
const SOURCE = { token: 'your saved token', gh: 'the GitHub CLI login', public: 'your public profile', none: '' }

let tokenAction: string | null | undefined

function render(view: SettingsView): void {
  const s = view.settings
  field('petName').value = s.petName
  field('petSize').value = String(s.petSize)
  field('petSpeed').value = String(s.petSpeed)
  ;(form.elements.namedItem('movement') as RadioNodeList).value = s.movement
  field('onTopOfApps').checked = s.onTopOfApps
  field('followCursor').checked = s.followCursor
  field('githubUser').value = s.githubUser
  field('quietHoursEnabled').checked = s.quietHoursEnabled
  field('quietStart').value = s.quietStart
  field('quietEnd').value = s.quietEnd
  field('startWithWindows').checked = view.startWithWindows
  tokenInput.value = ''
  tokenAction = undefined
  renderGitHub(view)
  updateValues()
}

function renderGitHub(view: SettingsView): void {
  const g = view.github
  field('githubUser').placeholder = g.login ?? 'your-github-username'
  userHint.textContent = view.github.ghAvailable
    ? 'Leave empty to use the account you are signed into with the GitHub CLI (gh).'
    : 'Your GitHub username. Without a token only public contributions count.'
  tokenHint.textContent = g.hasSavedToken
    ? 'A token is saved (encrypted on this PC). Type a new one to replace it.'
    : 'Optional: a fine-grained or classic token with read-only access, to include private contributions. Stored encrypted on this PC.'
  clearTokenBtn.hidden = !g.hasSavedToken

  ghStatus.replaceChildren()
  if (g.source === 'none') {
    const err = document.createElement('span')
    err.className = 'err'
    err.textContent = g.error ?? 'Not linked yet.'
    ghStatus.append(err)
    return
  }
  const who = document.createElement('span')
  who.className = 'who'
  who.textContent = `@${g.login} via ${SOURCE[g.source]}`
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
  ghStatus.append(who, week, today)
  if (g.error) {
    const err = document.createElement('span')
    err.className = 'err'
    err.textContent = `Last refresh failed: ${g.error}`
    ghStatus.append(err)
  }
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
    followCursor: field('followCursor').checked,
    githubUser: field('githubUser').value,
    quietHoursEnabled: field('quietHoursEnabled').checked,
    quietStart: field('quietStart').value,
    quietEnd: field('quietEnd').value
  }
}

form.addEventListener('input', updateValues)
form.addEventListener('submit', async (e) => {
  e.preventDefault()
  savedEl.textContent = 'Saving...'
  const token = tokenInput.value.trim() ? tokenInput.value.trim() : tokenAction
  try {
    render(await api.saveSettings(collect(), field('startWithWindows').checked, token))
    savedEl.textContent = 'Saved'
  } catch (err) {
    savedEl.textContent = (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
  }
  setTimeout(() => (savedEl.textContent = ''), 3000)
})
clearTokenBtn.addEventListener('click', () => {
  tokenAction = null
  tokenInput.value = ''
  tokenHint.textContent = 'The saved token will be removed when you click Save.'
})
refreshBtn.addEventListener('click', async () => {
  refreshBtn.disabled = true
  refreshBtn.textContent = 'Refreshing...'
  renderGitHub(await api.refreshGitHub())
  refreshBtn.disabled = false
  refreshBtn.textContent = 'Refresh now'
})
api.onSettings(() => void api.getSettings().then(renderGitHub))

void api.getSettings().then(render)
