import * as THREE from 'three'
import { neutralPose, type Pose } from './pose'
import type { TextureName, TextureSet } from './textures'

/**
 * Fixed per-face brightness, in BoxGeometry face order:
 * +x (the pet's front), -x (back), +y (top), -y (bottom), +z, -z (sides).
 * No lights, no shadows: just flat shading like a blocky sandbox game.
 */
const FACE_BRIGHTNESS = [0.8, 0.6, 1.0, 0.5, 0.6, 0.6]

type FaceTextures = [TextureName, TextureName, TextureName, TextureName, TextureName, TextureName]

interface TintedMaterial {
  mat: THREE.MeshBasicMaterial
  k: number
}

/** Model units: 1 unit = 1 texel. The pet is about 40 units tall. */
export const MODEL_HEIGHT = 40

/**
 * The pet: separate box meshes for body, head, four legs and a two-cube
 * antenna, each hanging off its own pivot so animation is just rotations.
 */
export class PetModel {
  readonly root = new THREE.Group()
  readonly pose: Pose = neutralPose()

  private lie = new THREE.Group()
  private lieInner = new THREE.Group()
  private bodyPivot = new THREE.Group()
  private neck = new THREE.Group()
  private antennaPivot = new THREE.Group()
  private tipPivot = new THREE.Group()
  /** Leg pivots: +z front, -z front, +z back, -z back. */
  private legPivots: THREE.Group[] = []
  private eyesMat: THREE.MeshBasicMaterial
  private tipMesh: THREE.Mesh
  private food: THREE.Mesh
  private tinted: TintedMaterial[] = []
  private lastTint = -1
  private lastGlow = -1

  constructor(private tex: TextureSet) {
    this.root.add(this.lie)
    this.lie.add(this.lieInner)
    this.lieInner.add(this.bodyPivot)
    const content = new THREE.Group()
    content.position.x = -4 // centre the pet (head sticks out in front)
    this.bodyPivot.add(content)

    // Body: 28 long, 12 tall, 16 wide, resting on 7-unit legs.
    const body = this.box(28, 12, 16, ['body_end', 'body_end', 'body_top', 'body_bottom', 'body_side', 'body_side'])
    body.position.set(0, 13, 0)
    content.add(body)

    // Legs: pivot at the hip, mesh hangs below.
    for (const [x, z] of [
      [9, 5],
      [9, -5],
      [-9, 5],
      [-9, -5]
    ]) {
      const pivot = new THREE.Group()
      pivot.position.set(x, 7, z)
      const leg = this.box(6, 7, 6, ['leg_side', 'leg_side', 'leg_top', 'leg_bottom', 'leg_side', 'leg_side'])
      leg.position.y = -3.5
      pivot.add(leg)
      content.add(pivot)
      this.legPivots.push(pivot)
    }

    // Head: a 16-unit cube on a neck pivot at the front-top of the body.
    this.neck.position.set(12, 17, 0)
    content.add(this.neck)
    const head = this.box(16, 16, 16, ['head_front', 'head_back', 'head_top', 'head_bottom', 'head_side', 'head_side'])
    head.position.set(2, 6, 0)
    this.neck.add(head)

    // Glowing eyes: a transparent overlay on the face at full brightness.
    this.eyesMat = new THREE.MeshBasicMaterial({ map: tex.eyes_open, transparent: true, alphaTest: 0.5 })
    const eyes = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), this.eyesMat)
    eyes.rotation.y = Math.PI / 2
    eyes.position.set(8.05, 0, 0)
    head.add(eyes)

    // Antenna: two stacked tiny cubes.
    this.antennaPivot.position.set(-3, 8, 0)
    head.add(this.antennaPivot)
    const stem = this.box(2, 5, 2, Array(6).fill('antenna_stem') as FaceTextures)
    stem.position.y = 2.5
    this.antennaPivot.add(stem)
    this.tipPivot.position.y = 5
    this.antennaPivot.add(this.tipPivot)
    this.tipMesh = this.box(4, 4, 4, Array(6).fill('antenna_tip_on') as FaceTextures)
    this.tipMesh.position.y = 2
    this.tipPivot.add(this.tipMesh)

    // Food: a golden commit cube that appears in front of the pet while it eats.
    this.food = this.box(16, 16, 16, Array(6).fill('food') as FaceTextures, false)
    this.food.position.set(24, 4, 0)
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
    // Which side faces the camera depends on which way the pet is facing.
    const nearZ = Math.cos(p.yaw) >= 0 ? 1 : -1
    this.root.rotation.y = p.yaw

    // Flop over toward the far side, pivoting on the far bottom edge.
    const edge = -nearZ * 8
    this.lie.position.z = edge
    this.lieInner.position.z = -edge
    this.lie.rotation.x = Math.sign(edge) * (Math.PI / 2) * p.roll

    this.bodyPivot.position.y = p.bodyY
    this.bodyPivot.rotation.z = p.bodyPitch
    const widen = 1 / Math.sqrt(Math.max(0.3, p.squash))
    this.bodyPivot.scale.set(widen, p.squash, widen)

    this.neck.rotation.set(0, p.neckYaw, p.neckPitch)
    const [frontNear, frontFar, backNear, backFar] = p.legs
    const [fp, fm, bp, bm] = this.legPivots
    fp.rotation.z = nearZ > 0 ? frontNear : frontFar
    fm.rotation.z = nearZ > 0 ? frontFar : frontNear
    bp.rotation.z = nearZ > 0 ? backNear : backFar
    bm.rotation.z = nearZ > 0 ? backFar : backNear
    this.antennaPivot.rotation.z = p.antenna
    this.tipPivot.rotation.z = p.tip

    this.eyesMat.map = p.eyes >= 0.5 ? this.tex.eyes_open : this.tex.eyes_closed

    const glow = Math.round(p.glow * 20) / 20
    if (glow !== this.lastGlow) {
      this.lastGlow = glow
      const mats = this.tipMesh.material as THREE.MeshBasicMaterial[]
      for (const m of mats) {
        m.map = glow > 0.35 ? this.tex.antenna_tip_on : this.tex.antenna_tip_off
        m.color.setRGB(0.55 + 0.45 * glow, 0.55 + 0.45 * glow, 0.55 + 0.45 * glow, THREE.SRGBColorSpace)
      }
    }

    const tint = Math.round(p.tint * 20) / 20
    if (tint !== this.lastTint) {
      this.lastTint = tint
      for (const { mat, k } of this.tinted) {
        mat.color.setRGB(k, k * (1 - 0.7 * tint), k * (1 - 0.7 * tint), THREE.SRGBColorSpace)
      }
      this.eyesMat.color.setRGB(1, 1 - 0.5 * tint, 1 - 0.5 * tint, THREE.SRGBColorSpace)
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
  private box(w: number, h: number, d: number, faces: FaceTextures, exactTexels = true): THREE.Mesh {
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
      if (!name.startsWith('antenna_tip')) this.tinted.push({ mat, k })
      return mat
    })
    return new THREE.Mesh(geo, mats)
  }
}
