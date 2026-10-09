import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { Campaign } from '../src/main/campaign/campaign'
import { srdCopy, srdMonsterIndex } from '../src/main/srd'
import { buildPrompt, parseBuild } from '../src/main/ai/encounter'

let dir: string
let c: Campaign
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dz-encb-')); c = Campaign.create(join(dir, 'Camp'), 'Enc') })
afterEach(() => { c.close(); rmSync(dir, { recursive: true, force: true }) })

it('builds an encounter from an AI answer: SRD and new monsters stay off the board until put on it', () => {
  const id = c.createEncounter({ name: 'Smugglers' })
  c.updateEncounter(id, { scene: 'A ruined tower in the rain' })
  const v = c.encountersView()
  const e = v.encounters[0]
  expect(e.scene).toBe('A ruined tower in the rain')
  expect(buildPrompt(e, v, ['Bandit (1/8)'], 'one flees')).toContain('The scene: A ruined tower in the rain')
  const plan = parseBuild(JSON.stringify({
    creatures: [
      { srd: 'Bandit (CR 1/8)', count: 4, notes: 'unloading crates' },
      { srd: 'Not A Monster', count: 1 },
      { new: { name: 'Tide Witch', statblock: { cr: '3', hp: '45', ac: '13' }, actions: [{ name: 'Brine Bolt', kind: 'ACTION', desc: 'Ranged Attack Roll: +5' }] }, count: 1, notes: 'on the stair' }
    ],
    tactics: 'The witch flees at half HP.'
  }), srdMonsterIndex())
  expect(plan.creatures.map((x) => `${x.kind}:${x.name}:${x.count}`)).toEqual(['srd:Bandit:4', 'new:Tide Witch:1'])
  const items = plan.creatures.map((x) => x.kind === 'srd' ? { srdKey: x.key, name: x.name, count: x.count, notes: x.notes } : { name: x.name, count: x.count, notes: x.notes, statblock: x.statblock, actions: x.actions })
  c.addEncounterProposals(id, items, plan.tactics, 'Ollama · test', srdCopy)
  const after = c.encounterView(id)
  expect(after.creatures.map((x) => [x.name, x.count, x.stashed, x.aiMade, x.notes])).toEqual([
    ['Bandit', 4, true, false, 'unloading crates'], ['Tide Witch', 1, true, true, 'on the stair']
  ])
  expect(after.tactics).toBe('The witch flees at half HP.')
  expect(Object.values(c.boardView(c.info().globalBoardId).entities).some((x) => x.name === 'Tide Witch')).toBe(false)
  c.setEntityStatus(after.creatures[1].entityId, 'active')
  expect(Object.values(c.boardView(c.info().globalBoardId).entities).some((x) => x.name === 'Tide Witch')).toBe(true)
  c.undo(); c.undo()
  expect(c.encounterView(id).creatures).toEqual([])
})
