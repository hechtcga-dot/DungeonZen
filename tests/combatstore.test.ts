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
