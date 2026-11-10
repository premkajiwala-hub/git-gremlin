import type { DisplayInfo } from '../shared/types'

/** Geometry helpers for the monitor this overlay covers, in global DIP coordinates. */
export class World {
  constructor(
    public display: DisplayInfo,
    public displays: DisplayInfo[]
  ) {}

  get left(): number {
    return this.display.bounds.x
  }
  get right(): number {
    return this.display.bounds.x + this.display.bounds.width
  }
  get top(): number {
    return this.display.bounds.y
  }
  get bottom(): number {
    return this.display.bounds.y + this.display.bounds.height
  }
  get groundY(): number {
    return this.display.groundY
  }

  toLocal(gx: number, gy: number): { x: number; y: number } {
    return { x: gx - this.left, y: gy - this.top }
  }

  toGlobal(lx: number, ly: number): { x: number; y: number } {
    return { x: lx + this.left, y: ly + this.top }
  }

  /** The monitor directly to the left (-1) or right (+1) of this one, if any. */
  neighbor(dir: 1 | -1): DisplayInfo | null {
    const b = this.display.bounds
    const edge = dir > 0 ? b.x + b.width : b.x
    let best: DisplayInfo | null = null
    let bestOverlap = 0
    for (const d of this.displays) {
      if (d.id === this.display.id) continue
      const otherEdge = dir > 0 ? d.bounds.x : d.bounds.x + d.bounds.width
      if (Math.abs(otherEdge - edge) > 4) continue
      const overlap =
        Math.min(b.y + b.height, d.bounds.y + d.bounds.height) - Math.max(b.y, d.bounds.y)
      if (overlap > bestOverlap) {
        best = d
        bestOverlap = overlap
      }
    }
    return best
  }

  /** Whether a horizontal span [x0, x1] at height y overlaps this monitor. */
  overlaps(x0: number, x1: number, y0: number, y1: number): boolean {
    return x1 > this.left && x0 < this.right && y1 > this.top && y0 < this.bottom
  }
}
