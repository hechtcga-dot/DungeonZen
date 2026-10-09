import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Campaign } from '../src/main/campaign/campaign'
import { encodePng } from '../src/main/png'
import { srdCopy } from '../src/main/srd'
import { parseStatBlock, statBlockPrompt } from '../src/main/ai/statblock'

let dir: string
let c: Campaign
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dz-fight-')); c = Campaign.create(join(dir, 'Camp'), 'Fight') })
afterEach(() => { c.close(); rmSync(dir, { recursive: true, force: true }) })

const captain = () => {
  const s = srdCopy('srd-2024_bandit-captain')
  return c.createEntity({ boardId: c.info().globalBoardId, type: 'NPC', name: 'Captain Ahab', position: { x: 0, y: 0 }, attributes: s.attributes, abilities: s.abilities })
}

describe('monster sheet', () => {
  it('raises and lowers the CR, actions too, as one undo step', () => {
    const e = captain()
    c.scaleCr(e.id, '5')
    const s = c.sheet(e.id)
    expect((s.entity.attributes.statblock as { cr: string }).cr).toBe('5')
    expect(s.abilities.find((a) => a.name === 'Scimitar')!.description).toMatch(/Attack Roll: \+8/)
    c.undo()
    expect((c.sheet(e.id).entity.attributes.statblock as { cr: string }).cr).toBe('2')
  })

  it('puts an approved AI stat block on the card; the old actions go to History', () => {
    const e = captain()
    const answer = parseStatBlock(JSON.stringify({
      statblock: { size: 'Medium', creatureType: 'humanoid', ac: 14, hp: '45', str: 40, dex: 'x', cr: '3', traits: [{ name: 'Sea Legs', desc: 'Never falls prone on a ship.' }] },
      actions: [{ name: 'Cutlass', kind: 'ACTION', desc: 'Melee Attack Roll: +5, reach 5 ft. 7 (1d8 + 3) Slashing damage.' }, { name: 'Parrot', kind: 'WEIRD', desc: 'Pecks.' }]
    }))
    expect(answer.statblock).toMatchObject({ ac: '14', str: 30, dex: 10, cr: '3' })
    expect(answer.actions.map((a) => a.kind)).toEqual(['ACTION', 'ACTION'])
    c.applyStatBlock(e.id, answer.statblock, answer.actions, 'Ollama · test')
    const s = c.sheet(e.id)
    expect(s.abilities.map((a) => a.name)).toEqual(['Cutlass', 'Parrot'])
    expect((s.entity.attributes.ai_filled as Record<string, string>).statblock).toBe('Ollama · test')
    expect(statBlockPrompt(s, { description: 'pirate', cr: '3', size: '', creatureType: '', role: 'Brute' })).toContain('challenge rating 3; role in a fight: Brute')
    c.undo()
    expect(c.sheet(e.id).abilities.some((a) => a.name === 'Scimitar')).toBe(true)
  })

  it('sets and removes a picture', () => {
    const e = captain()
    writeFileSync(join(dir, 'face.png'), encodePng(8, 8, new Uint8Array(8 * 8 * 3)))
    c.setPicture(e.id, { file: join(dir, 'face.png') })
    const pic = c.sheet(e.id).entity.attributes.picture as string
    expect(pic).toMatch(/^pictures\/.+\.png$/)
    expect(c.assetFile(pic)).not.toBeNull()
    c.setPicture(e.id, null)
    expect(c.sheet(e.id).entity.attributes.picture).toBeNull()
  })
})
