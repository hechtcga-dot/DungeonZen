// "Create a world map for me" (getting started, owner 2026-10-06): an offline, seeded
// world with its regions already mapped: land regions by biome, seas and lakes,
// and settlements. Everything comes from one set of Voronoi cells, so the regions
// match the picture. Pure (no Electron); the DM can rename, reshape and recolour
// every region afterwards.

import { seededRng, type Rng } from './generators'
import { encodePng } from './png'
import type { Biome, PlaceKind } from '../shared/places'

type Pt = [number, number]

export interface WorldOptions {
  seed: number
  /** How many cells (more cells: smaller, more varied regions). */
  size: 'small' | 'medium' | 'large'
  /** Share of the map that is land, 0.3 to 0.75. */
  land: number
  climate: 'cold' | 'temperate' | 'warm'
  /** Cities, towns and villages to place (0 to 30). */
  settlements: number
  width?: number
  height?: number
}

export interface WorldRegion {
  name: string
  kind: PlaceKind
  biome: Biome | null
  polygon: Pt[]
  /** Index of the region it lies inside (settlements inside their land). */
  parent: number | null
  summary: string
}

export interface World { width: number; height: number; png: Buffer; regions: WorldRegion[] }

const CELLS: Record<WorldOptions['size'], number> = { small: 120, medium: 220, large: 360 }

// ---------------------------------------------------------------- noise

function makeNoise(rng: Rng) {
  const perm = new Uint8Array(512)
  const p = Array.from({ length: 256 }, (_, i) => i)
  for (let i = 255; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [p[i], p[j]] = [p[j], p[i]] }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]
  const grad = (h: number, x: number, y: number) => ((h & 1) ? -x : x) + ((h & 2) ? -y : y)
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
  const noise = (x: number, y: number) => {
    const xi = Math.floor(x) & 255
    const yi = Math.floor(y) & 255
    const xf = x - Math.floor(x)
    const yf = y - Math.floor(y)
    const u = fade(xf)
    const v = fade(yf)
    const aa = perm[perm[xi] + yi], ab = perm[perm[xi] + yi + 1], ba = perm[perm[xi + 1] + yi], bb = perm[perm[xi + 1] + yi + 1]
    const x1 = grad(aa, xf, yf) + u * (grad(ba, xf - 1, yf) - grad(aa, xf, yf))
    const x2 = grad(ab, xf, yf - 1) + u * (grad(bb, xf - 1, yf - 1) - grad(ab, xf, yf - 1))
    return (x1 + v * (x2 - x1)) * 0.7 + 0.5 // about 0..1
  }
  /** Fractal noise, about 0..1. */
  return (x: number, y: number, octaves = 4) => {
    let sum = 0, amp = 1, freq = 1, norm = 0
    for (let o = 0; o < octaves; o++) { sum += amp * noise(x * freq, y * freq); norm += amp; amp *= 0.5; freq *= 2 }
    return sum / norm
  }
}

// ---------------------------------------------------------------- Voronoi cells

/** The cell of seed i: the box clipped by the half-planes nearer to i than to each neighbour seed. */
function cellPolygon(i: number, seeds: Pt[], near: number[], w: number, h: number): Pt[] {
  let poly: Pt[] = [[0, 0], [w, 0], [w, h], [0, h]]
  const [sx, sy] = seeds[i]
  for (const j of near) {
    if (j === i) continue
    const [tx, ty] = seeds[j]
    const mx = (sx + tx) / 2, my = (sy + ty) / 2
    const nx = tx - sx, ny = ty - sy
    const inside = (p: Pt) => (p[0] - mx) * nx + (p[1] - my) * ny <= 0
    const next: Pt[] = []
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k], b = poly[(k + 1) % poly.length]
      const ia = inside(a), ib = inside(b)
      if (ia) next.push(a)
      if (ia !== ib) {
        const da = (a[0] - mx) * nx + (a[1] - my) * ny
        const db = (b[0] - mx) * nx + (b[1] - my) * ny
        const t = da / (da - db)
        next.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
      }
    }
    poly = next
    if (poly.length < 3) break
  }
  return poly
}

const key = (p: Pt) => `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`

function area(poly: Pt[]): number {
  let a = 0
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1])
  return a / 2
}

/** One outline around neighbouring cells: shared edges cancel; the largest loop is kept. */
export function unionCells(polys: Pt[][]): Pt[] {
  if (polys.length === 1) return polys[0]
  const edges = new Map<string, { a: Pt; b: Pt; count: number }>()
  for (const poly of polys) {
    // Same winding for every cell.
    const ring = area(poly) < 0 ? [...poly].reverse() : poly
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k], b = ring[(k + 1) % ring.length]
      const ka = key(a), kb = key(b)
      if (ka === kb) continue
      const undirected = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
      const e = edges.get(undirected)
      if (e) e.count++
      else edges.set(undirected, { a, b, count: 1 })
    }
  }
  const outgoing = new Map<string, Array<{ a: Pt; b: Pt }>>()
  for (const e of edges.values()) {
    if (e.count !== 1) continue
    const k = key(e.a)
    outgoing.set(k, [...(outgoing.get(k) ?? []), e])
  }
  const loops: Pt[][] = []
  for (const start of [...outgoing.keys()]) {
    while (outgoing.get(start)?.length) {
      const loop: Pt[] = []
      let cur = outgoing.get(start)!.pop()!
      for (let guard = 0; guard < 100000; guard++) {
        loop.push(cur.a)
        const nk = key(cur.b)
        if (nk === start) break
        const list = outgoing.get(nk)
        if (!list?.length) break
        cur = list.pop()!
      }
      if (loop.length >= 3) loops.push(loop)
    }
  }
  if (!loops.length) return polys[0]
  return simplify(loops.reduce((best, l) => (Math.abs(area(l)) > Math.abs(area(best)) ? l : best)))
}

/** Drops points that lie on a straight line between their neighbours. */
function simplify(poly: Pt[]): Pt[] {
  const out = poly.filter((p, i) => {
    const a = poly[(i - 1 + poly.length) % poly.length], b = poly[(i + 1) % poly.length]
    return Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) > 0.5
  })
  return out.length >= 3 ? out.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as Pt) : poly
}

// ---------------------------------------------------------------- names

const PREFIX = ['Ash', 'Black', 'Bram', 'Cold', 'Dun', 'Elder', 'Fen', 'Gold', 'Grey', 'High', 'Iron', 'Kings', 'Long', 'Mist', 'North', 'Oak',
  'Raven', 'Red', 'Salt', 'Silver', 'Stone', 'Storm', 'Thorn', 'West', 'Wolf', 'Wyrm', 'Frost', 'Amber', 'Bright', 'Copper', 'Hollow', 'Moon',
  'Sun', 'Briar', 'Cinder', 'Dawn', 'Ember', 'Glen', 'Hart', 'Lark', 'Marsh', 'Rook', 'Shadow', 'Sorrow', 'Willow', 'Yew']
const TOWN_END = ['ford', 'haven', 'bridge', 'wick', 'stead', 'holm', 'mouth', 'gate', 'fall', 'moor', 'vale', 'wood', 'burg', 'port', 'crest', 'well', 'by', 'ton', 'barrow', 'cross']
const LAND: Record<string, string[]> = {
  forest: ['{p}wood', 'The {p} Forest', '{p}weald'], jungle: ['The {p} Jungle', '{p}tangle'], hills: ['The {p} Hills', '{p} Downs', 'The {p} Tors'],
  mountains: ['The {p}spire Mountains', '{p}peak Range', 'The {p} Teeth'], desert: ['The {p} Sands', '{p} Waste', 'The {p} Dunes'],
  badlands: ['The {p} Barrens', '{p} Badlands'], swamp: ['{p}fen Marsh', 'The {p} Mire', '{p} Bog'], tundra: ['The {p} Tundra', '{p} Steppe'],
  snow: ['The {p} Ice', '{p}frost Fields'], grassland: ['The {p} Plains', '{p}field Meadows', 'The {p} Grass'],
  farmland: ['{p} Farmlands', 'The {p} Vale'], coast: ['The {p} Coast'], water: ['The {p} Sea', 'Lake {p}', '{p}water'], wasteland: ['The {p} Waste']
}
const BIOME_WORDS: Record<string, string> = {
  forest: 'Old forest', jungle: 'Thick jungle', hills: 'Rolling hills', mountains: 'High mountains', desert: 'Dry desert', badlands: 'Broken badlands',
  swamp: 'Marsh and bog', tundra: 'Cold tundra', snow: 'Snow and ice', grassland: 'Open grassland', farmland: 'Farmland', coast: 'Coast',
  water: 'Water', wasteland: 'Wasteland'
}

function namer(rng: Rng) {
  const used = new Set<string>()
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rng() * xs.length)]
  const unique = (make: () => string) => {
    for (let k = 0; k < 40; k++) { const n = make(); if (!used.has(n)) { used.add(n); return n } }
    const n = `${make()} ${used.size}`; used.add(n); return n
  }
  return {
    land: (biome: string) => unique(() => pick(LAND[biome] ?? ['The {p} Lands']).replace('{p}', pick(PREFIX))),
    lake: () => unique(() => `Lake ${pick(PREFIX)}${pick(['mere', 'water', ''])}`),
    sea: () => unique(() => `The ${pick(PREFIX)} ${pick(['Sea', 'Sound', 'Deep', 'Gulf'])}`),
    town: () => unique(() => `${pick(PREFIX)}${pick(TOWN_END)}`)
  }
}

// ---------------------------------------------------------------- the world

export function generateWorld(o: WorldOptions): World {
  const W = o.width ?? 2048
  const H = o.height ?? 1366
  const rng = seededRng(o.seed >>> 0)
  const fbm = makeNoise(rng)
  const fbm2 = makeNoise(rng)
  const texture = makeNoise(rng)
  const n = CELLS[o.size]
  // Seeds on a jittered grid: even cells of varied shape.
  const cols = Math.round(Math.sqrt((n * W) / H))
  const rows = Math.ceil(n / cols)
  const cw = W / cols, ch = H / rows
  const seeds: Pt[] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) seeds.push([(c + 0.15 + rng() * 0.7) * cw, (r + 0.15 + rng() * 0.7) * ch])
  const near = (i: number) => {
    const c = i % cols, r = Math.floor(i / cols), out: number[] = []
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      const rr = r + dr, cc = c + dc
      if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) out.push(rr * cols + cc)
    }
    return out
  }
  const polys = seeds.map((_, i) => cellPolygon(i, seeds, near(i), W, H))
  // Neighbours: cells sharing a vertex.
  const byVertex = new Map<string, number[]>()
  polys.forEach((p, i) => p.forEach((v) => { const k = key(v); byVertex.set(k, [...(byVertex.get(k) ?? []), i]) }))
  const neighbours = polys.map(() => new Set<number>())
  for (const list of byVertex.values()) for (const a of list) for (const b of list) if (a !== b) neighbours[a].add(b)

  // Elevation: noise, lower towards the edges (so the world is surrounded by sea).
  const elevationAt = (x: number, y: number) => {
    const nx = x / W, ny = y / H
    // Round falloff (squared distance from the middle, 1 at the edges) so the land is not square.
    const d = (nx - 0.5) ** 2 * 4 + (ny - 0.5) ** 2 * 4
    const edge = Math.min(nx, 1 - nx, ny, 1 - ny)
    return fbm(nx * 3.2, ny * 3.2 * (H / W), 5) * 0.85 - d * 0.42 - (edge < 0.06 ? (0.06 - edge) * 6 : 0)
  }
  const elev = seeds.map(([x, y]) => elevationAt(x, y))
  const sorted = [...elev].sort((a, b) => a - b)
  const land = Math.min(0.75, Math.max(0.3, o.land))
  const seaLevel = sorted[Math.min(sorted.length - 1, Math.floor((1 - land) * sorted.length))] ?? 0.5
  const isLand = elev.map((e, i) => {
    const [x, y] = seeds[i]
    return e > seaLevel && x > cw * 0.6 && x < W - cw * 0.6 && y > ch * 0.6 && y < H - ch * 0.6
  })
  const landElev = elev.filter((_, i) => isLand[i]).sort((a, b) => a - b)
  const rank = (e: number) => (landElev.length ? landElev.findIndex((x) => x >= e) / landElev.length : 0)
  const shift = o.climate === 'cold' ? -0.25 : o.climate === 'warm' ? 0.22 : 0
  const biome: Array<Biome> = seeds.map(([x, y], i) => {
    if (!isLand[i]) return 'water'
    const r = rank(elev[i])
    // Broad, slow noise so wet and dry lands come in big stretches, not a patchwork.
    const moist = fbm2((x / W) * 1.8, (y / H) * 1.8 * (H / W), 3)
    const temp = 0.64 - Math.abs(y / H - 0.5) * 0.75 + shift - r * 0.2 + (fbm2(x / W * 1.3 + 7, y / H * 1.3, 2) - 0.5) * 0.25
    if (r > 0.88) return temp < 0.25 ? 'snow' : 'mountains'
    if (r > 0.72) return temp < 0.2 ? 'tundra' : 'hills'
    if (temp < 0.16) return 'snow'
    if (temp < 0.3) return 'tundra'
    if (moist < 0.4) return temp > 0.7 ? 'desert' : temp > 0.6 ? 'badlands' : 'grassland'
    if (moist > 0.6 && r < 0.3) return 'swamp'
    if (moist > 0.5) return temp > 0.8 ? 'jungle' : 'forest'
    return 'grassland'
  })
  // Smooth: a land cell whose neighbours mostly share another biome takes it on.
  for (let pass = 0; pass < 2; pass++) {
    const next = [...biome]
    for (let i = 0; i < seeds.length; i++) {
      if (!isLand[i] || biome[i] === 'mountains') continue
      const count = new Map<Biome, number>()
      for (const j of neighbours[i]) if (isLand[j]) count.set(biome[j], (count.get(biome[j]) ?? 0) + 1)
      const same = count.get(biome[i]) ?? 0
      let best: Biome = biome[i], bc = same
      for (const [b, c] of count) if (c > bc) { best = b; bc = c }
      if (same <= 1 && bc >= 3) next[i] = best
    }
    biome.splice(0, biome.length, ...next)
  }

  // Settlements: on habitable land, near water, spread out.
  const names = namer(rng)
  const habitable = new Set<Biome>(['grassland', 'farmland', 'forest', 'hills', 'coast', 'swamp', 'jungle', 'tundra', 'desert', 'badlands'])
  const score = (i: number) => {
    const b = biome[i]
    let s = { grassland: 3, farmland: 3, forest: 2, hills: 2, coast: 3, swamp: 0.6, jungle: 1, tundra: 0.6, desert: 0.5, badlands: 0.6 }[b as string] ?? 0
    if ([...neighbours[i]].some((j) => !isLand[j])) s += 2 // on the water
    return s * (0.6 + rng() * 0.8)
  }
  const candidates = seeds.map((_, i) => i).filter((i) => isLand[i] && habitable.has(biome[i])).sort((a, b) => score(b) - score(a))
  const minDist = Math.sqrt((W * H) / Math.max(1, o.settlements)) * 0.45
  const towns: number[] = []
  for (const i of candidates) {
    if (towns.length >= Math.min(30, Math.max(0, o.settlements))) break
    if (towns.every((t) => Math.hypot(seeds[t][0] - seeds[i][0], seeds[t][1] - seeds[i][1]) > minDist)) towns.push(i)
  }
  // Fields around the bigger settlements.
  towns.slice(0, Math.max(1, Math.round(towns.length / 3))).forEach((t) => {
    for (const j of [t, ...neighbours[t]]) if (biome[j] === 'grassland') biome[j] = 'farmland'
  })

  // Land regions: neighbouring cells of one biome; water: seas (touching the edge) and lakes.
  // Open sea is split into north, east, south and west seas so no outline wraps around the land.
  const onEdge = (c: number) => polys[c].some(([x, y]) => x <= 0.5 || y <= 0.5 || x >= W - 0.5 || y >= H - 0.5)
  const flood = (start: number, same: (j: number) => boolean, mark: Int32Array, id: number) => {
    const stack = [start], members: number[] = []
    mark[start] = id
    while (stack.length) {
      const c = stack.pop()!
      members.push(c)
      for (const j of neighbours[c]) if (mark[j] < 0 && same(j)) { mark[j] = id; stack.push(j) }
    }
    return members
  }
  const openSea = new Uint8Array(seeds.length)
  const waterMark = new Int32Array(seeds.length).fill(-1)
  for (let i = 0; i < seeds.length; i++) {
    if (isLand[i] || waterMark[i] >= 0) continue
    const members = flood(i, (j) => !isLand[j], waterMark, i)
    if (members.some(onEdge)) for (const c of members) openSea[c] = 1
  }
  const SECTORS = ['North', 'East', 'South', 'West'] as const
  const sector = seeds.map(([x, y]) => {
    const dx = x / W - 0.5, dy = y / H - 0.5
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0
  })
  const group = new Int32Array(seeds.length).fill(-1)
  const groups: number[][] = []
  for (let i = 0; i < seeds.length; i++) {
    if (group[i] >= 0) continue
    groups.push(flood(i, (j) => biome[j] === biome[i] && isLand[j] === isLand[i] && openSea[j] === openSea[i] && (!openSea[i] || sector[j] === sector[i]), group, groups.length))
  }
  const regions: WorldRegion[] = []
  const regionOfGroup = new Map<number, number>()
  groups.forEach((members, g) => {
    const b = biome[members[0]]
    const water = !isLand[members[0]]
    const sea = openSea[members[0]] === 1
    if (sea && members.length < 3) return // slivers of open sea stay unnamed
    const name = water ? (sea ? names.sea() : names.lake()) : names.land(b)
    regionOfGroup.set(g, regions.length)
    regions.push({
      name, kind: water ? 'sea' : 'region', biome: b, polygon: unionCells(members.map((c) => polys[c])), parent: null,
      summary: water
        ? (sea ? `Open sea to the ${SECTORS[sector[members[0]]].toLowerCase()}` : 'A lake')
        : `${BIOME_WORDS[b]}, ${members.length > 12 ? 'a wide land' : members.length > 4 ? 'a stretch of country' : 'a small area'}`
    })
  })
  towns.forEach((t, k) => {
    const kind: PlaceKind = k === 0 ? 'city' : k <= Math.max(1, Math.round(towns.length * 0.3)) ? 'town' : 'village'
    const r = kind === 'city' ? 26 : kind === 'town' ? 19 : 13
    const [x, y] = seeds[t]
    const poly: Pt[] = Array.from({ length: 6 }, (_, a) => [Math.round(x + r * Math.cos((a * Math.PI) / 3)), Math.round(y + r * Math.sin((a * Math.PI) / 3))])
    regions.push({
      name: names.town(), kind, biome: biome[t], polygon: poly, parent: regionOfGroup.get(group[t]) ?? null,
      summary: `${kind[0].toUpperCase() + kind.slice(1)}${[...neighbours[t]].some((j) => !isLand[j]) ? ' on the water' : ''}`
    })
  })

  return { width: W, height: H, png: paint(W, H, seeds, cols, rows, cw, ch, biome, isLand, elevationAt, seaLevel, texture, towns), regions }
}

// ---------------------------------------------------------------- painting

const PAINT: Record<Biome, [number, number, number]> = {
  grassland: [176, 180, 112], farmland: [200, 186, 118], forest: [92, 122, 72], jungle: [62, 110, 66], hills: [176, 154, 104],
  mountains: [138, 128, 114], desert: [222, 196, 132], badlands: [186, 128, 88], swamp: [104, 116, 80], tundra: [178, 184, 168],
  snow: [232, 236, 236], coast: [204, 190, 140], water: [92, 128, 158], wasteland: [150, 140, 126]
}
const PARCHMENT: [number, number, number] = [234, 220, 182]
const INK: [number, number, number] = [52, 38, 24]

function paint(W: number, H: number, seeds: Pt[], cols: number, rows: number, cw: number, ch: number, biome: Biome[], isLand: boolean[],
  elevationAt: (x: number, y: number) => number, seaLevel: number, texture: (x: number, y: number, o?: number) => number, towns: number[]): Buffer {
  const cellOf = new Int32Array(W * H)
  const warp = Math.min(cw, ch) * 0.22
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Warped lookup: wiggly coasts and borders instead of straight cell edges.
      const wx = x + (texture(x / 90, y / 90, 3) - 0.5) * warp * 2
      const wy = y + (texture(x / 90 + 31, y / 90 + 17, 3) - 0.5) * warp * 2
      const gc = Math.min(cols - 1, Math.max(0, Math.floor(wx / cw)))
      const gr = Math.min(rows - 1, Math.max(0, Math.floor(wy / ch)))
      let best = 0, bd = Infinity
      for (let dr = -2; dr <= 2; dr++) {
        const rr = gr + dr
        if (rr < 0 || rr >= rows) continue
        for (let dc = -2; dc <= 2; dc++) {
          const cc = gc + dc
          if (cc < 0 || cc >= cols) continue
          const i = rr * cols + cc
          const d = (seeds[i][0] - wx) ** 2 + (seeds[i][1] - wy) ** 2
          if (d < bd) { bd = d; best = i }
        }
      }
      cellOf[y * W + x] = best
    }
  }
  const rgb = new Uint8Array(W * H * 3)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = cellOf[y * W + x]
      const b = biome[i]
      let [r, g, bl] = PAINT[b]
      const grain = texture(x / 7, y / 7, 2) - 0.5
      if (!isLand[i]) {
        // Deeper water darker; shallows lighter.
        const depth = Math.max(0, Math.min(1, (seaLevel - elevationAt(x, y)) * 3))
        r = r + 30 - depth * 45; g = g + 34 - depth * 45; bl = bl + 28 - depth * 30
        if (texture(x / 14, y / 40, 2) > 0.62) { r += 8; g += 8; bl += 8 } // waves
      } else if (b === 'mountains' || b === 'snow' || b === 'hills') {
        const ridge = Math.abs(texture(x / 22, y / 22, 4) - 0.5) * 2
        const k = (b === 'hills' ? 26 : 60) * (1 - ridge)
        r -= k; g -= k; bl -= k
        if (b === 'mountains' && ridge < 0.12) { r += 50; g += 50; bl += 50 } // snowy crests
      } else if (b === 'forest' || b === 'jungle') {
        if (texture(x / 3.2, y / 3.2, 1) > 0.66) { r -= 36; g -= 30; bl -= 28 } // tree speckle
      } else if (b === 'swamp') {
        if (texture(x / 6, y / 2.5, 1) > 0.7) { r -= 10; g += 4; bl += 14 } // pools
      } else if (b === 'farmland') {
        if (Math.floor((x + y * 0.4) / 9 + texture(x / 60, y / 60, 1) * 4) % 3 === 0) { r -= 14; g -= 8; bl -= 10 } // field strips
      } else if (b === 'desert') {
        if (Math.abs(Math.sin((x * 0.06 + texture(x / 50, y / 50, 2) * 9))) < 0.08) { r -= 18; g -= 16; bl -= 12 } // dunes
      }
      r += grain * 22; g += grain * 22; bl += grain * 18
      // Coastlines and lake shores in ink.
      const left = x > 0 ? cellOf[y * W + x - 1] : i
      const up = y > 0 ? cellOf[(y - 1) * W + x] : i
      if (isLand[i] !== isLand[left] || isLand[i] !== isLand[up]) { r = INK[0]; g = INK[1]; bl = INK[2] }
      // Parchment wash and a soft vignette.
      const vx = x / W - 0.5, vy = y / H - 0.5
      const vig = 1 - Math.min(0.35, (vx * vx + vy * vy) * 0.9)
      const o = (y * W + x) * 3
      rgb[o] = clamp((r * 0.82 + PARCHMENT[0] * 0.18) * vig)
      rgb[o + 1] = clamp((g * 0.82 + PARCHMENT[1] * 0.18) * vig)
      rgb[o + 2] = clamp((bl * 0.82 + PARCHMENT[2] * 0.18) * vig)
    }
  }
  // Shallow-water halo along coasts.
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
    const i = cellOf[y * W + x]
    if (isLand[i]) continue
    if (isLand[cellOf[y * W + x - 3]] || isLand[cellOf[y * W + x + 3]] || isLand[cellOf[(y - 3) * W + x]] || isLand[cellOf[(y + 3) * W + x]]) {
      const o = (y * W + x) * 3
      rgb[o] = clamp(rgb[o] + 22); rgb[o + 1] = clamp(rgb[o + 1] + 24); rgb[o + 2] = clamp(rgb[o + 2] + 16)
    }
  }
  void towns
  return encodePng(W, H, rgb)
}

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v))
