import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Campaign } from '../src/main/campaign/campaign'
import { encodePng } from '../src/main/png'
import { generateWorld, unionCells } from '../src/main/worldgen'
import { parseRegions } from '../src/main/ai/regions'
import { centroid, pointInPolygon, type Point } from '../src/shared/geometry'
import { BIOMES, isPlaceKind, placeColour, worldMapPrompt } from '../src/shared/places'

const small = { size: 'small' as const, land: 0.5, climate: 'temperate' as const, settlements: 6, width: 600, height: 400 }

describe('PNG writer', () => {
  it('writes a valid PNG that reads back to the same pixels', () => {
    const rgb = new Uint8Array(3 * 2 * 3).map((_, i) => i * 10)
    const png = encodePng(3, 2, rgb)
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(png.readUInt32BE(16)).toBe(3)
    expect(png.readUInt32BE(20)).toBe(2)
    const idatLen = png.readUInt32BE(33)
    expect(png.toString('ascii', 37, 41)).toBe('IDAT')
    const raw = inflateSync(png.subarray(41, 41 + idatLen))
    expect([...raw]).toEqual([0, ...rgb.slice(0, 9), 0, ...rgb.slice(9)])
    expect(() => encodePng(3, 3, rgb)).toThrow()
  })
})

describe('world map maker', () => {
  it('is the same world for the same seed, and a different one for another', () => {
    const a = generateWorld({ seed: 11, ...small })
    const b = generateWorld({ seed: 11, ...small })
    const c = generateWorld({ seed: 12, ...small })
    expect(a.png.equals(b.png)).toBe(true)
    expect(a.regions).toEqual(b.regions)
    expect(a.png.equals(c.png)).toBe(false)
  })

  it('outlines seas, lands and settlements inside the picture, settlements inside their land', () => {
    for (const seed of [1, 2, 3]) {
      const w = generateWorld({ seed, ...small })
      expect(w.width).toBe(600)
      expect(w.png.readUInt32BE(16)).toBe(600)
      const kinds = new Set(w.regions.map((r) => r.kind))
      expect(kinds.has('sea')).toBe(true)
      expect(kinds.has('region')).toBe(true)
      expect(w.regions.filter((r) => r.kind === 'city')).toHaveLength(1)
      expect(new Set(w.regions.map((r) => r.name)).size).toBe(w.regions.length)
      w.regions.forEach((r, i) => {
        expect(isPlaceKind(r.kind)).toBe(true)
        expect(r.biome && BIOMES.includes(r.biome)).toBeTruthy()
        expect(r.polygon.length).toBeGreaterThanOrEqual(3)
        for (const [x, y] of r.polygon) {
          expect(x).toBeGreaterThanOrEqual(-1); expect(x).toBeLessThanOrEqual(601)
          expect(y).toBeGreaterThanOrEqual(-1); expect(y).toBeLessThanOrEqual(401)
        }
        if (['city', 'town', 'village'].includes(r.kind)) {
          expect(r.parent).not.toBeNull()
          expect(r.parent!).toBeLessThan(i)
          const land = w.regions[r.parent!]
          expect(land.kind).toBe('region')
          expect(pointInPolygon(centroid(r.polygon), land.polygon)).toBe(true)
        } else expect(r.parent).toBeNull()
      })
    }
  })

  it('a cold world is mostly snow and tundra; a warm one has none', () => {
    const lands = (climate: 'cold' | 'warm') => [1, 2, 3].flatMap((seed) => generateWorld({ seed, ...small, climate }).regions.filter((r) => r.kind === 'region').map((r) => r.biome))
    const cold = lands('cold')
    expect(cold.filter((b) => b === 'snow' || b === 'tundra').length / cold.length).toBeGreaterThan(0.5)
    expect(lands('warm').filter((b) => b === 'snow')).toEqual([])
  })

  it('joins neighbouring cells into one outline', () => {
    const sq = (x: number, y: number): Point[] => [[x, y], [x + 10, y], [x + 10, y + 10], [x, y + 10]]
    const u = unionCells([sq(0, 0), sq(10, 0), sq(0, 10), sq(10, 10)])
    expect(u.length).toBe(4)
    const xs = u.map((p) => p[0]), ys = u.map((p) => p[1])
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([0, 20, 0, 20])
  })
})

describe('regions found by an AI', () => {
  it('scales outlines to the picture, drops bad ones and puts towns inside their land', () => {
    const reply = 'Here you go:\n```json\n' + JSON.stringify({
      regions: [
        { name: 'Thornfield', kind: 'town', biome: 'grassland', polygon: [[480, 480], [520, 480], [520, 520], [480, 520]] },
        { name: 'The Green Plains', kind: 'region', biome: 'grassland', summary: 'Open country', polygon: [[300, 300], [700, 300], [700, 700], [300, 700]] },
        { name: 'The Wide Sea', kind: 'sea', polygon: [[0, 0], [1000, 0], [1000, 1000], [0, 1000]] },
        { name: 'Nowhere', kind: 'region', polygon: [[1, 1], [2, 2]] },
        { name: '', kind: 'region', polygon: [[0, 0], [10, 0], [10, 10]] },
        { name: 'Odd', kind: 'castle', biome: 'lava', polygon: [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 1200 }] }
      ]
    }) + '\n```'
    const { regions, dropped } = parseRegions(reply, 2000, 1000)
    expect(dropped).toBe(2)
    expect(regions.map((r) => r.name)).toEqual(['The Wide Sea', 'The Green Plains', 'Odd', 'Thornfield'])
    const sea = regions[0]
    expect(sea.biome).toBe('water')
    expect(sea.polygon[2]).toEqual([2000, 1000])
    const odd = regions[2]
    expect(odd.kind).toBe('region')
    expect(odd.biome).toBeNull()
    expect(odd.polygon[2]).toEqual([400, 1000]) // clamped to the picture
    expect(regions[3].parent).toBe(1) // inside the plains, not the sea
    expect(regions[1].summary).toBe('Open country')
  })

  it('reads an empty or broken answer as nothing found', () => {
    expect(parseRegions('{"regions": []}', 100, 100).regions).toEqual([])
    expect(() => parseRegions('no idea', 100, 100)).toThrow()
  })
})

describe('keeping a world map', () => {
  let dir: string
  let c: Campaign
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dz-world-'))
    c = Campaign.create(join(dir, 'Camp'), 'The Mistreach')
  })
  afterEach(() => {
    c.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('a new campaign starts on the guide until it is finished', () => {
    expect(c.info().gettingStarted).toBe(true)
    c.setSetting('getting_started', 'done', 'Finished the getting started guide')
    expect(c.info().gettingStarted).toBe(false)
  })

  it('keeps the map, its regions and their Location cards as one undo step', () => {
    const w = generateWorld({ seed: 5, ...small })
    const pending = c.savePendingImage(w.png, 'image/png')
    const map = c.keepWorldMap({ pendingId: pending.pendingId, name: 'The Known World', widthMiles: 1500, source: 'Dungeon Zen map maker (seed 5)', prompt: null, regions: w.regions })
    expect(map.kind).toBe('world')
    expect(map.width).toBe(600)
    expect(map.widthMiles).toBe(1500)
    expect(c.desk().map?.id).toBe(map.id)
    const v = c.mapScreen(map.id)
    expect(v.regions).toHaveLength(w.regions.length)
    const city = w.regions.find((r) => r.kind === 'city')!
    const cityView = v.regions.find((r) => r.name === city.name)!
    expect(cityView.kind).toBe('city')
    expect(placeColour(cityView)).toBe('#8f2a21')
    expect(c.regionDetail(v.regions.find((r) => r.name === w.regions[city.parent!].name)!.id).subRegions.map((s) => s.name)).toContain(city.name)
    // Cards on the board do not pile on top of each other.
    const spots = new Set(c.boardView(c.info().globalBoardId).items.map((i) => `${i.x},${i.y}`))
    expect(spots.size).toBe(w.regions.length)
    expect(() => c.keepWorldMap({ pendingId: pending.pendingId, name: 'Again', widthMiles: null, source: 'x', prompt: null, regions: [] })).toThrow()
    c.undo()
    expect(c.maps()).toEqual([])
    expect(c.boardView(c.info().globalBoardId).items).toEqual([])
  })

  it('adds regions an AI found to an imported map, marked as AI suggestions', () => {
    const png = encodePng(200, 200, new Uint8Array(200 * 200 * 3))
    writeFileSync(join(dir, 'world.png'), png)
    const map = c.importMap(join(dir, 'world.png'))
    const { regions } = parseRegions(JSON.stringify({ regions: [
      { name: 'Elderwood', kind: 'region', biome: 'forest', polygon: [[0, 0], [600, 0], [600, 600], [0, 600]] },
      { name: 'Oakton', kind: 'village', biome: 'forest', polygon: [[100, 100], [200, 100], [200, 200]] }
    ] }), 200, 200)
    c.addRegions(map.id, regions.map((r) => ({ ...r, source: 'Test AI' })), 'Added 2 regions found by AI')
    const v = c.mapScreen(map.id)
    expect(v.regions.map((r) => `${r.name}:${r.kind}:${r.biome}`).sort()).toEqual(['Elderwood:region:forest', 'Oakton:village:forest'])
    const card = c.sheet(v.regions.find((r) => r.name === 'Oakton')!.locationId).entity
    expect(card.attributes.imported).toEqual({ ai: 'Test AI', basis: 'inferred' })
    expect(c.mapImage(map.id)).toMatchObject({ width: 200, height: 200 })
    c.undo()
    expect(c.mapScreen(map.id).regions).toEqual([])
  })

  it('tells the image service what to draw, with no text on the map', () => {
    const p = worldMapPrompt({ description: 'A frozen north and a desert south', climate: 'cold', style: 'parchment' })
    expect(p).toContain('A frozen north and a desert south')
    expect(p).toContain('mostly cold')
    expect(p).toContain('parchment')
    expect(p).toContain('No text')
  })
})

describe('place names on the map', () => {
  it('moves a land name off a town tag, staying inside the land', async () => {
    const { placeLabels } = await import('../src/shared/labels')
    const land: Point[] = [[0, 0], [400, 0], [400, 400], [0, 400]]
    const town: Point[] = [[190, 190], [210, 190], [210, 210], [190, 210]]
    const [a, t] = placeLabels([{ polygon: land, name: 'The Green Plains', spot: false }, { polygon: town, name: 'Oakton', spot: true }], 1)
    expect(t).toEqual([200, 200])
    expect(a).not.toEqual([200, 200])
    expect(pointInPolygon(a, land)).toBe(true)
    // Alone, a name sits in the middle.
    expect(placeLabels([{ polygon: land, name: 'The Green Plains', spot: false }], 1)[0]).toEqual([200, 200])
  })
})
