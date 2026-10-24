/**
 * Token auto-fit: reads a small copy of a portrait (RGBA) and finds its background colour (the picture's edges)
 * and the figure (what differs from it), then the circle around the figure that must fit inside the token.
 * Circles are in picture widths (x, y, r all ÷ width), so they hold for any size of the same picture.
 */
export interface FitCircle { x: number; y: number; r: number }
export interface TokenFit { bg: string; body: FitCircle; head: FitCircle }

const FALLBACK_BG = '#d8c8a8'

export function analysePortrait(px: ArrayLike<number>, w: number, h: number): TokenFit {
  const at = (x: number, y: number) => (y * w + x) * 4
  // Background: the median colour of the opaque pixels along the edges.
  const edge: number[][] = []
  const band = Math.max(1, Math.round(Math.min(w, h) * 0.03))
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x >= band && x < w - band && y >= band && y < h - band) continue
    const i = at(x, y)
    if (px[i + 3] >= 128) edge.push([px[i], px[i + 1], px[i + 2]])
  }
  const median = (k: number) => { const v = edge.map((c) => c[k]).sort((a, b) => a - b); return v[v.length >> 1] }
  const bgRgb = edge.length ? [median(0), median(1), median(2)] : null
  const bg = bgRgb ? '#' + bgRgb.map((c) => c.toString(16).padStart(2, '0')).join('') : FALLBACK_BG

  // The figure: opaque pixels that differ from the background.
  const on = new Uint8Array(w * h)
  let count = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = at(x, y)
    if (px[i + 3] < 128) continue
    if (bgRgb && Math.hypot(px[i] - bgRgb[0], px[i + 1] - bgRgb[1], px[i + 2] - bgRgb[2]) < 48) continue
    on[y * w + x] = 1; count++
  }
  const cover: FitCircle = { x: 0.5, y: h / w / 2, r: Math.min(w, h) / w / 2 }
  // A busy picture (a scene, no plain background) or an empty one: fill the circle with its middle.
  if (count > w * h * 0.75 || count < w * h * 0.01) return { bg, body: cover, head: cover }

  // Rows and columns with enough of the figure (stray specks left out) give its box.
  const cols = new Array(w).fill(0), rows = new Array(h).fill(0)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (on[y * w + x]) { cols[x]++; rows[y]++ }
  const span = (c: number[], min: number) => [c.findIndex((n) => n >= min), c.length - 1 - [...c].reverse().findIndex((n) => n >= min)]
  const [x0, x1] = span(cols, Math.max(2, h * 0.03)), [y0, y1] = span(rows, Math.max(2, w * 0.03))
  if (x0 < 0 || y0 < 0) return { bg, body: cover, head: cover }

  // The smallest circle around the given box's centre that holds every figure pixel in [top, bottom].
  const circle = (top: number, bottom: number): FitCircle => {
    let a = w, b = 0
    for (let y = top; y <= bottom; y++) for (let x = x0; x <= x1; x++) if (on[y * w + x]) { a = Math.min(a, x); b = Math.max(b, x) }
    const cx = (a + b + 1) / 2, cy = (top + bottom + 1) / 2
    let r = 0
    for (let y = top; y <= bottom; y++) for (let x = a; x <= b; x++) if (on[y * w + x]) r = Math.max(r, Math.hypot(x + 0.5 - cx, y + 0.5 - cy))
    return { x: cx / w, y: cy / w, r: Math.max(r, 1) / w }
  }
  const body = circle(y0, y1)
  // Head and body: the top part of a tall figure (a bust is shown whole either way).
  const bh = y1 - y0 + 1, bw = x1 - x0 + 1
  const head = bh > bw * 1.3 ? circle(y0, y0 + Math.round(bh * 0.45)) : body
  return { bg, body, head }
}
