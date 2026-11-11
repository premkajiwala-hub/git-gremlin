import * as THREE from 'three'
import { EXPRESSIONS, neutralPose, type Pose } from './pose'
import type { TextureName, TextureSet } from './textures'

/**
 * Fixed per-face brightness, in BoxGeometry face order:
 * +x (the catbot's front), -x (back), +y (top), -y (bottom), +z, -z (sides).
 * No lights, no shadows: flat shading like a blocky sandbox game.
 */
const FACE_BRIGHTNESS = [0.8, 0.6, 1.0, 0.5, 0.6, 0.6]

type FaceTextures = [TextureName, TextureName, TextureName, TextureName, TextureName, TextureName]
const all = (t: TextureName): FaceTextures => [t, t, t, t, t, t]

interface TintedMaterial {
  mat: THREE.MeshBasicMaterial
  k: number
}

/** Model units: 1 unit = 1 texel. Catbot is about 38 units tall (ears included). */
export const MODEL_HEIGHT = 38
const TAIL_SEGMENTS = 5

/**
 * Catbot: a blocky robot cat built from separate box meshes, each hanging off
 * its own pivot, so animation is just rotations. Its face is a dark screen
 * whose eye overlay swaps to show expressions.
 */
export class CatbotModel {
  readonly root = new THREE.Group()
  readonly pose: Pose = neutralPose()

  private lie = new THREE.Group()
  private lieInner = new THREE.Group()
  private bodyPivot = new THREE.Group()
  private neck = new THREE.Group()
  private ears: THREE.Group[] = []
  private tail: THREE.Group[] = []
  /** Leg pivots: +z front, -z front, +z back, -z back. */
  private legPivots: THREE.Group[] = []
  private eyesMat: THREE.MeshBasicMaterial
  private bellMats: THREE.MeshBasicMaterial[]
  private food: THREE.Mesh
  private tinted: TintedMaterial[] = []
  private lastTint = -1
  private lastGlow = -1

  constructor(private tex: TextureSet) {
    this.root.add(this.lie)
    this.lie.add(this.lieInner)
    this.lieInner.add(this.bodyPivot)
    const content = new THREE.Group()
    content.position.x = -2 // centre the catbot (head sticks out front, tail out back)
    this.bodyPivot.add(content)

    // Body: 24 long, 10 tall, 14 wide, on 7-unit legs.
    const body = this.box(24, 10, 14, ['body_end', 'body_end', 'body_top', 'body_bottom', 'body_side', 'body_side'])
    body.position.set(0, 12, 0)
    content.add(body)

    // Legs: pivot at the hip, mesh hangs below.
    for (const [x, z] of [
      [8, 4.5],
      [8, -4.5],
      [-8, 4.5],
      [-8, -4.5]
    ]) {
      const pivot = new THREE.Group()
      pivot.position.set(x, 7, z)
      const leg = this.box(5, 7, 5, ['leg_side', 'leg_side', 'leg_top', 'leg_bottom', 'leg_side', 'leg_side'])
      leg.position.y = -3.5
      pivot.add(leg)
      content.add(pivot)
      this.legPivots.push(pivot)
    }

    // Collar with a bell that glows when Catbot is well fed.
    const collar = this.box(2, 3, 15, all('collar'))
    collar.position.set(11.5, 16, 0)
    content.add(collar)
    const bell = this.box(3, 3, 3, all('bell_on'), true, false)
    bell.position.set(13, 14, 0)
    this.bellMats = bell.material as THREE.MeshBasicMaterial[]
    content.add(bell)

    // Head: a 16-unit cube with a face-screen, on a neck pivot.
    this.neck.position.set(9, 16, 0)
    content.add(this.neck)
    const head = this.box(16, 16, 16, ['head_front', 'head_back', 'head_top', 'head_bottom', 'head_side', 'head_side'])
    head.position.set(4, 7, 0)
    this.neck.add(head)

    // Glowing eyes: a transparent overlay on the screen at full brightness.
    this.eyesMat = new THREE.MeshBasicMaterial({ map: tex.eyes_idle, transparent: true, alphaTest: 0.5 })
    const eyes = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), this.eyesMat)
    eyes.rotation.y = Math.PI / 2
    eyes.position.set(8.05, 0, 0)
    head.add(eyes)

    // Ears: pivot at the base on the head's top, splayed slightly outward.
    for (const z of [5, -5]) {
      const pivot = new THREE.Group()
      pivot.position.set(1, 8, z)
      const outward = new THREE.Group()
      outward.rotation.x = Math.sign(z) * 0.2
      const ear = this.box(3, 4, 5, ['ear_front', 'ear_side', 'ear_side', 'ear_side', 'ear_side', 'ear_side'])
      ear.position.y = 2
      const tip = this.box(2, 3, 3, all('ear_tip'))
      tip.position.set(-0.5, 5.5, 0)
      outward.add(ear, tip)
      pivot.add(outward)
      head.add(pivot)
      this.ears.push(pivot)
    }

    // Tail: a chain of striped cable segments with an orange tip.
    let parent: THREE.Object3D = content
    for (let i = 0; i < TAIL_SEGMENTS; i++) {
      const pivot = new THREE.Group()
      if (i === 0) pivot.position.set(-12, 15, 0)
      else pivot.position.set(0, 4, 0)
      const name: TextureName = i === TAIL_SEGMENTS - 1 ? 'tail_tip' : i % 2 === 0 ? 'tail_light' : 'tail_dark'
      const seg = this.box(3, 4, 3, all(name))
      seg.position.y = 2
      pivot.add(seg)
      parent.add(pivot)
      this.tail.push(pivot)
      parent = pivot
    }

    // Food: a golden commit cube that appears in front of Catbot while it eats.
    this.food = this.box(16, 16, 16, all('food'), false)
    this.food.position.set(26, 4, 0)
    this.food.visible = false
    this.root.add(this.food)

    this.apply()
  }

  /** Copy a pose (e.g. received from another monitor) and apply it. */
  applyPose(p: Pose): void {
    Object.assign(this.pose, p, { legs: [...p.legs] })
    this.apply()
  }

  /** Push the current `pose` onto the scene graph. */
  apply(): void {
    const p = this.pose
    // Which side faces the camera depends on which way Catbot is facing.
    const nearZ = Math.cos(p.yaw) >= 0 ? 1 : -1
    this.root.rotation.y = p.yaw

    // Flop over toward the far side, pivoting on the far bottom edge.
    const edge = -nearZ * 7
    this.lie.position.z = edge
    this.lieInner.position.z = -edge
    this.lie.rotation.x = Math.sign(edge) * (Math.PI / 2) * p.roll

    this.bodyPivot.position.y = p.bodyY
    this.bodyPivot.rotation.z = p.bodyPitch
    const widen = 1 / Math.sqrt(Math.max(0.3, p.squash))
    this.bodyPivot.scale.set(widen, p.squash, widen)

    this.neck.rotation.set(p.neckRoll, p.neckYaw, p.neckPitch, 'YXZ')

    const [frontNear, frontFar, backNear, backFar] = p.legs
    const [fp, fm, bp, bm] = this.legPivots
    fp.rotation.z = nearZ > 0 ? frontNear : frontFar
    fm.rotation.z = nearZ > 0 ? frontFar : frontNear
    bp.rotation.z = nearZ > 0 ? backNear : backFar
    bm.rotation.z = nearZ > 0 ? backFar : backNear

    // Ears fold back (positive) or perk up.
    this.ears[0].rotation.z = nearZ > 0 ? p.earNear : p.earFar
    this.ears[1].rotation.z = nearZ > 0 ? p.earFar : p.earNear

    // Tail: lift at the base, curl along the chain, sway sideways.
    this.tail[0].rotation.set(p.tailSway, 0, p.tailLift)
    for (let i = 1; i < this.tail.length; i++) {
      this.tail[i].rotation.set(p.tailSway * 0.5, 0, -p.tailCurl)
    }

    const eyes = EXPRESSIONS[Math.max(0, Math.min(EXPRESSIONS.length - 1, Math.round(p.eyes)))]
    this.eyesMat.map = this.tex[`eyes_${eyes}` as TextureName]

    const glow = Math.round(p.glow * 20) / 20
    if (glow !== this.lastGlow) {
      this.lastGlow = glow
      for (const m of this.bellMats) {
        m.map = glow > 0.35 ? this.tex.bell_on : this.tex.bell_off
        const k = 0.55 + 0.45 * glow
        m.color.setRGB(k, k, k, THREE.SRGBColorSpace)
      }
    }

    const tint = Math.round(p.tint * 20) / 20
    if (tint !== this.lastTint) {
      this.lastTint = tint
      for (const { mat, k } of this.tinted) {
        mat.color.setRGB(k, k * (1 - 0.7 * tint), k * (1 - 0.7 * tint), THREE.SRGBColorSpace)
      }
      this.eyesMat.color.setRGB(1, 1 - 0.6 * tint, 1 - 0.6 * tint, THREE.SRGBColorSpace)
    }

    this.food.visible = p.food > 0.02
    const s = 0.5 * p.food
    this.food.scale.setScalar(Math.max(0.001, s))
    this.food.position.y = 8 * s
  }

  /**
   * A box whose faces show the top-left W x H texels of their 16x16 textures
   * (1 texel per unit), repeating along faces longer than 16.
   */
  private box(w: number, h: number, d: number, faces: FaceTextures, exactTexels = true, tintable = true): THREE.Mesh {
    const geo = new THREE.BoxGeometry(w, h, d)
    if (exactTexels) {
      const uv = geo.attributes.uv as THREE.BufferAttribute
      const dims: [number, number][] = [
        [d, h],
        [d, h],
        [w, d],
        [w, d],
        [w, h],
        [w, h]
      ]
      for (let f = 0; f < 6; f++) {
        const [fw, fh] = dims[f]
        for (let v = f * 4; v < f * 4 + 4; v++) {
          uv.setXY(v, uv.getX(v) * (fw / 16), 1 - (1 - uv.getY(v)) * (fh / 16))
        }
      }
      uv.needsUpdate = true
    }
    const mats = faces.map((name, i) => {
      const mat = new THREE.MeshBasicMaterial({ map: this.tex[name] })
      const k = FACE_BRIGHTNESS[i]
      mat.color.setRGB(k, k, k, THREE.SRGBColorSpace)
      if (tintable) this.tinted.push({ mat, k })
      return mat
    })
    return new THREE.Mesh(geo, mats)
  }
}
