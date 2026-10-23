import { DEFAULT_UNITS, fmtDistance, fmtSpeed, longUnit, type Units } from './units'
// Plane geometry for map regions (image pixel coordinates). Pure, unit tested.

export type Point = [number, number]

/** Ray casting: true when the point lies inside the polygon (edges count as inside rarely; fine for clicks). */
export function pointInPolygon([x, y]: Point, poly: Point[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export function polygonArea(poly: Point[]): number {
  let a = 0
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1])
  return Math.abs(a / 2)
}

/** Centre of mass of the polygon (falls back to the average of the points for degenerate shapes). */
export function centroid(poly: Point[]): Point {
  let a = 0, cx = 0, cy = 0
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1]
    a += f
    cx += (poly[j][0] + poly[i][0]) * f
    cy += (poly[j][1] + poly[i][1]) * f
  }
  if (Math.abs(a) < 1e-9) {
    const n = poly.length || 1
    return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n]
  }
  return [cx / (3 * a), cy / (3 * a)]
}

/** The smallest region containing the point (so a sub-region wins over its parent), or null. */
export function regionAt<T extends { polygon: Point[] }>(p: Point, regions: T[]): T | null {
  return regions.filter((r) => r.polygon.length >= 3 && pointInPolygon(p, r.polygon))
    .sort((a, b) => polygonArea(a.polygon) - polygonArea(b.polygon))[0] ?? null
}

/**
 * A spot in the region that `regionAt` gives back as that region (Move party here): the centroid when it is, else
 * the nearest point of a 24 × 24 grid over the shape that is. Odd shapes and regions with towns inside missed before.
 */
export function spotIn<T extends { polygon: Point[] }>(region: T, regions: T[]): Point {
  const c = centroid(region.polygon)
  if (regionAt(c, regions) === region) return c
  const xs = region.polygon.map((p) => p[0]), ys = region.polygon.map((p) => p[1])
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  let best: Point | null = null
  for (let i = 0; i <= 24; i++) {
    for (let j = 0; j <= 24; j++) {
      const p: Point = [x0 + ((x1 - x0) * i) / 24, y0 + ((y1 - y0) * j) / 24]
      if (regionAt(p, regions) === region && (!best || distance(p, c) < distance(best, c))) best = p
    }
  }
  return best ?? c
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

/** The polygon with `p` added as a corner on its nearest edge. */
export function insertOnEdge(poly: Point[], p: Point): Point[] {
  let best = 0, bestD = Infinity
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length], dx = b[0] - a[0], dy = b[1] - a[1]
    const t = dx || dy ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy))) : 0
    const d = distance(p, [a[0] + t * dx, a[1] + t * dy])
    if (d < bestD) { bestD = d; best = i }
  })
  return [...poly.slice(0, best + 1), p, ...poly.slice(best + 1)]
}

/** Travel grid (invisible): 200 squares across the map; each end snaps to its square's centre. */
const GRID = 200
export function gridDistance(a: Point, b: Point, imageWidth: number): number {
  const c = imageWidth / GRID, snap = (v: number) => Math.floor(v / c)
  return Math.hypot(snap(a[0]) - snap(b[0]), snap(a[1]) - snap(b[1])) * c
}

export interface TravelEstimate {
  minutes: number | null
  km: number | null
  /** How it was worked out, in plain words. */
  basis: string
  /** The minutes are the DM's remembered time for this route. */
  saved?: boolean
}

/**
 * Travel time between two points on a map. A time the DM saved for this route
 * wins; otherwise straight-line distance on the travel grid from the map's scale (its width in
 * km) at the given pace, rounded to 10 minutes. Without a scale there is no
 * estimate and the DM sets the time.
 */
export function estimateTravel(input: {
  from: Point; to: Point; imageWidth: number | null; widthKm: number | null; kmh: number; savedMinutes?: number | null; units?: Units
}): TravelEstimate {
  const units = input.units ?? DEFAULT_UNITS
  const scaled = !!input.imageWidth && !!input.widthKm
  if (input.savedMinutes != null) {
    const km = scaled ? Math.round((gridDistance(input.from, input.to, input.imageWidth!) / input.imageWidth!) * input.widthKm! * 1000) / 1000 : null
    return { minutes: input.savedMinutes, km, basis: 'the time you set for this route', saved: true }
  }
  if (!input.imageWidth || !input.widthKm || input.kmh <= 0) {
    return { minutes: null, km: null, basis: `no map scale yet: set how many ${longUnit(units)} the map is across` }
  }
  const km = (gridDistance(input.from, input.to, input.imageWidth) / input.imageWidth) * input.widthKm
  const minutes = Math.max(10, Math.round(((km / input.kmh) * 60) / 10) * 10)
  return { minutes, km: Math.round(km * 1000) / 1000, basis: `about ${fmtDistance(km, units)} in a straight line at ${fmtSpeed(input.kmh, units)}` }
}

/** A map picture on a board: where it sits (board units) and the map's own size and regions (map pixels). */
export interface BoardMapPicture<R extends { polygon: Point[] }> { x: number; y: number; w: number; h: number; mapW: number; mapH: number; regions: R[] }

/** The region under a board point, on the top-most map picture that covers it (pictures listed bottom first), or null. */
export function regionOnBoard<R extends { polygon: Point[] }>([px, py]: Point, pictures: Array<BoardMapPicture<R>>): R | null {
  for (const p of [...pictures].reverse()) {
    if (px < p.x || py < p.y || px > p.x + p.w || py > p.y + p.h) continue
    return regionAt([((px - p.x) * p.mapW) / p.w, ((py - p.y) * p.mapH) / p.h], p.regions)
  }
  return null
}
