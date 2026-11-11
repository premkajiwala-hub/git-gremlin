import meta from '../../../assets/catbot/frames.json'

export type AnimName = keyof typeof meta.anims
export type Mood = 'idle' | 'blink' | 'happy' | 'hurt' | 'alert' | 'sad'
const MOODS: Mood[] = ['idle', 'blink', 'happy', 'hurt', 'alert', 'sad']

export interface Frame {
  img: HTMLImageElement
  /** Top-left of the face-screen's eye area, in frame pixels. */
  screen: [number, number]
  /** Top-left of the collar bell, in frame pixels. */
  bell: [number, number]
}

export interface Anim {
  frames: Frame[]
  fps: number
  loop: boolean
}

export interface SpriteSet {
  cellW: number
  cellH: number
  /** The catbot's feet (bottom centre) inside each frame. */
  anchorX: number
  anchorY: number
  /** Standing height in frame pixels (ears to paws). */
  standHeight: number
  anims: Record<AnimName, Anim>
  eyes: Record<Mood, HTMLImageElement>
  bellOn: HTMLImageElement
  food: HTMLImageElement
  heart: HTMLImageElement
  zzz: HTMLImageElement
}

/** Load an image; a missing or broken file becomes a tiny magenta placeholder instead of failing. */
function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => {
      console.error(`[sprites] could not load ${src}`)
      const c = document.createElement('canvas')
      c.width = c.height = 2
      const ctx = c.getContext('2d')!
      ctx.fillStyle = '#ff00ff'
      ctx.fillRect(0, 0, 2, 2)
      const fallback = new Image()
      fallback.onload = () => resolve(fallback)
      fallback.src = c.toDataURL()
    }
    img.src = src
  })
}

/** Load Catbot's frames (assets/catbot) and particle sprites (assets/textures). */
export async function loadSprites(): Promise<SpriteSet> {
  const anims = {} as Record<AnimName, Anim>
  await Promise.all(
    (Object.entries(meta.anims) as [AnimName, (typeof meta.anims)[AnimName]][]).map(async ([name, a]) => {
      anims[name] = {
        fps: a.fps,
        loop: a.loop,
        frames: await Promise.all(
          a.frames.map(async (f) => ({
            img: await load(`./catbot/${f.file}`),
            screen: f.screen as [number, number],
            bell: f.bell as [number, number]
          }))
        )
      }
    })
  )
  const eyes = Object.fromEntries(await Promise.all(MOODS.map(async (m) => [m, await load(`./catbot/eyes_${m}.png`)] as const))) as Record<
    Mood,
    HTMLImageElement
  >
  const [bellOn, food, heart, zzz] = await Promise.all([
    load('./catbot/bell_on.png'),
    load('./textures/food.png'),
    load('./textures/heart.png'),
    load('./textures/zzz.png')
  ])
  return {
    cellW: meta.cell.w,
    cellH: meta.cell.h,
    anchorX: meta.anchor.x,
    anchorY: meta.anchor.y,
    standHeight: meta.standHeight,
    anims,
    eyes,
    bellOn,
    food,
    heart,
    zzz
  }
}

/** Frame index of an animation after `t` seconds (looping, or holding the last frame). */
export function frameAt(anim: Anim, t: number): number {
  const i = Math.floor(t * anim.fps)
  return anim.loop ? i % anim.frames.length : Math.min(anim.frames.length - 1, i)
}

/**
 * Whole device pixels per sprite pixel for a requested on-screen height, so
 * the pixel art always stays crisp.
 */
export function pixelScale(sizeCss: number, standHeight: number, dpr: number): number {
  return Math.max(2, Math.round((sizeCss * dpr) / standHeight + 0.2))
}
