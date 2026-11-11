/**
 * Dev-only viewer for the generated pet frames: every animation, enlarged,
 * with eyes and accent. http://localhost:5173/sheet.html?pet=dusty&k=6
 */
const params = new URLSearchParams(location.search)
const K = Number(params.get('k') ?? 4)
const PET = params.get('pet') ?? 'catbot'
const metas = import.meta.glob('../../assets/pets/*/frames.json', { eager: true, import: 'default' }) as Record<
  string,
  {
    cell: { w: number; h: number }
    accent: string | null
    anims: Record<string, { frames: { file: string; screen: [number, number]; accent: [number, number] | null }[] }>
  }
>
const meta = metas[`../../assets/pets/${PET}/frames.json`]
const MOOD: Record<string, string> = {
  sleep: 'blink',
  starving: 'sad',
  idle_sad: 'sad',
  walk_sad: 'sad',
  happy: 'happy',
  eat: 'happy',
  wash: 'happy',
  hurt: 'hurt',
  dragged: 'alert',
  curious: 'alert',
  rummage: 'alert',
  jump_up: 'alert',
  tap: 'sad'
}

const load = (src: string) =>
  new Promise<HTMLImageElement>((resolve) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.src = src
  })

const rows = document.getElementById('rows')!
const base = `./pets/${PET}/`
const accent = meta.accent ? await load(base + meta.accent) : null
for (const [name, anim] of Object.entries(meta.anims)) {
  const row = document.createElement('div')
  row.className = 'row'
  const label = document.createElement('span')
  label.textContent = name
  row.append(label)
  const eyes = await load(`${base}eyes_${MOOD[name] ?? 'idle'}.png`)
  for (const f of anim.frames) {
    const img = await load(base + f.file)
    const c = document.createElement('canvas')
    c.width = meta.cell.w
    c.height = meta.cell.h
    c.style.width = `${meta.cell.w * K}px`
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    ctx.drawImage(eyes, f.screen[0], f.screen[1])
    if (accent && f.accent && !name.includes('sad') && name !== 'starving') ctx.drawImage(accent, f.accent[0], f.accent[1])
    row.append(c)
  }
  rows.append(row)
}
