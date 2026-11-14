import { GRID_MARK } from '../../shared/constants'

/** A pet's colour, shown as the little square next to its name. */
export interface BubbleTheme {
  accent?: string
}

export type Mood = 'ok' | 'warn' | 'bad'

/**
 * The pet's message box, in GitGremlin's "pixel glass" style: a small card
 * with a crisp border and a hard pixel shadow, the pet's name in the pixel
 * font and its words in monospace. It is sized to fit its text and shows all
 * of it at once (no typing). A line equal to GRID_MARK is drawn as a row of
 * contribution squares.
 */
export class SpeechBubble {
  private el = document.createElement('div')
  private name = document.createElement('span')
  private led = document.createElement('span')
  private body = document.createElement('div')
  private hideAt = 0
  private w = 0
  private h = 0
  private lastKey = ''
  visible = false

  constructor(container: HTMLElement, theme: BubbleTheme = {}) {
    this.el.className = 'bubble'
    if (theme.accent) this.el.style.setProperty('--accent', theme.accent)
    const head = document.createElement('div')
    head.className = 'b-head'
    const acc = document.createElement('i')
    acc.className = 'b-acc'
    this.led.className = 'b-led'
    head.append(acc, this.name, this.led)
    this.body.className = 'b-body'
    const t1 = document.createElement('span')
    const t2 = document.createElement('span')
    t1.className = 'b-tail t1'
    t2.className = 'b-tail t2'
    this.el.append(head, this.body, t1, t2)
    container.appendChild(this.el)
  }

  /** Show a message for `ms` (Infinity: until hidden). `grid` = contribution levels 0-4, today last. */
  show(text: string, ms: number, title: string, mood: Mood, grid: number[] = []): void {
    this.name.textContent = title.toUpperCase()
    this.el.dataset.mood = mood
    const lines = text.split('\n')
    // Drop trailing empty lines; keep one as a small gap between the report and the remark.
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
    this.body.replaceChildren(
      ...lines.map((line) => {
        if (line === GRID_MARK) {
          const row = document.createElement('div')
          row.className = 'b-grid'
          grid.forEach((level, i) => {
            const sq = document.createElement('span')
            sq.dataset.l = String(Math.max(0, Math.min(4, level)))
            if (i === grid.length - 1) sq.className = 'today'
            row.append(sq)
          })
          return row
        }
        const div = document.createElement('div')
        div.className = line.trim() ? (line.startsWith('> ') ? 'b-line b-remark' : 'b-line') : 'b-gap'
        div.textContent = line.startsWith('> ') ? line.slice(2) : line
        return div
      })
    )
    this.hideAt = ms === Infinity ? Infinity : performance.now() + ms
    this.el.style.display = 'block'
    this.w = this.el.offsetWidth
    this.h = this.el.offsetHeight
    this.lastKey = ''
    this.visible = true
  }

  hide(): void {
    this.visible = false
    this.el.style.display = 'none'
  }

  /** Let the current message go away after at most `ms`. */
  expireIn(ms: number): void {
    if (this.visible) this.hideAt = Math.min(this.hideAt, performance.now() + ms)
  }

  /** The text appears all at once, so nothing needs redrawing every frame. */
  get busy(): boolean {
    return false
  }

  /** Keep the box above the pet's head, inside the overlay. Returns false once it has gone. */
  update(headX: number, headY: number, maxW: number, maxH: number): boolean {
    if (!this.visible) return false
    if (performance.now() > this.hideAt) {
      this.hide()
      return false
    }
    const x = Math.round(Math.min(Math.max(6, headX - this.w / 2), maxW - this.w - 16))
    const y = Math.round(Math.min(Math.max(6, headY - this.h - 18), maxH - this.h - 16))
    const tail = Math.round(Math.min(Math.max(10, headX - x), this.w - 14))
    const key = `${x},${y},${tail}`
    if (key !== this.lastKey) {
      this.lastKey = key
      this.el.style.transform = `translate3d(${x}px, ${y}px, 0)`
      this.el.style.setProperty('--tail', `${tail}px`)
    }
    return true
  }
}
