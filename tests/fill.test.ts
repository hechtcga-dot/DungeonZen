import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Campaign } from '../src/main/campaign/campaign'
import { srdCopy, srdMonsterIndex } from '../src/main/srd'
import { fillPrompt, parseFill } from '../src/main/ai/fill'
import { DETAIL_FIELDS, fillableFields, INTERNAL_KEYS } from '../src/shared/cardFields'
import { ENTITY_TYPES } from '../src/shared/schemas'

let dir: string
let c: Campaign
let g: string
const at = { x: 0, y: 0 }
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dz-fill-'))
  c = Campaign.create(join(dir, 'Camp'), 'The Mistreach')
  g = c.info().globalBoardId
})
afterEach(() => {
  c.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('fields per card type', () => {
  it('lists fields for every type, and never offers internal ones', () => {
    for (const t of ENTITY_TYPES) {
      const keys = fillableFields(t).map((f) => f.key)
      expect(keys[0]).toBe('summary')
      expect(keys.at(-1)).toBe('bio')
      expect(new Set(keys).size).toBe(keys.length)
      expect(keys.filter((k) => ['statblock', 'provenance', 'custom', 'notes'].includes(k))).toEqual([])
      for (const f of DETAIL_FIELDS[t]) expect(INTERNAL_KEYS.has(f.key)).toBe(false)
    }
    expect(fillableFields('QUEST').map((f) => f.key)).toContain('reward')
    expect(fillableFields('LOCATION').map((f) => f.key)).toContain('player_notes')
  })
})

describe('fill blanks with AI', () => {
  it('tells the AI the card, its strings, storylines and notes, and asks only for the chosen fields', () => {
    const ciaf = c.createEntity({ boardId: g, type: 'NPC', name: 'Ciaf Crol', position: at })
    const choir = c.createEntity({ boardId: g, type: 'FACTION', name: 'The Drowned Choir', position: at })
    c.updateEntity(ciaf.id, { attributes: { summary: 'Harbourmaster', notes: 'Secretly blackmailed', custom: [{ label: 'Debt', value: '300 gp' }] } })
    c.createRelationship({ sourceId: ciaf.id, targetId: choir.id, type: 'MEMBER_OF', isSecret: true })
    const s = c.createStoryline('The Drowned Bell')
    c.addToStoryline(ciaf.id, s.storylineId!, at)
    const sheet = c.sheet(ciaf.id)
    const fields = fillableFields('NPC').filter((f) => ['appearance', 'voice'].includes(f.key))
    const p = fillPrompt({ campaignName: 'The Mistreach', sheet, storylines: c.storylinesOf(ciaf.id), srdNames: ['Bandit (CR 1/8)', 'Noble (CR 1/8)'] }, fields, 'he is old')
    expect(p).toContain('Card: Ciaf Crol (npc).')
    expect(p).toContain('summary: Harbourmaster')
    expect(p).toContain('Ciaf Crol member of The Drowned Choir (faction, secret)')
    expect(p).toContain('Storylines: The Drowned Bell.')
    expect(p).toContain('DM notes (private; use them for consistency): Secretly blackmailed')
    expect(p).toContain("DM's own fields: Debt: 300 gp")
    expect(p).toContain('- appearance: Appearance [two to four sentences]')
    expect(p).toContain('- voice: Voice and manner (How they talk, a phrase they use) [one line]')
    expect(p).toContain('Bandit (CR 1/8), Noble (CR 1/8)')
    expect(p).toContain('The DM adds: he is old')
  })

  it('keeps only what was asked for', () => {
    const r = parseFill('```json\n{"fields": {"appearance": " Salt-white beard ", "secret": "x", "voice": ""}, "srd_base": "Noble"}\n```', ['appearance', 'voice'])
    expect(r).toEqual({ fields: { appearance: 'Salt-white beard' }, srdBase: 'Noble' })
  })

  it('uses the kept suggestions in one undo step, never over what the DM wrote, and marks them', () => {
    const ciaf = c.createEntity({ boardId: g, type: 'NPC', name: 'Ciaf Crol', position: at })
    c.updateEntity(ciaf.id, { attributes: { summary: 'Mine' } })
    const noble = srdMonsterIndex().find((m) => m.name === 'Noble')!
    const used = c.applyFill(ciaf.id, { summary: 'AI summary', appearance: 'Salt-white beard', voice: 'Speaks in sea terms', statblock: 'x' }, 'Test AI · m', srdCopy(noble.key))
    expect(used).toEqual(['appearance', 'voice', 'statblock'])
    const s = c.sheet(ciaf.id)
    expect(s.entity.attributes).toMatchObject({ summary: 'Mine', appearance: 'Salt-white beard', voice: 'Speaks in sea terms', statblock: { cr: noble.cr } })
    expect(s.entity.attributes.ai_filled).toEqual({ appearance: 'Test AI · m', voice: 'Test AI · m', statblock: 'Test AI · m, based on the SRD Noble' })
    expect(s.abilities.length).toBeGreaterThan(0)
    c.undo()
    const back = c.sheet(ciaf.id)
    expect(back.entity.attributes.appearance).toBeUndefined()
    expect(back.entity.attributes.statblock).toBeUndefined()
    expect(back.abilities).toEqual([])
  })
})
