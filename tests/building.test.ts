import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { encodePng } from '../src/main/png'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Campaign } from '../src/main/campaign/campaign'
import { buildingAttrs, formatPrice, isRevealed, occupantsOf, parsePrice, readBuilding, scaledPrice } from '../src/shared/building'
import { blueprintText, emptySketch, paint, readSketch, resize, roomCells } from '../src/shared/sketch'
import { buildingPrompt, parseBuilding } from '../src/main/ai/building'

let dir: string
let c: Campaign
let g: string
const at = { x: 0, y: 0 }
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dz-building-'))
  c = Campaign.create(join(dir, 'Camp'), 'Saltmere')
  g = c.info().globalBoardId
})
afterEach(() => {
  c.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('prices', () => {
  it('formats and reads 5e prices in copper', () => {
    expect(formatPrice(1500)).toBe('15 gp')
    expect(formatPrice(240)).toBe('2 gp 4 sp')
    expect(formatPrice(4)).toBe('4 cp')
    expect(parsePrice('15 gp')).toBe(1500)
    expect(parsePrice('2gp 4 sp')).toBe(240)
    expect(parsePrice('3')).toBe(300)
    expect(parsePrice('cheap')).toBeNull()
    expect(scaledPrice(1500, 100, 120)).toBe(1800)
    expect(scaledPrice(1500, 50, 120)).toBe(900)
  })
})

describe('building data', () => {
  it('reads defaults and round-trips through attributes', () => {
    const b = readBuilding({})
    expect(b.kind).toBe('other')
    expect(b.floors).toEqual([{ id: 'main', name: 'Main floor' }])
    const attrs = buildingAttrs({ kind: 'tavern', secrets: [{ id: 's1', kind: 'clue', score: 17, text: 'Cargo in the cellar' }], roll: 14 })
    const back = readBuilding(attrs)
    expect(back.kind).toBe('tavern')
    expect(back.secrets[0].score).toBe(17)
    expect(isRevealed(back.secrets[0], back.roll)).toBe(false)
    expect(isRevealed(back.secrets[0], 17)).toBe(true)
  })

  it('finds NPCs and monsters in a place, in a building inside it, or tied to that building', () => {
    const town = c.createEntity({ boardId: g, type: 'LOCATION', name: 'Saltmere Docks', position: at })
    const inn = c.createEntity({ boardId: g, type: 'BUILDING', name: 'The Drowned Lantern', position: at, attributes: { location: 'Saltmere Docks' } })
    c.createEntity({ boardId: g, type: 'NPC', name: 'Dockmaster', position: at, attributes: { location: 'saltmere docks' } })
    c.createEntity({ boardId: g, type: 'NPC', name: 'Maud', position: at, attributes: { location: 'The Drowned Lantern' } })
    const vey = c.createEntity({ boardId: g, type: 'NPC', name: 'Captain Vey', position: at })
    c.createRelationship({ sourceId: vey.id, targetId: inn.id, type: 'LOCATED_AT', isSecret: false })
    c.createEntity({ boardId: g, type: 'PC', name: 'A hero', position: at, attributes: { location: 'Saltmere Docks' } })
    c.createEntity({ boardId: g, type: 'NPC', name: 'Elsewhere', position: at, attributes: { location: 'Harrowgate' } })
    const ents = c.search({ query: '' }).results.map((r) => r.entity)
    const rels = [...c.sheet(inn.id).connections.map((x) => ({ sourceId: x.outgoing ? inn.id : x.other.id, targetId: x.outgoing ? x.other.id : inn.id, type: x.relationship.type, status: 'active' }))]
    expect(occupantsOf(town, ents, rels).map((e) => e.name).sort()).toEqual(['Captain Vey', 'Dockmaster', 'Maud'])
  })
})

describe('building commands', () => {
  it('makes a card from a patron, tied with a string, in one undo step', () => {
    const inn = c.createEntity({
      boardId: g, type: 'BUILDING', name: 'The Drowned Lantern', position: at,
      attributes: buildingAttrs({ kind: 'tavern', patrons: [{ id: 'p1', name: 'Old Maud', role: 'barkeeper', desc: 'one glass eye', knows: '', floor: 'main', keeper: true }], secrets: [{ id: 's1', kind: 'secret', score: 9, text: 'The eye was a gift', patronId: 'p1' }] })
    })
    const id = c.buildingPatronCard(inn.id, 'p1', 'NPC')
    const npc = c.entityView(id)
    expect(npc.type).toBe('NPC')
    expect(npc.attributes.location).toBe('The Drowned Lantern')
    expect(String(npc.attributes.secret)).toContain('The eye was a gift')
    expect(readBuilding(c.entityView(inn.id).attributes).patrons[0].entityId).toBe(id)
    expect(c.sheet(inn.id).connections.some((x) => x.other.id === id && x.relationship.type === 'LOCATED_AT')).toBe(true)
    expect(() => c.buildingPatronCard(inn.id, 'p1', 'NPC')).toThrow(/already/)
    c.undo()
    expect(readBuilding(c.entityView(inn.id).attributes).patrons[0].entityId).toBeUndefined()
  })

  it('moves a secret to All campaign secrets and into another building', () => {
    const a = c.createEntity({ boardId: g, type: 'BUILDING', name: 'Inn', position: at, attributes: buildingAttrs({ secrets: [{ id: 's1', kind: 'clue', score: 18, text: 'Forged the blade', patronId: 'p1' }] }) })
    const b = c.createEntity({ boardId: g, type: 'BUILDING', name: 'Smithy', position: at })
    c.moveSecret({ secretId: 's1', from: a.id, to: null })
    expect(readBuilding(c.entityView(a.id).attributes).secrets).toEqual([])
    expect(c.secretPool(b.id).own.map((x) => x.text)).toEqual(['Forged the blade'])
    expect(c.secretPool(b.id).own[0].patronId).toBeUndefined()
    c.moveSecret({ secretId: 's1', from: null, to: b.id })
    expect(readBuilding(c.entityView(b.id).attributes).secrets[0].text).toBe('Forged the blade')
    expect(c.secretPool(a.id).elsewhere[0].buildingName).toBe('Smithy')
    c.undo()
    expect(c.secretPool(b.id).own).toHaveLength(1)
  })

  it('keeps a price scale for the campaign', () => {
    expect(c.info().priceScale).toBe(100)
    c.setSettings({ price_scale: 120 }, 'Changed campaign settings')
    expect(c.info().priceScale).toBe(120)
  })

  it('shows who is in a region on the map', () => {
    writeFileSync(join(dir, 'town.png'), encodePng(40, 20, new Uint8Array(40 * 20 * 3)))
    const m = c.importMap(join(dir, 'town.png'))
    const regionId = c.createRegion({ mapId: m.id, polygon: [[0, 0], [10, 0], [10, 10]], newName: 'Ironmarket' })
    c.createEntity({ boardId: g, type: 'BUILDING', name: 'Honest Edge', position: at, attributes: { location: 'Ironmarket' } })
    c.createEntity({ boardId: g, type: 'NPC', name: 'Brannoc', position: at, attributes: { location: 'Honest Edge' } })
    c.createEntity({ boardId: g, type: 'MONSTER', name: 'Rat swarm', position: at, attributes: { location: 'Ironmarket' } })
    const r = c.mapScreen(m.id).regions.find((x) => x.id === regionId)!
    expect(r.occupants).toEqual(['Brannoc', 'Rat swarm'])
    expect(c.regionDetail(regionId).hereNow.map((x) => x.name)).toContain('Brannoc')
  })
})

describe('sketch', () => {
  it('draws rooms, resizes and reads back safely', () => {
    let s = paint(emptySketch(10, 6), roomCells(1, 1, 4, 3))
    expect(s.cells.slice(10, 16)).toBe(' #### ')
    expect(s.cells.slice(20, 26)).toBe(' #..# ')
    s = resize({ ...s, labels: [{ x: 9, y: 5, t: 'gone' }, { x: 2, y: 2, t: 'Bar' }] }, 6, 6)
    expect(s.cols).toBe(6)
    expect(s.labels.map((l) => l.t)).toEqual(['Bar'])
    expect(readSketch({ cols: 2, rows: 2, cells: '' })).toBeNull()
    expect(readSketch({ cols: 5, rows: 5, cells: '#' })!.cells).toHaveLength(25)
  })

  it('tells the image AI to follow the plan as a blueprint', () => {
    const s = { ...paint(emptySketch(8, 5), [...roomCells(0, 0, 7, 4), [3, 4, 'D'], [2, 2, 'x']]), labels: [{ x: 1, y: 1, t: 'Mill' }] }
    const t = blueprintText(s, { labels: false, markers: false })
    expect(t).toMatch(/BLUEPRINT/)
    expect(t).toContain('8 squares across and 5 squares deep')
    expect(t).toContain('"Mill" at column 2, row 2')
    expect(t).toContain(' 5|###D####|')
    expect(t).toMatch(/do not draw them/)
    expect(t).toMatch(/Do not write the labels/)
  })
})

describe('building AI', () => {
  it('asks for the name story and campaign ties, and reads the answer', () => {
    const prompt = buildingPrompt({ campaignName: 'Saltmere', name: 'The Drowned Lantern', kind: 'tavern', where: 'Saltmere Docks', known: [], cards: ['Bog Wight (monster): haunts the lighthouse'] }, '')
    expect(prompt).toContain('how The Drowned Lantern got its name')
    expect(prompt).toContain('Bog Wight')
    const reply = JSON.stringify({
      description: 'Low beams.', history: 'Named for a lantern.', floors: ['Upper floor'],
      keeper: { name: 'Old Maud', role: 'barkeeper', desc: 'glass eye', knows: 'Vey drinks here' },
      patrons: [{ name: 'Hobb', role: 'dockhand', desc: 'asleep', knows: '', floor: 'main' }],
      secrets: [{ who: 'Old Maud', kind: 'clue', score: 17, text: 'Cargo in the cellar' }, { who: 'Hobb', kind: 'rumour', score: 40, text: 'Asleep since Tuesday' }],
      rooms: [{ no: '1', name: "Captain's Room", price: '2 gp', status: 'taken', who: 'Anselme', floor: 'Upper floor' }],
      stock: [{ name: 'Ale (mug)', notes: '', qty: null, price: '' }, { name: 'Grog', qty: 6, price: '5 sp' }],
      layout: { main: [{ name: 'Taproom', x: 0, y: 0, w: 12, h: 8, doors: [[5, 7]] }], 'Upper floor': [{ name: 'Room 1', x: 0, y: 0, w: 4, h: 4 }] }
    })
    const p = parseBuilding(reply, 'tavern')
    const b = p.building
    expect(p.history).toBe('Named for a lantern.')
    expect(b.floors!.map((f) => f.name)).toEqual(['Main floor', 'Upper floor'])
    expect(b.patrons![0]).toMatchObject({ name: 'Old Maud', keeper: true })
    expect(b.secrets![0].patronId).toBe(b.patrons![0].id)
    expect(b.secrets![1].score).toBe(20)
    expect(b.rooms![0]).toMatchObject({ price: 200, status: 'taken', floor: b.floors![1].id })
    expect(b.stock!.map((s) => s.price)).toEqual([4, 50])
    expect(b.floors![0].layout!.labels[0].t).toBe('Taproom')
    expect(b.floors![0].layout!.cells[7 * 20 + 5]).toBe('D')
    expect(b.floors![1].layout).toBeTruthy()
  })
})
