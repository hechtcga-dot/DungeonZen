import { z } from 'zod'
import { MINUTES_PER_DAY, setDateFormatter } from './time'
import { moonFrom, type MoonState } from './sky'

// The campaign calendar (3.9): turns campaign days into dates and back. Time stays integer minutes from campaign
// start (rule 5); a calendar only names the days. Day 1 of the campaign is `start`. A date's `day` may run past the
// month's own days: those are festival days outside the month (Harptos: Midwinter is day 31 of Hammer).

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const Text = (max: number) => z.string().trim().max(max)

export const CalDate = z.object({ year: z.number().int().min(-100000).max(100000), month: z.number().int().min(0).max(99), day: z.number().int().min(1).max(999) })
export type CalDate = z.infer<typeof CalDate>

export const Festival = z.object({ name: Text(60).min(1), day: z.number().int().min(1).max(999), length: z.number().int().min(1).max(60), leapOnly: z.boolean().optional() })
export type Festival = z.infer<typeof Festival>

export const CalMonth = z.object({
  name: Text(60).min(1), days: z.number().int().min(1).max(400),
  /** Extra days in leap years (Gregorian February: 1). */
  leapDays: z.number().int().min(0).max(60).optional(),
  festivals: z.array(Festival).max(30).optional()
})
export type CalMonth = z.infer<typeof CalMonth>

export const CalMoon = z.object({
  name: Text(60).min(1), colour: Hex, cycle: z.number().min(1).max(10000),
  /** A date the moon is full. */
  full: CalDate,
  /** "Manual Lunar Dates": the DM set cycle and full date; otherwise they follow the calendar. */
  manual: z.boolean().optional(),
  status: z.enum(['active', 'defunct']).optional()
})
export type CalMoon = z.infer<typeof CalMoon>

export const Season = z.object({ name: Text(40).min(1), month: z.number().int().min(0).max(99), day: z.number().int().min(1).max(999), colour: Hex })
export type Season = z.infer<typeof Season>

export const WEATHER_KINDS = ['clear', 'cloudy', 'rain', 'storm', 'snow', 'fog'] as const
export type WeatherKind = typeof WEATHER_KINDS[number]
export const WEATHER_COLUMNS: Record<WeatherKind, string> = { clear: 'Clear', cloudy: 'Cloud', rain: 'Rain', storm: 'Storm', snow: 'Snow', fog: 'Fog' }
export const CLIMATES = ['temperate', 'cold', 'warm', 'desert', 'tropical', 'custom'] as const
export type Climate = typeof CLIMATES[number]

export const CalendarDef = z.object({
  preset: Text(40),
  name: Text(80).min(1),
  yearLabel: Text(20),
  months: z.array(CalMonth).min(1).max(60),
  weekdays: z.array(Text(40).min(1)).min(1).max(20),
  /** Weeks start again on each month's day 1; festival days past the month have no weekday. */
  weeksRestart: z.boolean(),
  /** Leap years: the rule with the largest `every` that divides the year decides (Gregorian 4 / 100 / 400). */
  leap: z.array(z.object({ every: z.number().int().min(1).max(10000), leap: z.boolean() })).max(5),
  weekdayOffset: z.number().int().min(0).max(19),
  start: CalDate,
  moons: z.array(CalMoon).max(20),
  seasons: z.array(Season).max(12),
  climate: z.enum(CLIMATES),
  /** Chance of each weather kind per season (rows follow `seasons`, columns follow WEATHER_KINDS). */
  weather: z.array(z.array(z.number().min(0).max(1000)).length(6)).max(12),
  weatherSeed: z.number().int().min(0).max(2 ** 31)
})
export type CalendarDef = z.infer<typeof CalendarDef>

// ---- presets --------------------------------------------------------------------------------------------------------

const CLIMATE_ODDS: Record<Exclude<Climate, 'custom'>, number[][]> = {
  // Spring, Summer, Autumn, Winter; columns clear, cloudy, rain, storm, snow, fog
  temperate: [[30, 30, 30, 5, 0, 5], [50, 25, 10, 12, 0, 3], [25, 35, 25, 5, 0, 10], [20, 35, 5, 5, 30, 5]],
  cold: [[20, 35, 15, 5, 20, 5], [40, 30, 20, 5, 0, 5], [15, 35, 15, 5, 25, 5], [10, 30, 0, 5, 50, 5]],
  warm: [[45, 25, 20, 7, 0, 3], [60, 15, 10, 13, 0, 2], [40, 30, 20, 7, 0, 3], [35, 35, 22, 5, 0, 3]],
  desert: [[80, 12, 3, 3, 0, 2], [90, 6, 1, 2, 0, 1], [80, 13, 3, 3, 0, 1], [70, 20, 5, 3, 0, 2]],
  tropical: [[35, 25, 30, 8, 0, 2], [25, 20, 35, 18, 0, 2], [30, 25, 32, 11, 0, 2], [45, 25, 22, 6, 0, 2]]
}
const SEASON_ROW: Record<string, number> = { spring: 0, summer: 1, autumn: 2, fall: 2, winter: 3 }

/** The weather odds of a climate for these seasons (by name; other names get spring's). */
export function climateOdds(climate: Exclude<Climate, 'custom'>, seasons: Season[]): number[][] {
  return seasons.map((s) => [...CLIMATE_ODDS[climate][SEASON_ROW[s.name.trim().toLowerCase()] ?? 0]])
}

const four = (spring: [number, number], summer: [number, number], autumn: [number, number], winter: [number, number]): Season[] => [
  { name: 'Spring', month: spring[0], day: spring[1], colour: '#6f9a4a' }, { name: 'Summer', month: summer[0], day: summer[1], colour: '#d1a13a' },
  { name: 'Autumn', month: autumn[0], day: autumn[1], colour: '#b0612e' }, { name: 'Winter', month: winter[0], day: winter[1], colour: '#7c95ad' }
]
const moon = (name: string, colour: string, cycle: number, full: CalDate): CalMoon => ({ name, colour, cycle, full })
const GREG_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const GREG_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEK7 = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const TENDAY = ['First-day', 'Second-day', 'Third-day', 'Fourth-day', 'Fifth-day', 'Sixth-day', 'Seventh-day', 'Eighth-day', 'Ninth-day', 'Tenth-day']
const GREG_LEAP = [{ every: 4, leap: true }, { every: 100, leap: false }, { every: 400, leap: true }]
const gregMonths = (names: string[]): CalMonth[] => names.map((name, i) => ({ name, days: GREG_DAYS[i], ...(i === 1 ? { leapDays: 1 } : {}) }))

function preset(p: Omit<CalendarDef, 'climate' | 'weather' | 'weatherSeed'>): CalendarDef {
  return { ...p, climate: 'temperate', weather: climateOdds('temperate', p.seasons), weatherSeed: 1 }
}

export const CALENDAR_PRESETS: CalendarDef[] = [
  preset({
    preset: 'gregorian', name: 'Gregorian', yearLabel: '', months: gregMonths(GREG_NAMES), weekdays: WEEK7, weeksRestart: false,
    leap: GREG_LEAP, weekdayOffset: 5, start: { year: 2026, month: 0, day: 1 },
    moons: [moon('The Moon', '#f3ead2', 29.530588, { year: 2026, month: 0, day: 3 })],
    seasons: four([2, 20], [5, 21], [8, 22], [11, 21])
  }),
  preset({
    preset: 'harptos', name: 'Harptos', yearLabel: 'DR',
    months: ['Hammer', 'Alturiak', 'Ches', 'Tarsakh', 'Mirtul', 'Kythorn', 'Flamerule', 'Eleasis', 'Eleint', 'Marpenoth', 'Uktar', 'Nightal'].map((name) => ({
      name, days: 30,
      festivals: ({
        Hammer: [{ name: 'Midwinter', day: 31, length: 1 }], Tarsakh: [{ name: 'Greengrass', day: 31, length: 1 }],
        Flamerule: [{ name: 'Midsummer', day: 31, length: 1 }, { name: 'Shieldmeet', day: 32, length: 1, leapOnly: true }],
        Eleint: [{ name: 'Highharvestide', day: 31, length: 1 }], Uktar: [{ name: 'The Feast of the Moon', day: 31, length: 1 }]
      } as Record<string, Festival[]>)[name]
    })).map((m) => (m.festivals ? m : { name: m.name, days: m.days })),
    weekdays: TENDAY, weeksRestart: true, leap: [{ every: 4, leap: true }], weekdayOffset: 0, start: { year: 1492, month: 0, day: 1 },
    moons: [moon('Selûne', '#f3ead2', 30.4375, { year: 1372, month: 0, day: 31 })],
    seasons: four([2, 19], [5, 20], [8, 21], [11, 20])
  }),
  preset({
    preset: 'greyhawk', name: 'Greyhawk Common Year', yearLabel: 'CY',
    months: ['Needfest', 'Fireseek', 'Readying', 'Coldeven', 'Growfest', 'Planting', 'Flocktime', 'Wealsun', 'Richfest', 'Reaping', 'Goodmonth', 'Harvester', 'Brewfest', 'Patchwall', "Ready'reat", 'Sunsebb']
      .map((name, i) => ({ name, days: i % 4 === 0 ? 7 : 28 })),
    weekdays: ['Starday', 'Sunday', 'Moonday', 'Godsday', 'Waterday', 'Earthday', 'Freeday'], weeksRestart: false, leap: [], weekdayOffset: 0,
    start: { year: 576, month: 1, day: 1 },
    moons: [moon('Luna', '#f3ead2', 28, { year: 576, month: 0, day: 4 }), moon('Celene', '#9cc3e0', 91, { year: 576, month: 0, day: 4 })],
    seasons: four([4, 1], [8, 1], [12, 1], [15, 1])
  }),
  preset({
    preset: 'galifar', name: 'Eberron Galifar', yearLabel: 'YK',
    months: ['Zarantyr', 'Olarune', 'Therendor', 'Eyre', 'Dravago', 'Nymm', 'Lharvion', 'Barrakas', 'Rhaan', 'Sypheros', 'Aryth', 'Vult'].map((name) => ({ name, days: 28 })),
    weekdays: ['Sul', 'Mol', 'Zol', 'Wir', 'Zor', 'Far', 'Sar'], weeksRestart: true, leap: [], weekdayOffset: 0, start: { year: 998, month: 0, day: 1 },
    moons: [['Zarantyr', '#e8e4d8'], ['Olarune', '#e8b46a'], ['Therendor', '#c8c8c8'], ['Eyre', '#c0c0c0'], ['Dravago', '#c9a3d8'], ['Nymm', '#f0d870'],
      ['Lharvion', '#f0f0e0'], ['Barrakas', '#e0e0e8'], ['Rhaan', '#a8c0e8'], ['Sypheros', '#7a7a80'], ['Aryth', '#e09a6a'], ['Vult', '#b0b0a8']]
      .map(([n, c], i) => moon(n, c, 28 + 7 * i, { year: 998, month: 0, day: 1 + 2 * i })),
    seasons: four([2, 1], [5, 1], [8, 1], [11, 1])
  }),
  preset({
    preset: 'exandria', name: 'Exandria', yearLabel: 'P.D.',
    months: [['Horisal', 29], ['Misuthar', 30], ['Dualahei', 30], ['Thunsheer', 31], ['Unndilar', 28], ['Brussendar', 31], ['Sydenstar', 32], ['Fessuran', 29], ["Quen'pillar", 27], ['Cuersaar', 29], ['Duscar', 32]]
      .map(([name, days]) => ({ name: name as string, days: days as number, ...(name === 'Horisal' ? { festivals: [{ name: 'New Dawn', day: 1, length: 1 }] } : {}) })),
    weekdays: ['Miresen', 'Grissen', 'Whelsen', 'Conthsen', 'Folsen', 'Yulisen', "Da'leysen"], weeksRestart: false, leap: [], weekdayOffset: 0,
    start: { year: 835, month: 0, day: 1 },
    moons: [moon('Catha', '#f3ead2', 33, { year: 835, month: 0, day: 1 }), moon('Ruidus', '#e07a6a', 328, { year: 835, month: 6, day: 15 })],
    seasons: four([2, 13], [4, 26], [7, 3], [10, 2])
  }),
  preset({
    preset: 'barovia', name: 'Barovia', yearLabel: 'BC',
    months: gregMonths(['1st Moon', '2nd Moon', '3rd Moon', '4th Moon', '5th Moon', '6th Moon', '7th Moon', '8th Moon', '9th Moon', '10th Moon', '11th Moon', '12th Moon']),
    weekdays: WEEK7, weeksRestart: false, leap: GREG_LEAP, weekdayOffset: 0, start: { year: 735, month: 0, day: 1 },
    moons: [moon('The Moon', '#f3ead2', 29.5, { year: 735, month: 0, day: 10 })],
    seasons: four([2, 20], [5, 21], [8, 22], [11, 21])
  }),
  preset({
    preset: 'plain', name: 'Plain 12 × 30', yearLabel: '',
    months: ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth', 'Eleventh', 'Twelfth'].map((n) => ({ name: `${n} Month`, days: 30 })),
    weekdays: TENDAY, weeksRestart: true, leap: [], weekdayOffset: 0, start: { year: 1, month: 0, day: 1 },
    moons: [moon('The Moon', '#f3ead2', 29.5, { year: 1, month: 0, day: 1 })],
    seasons: four([2, 1], [5, 1], [8, 1], [11, 1])
  })
]

export const DEFAULT_CALENDAR_PRESET = 'harptos'
export const presetCalendar = (id: string): CalendarDef | undefined => structuredClone(CALENDAR_PRESETS.find((p) => p.preset === id))

/**
 * The campaign's calendar from its stored setting. No setting yet: Harptos with Day 1 = 1 Hammer 1492 DR; an older
 * campaign's "moon is full on day N" (`moon_offset_days`) becomes its moon's Manual Lunar Dates.
 */
export function campaignCalendar(stored: unknown, moonOffsetDays?: unknown): CalendarDef {
  const ok = CalendarDef.safeParse(stored)
  if (ok.success) return ok.data
  const def = presetCalendar(DEFAULT_CALENDAR_PRESET)!
  const off = Number(moonOffsetDays ?? 0)
  if (off) def.moons[0] = { ...def.moons[0], cycle: 29.5, manual: true, full: dateOfDay(def, -off) }
  return def
}

// ---- dates ----------------------------------------------------------------------------------------------------------

export function isLeapYear(def: CalendarDef, year: number): boolean {
  let best: { every: number; leap: boolean } | null = null
  for (const r of def.leap) if (((year % r.every) + r.every) % r.every === 0 && (!best || r.every > best.every)) best = r
  return best?.leap ?? false
}

export interface MonthShape {
  /** The month's own days (leap days included). */
  days: number
  /** Festival days past the month's own days, in order: day number (days + 1, …) and name. */
  extra: Array<{ day: number; name: string }>
  /** Festivals that fall on the month's own days: day number → name. */
  named: Map<number, string>
}

export function monthShape(def: CalendarDef, year: number, month: number): MonthShape {
  const m = def.months[month]
  const leap = isLeapYear(def, year)
  const days = m.days + (leap ? m.leapDays ?? 0 : 0)
  const named = new Map<number, string>()
  const extra: MonthShape['extra'] = []
  for (const f of [...(m.festivals ?? [])].sort((a, b) => a.day - b.day)) {
    if (f.leapOnly && !leap) continue
    if (f.day <= days) for (let i = 0; i < f.length && f.day + i <= days; i++) named.set(f.day + i, f.name)
    else for (let i = 0; i < f.length; i++) extra.push({ day: days + extra.length + 1, name: f.name })
  }
  return { days, extra, named }
}

const monthLength = (def: CalendarDef, year: number, month: number) => { const s = monthShape(def, year, month); return s.days + s.extra.length }
export const yearLength = (def: CalendarDef, year: number) => def.months.reduce((n, _m, i) => n + monthLength(def, year, i), 0)

// Day number of each year's first day, counted from year 0 (computed once per calendar).
const YEAR_STARTS = new WeakMap<CalendarDef, Map<number, number>>()
function yearStart(def: CalendarDef, year: number): number {
  let starts = YEAR_STARTS.get(def)
  if (!starts) { starts = new Map([[0, 0]]); YEAR_STARTS.set(def, starts) }
  const hit = starts.get(year)
  if (hit !== undefined) return hit
  let y = 0, d = 0
  // Walk from the nearest known year (ponytail: a straight walk; years in play are a few thousand at most).
  for (const [ky, kd] of starts) if (Math.abs(ky - year) < Math.abs(y - year)) { y = ky; d = kd }
  while (y < year) { d += yearLength(def, y); y++; starts.set(y, d) }
  while (y > year) { y--; d -= yearLength(def, y); starts.set(y, d) }
  return d
}

/** Absolute day number of a date (any day count from year 0). */
export function absOf(def: CalendarDef, date: CalDate): number {
  let d = yearStart(def, date.year)
  for (let m = 0; m < date.month && m < def.months.length; m++) d += monthLength(def, date.year, m)
  return d + date.day - 1
}

export function dateOfAbs(def: CalendarDef, abs: number): CalDate {
  const avg = Math.max(1, yearLength(def, 0))
  let year = Math.floor(abs / avg)
  while (yearStart(def, year) > abs) year--
  while (yearStart(def, year + 1) <= abs) year++
  let rest = abs - yearStart(def, year)
  for (let month = 0; month < def.months.length; month++) {
    const len = monthLength(def, year, month)
    if (rest < len) return { year, month, day: rest + 1 }
    rest -= len
  }
  return { year, month: def.months.length - 1, day: 1 }
}

/** Campaign day (0 = Day 1) ↔ date. */
export const dayOfDate = (def: CalendarDef, date: CalDate) => absOf(def, date) - absOf(def, def.start)
export const dateOfDay = (def: CalendarDef, day: number) => dateOfAbs(def, absOf(def, def.start) + day)
export const dayOfMinutes = (minutes: number) => Math.floor(minutes / MINUTES_PER_DAY)

/** The festival a date falls on, if any. */
export function festivalOn(def: CalendarDef, date: CalDate): string | null {
  const s = monthShape(def, date.year, date.month)
  return date.day > s.days ? s.extra[date.day - s.days - 1]?.name ?? null : s.named.get(date.day) ?? null
}

/** Weekday index, or null for a festival day outside the weeks. */
export function weekdayOf(def: CalendarDef, date: CalDate): number | null {
  const n = def.weekdays.length
  if (def.weeksRestart) {
    const s = monthShape(def, date.year, date.month)
    return date.day > s.days ? null : (date.day - 1) % n
  }
  return (((absOf(def, date) + def.weekdayOffset) % n) + n) % n
}

export const yearText = (def: CalendarDef, year: number) => `${year}${def.yearLabel ? ` ${def.yearLabel}` : ''}`

/** "14 Tarsakh 1492 DR"; a festival day past the month: "Midwinter 1492 DR". */
export function formatDate(def: CalendarDef, date: CalDate, withYear = true): string {
  const s = monthShape(def, date.year, date.month)
  const y = withYear ? ` ${yearText(def, date.year)}` : ''
  if (date.day > s.days) return `${s.extra[date.day - s.days - 1]?.name ?? def.months[date.month].name}${y}`
  return `${date.day} ${def.months[date.month].name}${y}`
}
export const formatDay = (def: CalendarDef, day: number, withYear = true) => formatDate(def, dateOfDay(def, day), withYear)

const pad = (n: number) => String(n).padStart(2, '0')
export const timeText = (minutes: number) => { const m = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY; return `${pad(Math.floor(m / 60))}:${pad(m % 60)}` }

/** Makes every `formatClock` (main and renderer) show this calendar's dates. */
export function useCalendar(def: CalendarDef): void {
  setDateFormatter((day) => formatDay(def, day))
}

/** Adds months to a date (day kept, or the month's last own day). */
export function addMonths(def: CalendarDef, date: CalDate, n: number): CalDate {
  const total = date.year * def.months.length + date.month + n
  const year = Math.floor(total / def.months.length)
  const month = total - year * def.months.length
  return { year, month, day: Math.min(date.day, monthShape(def, year, month).days) }
}

// ---- moons and seasons ----------------------------------------------------------------------------------------------

/** A moon at a campaign minute. */
export function moonAt(def: CalendarDef, m: CalMoon, minutes: number): MoonState {
  const days = absOf(def, def.start) + minutes / MINUTES_PER_DAY - absOf(def, m.full)
  return moonFrom(days, m.cycle)
}
export const activeMoons = (def: CalendarDef) => def.moons.filter((m) => m.status !== 'defunct')

/** Next campaign day (from `fromDay`, included) a moon is full (its phase passes 0.5 during that day). */
export function nextFullDay(def: CalendarDef, m: CalMoon, fromDay: number, kind: 'full' | 'new' = 'full'): number {
  const target = kind === 'full' ? 0.5 : 0
  for (let d = fromDay; d < fromDay + Math.ceil(m.cycle) + 2; d++) {
    const a = moonAt(def, m, d * MINUTES_PER_DAY).phase, b = moonAt(def, m, (d + 1) * MINUTES_PER_DAY).phase
    if (target === 0 ? b < a : a <= target && b > target) return d
  }
  return fromDay
}

export function seasonOn(def: CalendarDef, date: CalDate): number {
  if (!def.seasons.length) return -1
  const key = (s: { month: number; day: number }) => s.month * 1000 + s.day
  const order = def.seasons.map((s, i) => ({ i, k: key(s) })).sort((a, b) => a.k - b.k)
  const k = key(date)
  let hit = order[order.length - 1].i
  for (const o of order) if (o.k <= k) hit = o.i
  return hit
}

// ---- weather --------------------------------------------------------------------------------------------------------

export const WEATHER_WORDS: Record<WeatherKind, { day: string; night: string }> = {
  clear: { day: 'Sunny', night: 'Clear' }, cloudy: { day: 'Cloudy', night: 'Cloudy' }, rain: { day: 'Raining', night: 'Raining' },
  storm: { day: 'Storm', night: 'Storm' }, snow: { day: 'Snowing', night: 'Snowing' }, fog: { day: 'Foggy', night: 'Foggy' }
}

// A small fixed hash so the same day always rolls the same weather (no stored roll needed).
function hash01(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b); x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35); x ^= x >>> 16
  return (x >>> 0) / 4294967296
}

export function pickWeather(odds: number[] | undefined, r: number): WeatherKind {
  const row = odds && odds.some((v) => v > 0) ? odds : [1, 0, 0, 0, 0, 0]
  const sum = row.reduce((a, b) => a + b, 0)
  let at = r * sum
  for (let i = 0; i < WEATHER_KINDS.length; i++) { at -= row[i]; if (at < 0) return WEATHER_KINDS[i] }
  return WEATHER_KINDS[row.findLastIndex((v) => v > 0)]
}

/** The weather a campaign day rolls (by its season), before any DM change. */
export function rolledWeather(def: CalendarDef, day: number): WeatherKind {
  const s = seasonOn(def, dateOfDay(def, day))
  return pickWeather(def.weather[s], hash01(absOf(def, def.start) + day + def.weatherSeed * 7919))
}

export type WeatherDays = Record<string, WeatherKind>
export const weatherOn = (def: CalendarDef, set: WeatherDays, day: number): { kind: WeatherKind; set: boolean } =>
  set[String(day)] ? { kind: set[String(day)], set: true } : { kind: rolledWeather(def, day), set: false }

// ---- events ---------------------------------------------------------------------------------------------------------

export const EVENT_REPEATS = ['none', 'weekly', 'monthly', 'yearly'] as const
export const EVENT_COLOURS = ['#2f6f8f', '#8e2a1d', '#3f7a3a', '#6b4f8f', '#9c4f1f', '#5c6b73', '#7a3a5a', '#b8862b', '#3a3a3a']
export const EventLink = z.object({ kind: z.enum(['card', 'secret', 'storyline']), id: z.string().min(1).max(64) })
export type EventLink = z.infer<typeof EventLink>

export const CalEvent = z.object({
  id: z.string().min(1).max(64),
  title: Text(200).min(1),
  /** Campaign minutes; may be before Day 1 (history). */
  start: z.number().int().min(-1_000_000_000).max(1_000_000_000),
  end: z.number().int().min(-1_000_000_000).max(1_000_000_000).nullable(),
  allDay: z.boolean(),
  colour: Hex,
  notes: z.string().max(20000),
  repeat: z.enum(EVENT_REPEATS),
  links: z.array(EventLink).max(50),
  /** Shown on What they know; notes only with showNotes. */
  known: z.boolean(),
  showNotes: z.boolean(),
  /** Where it came from, e.g. the card text a date word was read from. */
  source: Text(300).optional(),
  status: z.enum(['active', 'defunct']).optional()
})
export type CalEvent = z.infer<typeof CalEvent>

export interface Occurrence { event: CalEvent; startDay: number; endDay: number; startMin: number }

/** Every showing of the events that touches campaign days fromDay..toDay (both included), in time order. */
export function occurrences(def: CalendarDef, events: CalEvent[], fromDay: number, toDay: number): Occurrence[] {
  const out: Occurrence[] = []
  for (const e of events) {
    if (e.status === 'defunct') continue
    const base = dayOfMinutes(e.start)
    const span = e.end !== null && e.end > e.start ? dayOfMinutes(e.end) - base : 0
    const inMin = e.start - base * MINUTES_PER_DAY
    const push = (d: number) => { if (d + span >= fromDay && d <= toDay) out.push({ event: e, startDay: d, endDay: d + span, startMin: d * MINUTES_PER_DAY + inMin }) }
    if (e.repeat === 'none') push(base)
    else if (e.repeat === 'weekly') {
      const step = def.weekdays.length
      let d = base + Math.max(0, Math.ceil((fromDay - span - base) / step)) * step
      for (; d <= toDay; d += step) push(d)
    } else {
      const first = dateOfDay(def, base)
      const step = e.repeat === 'monthly' ? 1 : def.months.length
      const from = dateOfDay(def, Math.max(base, fromDay - span))
      let k = Math.max(0, (from.year - first.year) * def.months.length + from.month - first.month - step)
      k -= k % step
      for (; ; k += step) {
        const d = addMonths(def, first, k)
        const shape = monthShape(def, d.year, d.month)
        const day = dayOfDate(def, { ...d, day: Math.min(first.day, shape.days + shape.extra.length) })
        if (day > toDay) break
        push(day)
      }
    }
  }
  return out.sort((a, b) => a.startMin - b.startMin || a.event.title.localeCompare(b.event.title))
}

// ---- date words in card text (shown to the DM, added only on their click) -------------------------------------------

export interface DateWord { from: number; to: number; phrase: string; day: number }

const NUMBERS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, 'a few': 3, 'a couple of': 2 }
const NUM = '(\\d{1,3}|a few|a couple of|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty)'
const UNIT = '(days?|weeks?|tendays?|months?|years?)'
const num = (s: string) => /^\d/.test(s) ? Number(s) : NUMBERS[s.toLowerCase()] ?? 1
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function addUnits(def: CalendarDef, today: number, n: number, unit: string): number {
  const u = unit.toLowerCase()
  if (u.startsWith('day')) return today + n
  if (u.startsWith('week') || u.startsWith('tenday')) return today + n * (u.startsWith('tenday') ? 10 : def.weekdays.length)
  const d = dateOfDay(def, today)
  return dayOfDate(def, addMonths(def, d, u.startsWith('month') ? n : n * def.months.length))
}

/**
 * Date words that point forward from now (`nowMin`): "in 10 days", "has three days to", "on the 15th", "by the end of
 * the month", "next week", "tomorrow", "on 3 Ches", "at the next full moon", "at Midwinter". Past wording ("ago",
 * "for weeks", "since", "last", a verb in -ed right before) is skipped. Nothing is added: the DM clicks to add.
 */
export function findDateWords(def: CalendarDef, text: string, nowMin: number): DateWord[] {
  const today = dayOfMinutes(nowMin)
  const now = dateOfDay(def, today)
  const months = def.months.map((m) => esc(m.name)).join('|')
  const festivals = [...new Set(def.months.flatMap((m) => (m.festivals ?? []).map((f) => esc(f.name))))].join('|')
  const moonNames = activeMoons(def).map((m) => esc(m.name)).join('|')
  const out: DateWord[] = []
  const rules: Array<[RegExp, (m: RegExpExecArray) => number | null]> = [
    [new RegExp(`\\b(?:in|within)\\s+${NUM}\\s+${UNIT}(?:'?\\s+time)?\\b`, 'gi'), (m) => addUnits(def, today, num(m[1]), m[2])],
    [new RegExp(`\\b${NUM}\\s+${UNIT}\\s+from\\s+(?:now|today)\\b`, 'gi'), (m) => addUnits(def, today, num(m[1]), m[2])],
    [new RegExp(`\\b${NUM}\\s+${UNIT}\\s+(?:to|until|before)\\b`, 'gi'), (m) => addUnits(def, today, num(m[1]), m[2])],
    [/\b(?:the\s+day\s+after\s+tomorrow)\b/gi, () => today + 2],
    [/\btomorrow\b/gi, () => today + 1],
    [/\bnext\s+(week|tenday|month|year)\b/gi, (m) => {
      const u = m[1].toLowerCase()
      if (u === 'month') return dayOfDate(def, { ...addMonths(def, now, 1), day: 1 })
      if (u === 'year') return dayOfDate(def, { year: now.year + 1, month: 0, day: 1 })
      return addUnits(def, today, 1, u)
    }],
    [/\b(?:by\s+)?the\s+end\s+of\s+(the|this|next)\s+(month|year)\b/gi, (m) => {
      const next = m[1].toLowerCase() === 'next'
      if (m[2].toLowerCase() === 'year') return dayOfDate(def, { year: now.year + (next ? 2 : 1), month: 0, day: 1 }) - 1
      const d = addMonths(def, now, next ? 1 : 0)
      return dayOfDate(def, { ...d, day: monthShape(def, d.year, d.month).days })
    }],
    ...(months ? [
      [new RegExp(`\\b(\\d{1,3})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${months})\\b`, 'gi'), (m: RegExpExecArray) => nextDate(def, today, monthIndex(def, m[2]), Number(m[1]))],
      [new RegExp(`\\b(${months})\\s+(\\d{1,3})(?:st|nd|rd|th)?\\b`, 'gi'), (m: RegExpExecArray) => nextDate(def, today, monthIndex(def, m[1]), Number(m[2]))]
    ] as Array<[RegExp, (m: RegExpExecArray) => number | null]> : []),
    [/\bon\s+the\s+(\d{1,3})(?:st|nd|rd|th)\b/gi, (m) => {
      const n = Number(m[1])
      const here = n > now.day && n <= monthShape(def, now.year, now.month).days ? { ...now, day: n } : { ...addMonths(def, now, 1), day: n }
      return n <= monthShape(def, here.year, here.month).days ? dayOfDate(def, here) : null
    }],
    [new RegExp(`\\b(?:at|on|by|until|before)\\s+the\\s+(?:next\\s+)?(full|new)\\s+moon\\b`, 'gi'), (m) => {
      const moon = activeMoons(def)[0]
      return moon ? nextFullDay(def, moon, today + 1, m[1].toLowerCase() as 'full' | 'new') : null
    }],
    ...(moonNames ? [[new RegExp(`\\b(?:when|until)\\s+(${moonNames})\\s+is\\s+(full|new)\\b`, 'gi'), (m: RegExpExecArray) => {
      const moon = activeMoons(def).find((x) => x.name.toLowerCase() === m[1].toLowerCase())
      return moon ? nextFullDay(def, moon, today + 1, m[2].toLowerCase() as 'full' | 'new') : null
    }]] as Array<[RegExp, (m: RegExpExecArray) => number | null]> : []),
    ...(festivals ? [[new RegExp(`\\b(?:at|on|by|until|before|during)\\s+(?:the\\s+)?(?:next\\s+)?(${festivals})\\b`, 'gi'), (m: RegExpExecArray) => nextFestival(def, today, m[1])]] as Array<[RegExp, (m: RegExpExecArray) => number | null]> : [])
  ]
  for (const [re, toDay] of rules) {
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const from = m.index, to = m.index + m[0].length
      if (out.some((w) => from < w.to && to > w.from)) continue
      if (isPast(text, from, to)) continue
      const day = toDay(m)
      if (day === null || day <= today) continue
      out.push({ from, to, phrase: m[0], day })
    }
  }
  return out.sort((a, b) => a.from - b.from)
}

function isPast(text: string, from: number, to: number): boolean {
  if (/^\s*(?:ago|before\s+(?:that|then)|earlier|back)\b/i.test(text.slice(to, to + 20))) return true
  const before = text.slice(Math.max(0, from - 60), from)
  const sentence = before.split(/[.!?\n]/).pop() ?? ''
  if (/\b(?:ago|since|last|for|has\s+been|have\s+been|had\s+been|was|were|did)\s*$/i.test(sentence)) return true
  if (/\b(?:began|begun|came|went|left|fell|saw|met|took|gave|died|born|became|held|fought|lost|won|broke|stole|ran|fled|struck|sent)\s*(?:on|at|in)?\s*$/i.test(sentence)) return true
  return /\b\w+ed\s*(?:on|at|in|by)?\s*$/i.test(sentence) && !/\b(?:need|plan|expect|schedul|due|arrang|promis|decid|intend)ed\s*(?:on|at|in|by)?\s*$/i.test(sentence)
}

const monthIndex = (def: CalendarDef, name: string) => def.months.findIndex((m) => m.name.toLowerCase() === name.toLowerCase())

function nextDate(def: CalendarDef, today: number, month: number, day: number): number | null {
  if (month < 0) return null
  const now = dateOfDay(def, today)
  for (const year of [now.year, now.year + 1]) {
    const s = monthShape(def, year, month)
    if (day > s.days + s.extra.length) return null
    const d = dayOfDate(def, { year, month, day })
    if (d > today) return d
  }
  return null
}

function nextFestival(def: CalendarDef, today: number, name: string): number | null {
  const now = dateOfDay(def, today)
  const lower = name.toLowerCase().replace(/^the\s+/, '')
  for (const year of [now.year, now.year + 1, now.year + 2, now.year + 3, now.year + 4]) {
    for (let month = 0; month < def.months.length; month++) {
      const s = monthShape(def, year, month)
      const hit = s.extra.find((x) => x.name.toLowerCase().replace(/^the\s+/, '') === lower)?.day
        ?? [...s.named].find(([, n]) => n.toLowerCase().replace(/^the\s+/, '') === lower)?.[0]
      if (hit === undefined) continue
      const d = dayOfDate(def, { year, month, day: hit })
      if (d > today) return d
    }
  }
  return null
}
