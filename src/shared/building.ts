// Building cards (taverns, shops, any other building): floors, patrons with scored secrets,
// rooms to rent, stock with prices, a layout sketch per floor. Everything lives in the
// card's attributes, so every edit is one entity:update (undo, rule 4) and stays editable (rule 11).

import type { Sketch } from './sketch'

export const BUILDING_KINDS = ['tavern', 'shop', 'other'] as const
export type BuildingKind = (typeof BUILDING_KINDS)[number]
export const KIND_LABELS: Record<BuildingKind, string> = { tavern: 'Tavern', shop: 'Shop', other: 'Building' }

export const SECRET_KINDS = ['rumour', 'secret', 'clue'] as const
export type SecretKind = (typeof SECRET_KINDS)[number]
export const SECRET_LABELS: Record<SecretKind, string> = { rumour: 'Rumour', secret: 'Secret', clue: 'Clue' }

export const ROOM_STATUSES = ['free', 'taken', 'closed'] as const
export type RoomStatus = (typeof ROOM_STATUSES)[number]
export const ROOM_LABELS: Record<RoomStatus, string> = { free: 'Free', taken: 'Taken', closed: 'Not for rent' }

/** Floor names offered by "+ Floor"; the DM can type any other. */
export const FLOOR_NAMES = ['Basement', 'Cellar', 'Upper floor', 'Second floor', 'Attic', 'Tower', 'Roof'] as const

export interface Floor { id: string; name: string; layout?: Sketch; mapId?: string }
export interface Patron {
  id: string; name: string; role: string; desc: string; knows: string; floor: string
  keeper?: boolean; entityId?: string
}
/** A rumour, secret or clue. Shown as revealed when the players' roll reaches its score. */
export interface BSecret { id: string; kind: SecretKind; score: number; text: string; patronId?: string; cardId?: string }
export interface Room { id: string; no: string; name: string; price: number; status: RoomStatus; who: string; floor: string }
/** price in copper pieces (base, before the campaign and building scales); qty null = always in stock. */
export interface StockItem { id: string; name: string; notes: string; qty: number | null; price: number; floor: string }

export interface Building {
  kind: BuildingKind
  floors: Floor[]
  patrons: Patron[]
  secrets: BSecret[]
  rooms: Room[]
  stock: StockItem[]
  /** Percent, on top of the campaign's scale. */
  priceScale: number
  /** The players' last roll typed in; secrets at or below it show as revealed. */
  roll: number | null
}

/** Fill with AI's answer: text fields plus the building data, kept only when the DM chooses (rule 2). */
export interface BuildingProposal { description: string; history: string; building: Partial<Building> }

export const MAIN_FLOOR = 'main'
export const newId = () => Math.random().toString(36).slice(2, 10)

const arr = <T>(v: unknown, ok: (x: Record<string, unknown>) => boolean): T[] =>
  Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object' && ok(x as Record<string, unknown>)) as T[]) : []
const isStr = (x: unknown): x is string => typeof x === 'string'
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

/** Reads a building's data from card attributes, tolerating anything missing or odd. */
export function readBuilding(a: Record<string, unknown>): Building {
  const kind = BUILDING_KINDS.includes(a.building_kind as BuildingKind) ? (a.building_kind as BuildingKind) : 'other'
  const floors = arr<Floor>(a.floors, (f) => isStr(f.id) && isStr(f.name))
  return {
    kind,
    floors: floors.length ? floors : [{ id: MAIN_FLOOR, name: 'Main floor' }],
    patrons: arr<Partial<Patron>>(a.patrons, (p) => isStr(p.id) && isStr(p.name)).map((p) => ({ role: '', desc: '', knows: '', floor: MAIN_FLOOR, ...p }) as Patron),
    secrets: arr<BSecret>(a.secrets, (s) => isStr(s.id) && isStr(s.text) && isNum(s.score))
      .map((s) => ({ ...s, kind: SECRET_KINDS.includes(s.kind) ? s.kind : 'secret' })),
    rooms: arr<Partial<Room>>(a.rooms, (r) => isStr(r.id)).map((r) => ({ no: '', name: '', price: 0, status: 'free', who: '', floor: MAIN_FLOOR, ...r }) as Room),
    stock: arr<Partial<StockItem>>(a.stock, (s) => isStr(s.id) && isStr(s.name)).map((s) => ({ notes: '', qty: null, price: 0, floor: MAIN_FLOOR, ...s }) as StockItem),
    priceScale: isNum(a.price_scale) && a.price_scale > 0 ? a.price_scale : 100,
    roll: isNum(a.players_roll) ? a.players_roll : null
  }
}

/** Card attributes for a building (the inverse of readBuilding, for one entity:update). */
export function buildingAttrs(b: Partial<Building>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (b.kind !== undefined) out.building_kind = b.kind
  if (b.floors !== undefined) out.floors = b.floors
  if (b.patrons !== undefined) out.patrons = b.patrons
  if (b.secrets !== undefined) out.secrets = b.secrets
  if (b.rooms !== undefined) out.rooms = b.rooms
  if (b.stock !== undefined) out.stock = b.stock
  if (b.priceScale !== undefined) out.price_scale = b.priceScale
  if (b.roll !== undefined) out.players_roll = b.roll
  return out
}

export const clampScore = (n: number) => Math.max(1, Math.min(20, Math.round(n) || 1))
export const byScore = (a: BSecret, b: BSecret) => a.score - b.score
export const isRevealed = (s: BSecret, roll: number | null) => roll !== null && s.score <= roll

// ---- prices ------------------------------------------------------------------

/** "15 gp", "2 gp 4 sp", "4 cp". */
export function formatPrice(cp: number): string {
  const n = Math.max(0, Math.round(cp))
  if (n === 0) return '0 cp'
  const gp = Math.floor(n / 100), sp = Math.floor((n % 100) / 10), c = n % 10
  return [gp && `${gp.toLocaleString('en')} gp`, sp && `${sp} sp`, c && `${c} cp`].filter(Boolean).join(' ')
}

/** Reads "15 gp", "2gp 4sp", "5 sp", "3" (gp) into copper; null if it is not a price. */
export function parsePrice(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/,/g, '')
  if (!t) return null
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t) * 100)
  const unit = { pp: 1000, gp: 100, ep: 50, sp: 10, cp: 1 } as const
  let total = 0, found = false
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(pp|gp|ep|sp|cp)/g)) { total += Number(m[1]) * unit[m[2] as keyof typeof unit]; found = true }
  return found ? Math.round(total) : null
}

/** The price the players pay: base × campaign scale × building scale (both percent). */
export const scaledPrice = (cp: number, campaignPct: number, buildingPct: number) => Math.round(cp * (campaignPct / 100) * (buildingPct / 100))

// ---- who is where ----------------------------------------------------------------

interface Ent { id: string; type: string; name: string; status: string; attributes: Record<string, unknown> }
interface Rel { sourceId: string; targetId: string; type: string; status: string }

const norm = (s: unknown) => (typeof s === 'string' ? s.trim().toLowerCase() : '')

/**
 * NPCs and monsters in a place: their location names it (or a building inside it), a
 * "located at" string ties them to it, or any string ties them to a building inside it.
 */
export function occupantsOf(place: { id: string; name: string }, ents: Ent[], rels: Rel[]): Ent[] {
  const live = ents.filter((e) => e.status === 'active' || e.status === 'resolved')
  const liveRels = rels.filter((r) => r.status === 'active')
  const name = norm(place.name)
  const at = (e: Ent, id: string, n: string) => norm(e.attributes.location) === n
    || liveRels.some((r) => r.sourceId === e.id && r.targetId === id && r.type === 'LOCATED_AT')
  const buildings = live.filter((b) => b.type === 'BUILDING' && at(b, place.id, name))
  return live.filter((e) => (e.type === 'NPC' || e.type === 'MONSTER') && (
    at(e, place.id, name) || buildings.some((b) => norm(e.attributes.location) === norm(b.name)
      || liveRels.some((r) => (r.sourceId === e.id && r.targetId === b.id) || (r.targetId === e.id && r.sourceId === b.id)))
  ))
}
