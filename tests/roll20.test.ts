import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Campaign } from '../src/main/campaign/campaign'
import { srdCopy, srdMonsterIndex } from '../src/main/srd'
import { DUNGEON_ZEN_SCRIPT, macroFor, roll20Character, roll20Data } from '../src/main/exporters/roll20'
import { buildAttack } from '../src/shared/attacks'

// 3.0 (owner's plan, M4): what a DM pastes into Roll20 is pinned to the exact text (tests/__snapshots__/roll20.test.ts.snap).
// A change here means existing Roll20 games get different macros: change it on purpose (vitest -u) and say so in the release.

let dir: string
let c: Campaign
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dz-roll20-')); c = Campaign.create(join(dir, 'R'), 'R') })
afterEach(() => { c.close(); rmSync(dir, { recursive: true, force: true }) })

describe('Roll20 output stays exactly the same', () => {
  it('macros built from descriptions', () => {
    expect([
      macroFor({ name: 'Scimitar', macroText: '', description: 'Melee Attack Roll: +5, reach 5 ft. 6 (1d6 + 3) Slashing damage plus 3 (1d6) Fire damage.' }),
      macroFor({ name: 'Fire Breath', macroText: '', description: 'Dexterity Saving Throw: DC 13, each creature in a 15-foot Cone. Failure: 22 (4d10) Fire damage.' }),
      macroFor({ name: 'Old style', macroText: '', description: '+4 to hit. Each creature must make a DC 13 Dexterity saving throw.' }),
      macroFor({ name: 'Own', macroText: '/roll 1d6', description: 'ignored' })
    ]).toMatchSnapshot()
  })

  it('attacks and spells from the picker', () => {
    expect([
      buildAttack({ name: 'Longsword', kind: 'ACTION', toHit: 5, attackType: 'Melee', reach: 'reach 5 ft', save: null, damage: [{ dice: '1d8', bonus: 3, type: 'Slashing' }], note: '' }),
      buildAttack({ name: 'Fireball', kind: 'SPELL', header: 'Level 3 Evocation · action · 150 feet', toHit: null, reach: '20-foot-radius Sphere', save: { dc: 15, ability: 'Dexterity' }, damage: [{ dice: '8d6', bonus: 0, type: 'Fire' }], note: 'Half damage on a success.' }),
      buildAttack({ name: 'Cure Wounds', kind: 'SPELL', toHit: null, reach: 'touch', save: null, damage: [{ dice: '2d8', bonus: 3, type: 'Healing' }], note: '' })
    ]).toMatchSnapshot()
  })

  it('a character, the import data and the API script', () => {
    const key = srdMonsterIndex().find((m) => m.name === 'Ghoul')!.key
    const ghoul = c.createEntity({ boardId: c.info().globalBoardId, ...srdCopy(key), position: { x: 0, y: 0 } })
    const s = c.sheet(ghoul.id)
    const ch = roll20Character(s.entity, s.abilities)
    expect(ch).toMatchSnapshot()
    expect(roll20Data([ch])).toMatchSnapshot()
    expect(DUNGEON_ZEN_SCRIPT).toMatchSnapshot()
  })
})
