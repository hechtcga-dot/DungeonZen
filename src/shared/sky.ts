import { MINUTES_PER_DAY } from './time'

// Sun, moon and sky colour for the desk clock. Simple model: sunrise 06:00,
// sunset 18:00, moon on a 29.5-day cycle that is full on Day 1 plus an offset.
// Custom calendars (Harptos and so on) are not specified yet (docs/FEATURES.md).

export const SUNRISE_MIN = 6 * 60
export const SUNSET_MIN = 18 * 60
export const LUNAR_CYCLE_DAYS = 29.5

export interface SkyState {
  /** Which body is up. */
  body: 'sun' | 'moon'
  /** 0 = rising on the left, 1 = setting on the right. */
  progress: number
  /** Top and bottom colours of the sky. */
  top: string
  bottom: string
  light: 'night' | 'dawn' | 'daylight' | 'dusk'
}

export function skyAt(totalMinutes: number): SkyState {
  const m = ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  const day = m >= SUNRISE_MIN && m < SUNSET_MIN
  const progress = day
    ? (m - SUNRISE_MIN) / (SUNSET_MIN - SUNRISE_MIN)
    : ((m - SUNSET_MIN + MINUTES_PER_DAY) % MINUTES_PER_DAY) / (MINUTES_PER_DAY - (SUNSET_MIN - SUNRISE_MIN))
  const nearEdge = m >= SUNRISE_MIN - 45 && m < SUNRISE_MIN + 60 ? 'dawn'
    : m >= SUNSET_MIN - 60 && m < SUNSET_MIN + 45 ? 'dusk'
      : day ? 'daylight' : 'night'
  const colours = {
    dawn: ['#7d8fb8', '#f2b27a'],
    daylight: ['#5f9fd4', '#bfe0f2'],
    dusk: ['#4b4f8a', '#e48a5c'],
    night: ['#0d1430', '#2a3566']
  }[nearEdge]
  return { body: day ? 'sun' : 'moon', progress, top: colours[0], bottom: colours[1], light: nearEdge }
}

export interface MoonState {
  /** 0 = new, 0.5 = full, back to 1 = new. */
  phase: number
  name: string
  /** Fraction of the disc that is lit, 0..1. */
  illumination: number
  nightsUntilFull: number
}

const PHASE_NAMES = [
  'New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous',
  'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'
]

/** `offsetDays` shifts the cycle; with 0 the moon is full on Day 1. */
export function moonOn(totalMinutes: number, offsetDays = 0): MoonState {
  const days = totalMinutes / MINUTES_PER_DAY + offsetDays
  const phase = (((days / LUNAR_CYCLE_DAYS + 0.5) % 1) + 1) % 1
  const illumination = (1 - Math.cos(phase * 2 * Math.PI)) / 2
  const name = PHASE_NAMES[Math.round(phase * 8) % 8]
  const toFull = ((0.5 - phase + 1) % 1) * LUNAR_CYCLE_DAYS
  // While the moon still counts as full (just past its peak), it is full tonight.
  const nightsUntilFull = name === 'Full moon' && phase >= 0.5 ? 0 : Math.round(toFull)
  return { phase, name, illumination, nightsUntilFull }
}

export interface Lighting {
  /** 0 = full daylight, 1 = deepest night. */
  darkness: number
  /** 0..1 strength of the warm dawn/dusk tint. */
  twilight: number
  /** Candles burn from dusk until after dawn. */
  candlesLit: boolean
}

const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

/**
 * Light on the table at a given time: fully lit 07:00–17:00, darkening
 * 17:00–20:00, dark 20:00–05:00, brightening 05:00–07:00.
 */
export function lightingAt(totalMinutes: number): Lighting {
  const m = ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  const h = m / 60
  let darkness: number
  if (h >= 7 && h < 17) darkness = 0
  else if (h >= 17 && h < 20) darkness = smooth((h - 17) / 3)
  else if (h >= 5 && h < 7) darkness = 1 - smooth((h - 5) / 2)
  else darkness = 1
  // Warm tint strongest around sunset (18:00) and sunrise (06:00).
  const twilight = Math.max(0, 1 - Math.abs(h - 18) / 1.5, 1 - Math.abs(h - 6) / 1.2)
  return { darkness, twilight, candlesLit: darkness >= 0.3 }
}
