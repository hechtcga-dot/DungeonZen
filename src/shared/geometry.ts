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

export function distance(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

export interface TravelEstimate {
  minutes: number | null
  km: number | null
  /** How it was worked out, in plain words. */
  basis: string
}

/**
 * Travel time between two points on a map. A time the DM saved for this route
 * wins; otherwise straight-line distance from the map's scale (its width in
 * km) at the given pace, rounded to 10 minutes. Without a scale there is no
 * estimate and the DM sets the time.
 */
export function estimateTravel(input: {
  from: Point; to: Point; imageWidth: number | null; widthKm: number | null; kmh: number; savedMinutes?: number | null; units?: Units
}): TravelEstimate {
  const units = input.units ?? DEFAULT_UNITS
  if (input.savedMinutes != null) return { minutes: input.savedMinutes, km: null, basis: 'the time you set for this route' }
  if (!input.imageWidth || !input.widthKm || input.kmh <= 0) {
    return { minutes: null, km: null, basis: `no map scale yet: set how many ${longUnit(units)} the map is across` }
  }
  const km = (distance(input.from, input.to) / input.imageWidth) * input.widthKm
  const minutes = Math.max(10, Math.round(((km / input.kmh) * 60) / 10) * 10)
  return { minutes, km: Math.round(km * 10) / 10, basis: `about ${fmtDistance(km, units)} in a straight line at ${fmtSpeed(input.kmh, units)}` }
}
