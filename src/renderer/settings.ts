import type { Settings, SettingsView } from '../shared/types'

const api = window.gremlin
const form = document.getElementById('form') as HTMLFormElement
const reposEl = document.getElementById('repos')!
const savedEl = document.getElementById('saved')!
const emailHint = document.getElementById('emailHint')!

const field = <T extends HTMLInputElement>(name: string) => form.elements.namedItem(name) as T

function render(view: SettingsView): void {
  const s = view.settings
  field('petName').value = s.petName
  field('petSize').value = String(s.petSize)
  field('petSpeed').value = String(s.petSpeed)
  field('peckishAfterHours').value = String(s.peckishAfterHours)
  field('hungryAfterHours').value = String(s.hungryAfterHours)
  field('starvingAfterHours').value = String(s.starvingAfterHours)
  field('quietHoursEnabled').checked = s.quietHoursEnabled
  field('quietStart').value = s.quietStart
  field('quietEnd').value = s.quietEnd
  field('gitEmail').value = s.gitEmail
  field('gitEmail').placeholder = view.detectedEmail || 'you@example.com'
  field('startWithWindows').checked = view.startWithWindows
  emailHint.textContent = view.detectedEmail
    ? `Leave empty to use each repo's git config email (globally: ${view.detectedEmail}).`
    : "Leave empty to use each repo's git config email."
  renderRepos(s.repos)
  updateValues()
}

function renderRepos(repos: string[]): void {
  reposEl.replaceChildren()
  if (!repos.length) {
    const li = document.createElement('li')
    li.className = 'empty'
    li.textContent = 'No repos yet. Add one so your pet can eat.'
    reposEl.append(li)
    return
  }
  for (const repo of repos) {
    const li = document.createElement('li')
    const name = document.createElement('span')
    name.textContent = repo
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'small'
    btn.textContent = 'Remove'
    btn.addEventListener('click', async () => render(await api.removeRepo(repo)))
    li.append(name, btn)
    reposEl.append(li)
  }
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
    peckishAfterHours: Number(field('peckishAfterHours').value),
    hungryAfterHours: Number(field('hungryAfterHours').value),
    starvingAfterHours: Number(field('starvingAfterHours').value),
    quietHoursEnabled: field('quietHoursEnabled').checked,
    quietStart: field('quietStart').value,
    quietEnd: field('quietEnd').value,
    gitEmail: field('gitEmail').value,
    repos: []
  }
}

form.addEventListener('input', updateValues)
form.addEventListener('submit', async (e) => {
  e.preventDefault()
  render(await api.saveSettings(collect(), field('startWithWindows').checked))
  savedEl.textContent = 'Saved'
  setTimeout(() => (savedEl.textContent = ''), 2000)
})
document.getElementById('addRepo')!.addEventListener('click', async () => {
  const res = await api.pickRepo()
  if (res.ok) render(await api.getSettings())
})
api.onSettings((s) => renderRepos(s.repos))

void api.getSettings().then(render)
