export type ParticleKind = 'heart' | 'crumb'

interface Particle {
  kind: ParticleKind
  /** Position relative to the pet's feet, in CSS px (y up is negative). */
  x: number
  y: number
  vx: number
  vy: number
  age: number
  life: number
  size: number
}

const GRAVITY = 520

/** Pixel hearts and tiny commit-cube crumbs, drawn on the pet's canvas. */
export class Particles {
  private live: Particle[] = []

  get active(): boolean {
    return this.live.length > 0
  }

  /** `x`, `y` relative to the pet's feet; `scale` is the pet's size / 72. */
  spawn(kind: ParticleKind, x: number, y: number, scale: number): void {
    if (this.live.length > 40) return
    if (kind === 'crumb') {
      this.live.push({
        kind,
        x,
        y,
        vx: (Math.random() - 0.5) * 90 * scale,
        vy: -(60 + Math.random() * 90) * scale,
        age: 0,
        life: 1.2,
        size: Math.max(3, Math.round(4 * scale))
      })
    } else {
      this.live.push({
        kind,
        x,
        y,
        vx: (Math.random() - 0.5) * 14 * scale,
        vy: -(34 + Math.random() * 14) * scale,
        age: 0,
        life: 1.5,
        size: Math.round(16 * scale)
      })
    }
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
        p.x += (p.vx + Math.sin(p.age * 5) * 8) * dt
        p.y += p.vy * dt
      }
      if (p.age >= p.life) this.live.splice(i, 1)
    }
  }

  draw(ctx: CanvasRenderingContext2D, ax: number, ay: number, heart: HTMLImageElement, food: HTMLImageElement): void {
    for (const p of this.live) {
      ctx.globalAlpha = Math.min(1, (p.life - p.age) * 2.5)
      const img = p.kind === 'heart' ? heart : food
      ctx.drawImage(img, Math.round(ax + p.x - p.size / 2), Math.round(ay + p.y - p.size), p.size, p.size)
    }
    ctx.globalAlpha = 1
  }

  clear(): void {
    this.live = []
  }
}
