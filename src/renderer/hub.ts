import { PET_IDS, PET_PURPOSE } from '../shared/constants'
import { ago, formatBytes } from '../shared/format'
import type { CleanMode, HubView, JunkTarget, PetConfig, PetId, Settings } from '../shared/types'

/**
 * The GitGremlin panel: every pet in one place. The sidebar lists the pets
 * (with an on/off dot and what they're up to); each pet has a page with its
 * purpose (Catbot: GitHub; Dusty: junk cleaning) and its look and movement.
 * Changes save as you make them.
 */
const api = window.gremlin
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

let view: HubView
let page = new URLSearchParams(location.search).get('page') ?? 'catbot'
const pages = new Map<string, HTMLElement>()

// --- saving ---------------------------------------------------------------------------------
let draft: Settings
let sww = false
let saveTimer: number | null = null

/** Save the draft shortly (sliders fire many input events). */
function saveSoon(ms = 250): void {
  if (saveTimer !== null) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(async () => {
    saveTimer = null
    const v = await api.saveSettings(draft, sww)
    view = v
    renderNav()
    renderStatusLines()
    renderDusty()
    toast('Saved')
  }, ms)
}

let toastTimer: number | null = null
function toast(text: string): void {
  const el = $('toast')
  el.textContent = text
  el.classList.add('show')
  if (toastTimer !== null) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 1400)
}

const cleanError = (err: unknown) => (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

// --- navigation -------------------------------------------------------------------------------
function show(p: string): void {
  if (p !== 'general' && !PET_IDS.includes(p as PetId)) p = 'catbot'
  page = p
  for (const [id, el] of pages) el.hidden = id !== p
  $('page-general').hidden = p !== 'general'
  for (const b of document.querySelectorAll<HTMLElement>('.nav-item')) b.classList.toggle('active', b.dataset.page === p)
  $('content').scrollTop = 0
}

/** One sentence about what a pet is up to, from its status report. */
function statusSummary(id: PetId): string {
  const cfg = view.settings.pets[id]
  if (!cfg.enabled) return 'Off'
  return sentence(view.status[id].report[0] ?? '')
}

function renderNav(): void {
  const list = $('petList')
  if (!list.childElementCount) {
    for (const id of PET_IDS) {
      const li = document.createElement('li')
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'nav-item'
      b.dataset.page = id
      b.innerHTML = `<img alt="" src="./pets/${id}/portrait.png" /><span class="nav-text"><span class="nav-name"></span><span class="nav-sub"></span></span><span class="dot"></span>`
      b.addEventListener('click', () => show(id))
      li.append(b)
      list.append(li)
    }
  }
  for (const id of PET_IDS) {
    const b = list.querySelector<HTMLElement>(`[data-page="${id}"]`)!
    const cfg = view.settings.pets[id]
    b.querySelector('.nav-name')!.textContent = cfg.name
    b.querySelector('.nav-sub')!.textContent = statusSummary(id)
    const dot = b.querySelector<HTMLElement>('.dot')!
    dot.className = `dot ${!cfg.enabled ? 'off' : view.status[id].alert ? 'alert' : 'on'}`
    dot.title = !cfg.enabled ? 'Not on the desktop' : view.status[id].alert ? 'Wants your attention' : 'On the desktop'
  }
}

function renderStatusLines(): void {
  for (const id of PET_IDS) {
    const el = pages.get(id)?.querySelector('.status-line')
    if (!el) continue
    const s = view.status[id]
    el.textContent = view.settings.pets[id].enabled ? (s.alert ? sentence(s.alert) : statusSummary(id)) : `${view.settings.pets[id].name} is resting (not on the desktop).`
    el.classList.toggle('alert', Boolean(s.alert) && view.settings.pets[id].enabled)
  }
}

/** "I SNIFFED OUT 1.2 GB OF JUNK!" -> "I sniffed out 1.2 GB of junk!" (keeps units readable). */
function sentence(text: string): string {
  const lower = text.toLowerCase().replace(/\b(\d+(?:\.\d+)?) (b|kb|mb|gb|tb)\b/g, (_m, n: string, u: string) => `${n} ${u.toUpperCase()}`)
  return lower.charAt(0).toUpperCase() + lower.slice(1).replace(/\bi\b/g, 'I').replace(/github/g, 'GitHub').replace(/click me/g, 'click the pet')
}

// --- pet pages ------------------------------------------------------------------------------------
function buildPetPage(id: PetId): HTMLElement {
  const el = document.createElement('section')
  el.className = 'page'
  el.id = `page-${id}`
  el.append(($('petPage') as HTMLTemplateElement).content.cloneNode(true))
  el.querySelector<HTMLImageElement>('.portrait')!.src = `./pets/${id}/portrait.png`
  el.querySelector('.purpose')!.textContent = PET_PURPOSE[id]
  const slot = el.querySelector('.purpose-slot')!
  slot.append(($(`${id}Purpose`) as HTMLTemplateElement).content.cloneNode(true))

  const input = (k: keyof PetConfig) => el.querySelector<HTMLInputElement>(`[data-k="${k}"]`)!
  const cfg = () => draft.pets[id]
  const values = () => {
    el.querySelector('[data-v="petSize"]')!.textContent = `${cfg().petSize} px`
    el.querySelector('[data-v="petSpeed"]')!.textContent = `${cfg().petSpeed} px/s`
    el.querySelector('.pet-name')!.textContent = cfg().name || PET_PURPOSE[id]
  }
  input('enabled').addEventListener('change', (e) => {
    cfg().enabled = (e.target as HTMLInputElement).checked
    saveSoon(0)
  })
  input('name').addEventListener('input', (e) => {
    const v = (e.target as HTMLInputElement).value.trim()
    if (!v) return
    cfg().name = v
    values()
    saveSoon(600)
  })
  for (const k of ['petSize', 'petSpeed'] as const) {
    input(k).addEventListener('input', (e) => {
      cfg()[k] = Number((e.target as HTMLInputElement).value)
      values()
      saveSoon()
    })
  }
  for (const r of el.querySelectorAll<HTMLInputElement>('[data-k="movement"]')) {
    r.name = `movement-${id}`
    r.addEventListener('change', () => {
      cfg().movement = r.value === 'ground' ? 'ground' : 'roam'
      saveSoon(0)
    })
  }
  input('followCursor').addEventListener('change', (e) => {
    cfg().followCursor = (e.target as HTMLInputElement).checked
    saveSoon(0)
  })
  ;(el as HTMLElement & { fill?: () => void }).fill = () => {
    const c = cfg()
    input('enabled').checked = c.enabled
    input('name').value = c.name
    input('petSize').value = String(c.petSize)
    input('petSpeed').value = String(c.petSpeed)
    for (const r of el.querySelectorAll<HTMLInputElement>('[data-k="movement"]')) r.checked = r.value === c.movement
    input('followCursor').checked = c.followCursor
    values()
  }
  return el
}

function fillPages(): void {
  for (const el of pages.values()) (el as HTMLElement & { fill?: () => void }).fill?.()
  $<HTMLInputElement>('onTopOfApps').checked = draft.onTopOfApps
  $<HTMLInputElement>('startWithWindows').checked = sww
}

// --- Catbot: GitHub ---------------------------------------------------------------------------------
const GRID = ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353']
const LEVEL_WORD = ['no', 'a few', 'some', 'lots of', 'loads of']
let verificationUri = 'https://github.com/login/device'
let signingIn = false

function ghError(msg: string | null | undefined): void {
  const el = $('ghError')
  el.hidden = !msg
  el.textContent = msg ?? ''
}

function renderGitHub(): void {
  if (signingIn) return
  const g = view.github
  const linked = g.source !== 'none' && g.login
  $('ghPending').hidden = true
  $('ghSignedOut').hidden = Boolean(linked)
  $('ghSignedIn').hidden = !linked
  if (!linked) {
    $<HTMLButtonElement>('signIn').disabled = !g.signInAvailable
    $('signInHint').textContent = g.signInAvailable
      ? 'Opens github.com in your browser. You approve GitGremlin on GitHub itself (read-only access to your profile), so your password never touches this app.'
      : "GitHub sign-in isn't set up in this build: it needs GitGremlin's GitHub OAuth App client ID (see the README)."
    $('useCli').hidden = !g.ghAvailable
    ghError(null)
    return
  }
  const avatar = $<HTMLImageElement>('avatar')
  if (g.avatarUrl) avatar.src = g.avatarUrl
  avatar.hidden = !g.avatarUrl
  $('ghName').textContent = g.name || g.login
  $('ghLogin').textContent = `@${g.login} · ${g.source === 'oauth' ? 'signed in with GitHub' : 'via the GitHub CLI login'}`
  const status = $('ghStatus')
  status.replaceChildren()
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
  const name = view.settings.pets.catbot.name
  const mood = g.todayCount === 0 ? `${name} is hungry` : `${LEVEL_WORD[g.level]} contributions, ${name} is fed`
  today.textContent = `Today: ${g.todayCount} (${mood}) · streak ${g.streak} day${g.streak === 1 ? '' : 's'} · updated ${ago(g.fetchedAt)}`
  status.append(week, today)
  ghError(g.error ? `Last refresh failed: ${g.error}` : null)
}

function wireGitHub(): void {
  $('signIn').addEventListener('click', async () => {
    ghError(null)
    const btn = $<HTMLButtonElement>('signIn')
    btn.disabled = true
    try {
      const code = await api.signInWithGitHub()
      verificationUri = code.verificationUri
      $('deviceCode').textContent = code.userCode
      signingIn = true
      $('ghSignedOut').hidden = true
      $('ghPending').hidden = false
    } catch (err) {
      ghError(cleanError(err))
    } finally {
      btn.disabled = false
    }
  })
  $('openGitHub').addEventListener('click', () => void api.openGitHub(verificationUri))
  $('cancelSignIn').addEventListener('click', async () => {
    await api.cancelSignIn()
    signingIn = false
    await reload()
  })
  api.onSignInResult(async (result) => {
    signingIn = false
    await reload()
    if (!result.ok) ghError(result.error ?? 'Sign-in failed.')
    else toast(`Linked to @${view.github.login}`)
  })
  $('useCli').addEventListener('click', async () => {
    ghError(null)
    const result = await api.useGitHubCli()
    await reload()
    if (!result.ok) ghError(result.error ?? 'Could not use the GitHub CLI login.')
  })
  $('signOut').addEventListener('click', async () => {
    apply(await api.signOutGitHub())
  })
  $('refresh').addEventListener('click', async () => {
    const btn = $<HTMLButtonElement>('refresh')
    btn.disabled = true
    btn.textContent = 'Refreshing...'
    apply(await api.refreshGitHub())
    btn.disabled = false
    btn.textContent = 'Refresh now'
  })
}

// --- Dusty: junk -------------------------------------------------------------------------------------
/** Categories the user unticked in the results table (kept across refreshes). */
const unticked = new Set<string>()

function renderDusty(): void {
  const d = view.dusty
  const cfg = view.settings.dusty
  const enabled = view.settings.pets.dusty.enabled
  const name = view.settings.pets.dusty.name
  for (const r of document.querySelectorAll<HTMLInputElement>('input[name="cleanMode"]')) r.checked = r.value === draft.dusty.mode
  for (const c of document.querySelectorAll<HTMLInputElement>('[data-t]')) c.checked = draft.dusty.targets[c.dataset.t as JunkTarget]
  $<HTMLSelectElement>('scanEvery').value = String(draft.dusty.scanEveryMinutes)

  // Sizes next to each target.
  for (const el of document.querySelectorAll<HTMLElement>('[data-f]')) {
    const t = el.dataset.f as JunkTarget
    const cats = d.scan?.categories.filter((c) => c.target === t) ?? []
    const bytes = cats.reduce((s, c) => s + c.bytes, 0)
    el.textContent = d.scan && cfg.targets[t] ? formatBytes(bytes) : ''
  }

  const scanBtn = $<HTMLButtonElement>('scanNow')
  scanBtn.disabled = Boolean(d.busy) || !enabled
  scanBtn.textContent = d.busy === 'scanning' ? 'Sniffing...' : 'Scan now'

  const info: string[] = []
  if (!enabled) info.push(`Turn ${name} on to scan.`)
  else if (d.busy === 'scanning') info.push(`${name} is sniffing around for junk...`)
  else if (d.busy === 'cleaning') info.push(`${name} is munching junk...`)
  info.push(d.scan ? `Last scan ${ago(d.scan.at)}.` : 'No scan yet.')
  if (d.lastClean) {
    const failed = d.lastClean.failed ? ` (${d.lastClean.failed} item${d.lastClean.failed === 1 ? '' : 's'} in use were skipped)` : ''
    info.push(`Last clean ${ago(d.lastClean.at)}: freed ${formatBytes(d.lastClean.freedBytes)}${failed}.`)
  }
  if (cfg.mode === 'report') info.push('Report-only mode: nothing will be deleted.')
  $('scanInfo').textContent = info.join(' ')

  const rows = $('junkRows')
  rows.replaceChildren()
  const cats = (d.scan?.categories ?? []).filter((c) => cfg.targets[c.target])
  if (!cats.length) {
    const tr = document.createElement('tr')
    tr.innerHTML = `<td colspan="4" class="empty">${d.scan ? 'Nothing to clean. All tidy!' : 'Click Scan now to look for junk.'}</td>`
    rows.append(tr)
  }
  let selected = 0
  for (const c of cats) {
    const tr = document.createElement('tr')
    const can = !c.blocked && c.bytes > 0 && cfg.mode !== 'report'
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.disabled = !can
    box.checked = can && !unticked.has(c.id)
    box.setAttribute('aria-label', `Clean ${c.label}`)
    box.addEventListener('change', () => {
      if (box.checked) unticked.delete(c.id)
      else unticked.add(c.id)
      renderDusty()
    })
    if (box.checked) selected += c.bytes
    const td0 = document.createElement('td')
    td0.append(box)
    const td1 = document.createElement('td')
    td1.textContent = c.label
    if (c.target === 'recycleBin') td1.insertAdjacentHTML('beforeend', ' <span class="tag warn">permanent</span>')
    if (c.blocked) td1.insertAdjacentHTML('beforeend', ` <span class="tag"></span>`)
    if (c.blocked) td1.querySelector('.tag:last-child')!.textContent = c.blocked
    const td2 = document.createElement('td')
    td2.className = 'num'
    td2.textContent = formatBytes(c.bytes)
    const td3 = document.createElement('td')
    td3.className = 'num'
    td3.textContent = c.items.toLocaleString()
    tr.append(td0, td1, td2, td3)
    if (!can) tr.classList.add('muted')
    rows.append(tr)
  }
  const clean = $<HTMLButtonElement>('cleanNow')
  clean.hidden = cfg.mode === 'report'
  clean.disabled = !selected || Boolean(d.busy) || !enabled
  clean.textContent = d.busy === 'cleaning' ? 'Cleaning...' : selected ? `Clean ${formatBytes(selected)}` : 'Clean selected'
}

function selectedJunk() {
  const cfg = view.settings.dusty
  return (view.dusty.scan?.categories ?? []).filter(
    (c) => cfg.targets[c.target] && !c.blocked && c.bytes > 0 && !unticked.has(c.id) && cfg.mode !== 'report'
  )
}

function wireDusty(): void {
  for (const r of document.querySelectorAll<HTMLInputElement>('input[name="cleanMode"]')) {
    r.addEventListener('change', () => {
      draft.dusty.mode = r.value as CleanMode
      saveSoon(0)
    })
  }
  for (const c of document.querySelectorAll<HTMLInputElement>('[data-t]')) {
    c.addEventListener('change', () => {
      draft.dusty.targets[c.dataset.t as JunkTarget] = c.checked
      saveSoon(0)
    })
  }
  $('scanEvery').addEventListener('change', (e) => {
    draft.dusty.scanEveryMinutes = Number((e.target as HTMLSelectElement).value)
    saveSoon(0)
  })
  $('scanNow').addEventListener('click', async () => {
    const p = api.dustyScan()
    await reload() // show "Sniffing..." right away
    apply(await p)
  })
  $('cleanNow').addEventListener('click', () => {
    const cats = selectedJunk()
    if (!cats.length) return
    const list = $('confirmList')
    list.replaceChildren(
      ...cats.map((c) => {
        const li = document.createElement('li')
        li.textContent = `${c.label}: ${formatBytes(c.bytes)}`
        return li
      })
    )
    $('confirmWarn').hidden = !cats.some((c) => c.target === 'recycleBin')
    const dlg = $<HTMLDialogElement>('confirm')
    dlg.returnValue = ''
    dlg.showModal()
    dlg.addEventListener(
      'close',
      async () => {
        if (dlg.returnValue !== 'ok') return
        const p = api.dustyClean(cats.map((c) => c.id))
        await reload()
        const v = await p
        apply(v)
        if (v.dusty.lastClean) toast(`Freed ${formatBytes(v.dusty.lastClean.freedBytes)}`)
      },
      { once: true }
    )
  })
}

// --- general ------------------------------------------------------------------------------------
function wireGeneral(): void {
  $('onTopOfApps').addEventListener('change', (e) => {
    draft.onTopOfApps = (e.target as HTMLInputElement).checked
    saveSoon(0)
  })
  $('startWithWindows').addEventListener('change', (e) => {
    sww = (e.target as HTMLInputElement).checked
    saveSoon(0)
  })
  for (const b of document.querySelectorAll<HTMLElement>('.nav-item.general')) b.addEventListener('click', () => show('general'))
}

// --- view ---------------------------------------------------------------------------------------
function apply(v: HubView, refill = false): void {
  view = v
  // Don't clobber edits that haven't been saved yet.
  if (refill || saveTimer === null) {
    draft = structuredClone(v.settings)
    sww = v.startWithWindows
    fillPages()
  }
  renderNav()
  renderStatusLines()
  renderGitHub()
  renderDusty()
}

async function reload(): Promise<void> {
  apply(await api.getHub())
}

async function start(): Promise<void> {
  view = await api.getHub()
  draft = structuredClone(view.settings)
  sww = view.startWithWindows
  const host = $('pages')
  for (const id of PET_IDS) {
    const el = buildPetPage(id)
    pages.set(id, el)
    host.append(el)
  }
  wireGitHub()
  wireDusty()
  wireGeneral()
  apply(view, true)
  show(page)
  api.onShowPage((p) => show(p))
  api.onHubChanged(() => void reload())
  // Keep "x min ago" fresh.
  window.setInterval(() => void reload(), 30_000)
}

void start()
