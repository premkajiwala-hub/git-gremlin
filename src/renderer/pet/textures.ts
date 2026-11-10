import * as THREE from 'three'

export const TEXTURE_NAMES = [
  'head_top',
  'head_side',
  'head_back',
  'head_bottom',
  'head_front',
  'eyes_open',
  'eyes_closed',
  'body_top',
  'body_side',
  'body_end',
  'body_bottom',
  'leg_side',
  'leg_top',
  'leg_bottom',
  'antenna_stem',
  'antenna_tip_off',
  'antenna_tip_on',
  'food',
  'heart',
  'zzz'
] as const

export type TextureName = (typeof TEXTURE_NAMES)[number]
export type TextureSet = Record<TextureName, THREE.Texture>

/** Load the PNGs from assets/textures (served as ./textures/) with nearest-neighbour filtering. */
export async function loadTextures(): Promise<TextureSet> {
  const loader = new THREE.TextureLoader()
  const entries = await Promise.all(
    TEXTURE_NAMES.map(async (name) => {
      const tex = await loader.loadAsync(`./textures/${name}.png`)
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
