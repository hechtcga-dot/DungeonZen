/** Distances are stored metric (km, km/h, m); the DM picks what the screens show. */
export type Units = 'metric' | 'imperial'
export const DEFAULT_UNITS: Units = 'imperial' // owner, 2026-10-16: imperial unless the DM picks metric
export const KM_PER_MILE = 1.609344
/** One battle map square: 1.5 m (5 ft). */
export const SQUARE_M = 1.5

const round1 = (n: number) => Math.round(n * 10) / 10

/** "12 km" / "7.5 miles". */
export function fmtDistance(km: number, units: Units): string {
  return units === 'imperial' ? `${round1(km / KM_PER_MILE)} miles` : `${round1(km)} km`
}
/** "4.8 km/h" / "3 mph". */
export function fmtSpeed(kmh: number, units: Units): string {
  return units === 'imperial' ? `${round1(kmh / KM_PER_MILE)} mph` : `${round1(kmh)} km/h`
}
/** Battle map size for a number of squares: "15 m" / "50 ft". */
export function fmtSquares(n: number, units: Units): string {
  return units === 'imperial' ? `${n * 5} ft` : `${round1(n * SQUARE_M)} m`
}
/** Long distances: the number the DM types in the shown unit, and back. */
export const kmToShown = (km: number, units: Units) => (units === 'imperial' ? round1(km / KM_PER_MILE) : round1(km))
export const shownToKm = (n: number, units: Units) => (units === 'imperial' ? n * KM_PER_MILE : n)
export const longUnit = (units: Units) => (units === 'imperial' ? 'miles' : 'km')
export const speedUnit = (units: Units) => (units === 'imperial' ? 'mph' : 'km/h')

/** Units the DM can give the map's scale bar in. */
export type LengthUnit = 'ft' | 'mi' | 'm' | 'km'
export const LENGTH_UNITS: LengthUnit[] = ['ft', 'mi', 'm', 'km']
export const KM_PER: Record<LengthUnit, number> = { ft: 0.0003048, mi: KM_PER_MILE, m: 0.001, km: 1 }

/** Travel paces in Confirm travel; each system has its own round numbers. Normal walk first pick every time. */
export const PACES: Array<{ name: string; mph: number; kmh: number }> = [
  { name: 'Slow walk', mph: 2, kmh: 3 }, { name: 'Normal walk', mph: 3, kmh: 5 }, { name: 'Fast walk', mph: 4, kmh: 6.5 },
  { name: 'Jog', mph: 5, kmh: 8 }, { name: 'Run', mph: 7.5, kmh: 12 }, { name: 'Mounted', mph: 8, kmh: 13 }, { name: 'Cart', mph: 2.5, kmh: 4 }
]
export const paceKmh = (p: { mph: number; kmh: number }, units: Units) => (units === 'imperial' ? p.mph * KM_PER_MILE : p.kmh)

/** A trip's length in the chosen system only: "350 ft", "1.3 mi", "800 m", "12 km". */
export function fmtTrip(km: number, units: Units): string {
  if (units === 'imperial') {
    const mi = km / KM_PER_MILE
    return mi < 0.25 ? `${Math.round((mi * 5280) / 10) * 10} ft` : `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`
  }
  return km < 1 ? `${Math.round((km * 1000) / 10) * 10} m` : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`
}

/** A tidy step for a scale bar row: 4 to 10 divisions of 1, 2, 2.5 or 5 × a power of ten. */
export function niceStep(span: number): number {
  const p = 10 ** Math.floor(Math.log10(span / 10))
  return [1, 2, 2.5, 5, 10].map((k) => k * p).find((v) => span / v <= 10)!
}
/** A round length (1, 2, 2.5 or 5 × a power of ten) no longer than `max`. */
export function roundDown(max: number): number {
  const p = 10 ** Math.floor(Math.log10(max))
  return [5, 2.5, 2, 1].map((k) => k * p).find((v) => v <= max) ?? p
}

/**
 * Free text (stat blocks, notes) keeps its words; for metric display, feet and miles
 * become metres and km (5 ft = 1.5 m, as the grid). Imperial shows the text as written.
 */
export function convertText(text: string, units: Units): string {
  if (units === 'imperial' || !text) return text
  const m = (n: string) => round1((Number(n) / 5) * SQUARE_M)
  return text
    .replace(/(\d+)\/(\d+)\s?(?:ft\.?|feet)(?![a-z])/gi, (_, a: string, b: string) => `${m(a)}/${m(b)} m`)
    .replace(/(\d+(?:\.\d+)?)(?:-|\s)?(?:ft\.?|feet|foot)(?![a-z])/gi, (_, n: string) => `${round1((Number(n) / 5) * SQUARE_M)} m`)
    .replace(/(\d+(?:\.\d+)?)(?:-|\s)?(?:miles?|mi\.)(?![a-z])/gi, (_, n: string) => `${round1(Number(n) * KM_PER_MILE)} km`)
}
