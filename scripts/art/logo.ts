/**
 * The GitGremlin logo: a little pixel gremlin (pointy ears, glowing
 * GitHub-green eyes, a toothy grin) on a dark rounded tile, standing on a tiny
 * commit graph whose three commits are the pets' colours (Catbot orange,
 * Dusty teal, Syncy gold). Drawn on a 16x16 grid so it is crisp at the 16 px
 * tray size and scales by whole pixels to 32, 48 and 256.
 */
import { Img, stamp } from './pixel.ts'

const TILE = '#121315'
const FACE = '#F1F1EE'
const FACE_SHADE = '#B9BAB4'
const EYE = '#39D353'
const EYE_HI = '#C8F7D2'
const MOUTH = '#121315'
const LINE = '#5B5F66'
const COMMITS = ['#F28A1E', '#1FB5A3', '#E2A812']

export function logo(): Img {
  const img = new Img(16, 16)
  img.round(0, 0, 16, 16, TILE)
  // Head and ears: X = face, o = shade (the inside of the ears).
  stamp(
    img,
    [
      '.X............X.',
      '.XX..........XX.',
      '.XoX.XXXXXX.XoX.',
      '..XoXXXXXXXXoX..',
      '...XXXXXXXXXX...',
      '...XXXXXXXXXX...',
      '...XXXXXXXXXX...',
      '...XXXXXXXXXX...',
      '...XXXXXXXXXX...',
      '....XXXXXXXX....',
      '.....XXXXXX.....'
    ],
    0,
    1,
    FACE,
    FACE_SHADE
  )
  // Glowing eyes (2x2 each, with a bright top-left glint).
  for (const x of [5, 9]) {
    img.rect(x, 5, 2, 2, EYE)
    img.set(x, 5, EYE_HI)
  }
  // Toothy grin: two little fangs hanging into a dark mouth.
  stamp(img, ['X.XX.X', 'XXXXXX'], 5, 8, MOUTH)
  // A tiny commit graph underneath: three commits on one line.
  img.rect(3, 14, 10, 1, LINE)
  COMMITS.forEach((c, i) => img.rect(3 + i * 4, 13, 2, 2, c))
  return img
}
