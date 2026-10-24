// Tokens for Roll20: a card's portrait in a round border, drawn on a canvas. Borders are drawn in code
// (replaceable, like the rest of the art in src/renderer/art); the picture comes in as a data URL from main
// (a dz-asset picture would make the canvas unreadable).
import { analysePortrait, type TokenFit } from '../shared/tokenFit'
import type { TokenBorder, TokenSpec } from '../shared/token'

export interface TokenPicture { img: HTMLImageElement; fit: TokenFit }

/** Loads a portrait (data URL) and works out its automatic fit. */
export async function loadTokenPicture(dataUrl: string): Promise<TokenPicture> {
  const img = new Image()
  img.src = dataUrl
  await img.decode()
  const k = Math.min(1, 160 / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k))
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.drawImage(img, 0, 0, w, h)
  return { img, fit: analysePortrait(g.getImageData(0, 0, w, h).data, w, h) }
}

/** Ring colours, light (top left) to dark (bottom right). */
const PALETTES: Record<Exclude<TokenBorder, 'plain' | 'none'>, string[]> = {
  ember: ['#fffbd2', '#ffe24a', '#ffb623', '#f67e1d', '#d9471a', '#9a1e0b', '#4c0904'],
  gold: ['#fff8c8', '#f4d466', '#d9a937', '#a8761c', '#6e4a0e'],
  silver: ['#ffffff', '#e2e6ea', '#aab2bb', '#77808a', '#3e444b'],
  bronze: ['#f9d9aa', '#d9975a', '#a8642c', '#743c12', '#3c1d06'],
  blood: ['#ffb08c', '#e5532f', '#b8220f', '#7a0b05', '#350302'],
  iron: ['#d6d6d0', '#9a9a94', '#6a6a66', '#454543', '#1e1e1d']
}

/** Grey mottled noise (same every time: seeded), for the ring's texture. */
const noiseCache = new Map<number, HTMLCanvasElement>()
function noise(size: number): HTMLCanvasElement {
  const hit = noiseCache.get(size)
  if (hit) return hit
  let seed = 7
  const rand = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const out = document.createElement('canvas')
  out.width = out.height = size
  const g = out.getContext('2d')!
  g.fillStyle = '#808080'
  g.fillRect(0, 0, size, size)
  g.imageSmoothingEnabled = true
  g.imageSmoothingQuality = 'high'
  // Octaves: small random grids stretched over the whole ring, finer ones fainter.
  ;[[8, 0.55], [16, 0.45], [40, 0.35], [100, 0.25], [220, 0.18]].forEach(([n, alpha]) => {
    const s = document.createElement('canvas')
    s.width = s.height = n
    const sg = s.getContext('2d')!
    const d = sg.createImageData(n, n)
    for (let i = 0; i < n * n; i++) { const v = Math.round(rand() * 255); d.data.set([v, v, v, 255], i * 4) }
    sg.putImageData(d, 0, 0)
    g.globalAlpha = alpha
    g.drawImage(s, 0, 0, size, size)
  })
  noiseCache.set(size, out)
  return out
}

/** Draws the token for `spec` on `canvas` (resized to spec.size). */
export function drawToken(canvas: HTMLCanvasElement, pic: TokenPicture, spec: TokenSpec): void {
  const S = spec.size
  canvas.width = canvas.height = S
  const g = canvas.getContext('2d')!
  g.clearRect(0, 0, S, S)
  const c = S / 2
  const R = S / 2 - S * 0.004
  const ringW = spec.border === 'none' ? 0 : spec.border === 'plain' ? S * 0.035 : S * 0.1
  const Ri = R - ringW

  // The picture: background colour, then the portrait framed so the figure's circle fills the opening.
  g.save()
  g.beginPath(); g.arc(c, c, spec.border === 'none' ? R : Ri + ringW * 0.5, 0, Math.PI * 2); g.clip()
  g.fillStyle = spec.bg ?? pic.fit.bg
  g.fillRect(0, 0, S, S)
  const circle = spec.fit === 'head' ? pic.fit.head : pic.fit.body
  const W = pic.img.naturalWidth, H = pic.img.naturalHeight
  const k = (Ri * 0.95 * spec.zoom) / (circle.r * W)
  const iw = W * k, ih = H * k
  const ox = c + spec.dx * S - circle.x * W * k, oy = c + spec.dy * S - circle.y * W * k
  // Soft picture edges, so they melt into the background colour.
  const pc = document.createElement('canvas')
  pc.width = S; pc.height = S
  const pg = pc.getContext('2d')!
  pg.imageSmoothingQuality = 'high'
  pg.drawImage(pic.img, ox, oy, iw, ih)
  const f = Math.max(2, Math.min(iw, ih) * 0.04)
  pg.globalCompositeOperation = 'destination-out'
  const fade = (x0: number, y0: number, x1: number, y1: number, rx: number, ry: number, rw: number, rh: number) => {
    const gr = pg.createLinearGradient(x0, y0, x1, y1)
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)')
    pg.fillStyle = gr; pg.fillRect(rx, ry, rw, rh)
  }
  fade(ox, 0, ox + f, 0, ox, oy, f, ih)
  fade(ox + iw, 0, ox + iw - f, 0, ox + iw - f, oy, f, ih)
  fade(0, oy, 0, oy + f, ox, oy, iw, f)
  fade(0, oy + ih, 0, oy + ih - f, ox, oy + ih - f, iw, f)
  g.drawImage(pc, 0, 0)
  // Depth: the picture darkens a little under the ring.
  if (ringW) {
    const sh = g.createRadialGradient(c, c, Ri * 0.82, c, c, Ri)
    sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.38)')
    g.fillStyle = sh; g.fillRect(0, 0, S, S)
  }
  g.restore()
  if (!ringW) return

  const ring = () => { g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.arc(c, c, Ri, 0, Math.PI * 2, true) }
  g.save()
  ring(); g.clip()
  if (spec.border === 'plain') {
    g.fillStyle = '#f7f4ee'; g.fillRect(0, 0, S, S)
  } else {
    // Colour, light top left to dark bottom right.
    const stops = PALETTES[spec.border as keyof typeof PALETTES]
    const lg = g.createLinearGradient(c - R * 0.55, c - R * 0.85, c + R * 0.55, c + R * 0.85)
    stops.forEach((s, i) => lg.addColorStop(i / (stops.length - 1), s))
    g.fillStyle = lg; g.fillRect(0, 0, S, S)
    // Texture: mottled noise; ember and blood get dark fire patches too, more towards the red side.
    g.globalCompositeOperation = 'overlay'
    g.globalAlpha = 0.6
    g.drawImage(noise(S), 0, 0)
    g.globalAlpha = 1
    if (spec.border === 'ember' || spec.border === 'blood') {
      const t = document.createElement('canvas')
      t.width = t.height = S
      const tg = t.getContext('2d')!
      tg.translate(c, c); tg.rotate(1.1); tg.drawImage(noise(S), -c, -c); tg.setTransform(1, 0, 0, 1, 0, 0)
      tg.globalCompositeOperation = 'destination-in'
      const m = tg.createLinearGradient(c - R * 0.4, c - R * 0.8, c + R * 0.5, c + R * 0.9)
      m.addColorStop(0, 'rgba(0,0,0,0)'); m.addColorStop(1, 'rgba(0,0,0,0.7)')
      tg.fillStyle = m; tg.fillRect(0, 0, S, S)
      g.globalCompositeOperation = 'multiply'
      g.drawImage(t, 0, 0)
    }
    // The colours again over the texture (it greys them).
    g.globalCompositeOperation = 'color'
    g.globalAlpha = 0.6
    g.fillStyle = lg; g.fillRect(0, 0, S, S)
    g.globalAlpha = 1
  }
  if (spec.tint) {
    g.globalCompositeOperation = 'color'
    g.globalAlpha = 0.85
    g.fillStyle = spec.tint; g.fillRect(0, 0, S, S)
    g.globalAlpha = 1
  }
  // Bevel: dark at both edges, a lit band in the middle; a gloss top left.
  g.globalCompositeOperation = 'source-over'
  const bv = g.createRadialGradient(c, c, Ri, c, c, R)
  bv.addColorStop(0, 'rgba(0,0,0,0.6)'); bv.addColorStop(0.16, 'rgba(0,0,0,0)')
  bv.addColorStop(0.42, 'rgba(255,250,225,0.2)'); bv.addColorStop(0.62, 'rgba(255,255,255,0)')
  bv.addColorStop(0.86, 'rgba(0,0,0,0.12)'); bv.addColorStop(1, 'rgba(0,0,0,0.6)')
  g.fillStyle = bv; g.fillRect(0, 0, S, S)
  g.globalCompositeOperation = 'screen'
  const gl = g.createRadialGradient(c - R * 0.55, c - R * 0.6, 0, c - R * 0.55, c - R * 0.6, R * 0.7)
  gl.addColorStop(0, 'rgba(255,245,200,0.3)'); gl.addColorStop(1, 'rgba(255,245,200,0)')
  g.fillStyle = gl; g.fillRect(0, 0, S, S)
  g.restore()
  // Fine dark lines at the ring's edges.
  g.strokeStyle = spec.border === 'plain' ? 'rgba(40,30,20,0.7)' : 'rgba(35,10,3,0.85)'
  g.lineWidth = Math.max(1, S * 0.006)
  g.beginPath(); g.arc(c, c, R - g.lineWidth / 2, 0, Math.PI * 2); g.stroke()
  g.beginPath(); g.arc(c, c, Ri + g.lineWidth / 2, 0, Math.PI * 2); g.stroke()
}

/** The canvas as PNG, base64 (no data: prefix). */
export const canvasPng = (canvas: HTMLCanvasElement) => canvas.toDataURL('image/png').split(',')[1]
