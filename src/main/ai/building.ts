// Building sheet › Fill with AI: one proposal for the whole tavern, shop or building
// (description, history with the name's story, floors, keeper and patrons with scored
// secrets tied to the campaign's cards, rooms, stock with prices, a rough layout).
// Pure: builds the request and reads the answer. Nothing is saved until the DM keeps it (rules 2, 10).

import { MAIN_FLOOR, newId, clampScore, parsePrice, SECRET_KINDS, type Building, type BSecret, type BuildingKind, type BuildingProposal, type Floor, type Patron, type Room, type StockItem } from '../../shared/building'
import { emptySketch, paint, roomCells, type Sketch } from '../../shared/sketch'
import { PRICE_LIST } from '../../shared/prices'
import { extractJson } from '../importers/notes'

export const BUILDING_SYSTEM = [
  'You help a Dungeon Master stock a building for a Dungeons & Dragons 5e (2024) campaign.',
  'Write short, concrete, usable text. Invent freely but stay consistent with the campaign facts given.',
  'Reply with ONE JSON object and nothing else.'
].join(' ')

export interface BuildingContext {
  campaignName: string
  name: string
  kind: BuildingKind
  where: string
  /** What is already written on the card (description, notes…). */
  known: string[]
  /** Cards on the board the patrons can know about: "Name (type): one line". */
  cards: string[]
}

export function buildingPrompt(ctx: BuildingContext, ask: string): string {
  const tavern = ctx.kind === 'tavern', shop = ctx.kind === 'shop'
  const lines = [
    `Campaign: ${ctx.campaignName}.`,
    `Building: ${ctx.name}, a ${tavern ? 'tavern or inn' : shop ? 'shop' : 'building'}${ctx.where ? ` in ${ctx.where}` : ''}.`,
    ctx.known.length ? `Already known:\n${ctx.known.join('\n')}` : 'Nothing is written about it yet.',
    ctx.cards.length ? `Cards already in the campaign (people, creatures, factions, clues, places, quests):\n${ctx.cards.join('\n')}` : 'The campaign has no other cards yet.',
    'Make:',
    '- "description": two to four sentences, what the place looks, sounds and smells like.',
    `- "history": three to five sentences. It MUST say how ${ctx.name} got its name, and that story must be unique to this place; mystery, a twist or humour are welcome.`,
    `- "floors": names of the floors besides the main floor (e.g. ["Upper floor", "Cellar"]); ${tavern ? 'a tavern usually has rooms upstairs' : 'often none'}.`,
    `- "keeper": the ${tavern ? 'barkeeper or innkeeper' : shop ? 'shopkeeper' : 'person in charge'}: {"name", "role", "desc" (one line: look and manner), "knows" (one line about someone or something in the campaign)}.`,
    `- "patrons": ${tavern ? 'five to eight' : shop ? 'one or two customers' : 'two to four people'} like the keeper, each with a "floor" (the main floor unless upstairs).`,
    '- "secrets": rumours, secrets and clues held by the keeper and patrons: {"who" (their name), "kind" ("rumour", "secret" or "clue"), "score" (1-20: how high the players must roll to learn it), "text"}.',
    '  Give each person two or three. Low scores (1-8) are harmless everyday gossip (rumour). Middle scores are personal secrets. High scores (14-20) are real secrets and clues that tie DIRECTLY to the campaign cards above by name.',
    tavern ? '- "rooms": the rooms to rent: {"no", "name", "price" (like "5 sp"), "status" ("free", "taken" or "closed" for not for rent), "who" (who stays there, or empty), "floor"}.' : '- "rooms": [] unless it has rooms to rent.',
    `- "stock": ${shop ? 'a long list (twelve or more) of what it sells' : tavern ? 'a short menu: drinks, meals, lodging' : 'anything for sale, often none'}: {"name", "notes" (short rules line or empty), "qty" (number, or null for always), "price" (5e standard prices like "15 gp")}.`,
    '- "layout": per floor, a rough plan on a 20 x 12 grid of 5-foot squares: {"<floor name or main>": [{"name", "x", "y", "w", "h", "doors": [[x, y]]}]} with rooms as rectangles that fit the grid; neighbouring rooms share a wall; doors are squares on a room\'s edge.',
    'Use "main" for the main floor in "floor" fields.'
  ]
  if (ask.trim()) lines.push(`The DM adds: ${ask.trim().slice(0, 600)}`)
  return lines.join('\n')
}

const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : '')
const list = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : [])
const known = new Map(PRICE_LIST.map((p) => [p.name.toLowerCase(), p.cp]))

/** Reads the AI's answer into building data with fresh ids; anything missing is left empty. */
export function parseBuilding(reply: string, kind: BuildingKind): BuildingProposal {
  const raw = extractJson(reply) as Record<string, unknown>
  const floors: Floor[] = [{ id: MAIN_FLOOR, name: 'Main floor' }]
  for (const n of Array.isArray(raw.floors) ? raw.floors : []) {
    const name = str(n, 60)
    if (name && !/^main/i.test(name) && !floors.some((f) => f.name.toLowerCase() === name.toLowerCase())) floors.push({ id: newId(), name })
  }
  const floorOf = (v: unknown) => {
    const n = str(v, 60).toLowerCase()
    return floors.find((f) => n && f.name.toLowerCase() === n)?.id ?? MAIN_FLOOR
  }
  const person = (p: Record<string, unknown>, keeper: boolean): Patron => ({
    id: newId(), name: str(p.name, 200) || 'Someone', role: str(p.role, 200), desc: str(p.desc, 600), knows: str(p.knows, 600),
    floor: floorOf(p.floor), ...(keeper ? { keeper: true } : {})
  })
  const keeper = raw.keeper && typeof raw.keeper === 'object' ? [person(raw.keeper as Record<string, unknown>, true)] : []
  const patrons = [...keeper, ...list(raw.patrons).map((p) => person(p, false))].slice(0, 30)
  const secrets: BSecret[] = list(raw.secrets).flatMap((s) => {
    const text = str(s.text)
    if (!text) return []
    const who = str(s.who, 200).toLowerCase()
    const kind = SECRET_KINDS.find((k) => k === str(s.kind).toLowerCase()) ?? 'secret'
    return [{ id: newId(), kind, score: clampScore(Number(s.score)), text, patronId: patrons.find((p) => who && p.name.toLowerCase() === who)?.id }]
  }).slice(0, 120)
  const rooms: Room[] = list(raw.rooms).map((r, i) => ({
    id: newId(), no: str(r.no, 10) || String(i + 1), name: str(r.name, 200), price: parsePrice(str(r.price)) ?? 0,
    status: r.status === 'taken' || r.status === 'closed' ? (r.status as Room['status']) : 'free', who: str(r.who, 300), floor: floorOf(r.floor)
  })).slice(0, 60)
  const stock: StockItem[] = list(raw.stock).flatMap((s) => {
    const name = str(s.name, 200)
    if (!name) return []
    const qty = typeof s.qty === 'number' && Number.isFinite(s.qty) ? Math.max(0, Math.round(s.qty)) : null
    return [{ id: newId(), name, notes: str(s.notes, 300), qty, price: parsePrice(str(s.price)) ?? known.get(name.toLowerCase()) ?? 0, floor: MAIN_FLOOR }]
  }).slice(0, 200)
  // A rough layout per floor from the rooms as rectangles.
  const layouts = raw.layout && typeof raw.layout === 'object' ? raw.layout as Record<string, unknown> : {}
  for (const [key, rects] of Object.entries(layouts)) {
    const floor = /^main/i.test(key) ? floors[0] : floors.find((f) => f.name.toLowerCase() === key.toLowerCase())
    if (!floor) continue
    let sk: Sketch = emptySketch(20, 12)
    for (const r of list(rects)) {
      const [x, y, w, h] = [r.x, r.y, r.w, r.h].map((n) => Math.round(Number(n)))
      if (![x, y, w, h].every(Number.isFinite) || w < 2 || h < 2) continue
      const x1 = Math.min(19, x + w - 1), y1 = Math.min(11, y + h - 1)
      if (x < 0 || y < 0 || x > 18 || y > 10) continue
      sk = paint(sk, roomCells(x, y, x1, y1))
      for (const d of Array.isArray(r.doors) ? r.doors : []) {
        const [dx, dy] = Array.isArray(d) ? d.map((n) => Math.round(Number(n))) : [NaN, NaN]
        if (Number.isFinite(dx) && Number.isFinite(dy)) sk = paint(sk, [[dx, dy, 'D']])
      }
      const name = str(r.name, 40)
      if (name) sk = { ...sk, labels: [...sk.labels, { x: x + 1, y: y + 1, t: name }] }
    }
    if (sk.cells.trim()) floor.layout = sk
  }
  return { description: str(raw.description, 5000), history: str(raw.history, 5000), building: { kind, floors, patrons, secrets, rooms, stock } as Partial<Building> }
}
