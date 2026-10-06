import { centroid, pointInPolygon, polygonArea, type Point } from './geometry'

// Where to write place names on a map so they do not sit on top of each other: settlement
// tags stay under their marker; land and sea names move off them, staying inside their area.

export interface LabelInput {
  polygon: Point[]
  name: string
  /** A settlement or landmark: a marker with a tag under it. */
  spot: boolean
}

interface Box { x0: number; y0: number; x1: number; y1: number }
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1

/**
 * The point to centre each name on (image pixels). `unit` is image pixels per screen pixel,
 * `areaSize` and `spotSize` the font sizes in screen pixels.
 */
export function placeLabels(items: LabelInput[], unit: number, areaSize = 17, spotSize = 12): Point[] {
  const out: Point[] = items.map((r) => centroid(r.polygon))
  const placed: Box[] = []
  items.forEach((r, i) => {
    if (!r.spot) return
    const [x, y] = out[i]
    const w = (r.name.length * spotSize * 0.57 + 16) * unit
    placed.push({ x0: x - w / 2, x1: x + w / 2, y0: y - 10 * unit, y1: y + (14 + spotSize * 1.5) * unit })
  })
  // Smaller areas first: they have the least room.
  const areas = items.map((r, i) => ({ r, i })).filter((x) => !x.r.spot)
    .sort((a, b) => Math.abs(polygonArea(a.r.polygon)) - Math.abs(polygonArea(b.r.polygon)))
  for (const { r, i } of areas) {
    const [cx, cy] = out[i]
    const w = r.name.length * areaSize * 0.5 * unit
    const h = areaSize * 1.2 * unit
    const box = (x: number, y: number): Box => ({ x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2 })
    const steps: Array<[number, number]> = [[0, 0], [0, 1.3], [0, -1.3], [0, 2.6], [0, -2.6], [0.6, 0], [-0.6, 0], [0.6, 1.3], [-0.6, 1.3], [0.6, -1.3], [-0.6, -1.3], [0, 4], [0, -4]]
    let best: Point = [cx, cy]
    for (const [fx, fy] of steps) {
      const p: Point = [cx + fx * w, cy + fy * h]
      if (!pointInPolygon(p, r.polygon)) continue
      if (placed.some((b) => overlaps(b, box(p[0], p[1])))) continue
      best = p
      break
    }
    out[i] = best
    placed.push(box(best[0], best[1]))
  }
  return out
}
