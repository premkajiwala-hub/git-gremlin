import { ADVANCE, drawText, GLYPH_H, LINE_H, wrap } from './font'

const PAD = 4 // font pixels
const TAIL = 4
const MAX_CHARS = 24
const INK = '#1d211c'
const PAPER = '#f3efe2'
const SHADE = '#d6d0bd'

/** A pixel-art speech bubble drawn with the built-in pixel font. */
export class SpeechBubble {
  private canvas = document.createElement('canvas')
  private ctx = this.canvas.getContext('2d')!
  private hideAt = 0
  private lines: string[] = []
  private wUnits = 0
  private hUnits = 0
  private px = 2
  private cssW = 0
  private cssH = 0
  private tailAt = -1
  visible = false

  constructor(container: HTMLElement) {
    this.canvas.className = 'bubble'
    this.canvas.style.display = 'none'
    container.appendChild(this.canvas)
  }

  show(text: string, ms = 4000): void {
    this.lines = wrap(text, MAX_CHARS)
    const cols = Math.max(...this.lines.map((l) => l.length))
    this.wUnits = cols * ADVANCE - 1 + PAD * 2 + 2
    this.hUnits = (this.lines.length - 1) * LINE_H + GLYPH_H + PAD * 2 + 2
    const dpr = window.devicePixelRatio
    // 2 CSS px per font pixel, snapped to whole device pixels so it stays crisp.
    this.px = Math.max(1, Math.round(2 * dpr))
    this.canvas.width = this.wUnits * this.px
    this.canvas.height = (this.hUnits + TAIL) * this.px
    this.cssW = this.canvas.width / dpr
    this.cssH = this.canvas.height / dpr
    this.canvas.style.width = `${this.cssW}px`
    this.canvas.style.height = `${this.cssH}px`
    this.tailAt = -1
    this.draw(Math.floor(this.wUnits / 2))
    this.canvas.style.display = 'block'
    this.visible = true
    this.hideAt = performance.now() + ms
  }

  hide(): void {
    this.visible = false
    this.canvas.style.display = 'none'
  }

  /** Keep the bubble above the pet's head, inside the overlay. Returns false once expired. */
  update(headX: number, headY: number, maxW: number, maxH: number): boolean {
    if (!this.visible) return false
    if (performance.now() > this.hideAt) {
      this.hide()
      return false
    }
    const x = Math.min(Math.max(4, headX - this.cssW / 2), maxW - this.cssW - 4)
    const y = Math.min(Math.max(4, headY - this.cssH - 4), maxH - this.cssH - 4)
    // Point the tail at the pet even when the bubble is pushed in from a screen edge.
    const unitCss = this.cssW / this.wUnits
    const tail = Math.round(Math.min(Math.max(3, (headX - x) / unitCss), this.wUnits - 4))
    if (tail !== this.tailAt) this.draw(tail)
    this.canvas.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`
    return true
  }

  private draw(tailCenter: number): void {
    this.tailAt = tailCenter
    const c = this.ctx
    const px = this.px
    const w = this.wUnits
    const h = this.hUnits
    c.clearRect(0, 0, this.canvas.width, this.canvas.height)
    const rect = (x: number, y: number, rw: number, rh: number, color: string) => {
      c.fillStyle = color
      c.fillRect(x * px, y * px, rw * px, rh * px)
    }
    // Outline with notched corners, then paper and a bottom shade.
    rect(1, 0, w - 2, h, INK)
    rect(0, 1, w, h - 2, INK)
    rect(1, 1, w - 2, h - 2, PAPER)
    rect(1, h - 2, w - 2, 1, SHADE)
    // A stepped tail pointing down at the pet.
    for (let i = 0; i < TAIL; i++) {
      const half = TAIL - i
      rect(tailCenter - half, h - 1 + i, half * 2, 1, INK)
      if (half > 1) rect(tailCenter - half + 1, h - 1 + i, half * 2 - 2, 1, i === 0 ? SHADE : PAPER)
    }
    c.fillStyle = INK
    drawText(c, this.lines, PAD + 1, PAD + 1, px)
  }
}
