// Map › Find regions with AI, and the getting started guide (ARCHITECTURE.md §4 "World map").
// Pure: the AI looks at a world map picture and outlines its lands, seas and settlements;
// the answer becomes proposals the DM ticks before anything is saved (rules 2, 10).

import { centroid, pointInPolygon, polygonArea, type Point } from '../../shared/geometry'
import { isBiome, isPlaceKind, type PlaceShape } from '../../shared/places'
import { extractJson } from '../importers/notes'

/** Coordinates the AI uses: 0 to 1000 across and down, whatever the picture's size. */
export const GRID = 1000

export const REGIONS_SYSTEM = [
  'You read fantasy world maps for a Dungeons & Dragons Dungeon Master.',
  'Outline the distinct areas you can see: each sea or large lake, each land region of one kind of terrain (forest, mountains, desert and so on),',
  'and each city, town or village symbol. Follow the coastlines and terrain edges you see.',
  `Coordinates run from 0,0 at the top left to ${GRID},${GRID} at the bottom right of the picture, whatever its shape.`,
  'Reply with ONE JSON object and nothing else:',
  '{"regions": [{"name": "...", "kind": "region|sea|city|town|village|landmark|dungeon", "biome": "grassland|farmland|forest|jungle|hills|mountains|desert|badlands|swamp|tundra|snow|coast|water|wasteland", "summary": "one short line", "polygon": [[x,y], ...]}]}.',
  'Land regions and seas: 6 to 30 points each. Settlements and landmarks: a small shape of 4 to 6 points around the symbol.',
  'Use any names written on the map; otherwise invent fitting fantasy names. At most 40 regions.'
].join(' ')

export function regionsPrompt(campaignName: string, ask: string): string {
  return [
    `Campaign: ${campaignName}.`,
    'Here is the world map. Outline its seas, lands by terrain, and settlements.',
    ask.trim() ? `The DM adds: ${ask.trim().slice(0, 600)}` : ''
  ].filter(Boolean).join('\n')
}

const SPOTS = new Set(['city', 'town', 'village', 'landmark', 'dungeon'])

/**
 * Reads the AI's outlines into places in image pixels. Bad entries are dropped. Big areas come
 * first; settlements and landmarks go inside the smallest area that holds their middle.
 */
export function parseRegions(reply: string, width: number, height: number): { regions: PlaceShape[]; dropped: number } {
  const raw = extractJson(reply) as { regions?: unknown }
  const list = Array.isArray(raw.regions) ? raw.regions : Array.isArray(raw) ? raw : []
  const out: PlaceShape[] = []
  let dropped = 0
  for (const item of list.slice(0, 80)) {
    const r = item as Record<string, unknown>
    const name = typeof r.name === 'string' ? r.name.trim().slice(0, 120) : ''
    const kind = isPlaceKind(r.kind) ? r.kind : 'region'
    const biome = isBiome(r.biome) ? r.biome : kind === 'sea' ? 'water' : null
    const pts = Array.isArray(r.polygon) ? r.polygon : []
    const polygon: Point[] = []
    for (const p of pts.slice(0, 200)) {
      const xy = Array.isArray(p) ? p : p && typeof p === 'object' ? [(p as { x?: unknown }).x, (p as { y?: unknown }).y] : []
      const x = Number(xy[0]), y = Number(xy[1])
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      const cx = Math.min(GRID, Math.max(0, x)), cy = Math.min(GRID, Math.max(0, y))
      polygon.push([Math.round((cx / GRID) * width * 10) / 10, Math.round((cy / GRID) * height * 10) / 10])
    }
    if (!name || polygon.length < 3 || Math.abs(polygonArea(polygon)) < 4) { dropped++; continue }
    out.push({ name, kind, biome, polygon, parent: null, summary: typeof r.summary === 'string' ? r.summary.trim().slice(0, 300) : '' })
  }
  // Areas before spots, biggest first, so a parent always comes earlier in the list.
  const isSpot = (p: PlaceShape) => SPOTS.has(p.kind)
  out.sort((a, b) => Number(isSpot(a)) - Number(isSpot(b)) || Math.abs(polygonArea(b.polygon)) - Math.abs(polygonArea(a.polygon)))
  out.forEach((p, i) => {
    if (!isSpot(p)) return
    const mid = centroid(p.polygon)
    let best: number | null = null
    for (let j = 0; j < i; j++) {
      const q = out[j]
      if (isSpot(q) || q.kind === 'sea' || !pointInPolygon(mid, q.polygon)) continue
      if (best === null || Math.abs(polygonArea(q.polygon)) < Math.abs(polygonArea(out[best].polygon))) best = j
    }
    p.parent = best
  })
  return { regions: out, dropped }
}
