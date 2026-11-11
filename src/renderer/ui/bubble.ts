import { ADVANCE, drawText, GLYPH_H, LINE_H, wrap } from './font'

/** Catbot palette: light-gray shell, orange accents, dark face-screen, cyan text. */
const C = {
  ink: '#15191e',
  shell: '#dfe3e8',
  shellShade: '#a9b1bb',
  bolt: '#7b8591',
  header: '#ff9a2e',
  headerShade: '#d97a17',
  headerText: '#2a1606',
  screen: '#0a1a20',
  scan: '#0e232b',
  text: '#5ef2ff',
  cable: '#ff9a2e'
}

const PAD = 4 // screen padding, in font pixels
const FRAME = 2 // gray shell thickness
const HEADER = 9 // header bar height
const TAIL = 5
const MAX_CHARS = 24
const TYPE_RATE = 45 // characters per second

export type Mood = 'ok' | 'warn' | 'bad'
const LED: Record<Mood, string> = { ok: '#5ef2ff', warn: '#ffb21e', bad: '#ff4d5e' }

/** A little robot terminal that pops up above the catbot and types its message out. */
export class SpeechBubble {
  private canvas = document.createElement('canvas')
  private ctx = this.canvas.getContext('2d')!
  private lines: string[] = []
  private title = ''
  private mood: Mood = 'ok'
  private total = 0
  private shownAt = 0
  private hideAt = 0
  private wUnits = 0
  private hUnits = 0
  private px = 2
  private cssW = 0
  private cssH = 0
  private lastKey = ''
  visible = false

  constructor(container: HTMLElement) {
    this.canvas.className = 'bubble'
    this.canvas.style.display = 'none'
    container.appendChild(this.canvas)
  }

  show(text: string, ms: number, title: string, mood: Mood): void {
    this.lines = wrap(text, MAX_CHARS)
    this.title = title.toUpperCase().slice(0, 18)
    this.mood = mood
    this.total = this.lines.reduce((n, l) => n + l.length, 0)
    const cols = Math.max(...this.lines.map((l) => l.length), this.title.length + 4)
    const screenW = cols * ADVANCE - 1 + PAD * 2
    const screenH = (this.lines.length - 1) * LINE_H + GLYPH_H + PAD * 2
    this.wUnits = screenW + (FRAME + 1) * 2
    this.hUnits = screenH + HEADER + FRAME * 2 + 2
    const dpr = window.devicePixelRatio
    this.px = Math.max(1, Math.round(2 * dpr))
    this.canvas.width = this.wUnits * this.px
    this.canvas.height = (this.hUnits + TAIL) * this.px
    this.cssW = this.canvas.width / dpr
    this.cssH = this.canvas.height / dpr
    this.canvas.style.width = `${this.cssW}px`
    this.canvas.style.height = `${this.cssH}px`
    this.shownAt = performance.now()
    // Leave time to read once it has finished typing.
    this.hideAt = this.shownAt + (this.total / TYPE_RATE) * 1000 + ms
    this.lastKey = ''
    this.canvas.style.display = 'block'
    this.visible = true
  }

  hide(): void {
    this.visible = false
    this.canvas.style.display = 'none'
  }

  /** Let the current bubble go away after at most `ms` (once it has finished typing). */
  expireIn(ms: number): void {
    if (!this.visible) return
    const typed = this.shownAt + (this.total / TYPE_RATE) * 1000
    this.hideAt = Math.min(this.hideAt, Math.max(typed, performance.now()) + ms)
  }

  /** Still typing (needs redraws every frame)? */
  get busy(): boolean {
    return this.visible && performance.now() - this.shownAt < (this.total / TYPE_RATE) * 1000 + 1600
  }

  /** Keep the bubble above the pet's head, inside the overlay. Returns false once expired. */
  update(headX: number, headY: number, maxW: number, maxH: number): boolean {
    if (!this.visible) return false
    const now = performance.now()
    if (now > this.hideAt) {
      this.hide()
      return false
    }
    const x = Math.min(Math.max(4, headX - this.cssW / 2), maxW - this.cssW - 4)
    const y = Math.min(Math.max(4, headY - this.cssH - 2), maxH - this.cssH - 4)
    const unitCss = this.cssW / this.wUnits
    const tail = Math.round(Math.min(Math.max(4, (headX - x) / unitCss), this.wUnits - 5))
    const shown = Math.min(this.total, Math.floor(((now - this.shownAt) / 1000) * TYPE_RATE))
    const cursorOn = Math.floor(now / 400) % 2 === 0 && this.busy
    const key = `${tail}|${shown}|${cursorOn}`
    if (key !== this.lastKey) {
      this.lastKey = key
      this.draw(tail, shown, cursorOn)
    }
    this.canvas.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`
    return true
  }

  private draw(tailCenter: number, shown: number, cursorOn: boolean): void {
    const c = this.ctx
    const px = this.px
    const w = this.wUnits
    const h = this.hUnits
    c.clearRect(0, 0, this.canvas.width, this.canvas.height)
    const rect = (x: number, y: number, rw: number, rh: number, color: string) => {
      c.fillStyle = color
      c.fillRect(x * px, y * px, rw * px, rh * px)
    }

    // Cable from the bubble down to the catbot (drawn first, behind the shell).
    for (let i = 0; i < TAIL; i++) {
      const xx = tailCenter - 1
      rect(xx - 1, h - 1 + i, 4, 1, C.ink)
      rect(xx, h - 1 + i, 2, 1, i === TAIL - 1 ? LED[this.mood] : C.cable)
    }

    // Shell: outline with notched corners, gray body, darker lower edge.
    rect(1, 0, w - 2, h, C.ink)
    rect(0, 1, w, h - 2, C.ink)
    rect(1, 1, w - 2, h - 2, C.shell)
    rect(1, h - 2, w - 2, 1, C.shellShade)
    // Screws in the corners.
    for (const [bx, by] of [
      [2, h - 3],
      [w - 3, h - 3]
    ])
      rect(bx, by, 1, 1, C.bolt)

    // Orange header with the pet's name and a status LED.
    const hx = 1 + FRAME - 1
    const hw = w - 2 * hx
    rect(hx, 1 + FRAME - 1, hw, HEADER, C.header)
    rect(hx, FRAME + HEADER - 1, hw, 1, C.headerShade)
    c.fillStyle = C.headerText
    drawText(c, [this.title], hx + 2, FRAME + 1, px)
    const ledX = hx + hw - 5
    rect(ledX - 1, FRAME + 2, 4, 4, C.headerText)
    rect(ledX, FRAME + 3, 2, 2, LED[this.mood])

    // Face-screen with scanlines.
    const sx = 1 + FRAME
    const sy = 1 + FRAME + HEADER
    const sw = w - 2 * sx
    const sh = h - sy - FRAME - 1
    rect(sx - 1, sy - 1, sw + 2, sh + 2, C.ink)
    rect(sx, sy, sw, sh, C.screen)
    for (let yy = sy + 1; yy < sy + sh; yy += 2) rect(sx, yy, sw, 1, C.scan)

    // Typed-out text and a blinking block cursor.
    let left = shown
    const visible = this.lines.map((l) => {
      const part = l.slice(0, Math.max(0, left))
      left -= l.length
      return part
    })
    c.fillStyle = C.text
    drawText(c, visible, sx + PAD, sy + PAD, px)
    if (cursorOn) {
      let li = visible.findIndex((v, i) => v.length < this.lines[i].length)
      if (li < 0) li = visible.length - 1
      const cx = sx + PAD + visible[li].length * ADVANCE
      if (cx + 5 <= sx + sw) rect(cx, sy + PAD + li * LINE_H, 5, GLYPH_H, C.text)
    }
  }
}
