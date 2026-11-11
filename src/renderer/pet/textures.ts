import * as THREE from 'three'

export const TEXTURE_NAMES = [
  'head_front',
  'head_side',
  'head_top',
  'head_back',
  'head_bottom',
  'eyes_idle',
  'eyes_blink',
  'eyes_happy',
  'eyes_hurt',
  'eyes_alert',
  'eyes_sad',
  'ear_front',
  'ear_side',
  'ear_tip',
  'body_side',
  'body_top',
  'body_end',
  'body_bottom',
  'leg_side',
  'leg_top',
  'leg_bottom',
  'tail_light',
  'tail_dark',
  'tail_tip',
  'collar',
  'bell_on',
  'bell_off',
  'food',
  'heart',
  'zzz'
] as const

export type TextureName = (typeof TEXTURE_NAMES)[number]
export type TextureSet = Record<TextureName, THREE.Texture>

/** A 2x2 magenta/black checker, used when a PNG is missing or broken. */
function missingTexture(): THREE.Texture {
  const data = new Uint8Array([255, 0, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 0, 255, 255])
  const tex = new THREE.DataTexture(data, 2, 2)
  tex.needsUpdate = true
  return tex
}

/** Load the PNGs from assets/textures (served as ./textures/) with nearest-neighbour filtering. */
export async function loadTextures(): Promise<TextureSet> {
  const loader = new THREE.TextureLoader()
  const entries = await Promise.all(
    TEXTURE_NAMES.map(async (name) => {
      // One broken or missing repaint shouldn't stop Catbot from appearing.
      const tex = await loader.loadAsync(`./textures/${name}.png`).catch(() => {
        console.error(`[textures] could not load textures/${name}.png`)
        return missingTexture()
      })
      tex.magFilter = THREE.NearestFilter
      tex.minFilter = THREE.NearestFilter
      tex.generateMipmaps = false
      tex.colorSpace = THREE.SRGBColorSpace
      tex.wrapS = THREE.RepeatWrapping
      tex.wrapT = THREE.RepeatWrapping
      return [name, tex] as const
    })
  )
  return Object.fromEntries(entries) as TextureSet
}
