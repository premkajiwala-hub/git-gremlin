import '@fontsource/silkscreen/latin-400.css'
import '@fontsource/silkscreen/latin-700.css'
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-500.css'
import '@fontsource/jetbrains-mono/latin-600.css'
import { PET_IDS } from '../shared/constants'
import { ago, formatBytes } from '../shared/format'
import type { CleanMode, HubView, JunkTarget, PetConfig, PetId, RepoAction, RepoInfo, Settings, ThemeMode } from '../shared/types'

/**
 * The GitGremlin panel ("pixel glass"): a rail of pets on the left, and for
 * each pet a page with a big scanline portrait, its job's cards and its look
 * and movement. Changes save as you make them.
 */
const api = window.gremlin
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

let view: HubView
let page = new URLSearchParams(location.search).get('page') ?? 'catbot'
const pages = new Map<PetId, HTMLElement>()

/** What each pet's page says about it (the rest comes live from its status). */
const PET_UI: Record<PetId, { n: string; species: string; accent: string; lede: string; art: [string, number, string]; scale: number }> = {
  catbot: {
    n: '01',
    species: 'Robot cat',
    accent: '#F28A1E',
    lede: 'Runs on your GitHub contributions. A green square today keeps it fed, happy and full of zoomies.',
    art: ['idle', 0, 'happy'],
    scale: 6
  },
  dusty: {
    n: '02',
    species: 'Raccoon',
    accent: '#1FB5A3',
    lede: 'Eats the junk on your PC: caches, temp files and the Recycle Bin. Nothing goes without your say-so.',
    art: ['idle', 0, 'idle'],
    scale: 6
  },
  syncy: {
    n: '03',
    species: 'Beaver',
    accent: '#E2A812',
    lede: "Guards work you haven't pushed. Nudges you before it's lost, and eats a log every time you push.",
    art: ['sit', 0, 'idle'],
    scale: 6
  }
}

// --- pet artwork, drawn from the real sprites -----------------------------------------------------
interface FrameMeta {
  file: string
  screen: [number, number]
  accent: [number, number] | null
}
const METAS = import.meta.glob('../../assets/pets/*/frames.json', { eager: true, import: 'default' }) as Record<
  string,
  { accent: string | null; anims: Record<string, { frames: FrameMeta[] }> }
>

const loadImg = (src: string) =>
  new Promise<HTMLImageElement>((done) => {
    const img = new Image()
    img.onload = () => done(img)
    img.onerror = () => done(img)
    img.src = src
  })

/** One pose (body + eyes + lit accent), trimmed to its pixels, as a canvas shown `scale`x bigger. */
async function petCanvas(id: PetId, anim: string, frame: number, eyes: string, scale: number, into?: HTMLCanvasElement): Promise<HTMLCanvasElement> {
  const meta = METAS[`../../assets/pets/${id}/frames.json`]
  const f = meta.anims[anim]?.frames[frame] ?? meta.anims.idle.frames[0]
  const dir = `./pets/${id}`
  const [body, eye, accent] = await Promise.all([
    loadImg(`${dir}/${f.file}`),
    loadImg(`${dir}/eyes_${eyes}.png`),
    meta.accent && f.accent ? loadImg(`${dir}/${meta.accent}`) : Promise.resolve(null)
  ])
  const work = document.createElement('canvas')
  work.width = body.width
  work.height = body.height
  const ctx = work.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(body, 0, 0)
  ctx.drawImage(eye, f.screen[0], f.screen[1])
  if (accent && f.accent) ctx.drawImage(accent, f.accent[0], f.accent[1])
  // Trim to the opaque pixels.
  const { data, width, height } = ctx.getImageData(0, 0, work.width, work.height)
  let x0 = width
  let y0 = height
  let x1 = 0
  let y1 = 0
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3]) {
        x0 = Math.min(x0, x)
        y0 = Math.min(y0, y)
        x1 = Math.max(x1, x)
        y1 = Math.max(y1, y)
      }
  const out = into ?? document.createElement('canvas')
  out.width = Math.max(1, x1 - x0 + 1)
  out.height = Math.max(1, y1 - y0 + 1)
  out.getContext('2d')!.drawImage(work, x0, y0, out.width, out.height, 0, 0, out.width, out.height)
  out.dataset.scale = String(scale)
  out.style.width = `${out.width * scale}px`
  return out
}

// --- saving -------------------------------------------------------------------------------------
let draft: Settings
let sww = false
let saveTimer: number | null = null

/** Save the draft shortly (sliders fire many input events). */
function saveSoon(ms = 250): void {
  if (saveTimer !== null) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(async () => {
    saveTimer = null
    apply(await api.saveSettings(draft, sww))
    toast('Saved')
  }, ms)
}

let toastTimer: number | null = null
function toast(text: string): void {
  const el = $('toast')
  el.textContent = text
  el.classList.add('show')
  if (toastTimer !== null) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 1600)
}

const cleanError = (err: unknown) => (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Ask before doing something that can't be undone. Resolves true when confirmed. */
function confirmDialog(o: { title: string; items: string[]; warn?: string; hint: string; ok: string }): Promise<boolean> {
  const dlg = $<HTMLDialogElement>('confirm')
  $('confirmTitle').textContent = o.title
  $('confirmList').replaceChildren(
    ...o.items.map((t) => {
      const li = document.createElement('li')
      li.textContent = t
      return li
    })
  )
  $('confirmWarn').hidden = !o.warn
  $('confirmWarn').textContent = o.warn ?? ''
  $('confirmHint').textContent = o.hint
  $('confirmOk').textContent = o.ok
  dlg.returnValue = ''
  dlg.showModal()
  return new Promise((done) => dlg.addEventListener('close', () => done(dlg.returnValue === 'ok'), { once: true }))
}

// --- small helpers ------------------------------------------------------------------------------
const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`

function setSwitch(el: Element | null, on: boolean): void {
  el?.setAttribute('aria-checked', String(on))
}

function setSeg(group: Element, attr: string, value: string): void {
  for (const b of group.querySelectorAll<HTMLElement>(`[${attr}]`)) b.setAttribute('aria-pressed', String(b.getAttribute(attr) === value))
}

function setRadio(group: Element, attr: string, value: string): void {
  for (const b of group.querySelectorAll<HTMLElement>(`[${attr}]`)) b.setAttribute('aria-checked', String(b.getAttribute(attr) === value))
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text) e.textContent = text
  return e
}

function button(label: string, title: string, onClick: () => void, cls = 'ib'): HTMLButtonElement {
  const b = el('button', cls, label)
  b.type = 'button'
  b.title = title
  b.addEventListener('click', onClick)
  return b
}

/** "I SNIFFED OUT 1.2 GB OF JUNK!" -> "I sniffed out 1.2 GB of junk!" (keeps units readable). */
function sentence(text: string): string {
  const lower = text.toLowerCase().replace(/\b(\d+(?:\.\d+)?) (b|kb|mb|gb|tb)\b/g, (_m, n: string, u: string) => `${n} ${u.toUpperCase()}`)
  return (lower.charAt(0).toUpperCase() + lower.slice(1))
    .replace(/\bi\b/g, 'I')
    .replace(/github/g, 'GitHub')
    .replace(/(right-)?click me/g, 'right-click the pet')
    .replace(/([.!?]\s+)([a-z])/g, (_m, gap: string, c: string) => gap + c.toUpperCase())
}

/** What the pet says in its hero bubble: its alert, else its remark, else its headline. */
function bubbleText(id: PetId): string {
  const s = view.status[id]
  if (!view.settings.pets[id].enabled) return 'ZZZ... TURN ME ON TO WAKE ME.'
  if (s.busy) return s.report[0] ?? '...'
  // "Click me" means nothing inside the panel itself.
  if (s.alert) return s.alert.replace(/\s*(RIGHT-)?CLICK ME.*$/, '')
  const remark = s.report.find((l) => l.startsWith('> '))
  return remark ? remark.slice(2) : (s.report[0] ?? '')
}

// --- navigation ---------------------------------------------------------------------------------
/** Size the visible page's pets to its stage, in whole pixels so they stay crisp. */
function fitPets(): void {
  for (const c of document.querySelectorAll<HTMLCanvasElement>('.page:not([hidden]) .stage canvas')) {
    const stage = c.closest('.stage') as HTMLElement
    if (!stage.clientHeight || !c.height) continue
    const share = stage.classList.contains('lineup') ? 0.42 : 0.66
    const k = Math.max(3, Math.min(12, Math.floor((stage.clientHeight * share) / c.height)))
    c.style.width = `${c.width * k}px`
  }
}

function show(p: string): void {
  if (p !== 'general' && !PET_IDS.includes(p as PetId)) p = 'catbot'
  page = p
  for (const [id, e] of pages) e.hidden = id !== p
  $('page-general').hidden = p !== 'general'
  for (const b of document.querySelectorAll<HTMLElement>('.nav[data-page]')) b.classList.toggle('active', b.dataset.page === p)
  $('content').scrollTop = 0
  fitPets()
}

function renderNav(): void {
  const list = $('petList')
  if (!list.childElementCount) {
    for (const id of PET_IDS) {
      const b = el('button', 'nav')
      b.type = 'button'
      b.dataset.page = id
      b.innerHTML = `<span class="nav-tile"><img alt="" src="./pets/${id}/portrait.png" /></span><span class="nav-text"><span class="nav-name"></span><span class="nav-sub"></span></span><span class="px"></span>`
      b.addEventListener('click', () => show(id))
      list.append(b)
    }
  }
  let awake = 0
  let wanting = 0
  for (const id of PET_IDS) {
    const b = list.querySelector<HTMLElement>(`[data-page="${id}"]`)!
    const cfg = view.settings.pets[id]
    const s = view.status[id]
    b.querySelector('.nav-name')!.textContent = cfg.name
    b.querySelector('.nav-sub')!.textContent = cfg.enabled ? sentence(s.report[0] ?? '') : 'Resting'
    const dot = b.querySelector<HTMLElement>('.px')!
    dot.className = `px ${!cfg.enabled ? 'off' : s.alert ? 'alert' : ''}`
    dot.title = !cfg.enabled ? 'Not on the desktop' : s.alert ? 'Wants your attention' : 'On the desktop'
    if (cfg.enabled) awake++
    if (cfg.enabled && s.alert) wanting++
  }
  $('awakeText').textContent = view.hidden ? 'Pets hidden for now' : `${plural(awake, 'pet')} awake${wanting ? ` · ${wanting} need${wanting === 1 ? 's' : ''} you` : ''}`
  $('awakeDot').className = `px ${view.hidden || !awake ? 'off' : wanting ? 'alert' : ''}`
}

// --- pet pages ------------------------------------------------------------------------------------
function buildPetPage(id: PetId): HTMLElement {
  const ui = PET_UI[id]
  const p = el('section', 'page')
  p.id = `page-${id}`
  p.style.setProperty('--accent', ui.accent)
  p.append(($('petPage') as HTMLTemplateElement).content.cloneNode(true))
  p.querySelector('.kicker-text')!.textContent = `${ui.n} · ${ui.species}`
  p.querySelector('.lede')!.textContent = ui.lede
  p.querySelector('.purpose-slot')!.append(($(`${id}Purpose`) as HTMLTemplateElement).content.cloneNode(true))
  void petCanvas(id, ui.art[0], ui.art[1], ui.art[2], ui.scale, p.querySelector<HTMLCanvasElement>('.pet-xl')!).then(fitPets)

  const cfg = () => draft.pets[id]
  const q = <T extends HTMLElement>(sel: string) => p.querySelector<T>(sel)!
  q('[data-k="enabled"]').setAttribute('aria-label', `Show this pet on the desktop`)
  q('[data-k="enabled"]').addEventListener('click', () => {
    cfg().enabled = !cfg().enabled
    saveSoon(0)
    fillPet(id)
  })
  // Look and movement: a summary, with Edit to open the controls.
  q('.look-toggle').addEventListener('click', () => {
    const card = q('.card.look')
    const editing = !card.classList.contains('editing')
    card.classList.toggle('editing', editing)
    q('.look-edit').hidden = !editing
    q('.look-summary').hidden = editing
    q('.look-toggle').innerHTML = editing ? 'Done' : 'Edit <span aria-hidden="true">›</span>'
  })
  q<HTMLInputElement>('[data-k="name"]').addEventListener('input', (e) => {
    const v = (e.target as HTMLInputElement).value.trim()
    if (!v) return
    cfg().name = v
    fillPet(id)
    saveSoon(600)
  })
  for (const k of ['petSize', 'petSpeed'] as const) {
    q<HTMLInputElement>(`[data-k="${k}"]`).addEventListener('input', (e) => {
      cfg()[k] = Number((e.target as HTMLInputElement).value)
      fillPet(id)
      saveSoon()
    })
  }
  for (const b of p.querySelectorAll<HTMLElement>('[data-move]')) {
    b.addEventListener('click', () => {
      cfg().movement = b.dataset.move === 'ground' ? 'ground' : 'roam'
      fillPet(id)
      saveSoon(0)
    })
  }
  q('[data-k="followCursor"]').addEventListener('click', () => {
    cfg().followCursor = !cfg().followCursor
    fillPet(id)
    saveSoon(0)
  })
  q('.hero-primary').addEventListener('click', () => heroAction(id, 'primary'))
  q('.hero-link').addEventListener('click', () => heroAction(id, 'link'))
  return p
}

/** Fill a pet page's shared parts from the draft settings and live status. */
function fillPet(id: PetId): void {
  const p = pages.get(id)
  if (!p) return
  const c: PetConfig = draft.pets[id]
  const q = <T extends HTMLElement>(sel: string) => p.querySelector<T>(sel)!
  q('.crumb-name').textContent = c.name
  q('.title').textContent = c.name.toUpperCase()
  setSwitch(q('[data-k="enabled"]'), c.enabled)
  q('.bubble-text').textContent = bubbleText(id)
  // Look and movement.
  q('.ls-name').textContent = c.name
  q('.ls-size').textContent = `${c.petSize} px`
  q('.ls-speed').textContent = `${c.petSpeed} px/s`
  q('.ls-move').textContent = c.movement === 'roam' ? 'anywhere' : 'along the bottom'
  q('.ls-follow').textContent = c.followCursor ? 'on' : 'off'
  const name = q<HTMLInputElement>('[data-k="name"]')
  if (document.activeElement !== name) name.value = c.name
  for (const k of ['petSize', 'petSpeed'] as const) {
    const r = q<HTMLInputElement>(`[data-k="${k}"]`)
    r.value = String(c[k])
    r.style.setProperty('--p', `${((c[k] - Number(r.min)) / (Number(r.max) - Number(r.min))) * 100}%`)
    q(`[data-v="${k}"]`).textContent = k === 'petSize' ? `${c[k]} px` : `${c[k]} px/s`
  }
  setSeg(q('.seg'), 'data-move', c.movement)
  setSwitch(q('[data-k="followCursor"]'), c.followCursor)

  const h = heroInfo(id)
  const stats = q('.stats')
  stats.replaceChildren(...h.stats.map((t) => el('span', '', t)))
  const primary = q<HTMLButtonElement>('.hero-primary')
  primary.textContent = h.primary.label
  primary.disabled = Boolean(h.primary.disabled)
  const link = q<HTMLButtonElement>('.hero-link')
  link.hidden = !h.link
  if (h.link) link.innerHTML = `${escapeHtml(h.link.label)} <span aria-hidden="true">›</span>`
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

interface HeroInfo {
  stats: string[]
  primary: { label: string; disabled?: boolean }
  link: { label: string } | null
}

function heroInfo(id: PetId): HeroInfo {
  const enabled = view.settings.pets[id].enabled
  if (id === 'catbot') {
    const g = view.github
    const linked = g.source !== 'none' && Boolean(g.login)
    return linked
      ? {
          stats: [`${plural(g.todayCount, 'contribution')} today`, `${g.streak}-day streak`, `updated ${ago(g.fetchedAt)}`],
          primary: { label: 'Refresh now' },
          link: { label: 'Open my GitHub profile' }
        }
      : {
          stats: ['GitHub not linked', 'hungry for commits'],
          primary: { label: 'Sign in with GitHub', disabled: !g.signInAvailable },
          link: g.ghAvailable ? { label: 'Use my GitHub CLI login' } : null
        }
  }
  if (id === 'dusty') {
    const d = view.dusty
    const found = cleanableJunk().reduce((s, c) => s + c.bytes, 0)
    const sel = selectedJunk().reduce((s, c) => s + c.bytes, 0)
    const mode = { ask: 'ask first', auto: 'cleans automatically', report: 'report only' }[view.settings.dusty.mode]
    const stats = [found ? `${formatBytes(found)} found` : 'all clean', mode, d.scan ? `scanned ${ago(d.scan.at)}` : 'not scanned yet']
    if (d.busy) return { stats, primary: { label: d.busy === 'scanning' ? 'Sniffing...' : 'Munching...', disabled: true }, link: null }
    if (!sel) return { stats, primary: { label: 'Scan now', disabled: !enabled }, link: null }
    return { stats, primary: { label: `Clean ${formatBytes(sel)}`, disabled: !enabled }, link: { label: 'Scan again' } }
  }
  const v = view.syncy
  const repos = v.scan?.repos ?? []
  const need = repos.filter(hasWork).length
  const hour = view.settings.syncy.summaryHour
  return {
    stats: [plural(repos.length, 'repo'), need ? `${need} need${need === 1 ? 's' : ''} a push` : 'all on GitHub', v.scan ? `checked ${ago(v.scan.at)}` : 'not checked yet'],
    primary: { label: v.busy === 'scanning' ? 'Checking...' : 'Check now', disabled: Boolean(v.busy) || !enabled },
    link: { label: hour === null ? 'Set an evening check-in' : `End-of-day check at ${hour > 12 ? hour - 12 : hour} ${hour >= 12 ? 'PM' : 'AM'}` }
  }
}

async function heroAction(id: PetId, which: 'primary' | 'link'): Promise<void> {
  if (id === 'catbot') {
    const linked = view.github.source !== 'none' && Boolean(view.github.login)
    if (which === 'primary') return linked ? refreshGitHub() : startSignIn()
    if (linked) return void api.openGitHub(`https://github.com/${view.github.login}`)
    return useCli()
  }
  if (id === 'dusty') {
    if (which === 'primary' && selectedJunk().length) return cleanJunk()
    return scanJunk()
  }
  if (which === 'primary') return checkRepos()
  $('syncyNudges').scrollIntoView({ behavior: 'smooth', block: 'center' })
}

// --- Catbot: GitHub -------------------------------------------------------------------------------
const GRID = ['var(--c0)', 'var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)']
const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const LEVEL_WORD = ['hungry', 'calm', 'content', 'happy', 'ecstatic']
let verificationUri = 'https://github.com/login/device'
let signingIn = false

function ghError(msg: string | null | undefined): void {
  $('ghError').hidden = !msg
  $('ghError').textContent = msg ?? ''
}

function renderCatbot(): void {
  const g = view.github
  const linked = g.source !== 'none' && Boolean(g.login)
  const name = view.settings.pets.catbot.name
  $('cbToday').textContent = linked ? String(g.todayCount) : '–'
  $('cbTodayLabel').innerHTML = linked ? `contribution${g.todayCount === 1 ? '' : 's'}<br>since midnight` : 'not linked<br>yet'
  $('cbLevel').textContent = !linked ? 'not linked' : g.todayCount ? `Fed · level ${g.level}/4` : 'Hungry'
  $('cbMeter')
    .querySelectorAll('span')
    .forEach((s, i) => s.classList.toggle('fill', linked && i < g.level))
  $('cbMood').textContent = !linked
    ? `Sign in below so ${name} can read your chart.`
    : g.todayCount === 0
      ? `No contributions yet today. One push feeds ${name}.`
      : g.level >= 4
        ? `Top of the chart today. ${name} is ${LEVEL_WORD[4]}.`
        : `${name} is ${LEVEL_WORD[g.level]}. More contributions push it to level ${g.level + 1}.`
  $('cbStreak').textContent = linked ? `streak ${g.streak}` : 'no data'
  const today = new Date().getDay()
  $('cbWeek').replaceChildren(
    ...(linked ? g.week : [0, 0, 0, 0, 0, 0, 0]).map((level, i, all) => {
      const d = el('div')
      const sq = el('span', `sq${i === all.length - 1 ? ' today' : ''}`)
      sq.style.background = GRID[level]
      d.append(sq, DAYS[(today - (all.length - 1 - i) + 70) % 7])
      return d
    })
  )

  if (signingIn) return
  $('ghPending').hidden = true
  $('ghSignedOut').hidden = linked
  $('ghSignedIn').hidden = !linked
  if (!linked) {
    $<HTMLButtonElement>('signIn').disabled = !g.signInAvailable
    $('signInHint').hidden = g.signInAvailable
    $('signInHint').textContent = "GitHub sign-in isn't set up in this build: it needs GitGremlin's GitHub OAuth App client ID (see the README)."
    $('useCli').hidden = !g.ghAvailable
    ghError(null)
    return
  }
  const avatar = $<HTMLImageElement>('avatar')
  if (g.avatarUrl) avatar.src = g.avatarUrl
  avatar.hidden = !g.avatarUrl
  $('ghName').textContent = g.name || g.login
  $('ghLogin').textContent = `@${g.login} · ${g.source === 'oauth' ? 'signed in with GitHub' : 'via the GitHub CLI'}`
  ghError(g.error ? `Last refresh failed: ${g.error}` : null)
}

async function startSignIn(): Promise<void> {
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
    show('catbot')
  } catch (err) {
    ghError(cleanError(err))
  } finally {
    btn.disabled = false
  }
}

async function useCli(): Promise<void> {
  ghError(null)
  const result = await api.useGitHubCli()
  await reload()
  if (!result.ok) ghError(result.error ?? 'Could not use the GitHub CLI login.')
}

async function refreshGitHub(): Promise<void> {
  toast('Checking GitHub...')
  apply(await api.refreshGitHub())
}

function wireCatbot(): void {
  $('signIn').addEventListener('click', () => void startSignIn())
  $('useCli').addEventListener('click', () => void useCli())
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
  $('signOut').addEventListener('click', async () => apply(await api.signOutGitHub()))
  $('refresh').addEventListener('click', () => void refreshGitHub())
}

// --- Dusty: junk ----------------------------------------------------------------------------------
/** Categories the user unticked (kept across refreshes). */
const unticked = new Set<string>()

function cleanableJunk() {
  const cfg = view.settings.dusty
  return (view.dusty.scan?.categories ?? []).filter((c) => cfg.targets[c.target] && !c.blocked && c.bytes > 0)
}

function selectedJunk() {
  return view.settings.dusty.mode === 'report' ? [] : cleanableJunk().filter((c) => !unticked.has(c.id))
}

const CHECK = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="square" aria-hidden="true"><path d="M4 12l5 5L20 6"></path></svg>'

function renderDusty(): void {
  const d = view.dusty
  const cfg = view.settings.dusty
  const enabled = view.settings.pets.dusty.enabled
  setRadio(document.querySelector('[aria-label="Cleaning mode"]')!, 'data-mode', draft.dusty.mode)
  for (const s of document.querySelectorAll<HTMLElement>('[data-t]')) setSwitch(s, draft.dusty.targets[s.dataset.t as JunkTarget])
  $<HTMLSelectElement>('scanEvery').value = String(draft.dusty.scanEveryMinutes)
  for (const f of document.querySelectorAll<HTMLElement>('[data-f]')) {
    const t = f.dataset.f as JunkTarget
    const bytes = (d.scan?.categories ?? []).filter((c) => c.target === t).reduce((s, c) => s + c.bytes, 0)
    f.textContent = d.scan && cfg.targets[t] ? formatBytes(bytes) : ''
  }

  const info = !enabled ? 'Dusty is resting.' : d.busy === 'scanning' ? 'Sniffing around...' : d.busy === 'cleaning' ? 'Munching...' : cfg.mode === 'report' ? 'Report only: nothing is deleted.' : "Tick what goes. You'll confirm first."
  $('scanInfo').textContent = info

  const rows = $('junkRows')
  const cats = (d.scan?.categories ?? []).filter((c) => cfg.targets[c.target])
  rows.replaceChildren(
    ...cats.map((c) => {
      const can = !c.blocked && c.bytes > 0 && cfg.mode !== 'report'
      const on = can && !unticked.has(c.id)
      const r = el('div', `r${can ? '' : ' dim'}`)
      const box = el('button', 'check')
      box.type = 'button'
      box.setAttribute('role', 'checkbox')
      box.setAttribute('aria-checked', String(on))
      box.setAttribute('aria-label', `Clean ${c.label}`)
      box.disabled = !can
      box.innerHTML = CHECK
      box.addEventListener('click', () => {
        if (unticked.has(c.id)) unticked.delete(c.id)
        else unticked.add(c.id)
        renderDusty()
        fillPet('dusty')
      })
      const n = el('span', 'n', c.label)
      if (c.target === 'recycleBin') n.append(el('span', 'tag hot', 'permanent'))
      if (c.blocked) n.append(el('span', 'tag', c.blocked))
      n.append(el('small', '', `${plural(c.items, 'item')}${c.target === 'temp' ? ' · in-use files are skipped' : ''}`))
      r.append(box, n, el('span', 'sz', formatBytes(c.bytes)))
      return r
    })
  )
  if (!cats.length) rows.append(el('div', 'empty', d.scan ? 'Nothing to clean. All tidy!' : 'Click Scan now to look for junk.'))

  const sel = selectedJunk().reduce((s, c) => s + c.bytes, 0)
  $('junkTotal').textContent = formatBytes(sel)
  const clean = $<HTMLButtonElement>('cleanNow')
  clean.hidden = cfg.mode === 'report'
  clean.disabled = !sel || Boolean(d.busy) || !enabled
}

async function scanJunk(): Promise<void> {
  const p = api.dustyScan()
  await reload() // show "Sniffing..." right away
  apply(await p)
}

async function cleanJunk(): Promise<void> {
  const cats = selectedJunk()
  if (!cats.length) return
  const ok = await confirmDialog({
    title: `Let ${view.settings.pets.dusty.name} eat this junk?`,
    items: cats.map((c) => `${c.label}: ${formatBytes(c.bytes)}`),
    warn: cats.some((c) => c.target === 'recycleBin') ? "The Recycle Bin is emptied for good: those files can't be restored afterwards." : undefined,
    hint: 'Apps rebuild their caches when they need them. Files in use are skipped.',
    ok: 'Delete'
  })
  if (!ok) return
  const p = api.dustyClean(cats.map((c) => c.id))
  await reload()
  const v = await p
  apply(v)
  if (v.dusty.lastClean) toast(`Freed ${formatBytes(v.dusty.lastClean.freedBytes)}`)
}

function wireDusty(): void {
  for (const b of document.querySelectorAll<HTMLElement>('[data-mode]')) {
    b.addEventListener('click', () => {
      draft.dusty.mode = b.dataset.mode as CleanMode
      renderDusty()
      saveSoon(0)
    })
  }
  for (const s of document.querySelectorAll<HTMLElement>('[data-t]')) {
    s.addEventListener('click', () => {
      const t = s.dataset.t as JunkTarget
      draft.dusty.targets[t] = !draft.dusty.targets[t]
      setSwitch(s, draft.dusty.targets[t])
      saveSoon(0)
    })
  }
  $('scanEvery').addEventListener('change', (e) => {
    draft.dusty.scanEveryMinutes = Number((e.target as HTMLSelectElement).value)
    saveSoon(0)
  })
  $('cleanNow').addEventListener('click', () => void cleanJunk())
}

// --- Syncy: work not on GitHub ---------------------------------------------------------------------
const hasWork = (r: RepoInfo) => !r.error && (r.changes > 0 || r.unpushed > 0 || r.stashes > 0)
const oldestOf = (r: RepoInfo) => Math.min(...[r.changesSince, r.unpushedSince, r.stashSince].map((t) => t ?? Infinity))

function isStale(r: RepoInfo): boolean {
  const limit = view.settings.syncy.staleHours * 3_600_000
  return [r.changesSince, r.unpushedSince, r.stashSince].some((t) => t !== null && Date.now() - t > limit)
}

const SVG_FOLDER = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path></svg>'
const SVG_CODE = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 7l-5 5 5 5"></path><path d="M16 7l5 5-5 5"></path><path d="M13.5 4l-3 16"></path></svg>'
const SVG_BRANCH = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="2"></circle><circle cx="6" cy="18" r="2"></circle><circle cx="18" cy="8" r="2"></circle><path d="M6 8v8"></path><path d="M18 10c0 4-6 3-10 6"></path></svg>'

function iconButton(svg: string, label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = button('', title, onClick)
  b.innerHTML = `${svg}${escapeHtml(label)}`
  return b
}

async function repoAction(action: RepoAction): Promise<void> {
  const r = await api.syncyAction(action)
  toast(r.message)
  await reload()
}

function short(t: number | null): string {
  if (t === null) return ''
  const h = (Date.now() - t) / 3_600_000
  return h < 1 ? 'now' : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`
}

function repoRow(r: RepoInfo): HTMLElement {
  const row = el('div', 'repo')
  const left = el('div')
  const name = el('div', 'repo-name', r.name)
  if (r.branch) name.append(el('span', 'tag', r.branch))
  const path = el('div', 'path', r.path)
  path.title = r.path
  const badges = el('div', 'badges')
  const limit = view.settings.syncy.staleHours * 3_600_000
  const kind = (t: number | null) => (t !== null && Date.now() - t > limit ? 'b hot' : 'b warn')
  if (r.error) badges.append(el('span', 'b hot', `Couldn't check: ${r.error}`))
  if (r.unpushed) badges.append(el('span', kind(r.unpushedSince), `${plural(r.unpushed, 'commit')} not on GitHub · ${short(r.unpushedSince)}`))
  if (r.changes) badges.append(el('span', kind(r.changesSince), `${plural(r.changes, 'uncommitted change')} · ${short(r.changesSince)}`))
  if (r.stashes) badges.append(el('span', kind(r.stashSince), `${plural(r.stashes, 'stash', 'stashes')} · ${short(r.stashSince)}`))
  if (!r.hasRemote && !r.error) badges.append(el('span', 'b', 'no remote: not backed up'))
  if (r.merged.length) badges.append(el('span', 'b', plural(r.merged.length, 'merged branch', 'merged branches')))
  left.append(name, path, badges)

  const acts = el('div', 'acts')
  acts.append(iconButton(SVG_FOLDER, 'Open', 'Open this repo in File Explorer', () => void repoAction({ kind: 'open', path: r.path })))
  // Open it in VS Code, to commit and push from its Source Control view.
  if (view.syncy.vscode) acts.append(iconButton(SVG_CODE, 'VS Code', 'Open this repo in Visual Studio Code', () => void repoAction({ kind: 'vscode', path: r.path })))
  if (r.merged.length) {
    acts.append(
      iconButton(SVG_BRANCH, 'Delete merged', r.merged.join(', '), async () => {
        const ok = await confirmDialog({
          title: `Delete merged branches in ${r.name}?`,
          items: r.merged,
          hint: `These local branches are already merged into ${r.base ?? 'your main branch'}, so their work is safe there. Branches on GitHub aren't touched, and git refuses to delete a branch that isn't fully merged.`,
          ok: 'Delete branches'
        })
        if (ok) await repoAction({ kind: 'deleteBranches', path: r.path, branches: r.merged })
      })
    )
  }
  acts.append(button('Ignore', 'Stop watching this repo', () => void repoAction({ kind: 'ignore', path: r.path }), 'ib ghost'))
  row.append(left, acts)
  return row
}

function pathRow(path: string, label: string, title: string, onClick: () => void): HTMLElement {
  const row = el('div', 'folder')
  const span = el('span', '', path)
  span.title = path
  row.append(span, button(label, title, onClick, 'ib ghost'))
  return row
}

function renderSyncy(): void {
  const v = view.syncy
  const scan = v.scan
  const cfg = draft.syncy
  setSeg($('syncyStale'), 'data-h', String(cfg.staleHours))
  $<HTMLSelectElement>('syncySummary').value = cfg.summaryHour === null ? 'off' : String(cfg.summaryHour)
  $<HTMLSelectElement>('syncyEvery').value = String(cfg.scanEveryMinutes)
  setSwitch($('syncyBranches'), cfg.trackBranches)
  setSwitch($('syncyAuto'), cfg.autoFind)
  $('syncyAutoHint').textContent = v.autoRoots.length ? `Searches ${v.autoRoots.join(', ')}` : 'Your user folder, code folders and other local drives'
  $('syncyFolders').replaceChildren(
    ...cfg.folders.map((f) =>
      pathRow(f, 'Remove', 'Stop searching this folder', () => {
        draft.syncy.folders = draft.syncy.folders.filter((x) => x !== f)
        saveSoon(0)
        renderSyncy()
      })
    )
  )
  $('syncyIgnoredBox').hidden = !cfg.ignored.length
  $('syncyIgnored').replaceChildren(...cfg.ignored.map((p) => pathRow(p, 'Watch again', 'Watch this repo again', () => void repoAction({ kind: 'unignore', path: p }))))

  const repos = scan?.repos ?? []
  const info = scan?.gitMissing
    ? "Git isn't installed (or isn't on PATH), so Syncy can't check your repos."
    : `Oldest first · red is older than ${cfg.staleHours >= 24 ? plural(cfg.staleHours / 24, 'day') : `${cfg.staleHours} h`} · as of your last fetch`
  $('syncyInfo').textContent = info
  const needs = repos
    .filter((r) => hasWork(r) || r.merged.length || r.error)
    .sort((a, b) => Number(isStale(b)) - Number(isStale(a)) || oldestOf(a) - oldestOf(b))
  $('syncyRepos').replaceChildren(...needs.map(repoRow))
  if (!needs.length) {
    $('syncyRepos').append(
      el('div', 'empty', !scan ? 'Click Check now to look at your repos.' : repos.length ? 'Everything is on GitHub. Nothing to do!' : 'No repos found yet. Add a folder below.')
    )
  }
  $('syncyAllTitle').textContent = `All ${plural(repos.length, 'repo')}`
  $('syncyAll').replaceChildren(
    ...repos.map((r) => {
      const row = el('div', 'repo')
      const left = el('div')
      left.append(el('div', 'repo-name', r.name), el('div', 'path', r.path))
      const ok = !r.error && !hasWork(r)
      row.append(left, el('span', ok ? 'b ok' : isStale(r) || r.error ? 'b hot' : 'b warn', r.error ? 'error' : ok ? 'all on GitHub' : 'unsaved work'))
      return row
    })
  )
}

async function checkRepos(): Promise<void> {
  const p = api.syncyScan()
  await reload() // show "Checking..." right away
  apply(await p)
}

function wireSyncy(): void {
  for (const b of $('syncyStale').querySelectorAll<HTMLElement>('[data-h]')) {
    b.addEventListener('click', () => {
      draft.syncy.staleHours = Number(b.dataset.h)
      renderSyncy()
      saveSoon(0)
    })
  }
  $('syncySummary').addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value
    draft.syncy.summaryHour = v === 'off' ? null : Number(v)
    saveSoon(0)
  })
  $('syncyEvery').addEventListener('change', (e) => {
    draft.syncy.scanEveryMinutes = Number((e.target as HTMLSelectElement).value)
    saveSoon(0)
  })
  $('syncyBranches').addEventListener('click', () => {
    draft.syncy.trackBranches = !draft.syncy.trackBranches
    renderSyncy()
    saveSoon(0)
  })
  $('syncyAuto').addEventListener('click', () => {
    draft.syncy.autoFind = !draft.syncy.autoFind
    renderSyncy()
    saveSoon(0)
  })
  $('syncyAddFolder').addEventListener('click', async () => {
    const folder = await api.pickFolder()
    if (!folder || draft.syncy.folders.some((f) => f.toLowerCase() === folder.toLowerCase())) return
    draft.syncy.folders.push(folder)
    renderSyncy()
    saveSoon(0)
  })
}

// --- General -------------------------------------------------------------------------------------
function renderGeneral(): void {
  const on = PET_IDS.filter((id) => view.settings.pets[id].enabled).length
  $('generalStats').replaceChildren(...[plural(PET_IDS.length, 'pet'), view.hidden ? 'hidden for now' : `${on} awake`, 'lives in your tray'].map((t) => el('span', '', t)))
  $('lineupBubble').textContent = view.hidden ? 'WE ARE HIDING. BACK SOON.' : on === PET_IDS.length ? `ALL ${on} OF US ARE AWAKE.` : `${on} OF ${PET_IDS.length} OF US ARE AWAKE.`
  setRadio(document.querySelector('[aria-label="Where pets live"]')!, 'data-layer', draft.onTopOfApps ? 'top' : 'desktop')
  setSwitch($('startWithWindows'), sww)
  setSeg(document.querySelector('[aria-label="Theme"]')!, 'data-theme', draft.theme)
  $('hidePets').textContent = view.hidden ? 'Show pets' : 'Hide for 1 h'
  $('hideHint').textContent = view.hidden ? 'Pets are hidden right now' : 'They come back on their own after an hour'
  $('version').textContent = `v${view.version}`
}

function wireGeneral(): void {
  for (const b of document.querySelectorAll<HTMLElement>('[data-layer]')) {
    b.addEventListener('click', () => {
      draft.onTopOfApps = b.dataset.layer === 'top'
      renderGeneral()
      saveSoon(0)
    })
  }
  $('startWithWindows').addEventListener('click', () => {
    sww = !sww
    renderGeneral()
    saveSoon(0)
  })
  for (const b of document.querySelectorAll<HTMLElement>('[data-theme]')) {
    b.addEventListener('click', () => {
      draft.theme = b.dataset.theme as ThemeMode
      renderGeneral()
      saveSoon(0)
    })
  }
  $('hidePets').addEventListener('click', async () => apply(await api.hidePets(!view.hidden)))
  for (const b of document.querySelectorAll<HTMLElement>('[data-url]')) b.addEventListener('click', () => void api.openGitHub(b.dataset.url!))
  document.querySelector('.nav[data-page="general"]')!.addEventListener('click', () => show('general'))
  // Three pets side by side, drawn from their sprites.
  const lineup = $('lineup')
  void Promise.all([
    petCanvas('catbot', 'sit', 0, 'idle', 4),
    petCanvas('syncy', 'idle', 0, 'idle', 4),
    petCanvas('dusty', 'wash', 0, 'happy', 4)
  ]).then((cs) => {
    lineup.replaceChildren(...cs)
    fitPets()
  })
}

// --- view ----------------------------------------------------------------------------------------
function apply(v: HubView, refill = false): void {
  view = v
  // Don't clobber edits that haven't been saved yet.
  if (refill || saveTimer === null) {
    draft = structuredClone(v.settings)
    sww = v.startWithWindows
  }
  renderNav()
  renderCatbot()
  renderDusty()
  renderSyncy()
  renderGeneral()
  for (const id of PET_IDS) fillPet(id)
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
    const p = buildPetPage(id)
    pages.set(id, p)
    host.append(p)
  }
  wireCatbot()
  wireDusty()
  wireSyncy()
  wireGeneral()
  apply(view, true)
  show(page)
  api.onShowPage((p) => show(p))
  window.addEventListener('resize', fitPets)
  api.onHubChanged(() => void reload())
  // Keep "x min ago" fresh.
  window.setInterval(() => void reload(), 30_000)
}

void start()
