/**
 * The GitGremlin logo ("Pixel"): a gremlin head built from crisp black pixel
 * squares (pointed ears, two empty pixels for eyes, a little grin) on a white
 * rounded app tile. Black and white only.
 *
 * Drawn natively at each size, never scaled: the 8x7 grid of squares snaps to
 * whole pixels, solid up to 64 px and with hairline gaps from 96 px up, so
 * it stays sharp from the 16 px tray icon to the 256 px Start menu tile.
 */
import { Img } from './pixel.ts'

/** The head: X = a black square. */
export const HEAD = ['X......X', 'XX....XX', 'XXXXXXXX', 'XX.XX.XX', 'XXXXXXXX', 'XXX..XXX', '.XXXXXX.']

const TILE: [number, number, number] = [255, 255, 255]
const EDGE: [number, number, number] = [212, 212, 216]
const INK: [number, number, number] = [10, 10, 10]

/** Square size and gap (px) for a tile `size` px wide: the head is about half the tile. */
export function grid(size: number): [number, number] {
  // Small icons: solid squares (1 px gaps would read as a dotted mesh).
  if (size < 24) return [1, 0]
  if (size < 40) return [2, 0]
  if (size < 56) return [3, 0]
  if (size < 96) return [4, 0]
  let best: [number, number] = [5, 1]
  let err = Infinity
  for (let cell = 5; cell <= size; cell++)
    for (let gap = 1; gap <= Math.ceil(cell / 2); gap++) {
      const w = 8 * cell + 7 * gap
      const e = Math.abs(w - size / 2) + Math.abs(gap / cell - 0.22) * size * 0.4
      if (e < err) {
        err = e
        best = [cell, gap]
      }
    }
  return best
}

/** Is (x, y) inside a rounded square of side `s` and corner radius `r` (shrunk by `inset`)? */
function inside(x: number, y: number, s: number, r: number, inset = 0): boolean {
  const lo = inset
  const hi = s - inset
  if (x < lo || y < lo || x > hi || y > hi) return false
  const rr = Math.max(0, r - inset)
  const cx = Math.min(Math.max(x, lo + rr), hi - rr)
  const cy = Math.min(Math.max(y, lo + rr), hi - rr)
  return (x - cx) ** 2 + (y - cy) ** 2 <= rr * rr
}

function put(img: Img, x: number, y: number, [r, g, b]: [number, number, number], a: number): void {
  img.data.set([r, g, b, Math.round(a * 255)], (y * img.w + x) * 4)
}

/** The icon at `size` x `size` px. */
export function logoIcon(size: number): Img {
  const img = new Img(size, size)
  const radius = size * 0.224
  const edge = Math.max(1, size / 128)
  const SS = 4
  // The tile: white, with a faint edge so it holds up on white backgrounds; corners anti-aliased.
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let cover = 0
      let ring = 0
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS
          const py = y + (sy + 0.5) / SS
          if (!inside(px, py, size, radius)) continue
          cover++
          if (!inside(px, py, size, radius, edge)) ring++
        }
      if (!cover) continue
      const t = ring / cover
      const mix = TILE.map((c, i) => c + (EDGE[i] - c) * t) as [number, number, number]
      put(img, x, y, mix, cover / (SS * SS))
    }
  // The head, snapped to whole pixels and centred.
  const [cell, gap] = grid(size)
  const w = 8 * cell + 7 * gap
  const h = 7 * cell + 6 * gap
  const x0 = Math.round((size - w) / 2)
  const y0 = Math.round((size - h) / 2)
  HEAD.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      if (ch !== 'X') return
      for (let yy = 0; yy < cell; yy++) for (let xx = 0; xx < cell; xx++) put(img, x0 + c * (cell + gap) + xx, y0 + r * (cell + gap) + yy, INK, 1)
    })
  )
  return img
}

/** Every size Windows asks an .ico for. */
export const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
