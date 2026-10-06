// What a place on the map is: a land region (with its biome), a settlement or a
// landmark. Stored on the Location card (attributes.place_kind, attributes.biome),
// editable in the Map region panel; the map colours regions by it.

export const PLACE_KINDS = ['region', 'city', 'town', 'village', 'landmark', 'dungeon', 'sea'] as const
export type PlaceKind = (typeof PLACE_KINDS)[number]
export const PLACE_KIND_LABELS: Record<PlaceKind, string> = {
  region: 'Region', city: 'City', town: 'Town', village: 'Village', landmark: 'Landmark', dungeon: 'Dungeon or ruin', sea: 'Sea or lake'
}

export const BIOMES = [
  'grassland', 'farmland', 'forest', 'jungle', 'hills', 'mountains', 'desert', 'badlands', 'swamp', 'tundra', 'snow', 'coast', 'water', 'wasteland'
] as const
export type Biome = (typeof BIOMES)[number]

/** Map tint per biome (regions without one use parchment). */
export const BIOME_COLOURS: Record<Biome, string> = {
  grassland: '#9fb36a', farmland: '#c9b56a', forest: '#4f7a3f', jungle: '#2f6b3a', hills: '#a89060', mountains: '#7d7468',
  desert: '#d9b871', badlands: '#b0704a', swamp: '#5f6f4a', tundra: '#a9b3a6', snow: '#e6ecef', coast: '#c8b98a', water: '#5b84a8',
  wasteland: '#8a7f73'
}

/** Settlements and landmarks get a fixed colour, whatever the land around them. */
export const KIND_COLOURS: Partial<Record<PlaceKind, string>> = {
  city: '#8f2a21', town: '#a8452e', village: '#b8683a', landmark: '#5a3f8a', dungeon: '#3a2f45', sea: '#3f6f9a'
}

export function isPlaceKind(v: unknown): v is PlaceKind {
  return typeof v === 'string' && (PLACE_KINDS as readonly string[]).includes(v)
}
export function isBiome(v: unknown): v is Biome {
  return typeof v === 'string' && (BIOMES as readonly string[]).includes(v)
}

/** The colour a region is drawn in: the DM's own colour, else by kind, else by biome. */
export function placeColour(p: { colour: string | null; kind: PlaceKind | null; biome: Biome | null }): string | null {
  if (p.colour) return p.colour
  if (p.kind && KIND_COLOURS[p.kind]) return KIND_COLOURS[p.kind]!
  if (p.biome) return BIOME_COLOURS[p.biome]
  return null
}

/**
 * A place proposed for a map (made by the map maker, or found by an AI in a picture):
 * the outline in image pixels and, for a place inside another, the index of an earlier one.
 */
export interface PlaceShape {
  name: string
  kind: PlaceKind
  biome: Biome | null
  polygon: Array<[number, number]>
  parent: number | null
  summary: string
}

export const WORLD_SIZES = ['small', 'medium', 'large'] as const
export const WORLD_CLIMATES = ['cold', 'temperate', 'warm'] as const
export interface WorldSettings {
  seed: number
  size: (typeof WORLD_SIZES)[number]
  /** Share of the map that is land, 0.3 to 0.75. */
  land: number
  climate: (typeof WORLD_CLIMATES)[number]
  /** Cities, towns and villages to place (0 to 30). */
  settlements: number
}

/** What the image service is told when it draws a world map (shown and editable before drawing). */
export function worldMapPrompt(o: { description: string; climate: WorldSettings['climate']; style: 'painted' | 'parchment' }): string {
  return [
    'A fantasy world map seen from directly above, as in an atlas.',
    o.description.trim() ? `The world: ${o.description.trim()}` : 'A large continent with smaller islands, surrounded by sea.',
    `Climate: mostly ${o.climate}.`,
    'Show clearly different lands: forests, mountains, hills, grassland, farmland, desert, swamp, snow where it fits, rivers and lakes, coastlines.',
    'Mark cities, towns and villages with small simple symbols.',
    o.style === 'parchment' ? 'Style: hand-inked map on aged parchment, muted colours.' : 'Style: richly painted, natural colours, soft relief shading.',
    'No text, no labels, no names, no legend, no compass rose, no border, no frame.'
  ].join(' ')
}
