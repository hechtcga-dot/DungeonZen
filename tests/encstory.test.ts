import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Campaign } from '../src/main/campaign/campaign'
import { seededRng, suggestThemed } from '../src/main/generators'
import { landsFromWords, THEMES } from '../src/main/encounterThemes'
import { srdCopy, srdMonsterIndex } from '../src/main/srd'
import { parseDraft } from '../src/main/ai/encounter'
import { emptyStory, itemTree, withContents } from '../src/shared/encounterStory'

let dir: string
let c: Campaign
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dungeonzen-'))
  c = Campaign.create(join(dir, 'Story test'), 'Story test')
})
afterEach(() => {
  c.close()
  rmSync(dir, { recursive: true, force: true })
})
const index = srdMonsterIndex()
const key = (name: string) => index.find((m) => m.name === name)!.key

describe('themed encounters', () => {
  it('names only real SRD monsters', () => {
    const names = new Set(index.map((m) => m.name))
    for (const t of THEMES) for (const n of [...t.leaders, ...t.troops]) expect(names.has(n), `${t.name}: ${n}`).toBe(true)
  })
  it('rolls one family with a leader for the land, within the budget', () => {
    for (let s = 1; s < 30; s++) {
      const e = suggestThemed(seededRng(s), index, 3, 4, 'moderate', { lands: ['farmland'] })!
      const theme = THEMES.find((t) => t.name === e.theme)!
      expect(theme.lands).toContain('farmland')
      for (const g of e.groups) expect([...theme.leaders, ...theme.troops]).toContain(g.name)
      expect(e.groups.length).toBeLessThanOrEqual(5)
      expect(e.totalXp).toBeLessThanOrEqual(e.budget)
    }
  })
  it('follows the included cards and typed places', () => {
    const e = suggestThemed(seededRng(4), index, 5, 4, 'high', { lands: [], includeNames: ['Worg'], spentXp: 100 })!
    expect(THEMES.find((t) => t.name === e.theme)!.troops).toContain('Worg')
    expect(landsFromWords('Abandoned village')).toEqual(['settlement', 'dungeon'])
    expect(landsFromWords('open field')).toEqual(['grassland'])
  })
})

describe('encounter story and builder', () => {
  it('keeps a draft as one undoable encounter with place, scene, creatures and story', () => {
    const g = c.info().globalBoardId
    const place = c.createEntity({ boardId: g, type: 'LOCATION', name: 'The Crossroads', position: { x: 0, y: 0 } }).id
    const worg = c.createEntity({ boardId: g, type: 'MONSTER', name: 'Worg', position: { x: 0, y: 0 } }).id
    const story = { ...emptyStory(), npcs: [{ id: 'n1', name: 'Miller Acerman', entityId: null, notes: 'under the cart' }] }
    const id = c.keepEncounterDraft({
      name: 'Goblin ambush!', scene: 'An overturned cart.', difficulty: 'moderate', locationId: place,
      groups: [{ key: key('Goblin Warrior'), count: 6, notes: 'archers' }], include: [{ entityId: worg, count: 1 }], story, tactics: 'Shoot, then run.'
    }, false, srdCopy)
    const e = c.encounterView(id)
    expect(e).toMatchObject({ name: 'Goblin ambush!', scene: 'An overturned cart.', locationName: 'The Crossroads', tactics: 'Shoot, then run.' })
    expect(e.creatures.map((x) => [x.name, x.count, x.notes])).toEqual([['Goblin Warrior', 6, 'archers'], ['Worg', 1, '']])
    expect(e.story.npcs[0].name).toBe('Miller Acerman')
    expect(c.encountersView().encounters.map((x) => x.id)).toContain(id)
    c.undo()
    expect(c.encountersView().encounters.map((x) => x.id)).not.toContain(id)
  })

  it('raises a CR as a copy for this encounter only, and changes that copy after', () => {
    const id = c.createEncounter({ name: 'Ambush' })
    c.addSrdToEncounter(id, [{ key: key('Goblin Boss'), count: 1 }], srdCopy)
    const original = c.encounterView(id).creatures[0]
    c.adjustEncounterCr(id, [original.entityId], 1)
    const raised = c.encounterView(id).creatures[0]
    expect(raised.entityId).not.toBe(original.entityId)
    expect(raised).toMatchObject({ name: 'Goblin Boss (CR 2)', cr: '2', stashed: true })
    expect(c.encounterView(id).creatures).toHaveLength(1)
    c.adjustEncounterCr(id, [raised.entityId], 1)
    expect(c.encounterView(id).creatures[0]).toMatchObject({ entityId: raised.entityId, name: 'Goblin Boss (CR 3)', cr: '3' })
    c.undo(); c.undo()
    expect(c.encounterView(id).creatures[0]).toMatchObject({ entityId: original.entityId, cr: '1' })
  })

  it('makes a card from a story item and keeps the line', () => {
    const id = c.createEncounter({ name: 'Ambush' })
    c.updateEncounter(id, { story: { ...emptyStory(), items: [{ id: 'cart', name: 'Cart', count: 1, notes: 'overturned', parentId: null, entityId: null }, { id: 'wine', name: 'Wine', count: 5, notes: '', parentId: 'cart', entityId: null }] } })
    const card = c.encounterStoryCard(id, 'item', 'wine')
    expect(c.encounterView(id).story.items.find((x) => x.id === 'wine')!.entityId).toBe(card)
    expect(c.sheet(card).entity).toMatchObject({ type: 'ITEM', name: 'Wine' })
    const items = c.encounterView(id).story.items
    expect(itemTree(items).map((x) => [x.item.name, x.depth])).toEqual([['Cart', 0], ['Wine', 1]])
    expect([...withContents(items, 'cart')]).toEqual(['cart', 'wine'])
  })

  it('reads an AI draft: SRD names, nested items, NPC cards, secrets by number', () => {
    const reply = JSON.stringify({
      name: 'Goblin ambush!', scene: 'A cart.', creatures: [{ srd: 'Goblin Boss', count: 1 }, { srd: 'Not a monster', count: 2 }],
      npcs: [{ name: 'miller acerman', notes: 'hiding' }],
      items: [{ name: 'Cart', count: 1, inside: [{ name: 'Crates', count: 3, inside: [{ name: 'Wine', count: 5 }] }] }],
      checks: [{ skill: 'perception', tiers: [{ dc: 5, text: 'Quiet.' }, { dc: '20+', text: 'Small helmets.' }] }],
      rewards: { gold: '25 gp', items: 'wine', secrets: [2] }
    })
    const d = parseDraft(reply, index, [{ id: 'm1', name: 'Miller Acerman' }], ['s1', 's2'])
    expect(d.creatures.map((x) => x.name)).toEqual(['Goblin Boss'])
    expect(d.story.npcs[0].entityId).toBe('m1')
    expect(itemTree(d.story.items).map((x) => `${x.depth}${x.item.name}`)).toEqual(['0Cart', '1Crates', '2Wine'])
    expect(d.story.checks[0]).toMatchObject({ skill: 'Perception', tiers: [{ dc: '5', text: 'Quiet.' }, { dc: '20+', text: 'Small helmets.' }] })
    expect(d.story.rewards).toEqual({ gold: '25 gp', items: 'wine', secretIds: ['s2'] })
  })
})
