// Battle maps drawn by an AI image service, held to fixed local rules (owner, 2026-10-06):
// top-down, a square grid of 5-foot squares, the size in squares, the scene's facts,
// and the DM's own example maps for the style. Every choice has a default (some filled
// from the campaign: time of day, the place) and every choice can be changed (rule 11).
// Shared so the dialog can show the exact request before it is sent (the DM can edit it).

export const BATTLE_SETTINGS = ['outdoors', 'indoors', 'underground', 'town street', 'ship or dock', 'other'] as const
export type BattleSetting = (typeof BATTLE_SETTINGS)[number]

export const TERRAINS = [
  'any', 'forest', 'swamp', 'plains', 'hills', 'mountain', 'desert', 'coast', 'arctic', 'cave', 'dungeon', 'crypt',
  'city', 'village', 'castle', 'temple', 'tavern', 'ruins', 'sewer', 'underdark', 'other'
] as const
export type Terrain = (typeof TERRAINS)[number]

export const TIMES_OF_DAY = ['dawn', 'day', 'dusk', 'night'] as const
export type TimeOfDay = (typeof TIMES_OF_DAY)[number]

export const WEATHERS = ['clear', 'overcast', 'rain', 'fog', 'snow', 'storm', 'indoors (none)'] as const
export type Weather = (typeof WEATHERS)[number]

export const SEASONS = ['any', 'spring', 'summer', 'autumn', 'winter'] as const
export type Season = (typeof SEASONS)[number]

export const MOODS = ['neutral', 'eerie', 'grim', 'cosy', 'grand', 'chaotic', 'sacred', 'decaying'] as const
export type Mood = (typeof MOODS)[number]

export const ART_STYLES = ['painted', 'hand-drawn ink', 'realistic', 'old parchment', 'clean and simple'] as const
export type ArtStyle = (typeof ART_STYLES)[number]

/** Things the DM can switch on or off; each adds one phrase to the request. */
export const BATTLE_FEATURES = {
  open: { label: 'Open space to fight', phrase: 'an open central area with room to fight' },
  cover: { label: 'Cover', phrase: 'scattered cover (crates, rubble, low walls, barrels)' },
  difficult: { label: 'Difficult terrain', phrase: 'patches of difficult terrain (mud, undergrowth, debris)' },
  water: { label: 'Water', phrase: 'water (a stream, pool or flooded area)' },
  elevation: { label: 'High ground', phrase: 'changes in height (ledges, platforms, a raised dais)' },
  hazards: { label: 'Hazards and traps', phrase: 'hazards (pits, spikes, fire or a weak floor)' },
  lights: { label: 'Light sources', phrase: 'light sources (torches, braziers, lanterns)' },
  doors: { label: 'Doors', phrase: 'doors and doorways' },
  secret: { label: 'Secret door', phrase: 'a subtle hidden passage or secret door' },
  stairs: { label: 'Stairs or ladders', phrase: 'stairs or ladders' },
  exits: { label: 'Several ways out', phrase: 'several entrances and exits' },
  vegetation: { label: 'Trees and plants', phrase: 'trees, bushes and vegetation' },
  furniture: { label: 'Furniture and props', phrase: 'furniture and props' },
  ruins: { label: 'Ruined walls', phrase: 'ruined, crumbling structures' },
  bridge: { label: 'Bridge or crossing', phrase: 'a bridge or narrow crossing' },
  chasm: { label: 'Chasm or cliff', phrase: 'a chasm or cliff edge' },
  rocks: { label: 'Boulders', phrase: 'boulders and rock outcrops' },
  bodies: { label: 'Signs of a fight', phrase: 'signs of an earlier fight (broken weapons, bloodstains)' }
} as const
export type BattleFeature = keyof typeof BATTLE_FEATURES
export const FEATURE_KEYS = Object.keys(BATTLE_FEATURES) as BattleFeature[]

export type Aspect = '1:1' | '3:2' | '2:3' | '16:9' | '9:16'

export interface BattleMapSpec {
  /** What is there: the DM's own words, the scene text or the place's notes. */
  description: string
  setting: BattleSetting
  terrain: Terrain
  cols: number
  rows: number
  timeOfDay: TimeOfDay
  weather: Weather
  season: Season
  mood: Mood
  style: ArtStyle
  features: BattleFeature[]
  /** Anything else, in the DM's words. */
  extra: string
  /** True when example maps go with the request. */
  withExamples: boolean
  /** A source picture (part of a map, or any picture) is sent first and followed closely. */
  follow?: boolean
  /** When following a picture: buildings shown by their roofs or opened up to show inside. */
  buildings?: Buildings
}

export const BUILDINGS = ['inside', 'roofs'] as const
export type Buildings = (typeof BUILDINGS)[number]

/** Part of a picture, as fractions (0–1) of its width and height. */
export type Crop = { x: number; y: number; w: number; h: number }
/** "Follow a picture": a campaign map or an uploaded picture (assets path), the boxed part and how buildings show. Saved on the encounter. */
export type FollowSource = { mapId?: string; path?: string; crop: Crop; buildings?: Buildings; cols?: number; rows?: number }

const frac = (n: unknown) => typeof n === 'number' && n >= 0 && n <= 1
export function readFollow(x: unknown): FollowSource | null {
  const f = x as Partial<FollowSource> | null
  if (!f || typeof f !== 'object' || !(typeof f.mapId === 'string' || typeof f.path === 'string')) return null
  const c = f.crop
  if (!c || ![c.x, c.y, c.w, c.h].every(frac) || !c.w || !c.h) return null
  const size = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= GRID_MIN && n <= GRID_MAX
  return {
    ...(f.mapId ? { mapId: f.mapId } : { path: f.path }), crop: { x: c.x, y: c.y, w: c.w, h: c.h }, buildings: f.buildings === 'roofs' ? 'roofs' : 'inside',
    ...(size(f.cols) && size(f.rows) ? { cols: f.cols, rows: f.rows } : {})
  }
}

/**
 * The boxed part shrunk (about its centre) to the largest true-scale battle map, GRID_MAX squares
 * (300 ft) on its longer side; null when it already fits. `squares` = the box's size in squares at the map's scale.
 */
export function fitToMax(crop: Crop, squares: { across: number; deep: number }): { crop: Crop; cols: number; rows: number } | null {
  const k = Math.min(GRID_MAX / squares.across, GRID_MAX / squares.deep)
  if (k >= 1) return null
  const w = crop.w * k, h = crop.h * k
  return {
    crop: { x: crop.x + (crop.w - w) / 2, y: crop.y + (crop.h - h) / 2, w, h },
    cols: Math.max(GRID_MIN, Math.min(GRID_MAX, Math.round(squares.across * k))),
    rows: Math.max(GRID_MIN, Math.min(GRID_MAX, Math.round(squares.deep * k)))
  }
}

export const GRID_MIN = 5
export const GRID_MAX = 60

/** Sensible switches for a setting; the DM changes them freely. */
export function defaultFeatures(setting: BattleSetting): BattleFeature[] {
  switch (setting) {
    case 'indoors': return ['open', 'doors', 'furniture', 'lights', 'cover']
    case 'underground': return ['open', 'cover', 'difficult', 'lights', 'exits']
    case 'town street': return ['open', 'cover', 'doors', 'exits']
    case 'ship or dock': return ['open', 'cover', 'water', 'elevation']
    default: return ['open', 'cover', 'vegetation', 'rocks']
  }
}

/** Time of day from the campaign clock's light. */
export function timeOfDayFor(light: 'night' | 'dawn' | 'daylight' | 'dusk'): TimeOfDay {
  return light === 'daylight' ? 'day' : light
}

const TERRAIN_WORDS: Array<[Terrain, RegExp]> = [
  ['crypt', /\b(crypt|tomb|catacomb|ossuary|sarcophag)/i], ['sewer', /\bsewer/i], ['underdark', /\bunderdark/i],
  ['cave', /\b(cave|cavern|grotto|mine)\b/i], ['dungeon', /\b(dungeon|cell|vault)\b/i], ['temple', /\b(temple|shrine|chapel|church|abbey)/i],
  ['tavern', /\b(tavern|inn|alehouse)\b/i], ['castle', /\b(castle|keep|fortress|citadel)\b/i],
  ['swamp', /\b(swamp|marsh|bog|fen)\b/i], ['forest', /\b(forest|wood|woods|grove|jungle)\b/i], ['desert', /\b(desert|dune|sand)\b/i],
  ['arctic', /\b(snow|ice|glacier|tundra|frozen)\b/i], ['mountain', /\b(mountain|peak|pass|cliff)\b/i], ['coast', /\b(coast|harbou?r|dock|beach|shore|pier)\b/i],
  ['ruins', /\bruin/i], ['city', /\b(city|street|market|alley|district)\b/i], ['village', /\b(village|hamlet|farm)\b/i], ['hills', /\bhills?\b/i]
]

/** A first guess at the terrain from the description (the DM can change it). */
export function guessTerrain(text: string): Terrain {
  return TERRAIN_WORDS.find(([, re]) => re.test(text))?.[0] ?? 'any'
}

/** A first guess at the setting from the terrain. */
export function settingFor(terrain: Terrain): BattleSetting {
  if (['cave', 'dungeon', 'crypt', 'sewer', 'underdark'].includes(terrain)) return 'underground'
  if (['tavern', 'temple', 'castle'].includes(terrain)) return 'indoors'
  if (terrain === 'city' || terrain === 'village') return 'town street'
  if (terrain === 'coast') return 'ship or dock'
  return 'outdoors'
}

/** The image shape closest to the grid, from the shapes every image service supports. */
export function aspectFor(cols: number, rows: number): Aspect {
  const r = cols / rows
  const options: Array<[Aspect, number]> = [['1:1', 1], ['3:2', 1.5], ['2:3', 2 / 3], ['16:9', 16 / 9], ['9:16', 9 / 16]]
  return options.reduce((best, o) => (Math.abs(Math.log(o[1] / r)) < Math.abs(Math.log(best[1] / r)) ? o : best))[0]
}

/** Rows that fit an image of this size when it has `cols` square cells across. */
export function rowsFor(cols: number, width: number, height: number): number {
  return Math.max(1, Math.round((cols * height) / width))
}

const LIGHT_WORDS: Record<TimeOfDay, string> = {
  dawn: 'dawn, low golden light and long shadows',
  day: 'full daylight',
  dusk: 'dusk, warm fading light',
  night: 'night: dark, lit only by moonlight and any light sources'
}

/** The request for "Follow a picture": the source's layout kept exactly, redrawn at battle-map scale and detail. */
function followPrompt(spec: BattleMapSpec): string {
  const sky = spec.setting === 'indoors' || spec.setting === 'underground' || spec.weather === 'indoors (none)'
    ? '' : ` Weather: ${spec.weather}.${spec.season !== 'any' ? ` Season: ${spec.season}.` : ''}`
  const lines = [
    'Redraw the attached source picture (a small part of a larger map) as a detailed top-down battle map for a tabletop role-playing game.',
    'Seen from directly above (orthographic, 90 degrees, no perspective or horizon).',
    'Follow the source closely: keep every road, path, river, shoreline, wall, building footprint, field edge, tree line and open space in the same place, with the same shape and proportions. Do not add, move or remove buildings, roads or water.',
    'The source is small-scale and blurry: read what each shape is from its colour and shape (red or brown blocks are roofs, blue is water, pale grey or tan lines are roads and paths, dark green dots are trees and bushes, yellow and brown patches are fields) and paint each one in full battle-map detail.',
    `Scale: the map is ${spec.cols} squares wide and ${spec.rows} squares deep, each square 5 feet (1.5 metres). A person fills one square, a door is one square wide, a cottage is about 4 by 6 squares, a road 2 to 3 squares wide, a tree crown 2 to 4 squares across. Draw buildings, roads, trees and the gaps between them at these sizes.`,
    spec.buildings === 'roofs'
      ? 'Buildings: show their roofs (tiles, thatch or slate), with doors and steps visible at the walls.'
      : 'Buildings: roofs removed so the inside shows: walls, doors, windows, floor, furniture, hearth.',
    'Add fine detail that fits the source: ground texture (grass tufts, dirt, mud, cobbles), single bushes, rocks and stumps, fences and hedges, crates, barrels and carts, worn paths and wheel ruts.',
    `Lighting: ${LIGHT_WORDS[spec.timeOfDay]}.${sky}`
  ]
  if (spec.description.trim()) lines.push(`Notes on the place: ${spec.description.trim().replace(/\s+/g, ' ')}`)
  const feats = spec.features.filter((f) => f in BATTLE_FEATURES).map((f) => BATTLE_FEATURES[f].phrase)
  if (feats.length) lines.push(`Where the source leaves room, add: ${feats.join('; ')}.`)
  if (spec.extra.trim()) lines.push(`Also: ${spec.extra.trim().replace(/\s+/g, ' ')}`)
  if (spec.mood !== 'neutral') lines.push(`Mood: ${spec.mood}.`)
  lines.push(`Art style: ${spec.style}, rich detail, crisp clear edges; open ground you can walk on reads clearly against walls, water and obstacles.`)
  lines.push('Leave out everything in the source that is not terrain: no text, names, labels, letters, numbers, symbols, icons, compass, scale bar, grid lines, frame, border, watermark, signature or logo. No people, creatures or tokens. No grid lines (the app draws them).')
  if (spec.withExamples) lines.push('Match the art style, colours and line work of the example maps provided; take the layout only from the source picture.')
  return lines.join('\n')
}

export function battleMapPrompt(spec: BattleMapSpec): string {
  if (spec.follow) return followPrompt(spec)
  const where = [spec.setting, spec.terrain !== 'any' ? spec.terrain : ''].filter(Boolean).join(', ')
  const sky = spec.setting === 'indoors' || spec.setting === 'underground' || spec.weather === 'indoors (none)'
    ? '' : ` Weather: ${spec.weather}.${spec.season !== 'any' ? ` Season: ${spec.season}.` : ''}`
  const lines = [
    `A top-down battle map for a tabletop role-playing game: ${where}.`,
    'Seen from directly above (orthographic, 90 degrees, no perspective or horizon).',
    `The area is ${spec.cols} squares wide and ${spec.rows} squares deep, each square 5 feet (1.5 metres); walls, doors, furniture and terrain line up with that square grid.`,
    `Lighting: ${LIGHT_WORDS[spec.timeOfDay]}.${sky}`,
    spec.description.trim() ? `What is there: ${spec.description.trim().replace(/\s+/g, ' ')}` : 'An area with a few obstacles to fight around.'
  ]
  const feats = spec.features.filter((f) => f in BATTLE_FEATURES).map((f) => BATTLE_FEATURES[f].phrase)
  if (feats.length) lines.push(`Include: ${feats.join('; ')}.`)
  if (spec.extra.trim()) lines.push(`Also: ${spec.extra.trim().replace(/\s+/g, ' ')}`)
  if (spec.mood !== 'neutral') lines.push(`Mood: ${spec.mood}.`)
  lines.push(`Art style: ${spec.style}, rich detail, clear readable floor and terrain with room to move.`)
  lines.push('No grid lines (the app draws them), no text, labels, letters, numbers, compass or legend, no people, creatures or tokens, no frame or border.')
  if (spec.withExamples) lines.push('Match the art style, colours and line work of the example maps provided; do not copy their layout.')
  return lines.join('\n')
}
