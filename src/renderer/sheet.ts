/** Dev-only viewer for the generated catbot frames: every animation, enlarged, with eyes and lit bell. */
import meta from '../../assets/catbot/frames.json'

const K = Number(new URLSearchParams(location.search).get('k') ?? 3)
const MOOD: Record<string, string> = { sleep: 'blink', starving: 'sad', idle_sad: 'sad', walk_sad: 'sad', happy: 'happy', eat: 'happy', hurt: 'hurt', dragged: 'alert', curious: 'alert', jump_up: 'alert', tap: 'sad' }

const load = (src: string) =>
  new Promise<HTMLImageElement>((resolve) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.src = src
  })

const rows = document.getElementById('rows')!
const bell = await load('./catbot/bell_on.png')
for (const [name, anim] of Object.entries(meta.anims)) {
  const row = document.createElement('div')
  row.className = 'row'
  const label = document.createElement('span')
  label.textContent = name
  row.append(label)
  const eyes = await load(`./catbot/eyes_${MOOD[name] ?? 'idle'}.png`)
  for (const f of anim.frames) {
    const img = await load(`./catbot/${f.file}`)
    const c = document.createElement('canvas')
    c.width = meta.cell.w
    c.height = meta.cell.h
    c.style.width = `${meta.cell.w * K}px`
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    ctx.drawImage(eyes, f.screen[0], f.screen[1])
    if (!name.includes('sad') && name !== 'starving') ctx.drawImage(bell, f.bell[0], f.bell[1])
    row.append(c)
  }
  rows.append(row)
}
