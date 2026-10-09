/** Distances are stored metric (km, km/h, m); the DM picks what the screens show. */
export type Units = 'metric' | 'imperial'
export const DEFAULT_UNITS: Units = 'metric'
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
