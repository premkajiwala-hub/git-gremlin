export type ParticleKind = 'heart' | 'zzz' | 'crumb'

interface Particle {
  kind: ParticleKind
  /** Position relative to Catbot's feet, in sprite pixels (y up is negative). */
  x: number
  y: number
  vx: number
  vy: number
  age: number
  life: number
}

const GRAVITY = 160 // sprite px / s^2

/** Pixel hearts, sleepy Zs and commit-cube crumbs, drawn on Catbot's canvas. */
export class Particles {
  private live: Particle[] = []

  get active(): boolean {
    return this.live.length > 0
  }

  /** Spawn at (x, y) sprite pixels from the feet; x is already flipped for facing. */
  spawn(kind: ParticleKind, x: number, y: number): void {
    if (this.live.length > 40) return
    const p: Particle = { kind, x, y, vx: 0, vy: 0, age: 0, life: 1.5 }
    if (kind === 'crumb') {
      p.vx = (Math.random() - 0.5) * 30
      p.vy = -(20 + Math.random() * 25)
      p.life = 1.1
    } else if (kind === 'heart') {
      p.vx = (Math.random() - 0.5) * 4
      p.vy = -12 - Math.random() * 4
      p.life = 1.6
    } else {
      p.vx = 3 + Math.random() * 2
      p.vy = -5
      p.life = 2.6
    }
    this.live.push(p)
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i]
      p.age += dt
      if (p.kind === 'crumb') {
        p.vy += GRAVITY * dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        if (p.y > 0) {
          p.y = 0
          p.vy = -Math.abs(p.vy) * 0.3
          p.vx *= 0.6
        }
      } else {
        p.x += (p.vx + Math.sin(p.age * 5) * 3) * dt
        p.y += p.vy * dt
      }
      if (p.age >= p.life) this.live.splice(i, 1)
    }
  }

  /** Draw at whole-device-pixel positions; (ax, ay) is the feet in device px, s = device px per sprite px. */
  draw(
    ctx: CanvasRenderingContext2D,
    ax: number,
    ay: number,
    s: number,
    sprites: { heart: HTMLImageElement; food: HTMLImageElement; zzz: HTMLImageElement }
  ): void {
    for (const p of this.live) {
      ctx.globalAlpha = Math.min(1, (p.life - p.age) * 2.5)
      const img = p.kind === 'heart' ? sprites.heart : p.kind === 'zzz' ? sprites.zzz : sprites.food
      const w = p.kind === 'crumb' ? 2 : img.width
      const h = p.kind === 'crumb' ? 2 : img.height
      const x = Math.round(ax + (p.x - w / 2) * s)
      const y = Math.round(ay + (p.y - h) * s)
      if (p.kind === 'crumb') ctx.drawImage(img, 3, 3, 3, 3, x, y, w * s, h * s)
      else ctx.drawImage(img, x, y, w * s, h * s)
    }
    ctx.globalAlpha = 1
  }

  clear(): void {
    this.live = []
  }
}
