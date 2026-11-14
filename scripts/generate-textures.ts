/**
 * Draws every GitGremlin pet in code and exports the PNGs so they can be
 * repainted in Aseprite or Piskel:
 *
 *   assets/pets/<pet>/<anim>-<n>.png   side-view frames, facing right
 *   assets/pets/<pet>/eyes_<mood>.png  eye overlays (idle, blink, happy, hurt, alert, sad)
 *   assets/pets/<pet>/accent_on.png    lit accent (Catbot's bell), if any
 *   assets/pets/<pet>/food.png         what the pet eats (and its crumbs)
 *   assets/pets/<pet>/portrait.png     head portrait for the GitGremlin panel
 *   assets/pets/<pet>/frames.json      animations, frame rates, anchor, overlay positions
 *   assets/textures/heart.png, zzz.png shared particles
 *   assets/icon.png, build/icon.png    GitGremlin app (tray / installer) icon
 *   assets/icon.ico                    the same, for the Start menu shortcut
 *
 * Run with:  npm run textures              (every pet; overwrites repainted files)
 *            npm run textures -- syncy     (only the pets named)
 * Each pet's drawing lives in scripts/art/<pet>.ts.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { catbot } from './art/catbot.ts'
import { dusty } from './art/dusty.ts'
import { syncy } from './art/syncy.ts'
import { Img, png, scale, stamp, type PetArt } from './art/pixel.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PETS = join(ROOT, 'assets', 'pets')
const TEX = join(ROOT, 'assets', 'textures')

function writePet(art: PetArt): number {
  const dir = join(PETS, art.id)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const anims: Record<string, { fps: number; loop: boolean; frames: { file: string; screen: [number, number]; accent: [number, number] | null }[] }> = {}
  let count = 0
  for (const [name, a] of Object.entries(art.anims)) {
    anims[name] = { fps: a.fps, loop: a.loop, frames: [] }
    a.frames.forEach((f, i) => {
      const file = `${name}-${i}.png`
      writeFileSync(join(dir, file), png(f.img))
      anims[name].frames.push({ file, screen: f.screen, accent: f.accent })
      count++
    })
  }
  // Standing height (ears to paws), measured from the first idle frame.
  const idle = art.anims.idle.frames[0].img
  let top = idle.h
  for (let y = 0; y < idle.h && top === idle.h; y++) for (let x = 0; x < idle.w; x++) if (idle.alpha(x, y)) top = y
  for (const [mood, img] of Object.entries(art.eyes)) writeFileSync(join(dir, `eyes_${mood}.png`), png(img))
  if (art.accentOn) writeFileSync(join(dir, 'accent_on.png'), png(art.accentOn))
  writeFileSync(join(dir, 'food.png'), png(art.food))
  writeFileSync(join(dir, 'portrait.png'), png(scale(art.portrait, 3)))
  const eye = Object.values(art.eyes)[0]
  writeFileSync(
    join(dir, 'frames.json'),
    JSON.stringify(
      {
        cell: art.cell,
        anchor: art.anchor,
        standHeight: art.anchor.y - top,
        eyes: { w: eye.w, h: eye.h },
        accent: art.accentOn ? 'accent_on.png' : null,
        anims
      },
      null,
      2
    )
  )
  return count
}

mkdirSync(PETS, { recursive: true })
mkdirSync(TEX, { recursive: true })
const only = process.argv.slice(2)
const pets = [catbot, dusty, syncy].filter((f) => !only.length || only.includes(f.name)).map((f) => f())
if (only.length && pets.length !== only.length) throw new Error(`Unknown pet in: ${only.join(', ')}`)
for (const art of pets) console.log(`${art.id}: ${writePet(art)} frames`)

// Shared particles.
const heart = new Img(9, 8)
stamp(heart, ['.XX.XX.', 'XoXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'], 1, 1, '#ff5b6e', '#ffc0c7')
heart.outline('#4a0e18')
writeFileSync(join(TEX, 'heart.png'), png(heart))
const zzz = new Img(7, 7)
stamp(zzz, ['XXXXX', '...X.', '..X..', '.X...', 'XXXXX'], 1, 1, '#5ef2ff')
zzz.outline('#0a2a33')
writeFileSync(join(TEX, 'zzz.png'), png(zzz))

// GitGremlin app icon: a dark tile with a 2x2 contribution grid and an orange paw print.
const icon = new Img(20, 20)
icon.round(0, 0, 20, 20, '#11161c')
const greens = ['#0e4429', '#26a641', '#006d32', '#39d353']
greens.forEach((c, i) => icon.rect(3 + (i % 2) * 7, 3 + Math.floor(i / 2) * 7, 6, 6, c))
stamp(icon, ['.X.X.', 'X.X.X', '.....', '.XXX.', 'XXXXX', '.XXX.'], 7, 7, '#ff9a2e')
const paw = new Img(20, 20)
stamp(paw, ['.X.X.', 'X.X.X', '.....', '.XXX.', 'XXXXX', '.XXX.'], 7, 7, '#ff9a2e')
paw.outline('#11161c')
icon.over(paw)
writeFileSync(join(ROOT, 'assets', 'icon.png'), png(scale(icon, 2)))
mkdirSync(join(ROOT, 'build'), { recursive: true })
writeFileSync(join(ROOT, 'build', 'icon.png'), png(scale(icon, 13)))
writeFileSync(join(ROOT, 'assets', 'icon.ico'), ico([1, 2, 3, 5, 12].map((k) => png(scale(icon, k)))))

/** A Windows .ico holding PNG images (supported since Vista), for the Start menu shortcut. */
function ico(images: Buffer[]): Buffer {
  const head = Buffer.alloc(6 + 16 * images.length)
  head.writeUInt16LE(0, 0)
  head.writeUInt16LE(1, 2) // type: icon
  head.writeUInt16LE(images.length, 4)
  let offset = head.length
  images.forEach((img, i) => {
    const size = img.readUInt32BE(16) // PNG IHDR width (square)
    const e = 6 + 16 * i
    head.writeUInt8(size >= 256 ? 0 : size, e)
    head.writeUInt8(size >= 256 ? 0 : size, e + 1)
    head.writeUInt16LE(1, e + 4) // planes
    head.writeUInt16LE(32, e + 6) // bits per pixel
    head.writeUInt32LE(img.length, e + 8)
    head.writeUInt32LE(offset, e + 12)
    offset += img.length
  })
  return Buffer.concat([head, ...images])
}

console.log(`Wrote ${pets.length} pets to ${PETS}, particles and icons`)
