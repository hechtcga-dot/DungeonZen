import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Campaign } from '../src/main/campaign/campaign'
import { searchSrd, srdCopy } from '../src/main/srd'
import { crToNumber, emptyStatBlock, leadingNumber, statLine } from '../src/shared/statblock'

let dir: string
let c: Campaign
let g: string
const at = { x: 0, y: 0 }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dungeonzen-'))
  c = Campaign.create(join(dir, 'Sheet test'), 'Sheet test')
  g = c.info().globalBoardId
})
afterEach(() => {
  c.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('stat block helpers', () => {
  it('reads challenge ratings and leading numbers', () => {
    expect(crToNumber('1/4')).toBe(0.25)
    expect(crToNumber('10')).toBe(10)
    expect(crToNumber('')).toBeNull()
    expect(leadingNumber('82 (11d8 + 33)')).toBe(82)
  })

  it('builds a card line from a stat block', () => {
    const sb = { ...emptyStatBlock(), size: 'Medium', creatureType: 'fiend', cr: '1', hp: '82 (11d8 + 33)', ac: '10 (scale mail)' }
    expect(statLine(sb)).toBe('Medium fiend · CR 1 · HP 82 · AC 10')
  })
})

describe('entity sheet', () => {
  it('saves a stat block and rejects an invalid one', () => {
    const npc = c.createEntity({ boardId: g, type: 'NPC', name: 'Ciaf Crol', position: at })
    c.updateEntity(npc.id, { attributes: { statblock: { ...emptyStatBlock(), str: 18, cr: '1' } } })
    expect(c.sheet(npc.id).entity.attributes.statblock).toMatchObject({ str: 18, cr: '1' })
    expect(() => c.updateEntity(npc.id, { attributes: { statblock: { str: 99 } } })).toThrow()
  })

  it('adds, edits, removes and restores abilities with undo', () => {
    const npc = c.createEntity({ boardId: g, type: 'NPC', name: 'Ciaf Crol', position: at })
    const bite = c.addAbility(npc.id, { name: 'Bite', macroText: '/r 1d20+4' })
    c.addAbility(npc.id, { name: 'Claw' })
    c.updateAbility(bite.id, { showMacroBar: true })
    expect(c.sheet(npc.id).abilities.map((a) => [a.name, a.showMacroBar])).toEqual([['Bite', true], ['Claw', false]])
    c.setAbilityStatus(bite.id, 'defunct')
    expect(c.sheet(npc.id).abilities.map((a) => a.name)).toEqual(['Claw'])
    c.undo()
    expect(c.sheet(npc.id).abilities.map((a) => a.name)).toEqual(['Bite', 'Claw'])
  })

  it('tracks what the party knows per field and per string', () => {
    const a = c.createEntity({ boardId: g, type: 'NPC', name: 'A', position: at })
    const b = c.createEntity({ boardId: g, type: 'NPC', name: 'B', position: at })
    const r = c.createRelationship({ sourceId: a.id, targetId: b.id, type: 'KNOWS', isSecret: true })
    c.setPartyKnows(a.id, 'location', true)
    c.setStringKnown(r.id, true)
    let sheet = c.sheet(a.id)
    expect(sheet.partyKnows).toMatchObject({ name: false, location: true })
    expect(sheet.connections).toMatchObject([{ other: { name: 'B' }, outgoing: true, partyKnows: true }])
    expect(c.sheet(b.id).connections).toMatchObject([{ other: { name: 'A' }, outgoing: false }])

    c.setPartyKnows(a.id, 'location', false)
    c.setPartyKnows(a.id, 'location', true) // reuses the row, not a new one
    c.setStringKnown(r.id, false)
    sheet = c.sheet(a.id)
    expect(sheet.partyKnows.location).toBe(true)
    expect(sheet.connections[0].partyKnows).toBe(false)
  })

  it('duplicates an entity with its abilities but not its strings', () => {
    const a = c.createEntity({ boardId: g, type: 'MONSTER', name: 'Ghoul', position: { x: 100, y: 100 } })
    const b = c.createEntity({ boardId: g, type: 'NPC', name: 'B', position: at })
    c.addAbility(a.id, { name: 'Bite' })
    c.updateEntity(a.id, { tags: ['undead'], attributes: { location: 'Crypt' } })
    c.createRelationship({ sourceId: a.id, targetId: b.id, type: 'KNOWS', isSecret: false })
    const copy = c.duplicateEntity(a.id)
    const sheet = c.sheet(copy.id)
    expect(sheet.entity).toMatchObject({ name: 'Ghoul (copy)', tags: ['undead'], attributes: { location: 'Crypt' } })
    expect(sheet.abilities.map((x) => x.name)).toEqual(['Bite'])
    expect(sheet.connections).toEqual([])
    expect(c.boardView(g).items.find((i) => i.entityId === copy.id)).toMatchObject({ x: 140, y: 140 })
    expect(c.undo()).toBe('Duplicated Ghoul')
  })
})

describe('library search', () => {
  it('filters by text, type, tag, challenge and hit points', () => {
    const ghoul = c.createEntity({ boardId: g, type: 'MONSTER', name: 'Ghoul', position: at })
    c.updateEntity(ghoul.id, { tags: ['undead'], attributes: { statblock: { ...emptyStatBlock(), cr: '1', hp: '22 (5d8)' } } })
    const npc = c.createEntity({ boardId: g, type: 'NPC', name: 'Ciaf Crol', position: at })
    c.updateEntity(npc.id, { attributes: { location: 'District C' } })
    c.addAbility(npc.id, { name: 'Hellfire Bolt' })
    const gone = c.createEntity({ boardId: g, type: 'MONSTER', name: 'Removed ghoul', position: at })
    c.setEntityStatus(gone.id, 'defunct')

    const names = (f: Parameters<Campaign['search']>[0]) => c.search(f).results.map((r) => r.entity.name)
    expect(names({ query: '' })).toEqual(['Ciaf Crol', 'Ghoul'])
    expect(names({ query: 'district' })).toEqual(['Ciaf Crol'])
    expect(names({ query: 'hellfire' })).toEqual(['Ciaf Crol'])
    expect(names({ query: '', type: 'MONSTER' })).toEqual(['Ghoul'])
    expect(names({ query: '', tag: 'undead' })).toEqual(['Ghoul'])
    expect(names({ query: '', crMin: 1, crMax: 2 })).toEqual(['Ghoul'])
    expect(names({ query: '', hpMin: 30 })).toEqual([])
    expect(c.search({ query: '' }).tags).toEqual(['undead'])
    expect(c.search({ query: 'ghoul' }).results[0].line).toBe('CR 1 · HP 22')
  })
})

describe('SRD 5.2 content', () => {
  it('finds monsters by name, type and challenge', () => {
    const r = searchSrd({ query: 'ghoul', kind: 'monsters' })
    expect(r.monsters.map((m) => m.name)).toContain('Ghoul')
    expect(r.items).toEqual([])
    const undead = searchSrd({ query: 'undead', kind: 'monsters', crMax: 0.25 })
    expect(undead.monsters.length).toBeGreaterThan(0)
    expect(undead.monsters.every((m) => (crToNumber(m.cr) ?? 99) <= 0.25)).toBe(true)
    expect(r.attribution).toMatch(/Creative Commons Attribution 4\.0/)
  })

  it('finds items', () => {
    const r = searchSrd({ query: 'amulet of health', kind: 'items' })
    expect(r.items).toMatchObject([{ name: 'Amulet of Health', magic: true }])
  })

  it('copies a monster into the campaign with its actions as abilities', () => {
    const key = searchSrd({ query: 'ghoul', kind: 'monsters' }).monsters.find((m) => m.name === 'Ghoul')!.key
    const copy = srdCopy(key)
    const e = c.createEntity({ ...copy, boardId: g, position: c.freeGlobalSpot(), label: 'Added Ghoul from the SRD 5.2' })
    const sheet = c.sheet(e.id)
    expect(sheet.entity.type).toBe('MONSTER')
    expect(sheet.entity.attributes.statblock).toMatchObject({ cr: '1', creatureType: 'undead' })
    expect(sheet.entity.attributes.source).toMatchObject({ name: 'SRD 5.2', key })
    expect(sheet.abilities.map((a) => a.name)).toEqual(['Multiattack', 'Bite', 'Claw'])
    expect(sheet.abilities[1].macroText).toContain('[[1d20+4]]')
    c.undo()
    expect(c.search({ query: '' }).results).toEqual([])
  })

  it('places copies on free spots, not on top of each other', () => {
    const key = searchSrd({ query: 'ghoul', kind: 'monsters' }).monsters[0].key
    for (let i = 0; i < 3; i++) c.createEntity({ ...srdCopy(key), boardId: g, position: c.freeGlobalSpot() })
    const spots = c.boardView(g).items.map((i) => `${i.x},${i.y}`)
    expect(new Set(spots).size).toBe(3)
  })
})
