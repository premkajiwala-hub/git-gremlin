import * as THREE from 'three'

/** Fixed per-face brightness: +x front, -x back, +y top, -y bottom, +z/-z sides. */
export const FACE_BRIGHTNESS = [0.8, 0.6, 1.0, 0.5, 0.6, 0.6] as const

/** Milestone-1 stand-in: a flat-shaded mossy cube that bobs as it walks. */
export class PlaceholderPet {
  readonly root = new THREE.Group()
  private cube: THREE.Mesh
  private t = 0
  yaw = 0
  bob = 0

  constructor() {
    const base = new THREE.Color('#5c9a3c')
    const mats = FACE_BRIGHTNESS.map(
      (k) => new THREE.MeshBasicMaterial({ color: base.clone().multiplyScalar(k) })
    )
    this.cube = new THREE.Mesh(new THREE.BoxGeometry(20, 20, 20), mats)
    this.root.add(this.cube)
    this.apply()
  }

  update(dt: number, facing: 1 | -1, walking: boolean): void {
    this.t += dt
    const targetYaw = facing > 0 ? -0.4 : Math.PI + 0.4
    this.yaw += (targetYaw - this.yaw) * Math.min(1, dt * 10)
    this.bob = walking ? Math.abs(Math.sin(this.t * 9)) * 2 : 0
    this.apply()
  }

  getPose(): Record<string, unknown> {
    return { yaw: this.yaw, bob: this.bob }
  }

  applyPose(p: Record<string, unknown>): void {
    this.yaw = Number(p.yaw) || 0
    this.bob = Number(p.bob) || 0
    this.apply()
  }

  private apply(): void {
    this.root.rotation.y = this.yaw
    this.cube.position.y = 10 + this.bob
  }
}
