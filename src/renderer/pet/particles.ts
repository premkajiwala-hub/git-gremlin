import * as THREE from 'three'
import type { TextureSet } from './textures'

export type ParticleKind = 'heart' | 'zzz' | 'crumb'

interface Particle {
  obj: THREE.Object3D
  kind: ParticleKind
  vx: number
  vy: number
  vz: number
  age: number
  life: number
  spin: number
}

const GRAVITY = 260 // model units / s^2

/**
 * Pixel hearts, sleepy Zs and tiny commit-cube crumbs. Positions are in the
 * pet's scene space (origin = between its feet, units = model texels).
 */
export class Particles {
  private live: Particle[] = []
  private crumbGeo = new THREE.BoxGeometry(2, 2, 2)
  private crumbMat: THREE.MeshBasicMaterial
  private heartMat: THREE.SpriteMaterial
  private zMat: THREE.SpriteMaterial

  constructor(
    private scene: THREE.Scene,
    tex: TextureSet
  ) {
    this.crumbMat = new THREE.MeshBasicMaterial({ map: tex.food })
    this.heartMat = new THREE.SpriteMaterial({ map: tex.heart, transparent: true, alphaTest: 0.5 })
    this.zMat = new THREE.SpriteMaterial({ map: tex.zzz, transparent: true, alphaTest: 0.5 })
  }

  get active(): boolean {
    return this.live.length > 0
  }

  spawn(kind: ParticleKind, x: number, y: number, z = 6): void {
    if (this.live.length > 60) return
    let obj: THREE.Object3D
    const p: Particle = { obj: null!, kind, vx: 0, vy: 0, vz: 0, age: 0, life: 1, spin: 0 }
    if (kind === 'crumb') {
      obj = new THREE.Mesh(this.crumbGeo, this.crumbMat)
      p.vx = (Math.random() - 0.5) * 70
      p.vy = 50 + Math.random() * 60
      p.vz = (Math.random() - 0.2) * 40
      p.life = 1.4
      p.spin = (Math.random() - 0.5) * 12
    } else {
      obj = new THREE.Sprite(kind === 'heart' ? this.heartMat.clone() : this.zMat.clone())
      obj.scale.setScalar(kind === 'heart' ? 8 : 7)
      p.vx = kind === 'zzz' ? 6 + Math.random() * 4 : (Math.random() - 0.5) * 10
      p.vy = kind === 'zzz' ? 9 : 18 + Math.random() * 8
      p.life = kind === 'zzz' ? 2.6 : 1.6
    }
    obj.position.set(x, y, z)
    p.obj = obj
    this.scene.add(obj)
    this.live.push(p)
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i]
      p.age += dt
      const o = p.obj
      if (p.kind === 'crumb') {
        p.vy -= GRAVITY * dt
        o.position.x += p.vx * dt
        o.position.y += p.vy * dt
        o.position.z += p.vz * dt
        o.rotation.x += p.spin * dt
        o.rotation.y += p.spin * dt
        if (o.position.y < 1) {
          o.position.y = 1
          p.vy = Math.abs(p.vy) * 0.3
          p.vx *= 0.6
          p.vz *= 0.6
        }
      } else {
        o.position.x += (p.vx + Math.sin(p.age * 5) * 6) * dt
        o.position.y += p.vy * dt
        if (p.kind === 'zzz') o.scale.setScalar(5 + p.age * 2)
        ;(o as THREE.Sprite).material.opacity = Math.min(1, (p.life - p.age) * 2)
      }
      if (p.age >= p.life) {
        this.scene.remove(o)
        if (o instanceof THREE.Sprite) o.material.dispose()
        this.live.splice(i, 1)
      }
    }
  }

  clear(): void {
    for (const p of this.live) this.scene.remove(p.obj)
    this.live = []
  }
}
