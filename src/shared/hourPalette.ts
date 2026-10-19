// Colours of the Adventure UI hour picture (3.1, owner: blend smoothly through the day).
// Four looks — night, dawn, day, dusk — placed on the clock; any minute between two of them mixes the two.

export interface HourPalette {
  s0: string; s1: string; s2: string; s3: string; b0: string; b1: string; sun: string; cloud: string; haze: string
  far: string; mid: string; near: string; co: number; stars: number; win: number; smoke: number; birds: number
}

const NIGHT: HourPalette = { s0: '#070b1a', s1: '#121a36', s2: '#1f2b4e', s3: '#2c3a5e', b0: '#f6f0dc', b1: '#c9d4ee', sun: '#f6f0dc', cloud: '#3a4560', haze: '#3c4a6c', far: '#273046', mid: '#1c2620', near: '#121811', co: 0.55, stars: 1, win: 1, smoke: 0, birds: 0 }
const DAWN: HourPalette = { s0: '#2f3f6e', s1: '#b88aa6', s2: '#f2b07e', s3: '#ffd9a0', b0: '#fff3d6', b1: '#ffb978', sun: '#fff0cc', cloud: '#f6c6bc', haze: '#ffd6b8', far: '#8c84a0', mid: '#5f6a4c', near: '#353d26', co: 0.9, stars: 0.25, win: 0.8, smoke: 0.4, birds: 0.6 }
const DAY: HourPalette = { s0: '#3f78b5', s1: '#8fbde0', s2: '#e9dcc0', s3: '#f6cf8e', b0: '#fffbe6', b1: '#ffe39a', sun: '#fffdf2', cloud: '#fbf7ee', haze: '#fff1d2', far: '#a3b2b8', mid: '#6f8a50', near: '#3e5128', co: 0.95, stars: 0, win: 0, smoke: 0.55, birds: 1 }
const DUSK: HourPalette = { s0: '#2a2550', s1: '#8a4a6c', s2: '#e07a4a', s3: '#f7b45c', b0: '#fff0c8', b1: '#ff9a50', sun: '#ffd28a', cloud: '#f09a6a', haze: '#ffb47a', far: '#7a5a66', mid: '#4a4632', near: '#2b2919', co: 0.9, stars: 0.35, win: 1, smoke: 0.35, birds: 0.8 }

/** Minute of the day → look; between two stops the colours mix. */
const STOPS: Array<[number, HourPalette]> = [[0, NIGHT], [300, NIGHT], [375, DAWN], [540, DAY], [1020, DAY], [1110, DUSK], [1230, NIGHT], [1440, NIGHT]]

const mixHex = (a: string, b: string, t: number) => {
  const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16)
  const ch = (s: number) => Math.round(((x >> s) & 255) * (1 - t) + ((y >> s) & 255) * t)
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`
}

export function hourPalette(minuteOfDay: number): HourPalette {
  const m = ((minuteOfDay % 1440) + 1440) % 1440
  const i = STOPS.findIndex(([at], k) => m >= at && m < STOPS[k + 1][0])
  const [a0, pa] = STOPS[i], [a1, pb] = STOPS[i + 1]
  const t = (m - a0) / (a1 - a0)
  const out = {} as Record<string, string | number>
  for (const k of Object.keys(pa) as Array<keyof HourPalette>) {
    const va = pa[k], vb = pb[k]
    out[k] = typeof va === 'number' ? va + ((vb as number) - va) * t : mixHex(va, vb as string, t)
  }
  return out as unknown as HourPalette
}
