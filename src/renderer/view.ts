import type { RenderState } from './pet/brain'
import type { Particles } from './pet/particles'
import { pixelScale, type SpriteSet } from './pet/sprites'

/** Extra room around the frame for food, hearts, Zs and hops (sprite pixels). */
const SIDE = 22
const TOP = 30
const BOTTOM = 4

/**
 * A small transparent 2D canvas that follows Catbot around the overlay. It
 * draws in whole device pixels so the pixel art is always crisp.
 */
export class PetView {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private sprite = document.createElement('canvas')
  private sctx = this.sprite.getContext('2d')!
  private visible = true
  private dpr = window.devicePixelRatio
  /** Device pixels per sprite pixel. */
  s = 2
  /** Feet position inside the canvas, in device pixels. */
  private ax = 0
  private ay = 0

  constructor(
    container: HTMLElement,
    petSize: number,
    private sprites: SpriteSet
  ) {
    this.canvas = document.createElement('canvas')
    container.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')!
    this.setPetSize(petSize)
  }

  /** On-screen standing height in CSS px (the requested size, snapped to crisp pixels). */
  get displaySize(): number {
    return (this.sprites.standHeight * this.s) / this.dpr
  }

  setPetSize(size: number): void {
    const sp = this.sprites
    this.dpr = window.devicePixelRatio
    this.s = pixelScale(size, sp.standHeight, this.dpr)
    const s = this.s
    this.canvas.width = (sp.cellW + SIDE * 2) * s
    this.canvas.height = (sp.cellH + TOP + BOTTOM) * s
    this.canvas.style.width = `${this.canvas.width / this.dpr}px`
    this.canvas.style.height = `${this.canvas.height / this.dpr}px`
    this.ax = (SIDE + sp.anchorX) * s
    this.ay = (TOP + sp.anchorY) * s
    this.sprite.width = sp.cellW * s
    this.sprite.height = sp.cellH * s
  }

  /** Position the canvas so Catbot's feet land on (lx, ly) in overlay-local CSS px. */
  place(lx: number, ly: number): void {
    const tx = Math.round(lx * this.dpr - this.ax) / this.dpr
    const ty = Math.round(ly * this.dpr - this.ay) / this.dpr
    this.canvas.style.transform = `translate3d(${tx}px, ${ty}px, 0)`
  }

  setVisible(v: boolean): void {
    if (v === this.visible) return
    this.visible = v
    this.canvas.style.display = v ? 'block' : 'none'
  }

  draw(rs: RenderState, particles: Particles | null): void {
    if (!this.visible) return
    const sp = this.sprites
    const s = this.s
    const ctx = this.ctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.imageSmoothingEnabled = false

    // Pixel shadow on the floor, smaller the higher Catbot is.
    const lift = Math.min(0.7, rs.z / 160 + (rs.lifted ? 0.4 : 0))
    const half = Math.max(3, Math.round(12 * (1 - lift)))
    ctx.fillStyle = `rgba(0, 0, 0, ${0.25 * (1 - lift)})`
    ctx.fillRect(this.ax - half * s, this.ay - s, half * 2 * s, s)
    ctx.fillRect(this.ax - (half - 2) * s, this.ay - 2 * s, (half - 2) * 2 * s, s)

    // The commit cube being eaten, in front of Catbot.
    if (rs.food > 0) {
      const fs = Math.max(2, Math.round(10 * rs.food)) * s
      const fx = this.ax + rs.facing * 20 * s - fs / 2
      ctx.drawImage(sp.food, Math.round(fx), this.ay - fs, fs, fs)
    }

    // Compose the frame, its face-screen expression and the lit bell.
    const frame = sp.anims[rs.anim].frames[rs.frame] ?? sp.anims.idle.frames[0]
    const sc = this.sctx
    sc.setTransform(1, 0, 0, 1, 0, 0)
    sc.globalCompositeOperation = 'source-over'
    sc.imageSmoothingEnabled = false
    sc.clearRect(0, 0, this.sprite.width, this.sprite.height)
    sc.drawImage(frame.img, 0, 0, sp.cellW * s, sp.cellH * s)
    const eyes = sp.eyes[rs.mood]
    sc.drawImage(eyes, frame.screen[0] * s, (frame.screen[1] + rs.lookY) * s, eyes.width * s, eyes.height * s)
    if (rs.glow) sc.drawImage(sp.bellOn, frame.bell[0] * s, frame.bell[1] * s, 3 * s, 3 * s)
    if (rs.dim > 0 || rs.tint > 0) {
      sc.globalCompositeOperation = 'source-atop'
      if (rs.dim > 0) {
        sc.fillStyle = `rgba(28, 36, 48, ${rs.dim})`
        sc.fillRect(0, 0, this.sprite.width, this.sprite.height)
      }
      if (rs.tint > 0) {
        sc.fillStyle = 'rgba(255, 40, 40, 0.55)'
        sc.fillRect(0, 0, this.sprite.width, this.sprite.height)
      }
      sc.globalCompositeOperation = 'source-over'
    }

    // Blit it, mirrored around the feet when facing left, lifted by z / hop.
    const up = Math.round(rs.z * this.dpr) + Math.round(rs.bob) * s
    ctx.save()
    ctx.translate(this.ax, this.ay - up)
    if (rs.facing < 0) ctx.scale(-1, 1)
    if (rs.squash > 0) ctx.scale(1 + 0.12 * rs.squash, 1 - 0.18 * rs.squash)
    ctx.drawImage(this.sprite, -sp.anchorX * s, -sp.anchorY * s)
    ctx.restore()

    particles?.draw(ctx, this.ax, this.ay, s, sp)
  }
}
