import type { RenderState } from './pet/brain'
import type { Particles } from './pet/particles'
import type { SpriteSet } from './pet/sprites'

/**
 * A small transparent 2D canvas that follows the pet around the overlay and
 * draws the current catbot frame, its shadow, food and particles. Rendering
 * only a pet-sized canvas keeps GPU and compositor work tiny.
 */
export class PetView {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private tintCanvas = document.createElement('canvas')
  private tintCtx = this.tintCanvas.getContext('2d')!
  private visible = true

  /** Canvas size in CSS px, and where the pet's feet sit inside it. */
  width = 0
  height = 0
  anchorX = 0
  anchorY = 0
  petSize = 0
  /** Sprite pixels -> CSS px. */
  scale = 1

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

  setPetSize(size: number): void {
    const s = this.sprites
    this.petSize = size
    this.scale = size / s.standHeight
    const side = size * 0.7
    const top = size * 1.0 // room for hearts and bubbles of particles above
    const bottom = size * 0.3
    this.width = Math.ceil(s.cellW * this.scale + side * 2)
    this.height = Math.ceil(s.cellH * this.scale + top + bottom)
    this.anchorX = Math.round(this.width / 2)
    this.anchorY = Math.round(top + s.anchorY * this.scale)
    const dpr = window.devicePixelRatio
    this.canvas.width = Math.round(this.width * dpr)
    this.canvas.height = Math.round(this.height * dpr)
    this.canvas.style.width = `${this.width}px`
    this.canvas.style.height = `${this.height}px`
    this.tintCanvas.width = Math.ceil(s.cellW * this.scale * dpr)
    this.tintCanvas.height = Math.ceil(s.cellH * this.scale * dpr)
  }

  /** Position the canvas so the pet's feet land on (lx, ly) in overlay-local px. */
  place(lx: number, ly: number): void {
    const dpr = window.devicePixelRatio
    const tx = Math.round((lx - this.anchorX) * dpr) / dpr
    const ty = Math.round((ly - this.anchorY) * dpr) / dpr
    this.canvas.style.transform = `translate3d(${tx}px, ${ty}px, 0)`
  }

  setVisible(v: boolean): void {
    if (v === this.visible) return
    this.visible = v
    this.canvas.style.display = v ? 'block' : 'none'
  }

  draw(rs: RenderState, facing: 1 | -1, particles: Particles | null): void {
    if (!this.visible) return
    const s = this.sprites
    const ctx = this.ctx
    const dpr = window.devicePixelRatio
    const k = this.scale
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, this.width, this.height)
    // Downscaling pixel art looks best smoothed; upscaling looks best crisp.
    const smooth = k * dpr < 1
    ctx.imageSmoothingEnabled = smooth
    ctx.imageSmoothingQuality = 'high'

    // Shadow on the floor, smaller the higher the pet is.
    const lift = Math.min(0.6, rs.z / 300 + (rs.lifted ? 0.35 : 0))
    const rx = s.standWidth * k * 0.36 * (1 - lift)
    ctx.fillStyle = `rgba(0, 0, 0, ${0.22 * (1 - lift)})`
    ctx.beginPath()
    ctx.ellipse(this.anchorX, this.anchorY - 1, rx, rx * 0.22, 0, 0, Math.PI * 2)
    ctx.fill()

    // The commit cube it's eating, in front of it.
    if (rs.food > 0) {
      const fs = Math.round(26 * k * rs.food + 4)
      const fx = this.anchorX + facing * s.standWidth * k * 0.55
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(s.food, Math.round(fx - fs / 2), Math.round(this.anchorY - fs), fs, fs)
      ctx.imageSmoothingEnabled = smooth
    }

    // The catbot itself.
    const img = s.anims[rs.anim].frames[rs.frame]
    const cw = s.cellW * k
    const ch = s.cellH * k
    let source: CanvasImageSource = img
    if (rs.tint > 0 || rs.dim > 0) source = this.tinted(img, rs, smooth)
    ctx.save()
    ctx.translate(this.anchorX, this.anchorY - rs.z)
    ctx.rotate(rs.rot)
    ctx.scale((rs.flip ? -1 : 1) * rs.squashX, rs.squashY)
    ctx.drawImage(source, -s.anchorX * k, -s.anchorY * k, cw, ch)
    ctx.restore()

    particles?.draw(ctx, this.anchorX, this.anchorY, s.heart, s.food)
  }

  /** Draw a frame with a hunger dim and/or red flash into a scratch canvas. */
  private tinted(img: HTMLImageElement, rs: RenderState, smooth: boolean): HTMLCanvasElement {
    const c = this.tintCtx
    const w = this.tintCanvas.width
    const h = this.tintCanvas.height
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.globalCompositeOperation = 'source-over'
    c.clearRect(0, 0, w, h)
    c.imageSmoothingEnabled = smooth
    c.imageSmoothingQuality = 'high'
    c.filter = rs.dim > 0 ? `brightness(${1 - rs.dim * 0.45}) saturate(${1 - rs.dim})` : 'none'
    c.drawImage(img, 0, 0, w, h)
    c.filter = 'none'
    if (rs.tint > 0) {
      c.globalCompositeOperation = 'source-atop'
      c.fillStyle = 'rgba(255, 40, 40, 0.55)'
      c.fillRect(0, 0, w, h)
      c.globalCompositeOperation = 'source-over'
    }
    return this.tintCanvas
  }
}
