import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { Campaign } from '../src/main/campaign/campaign'
import { srdCopy } from '../src/main/srd'
import { changeHp, combatHints } from '../src/shared/combat'

let dir: string
let c: Campaign
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dz-cmb-')); c = Campaign.create(join(dir, 'Camp'), 'Fight') })
afterEach(() => { c.close(); rmSync(dir, { recursive: true, force: true }) })

it('runs an encounter: party then foes, numbered copies, undoable changes, one fight at a time', () => {
  c.createEntity({ boardId: c.info().globalBoardId, type: 'PC', name: 'Mira', position: { x: 0, y: 0 }, attributes: { statblock: { hp: '24', ac: '15' }, hp_current: 20 } })
  const enc = c.createEncounter({ name: 'Gate' })
  c.addSrdToEncounter(enc, [{ key: 'srd-2024_guard', count: 3 }, { key: 'srd-2024_guard-captain', count: 1 }], srdCopy)
  const id = c.startCombat(enc)
  expect(c.startCombat(enc)).toBe(id)
  const v = c.combatView(id)
  expect(v.state.combatants.map((x) => `${x.side}:${x.name}:${x.hp}`)).toEqual(['party:Mira:24', 'foe:Guard 1:11', 'foe:Guard 2:11', 'foe:Guard 3:11', 'foe:Guard Captain:75'])
  expect(Object.values(v.info).find((i) => i.leader)).toBeTruthy()
  let s = changeHp(v.state, v.state.combatants[1].id, -11)
  s = changeHp(s, v.state.combatants[2].id, -11)
  c.updateCombat(id, s, 'Guards down')
  const after = c.combatView(id)
  expect(combatHints(after.state, after.info).map((h) => h.text)).toContain('Guard: half are down, but guards hold their ground while Guard Captain still stands.')
  c.undo()
  expect(c.combatView(id).state.combatants[1].hp).toBe(11)
  c.endCombat(id)
  expect(c.combatView(id).status).toBe('ended')
  expect(c.startCombat(enc)).not.toBe(id)
})

it('follows the encounter while the fight runs, takes in new player characters, and ends with a summary', () => {
  const g = c.info().globalBoardId
  const enc = c.createEncounter({ name: 'Bridge' })
  c.addSrdToEncounter(enc, [{ key: 'srd-2024_guard', count: 1 }], srdCopy)
  const id = c.startCombat(enc)
  const names = () => c.combatView(id).state.combatants.map((x) => x.name)
  expect(names()).toEqual(['Guard'])
  c.addSrdToEncounter(enc, [{ key: 'srd-2024_guard', count: 2 }], srdCopy)
  expect(names()).toEqual(['Guard 1', 'Guard 2', 'Guard 3'])
  // Hurt Guard 1, then lower the count: the unhurt ones leave first.
  const v = c.combatView(id)
  c.updateCombat(id, changeHp(v.state, v.state.combatants[0].id, -3), 'hit')
  const row = c.encounterView(enc).creatures[0]
  c.updateEncounterCreature(row.rowId!, { count: 1 })
  expect(names()).toEqual(['Guard 1'])
  c.undo()
  expect(names()).toHaveLength(3)
  const pc = c.createEntity({ boardId: g, type: 'PC', name: 'Late Larry', position: { x: 0, y: 0 } })
  expect(c.combatView(id).state.combatants.at(-1)).toMatchObject({ name: 'Late Larry', side: 'party', entityId: pc.id })
  const guardCard = c.combatView(id).state.combatants[0].entityId!
  c.endCombat(id, { resolveIds: [guardCard], summary: 'Won at the bridge.' })
  expect(c.sheet(guardCard).entity.status).toBe('resolved')
  c.undo()
  expect(c.sheet(guardCard).entity.status).not.toBe('resolved')
})
