import meta from '../../../assets/catbot/frames.json'

export type AnimName = 'idle' | 'walk-right' | 'walk-left' | 'sit' | 'sleep' | 'jump' | 'curious' | 'happy' | 'hurt'

export interface Anim {
  frames: HTMLImageElement[]
  fps: number
  loop: boolean
}

export interface SpriteSet {
  /** Size of every frame image, in sheet pixels. */
  cellW: number
  cellH: number
  /** Where the catbot's feet are inside each frame. */
  anchorX: number
  anchorY: number
  /** Typical standing catbot size (ears to feet), used to scale to the size setting. */
  standHeight: number
  standWidth: number
  anims: Record<AnimName, Anim>
  heart: HTMLImageElement
  food: HTMLImageElement
}

function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image()
  img.src = src
  return img.decode().then(() => img)
}

/** Load the sliced catbot frames (assets/catbot) and particle sprites (assets/textures). */
export async function loadSprites(): Promise<SpriteSet> {
  const anims = {} as Record<AnimName, Anim>
  await Promise.all(
    Object.entries(meta.anims).map(async ([name, a]) => {
      anims[name as AnimName] = {
        frames: await Promise.all(a.frames.map((f) => loadImage(`./catbot/${f}`))),
        fps: a.fps,
        loop: a.loop
      }
    })
  )
  const [heart, food] = await Promise.all([loadImage('./textures/heart.png'), loadImage('./textures/food.png')])
  return {
    cellW: meta.cell.w,
    cellH: meta.cell.h,
    anchorX: meta.anchor.x,
    anchorY: meta.anchor.y,
    standHeight: meta.standHeight,
    standWidth: meta.standWidth,
    anims,
    heart,
    food
  }
}

/** Frame index of an animation after `t` seconds (looping or holding the last frame). */
export function frameAt(anim: Anim, t: number): number {
  const i = Math.floor(t * anim.fps)
  return anim.loop ? i % anim.frames.length : Math.min(anim.frames.length - 1, i)
}

export function animLength(anim: Anim): number {
  return anim.frames.length / anim.fps
}
