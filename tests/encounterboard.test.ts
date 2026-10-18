import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Campaign } from '../src/main/campaign/campaign'

let dir: string
let c: Campaign
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dungeonzen-'))
  c = Campaign.create(join(dir, 'Enc board'), 'Enc board')
})
afterEach(() => { c.close(); rmSync(dir, { recursive: true, force: true }) })

const onGlobal = (id: string) => c.boardView(c.boards()[0].id).items.some((i) => i.entityId === id)

describe('encounters on the board (owner, 2026-10-18)', () => {
  it('stay off the board until put there; undo takes the card back off', () => {
    const id = c.createEncounter({ name: 'Ambush' })
    expect(onGlobal(id)).toBe(false)
    expect(c.encounterView(id).onBoard).toBe(false)
    c.encounterToBoard(id)
    expect(onGlobal(id)).toBe(true)
    expect(c.encounterView(id).onBoard).toBe(true)
    c.undo()
    expect(onGlobal(id)).toBe(false)
  })

  it('prep: Add a scene › Encounter makes an encounter and its scene line, edited from either side', () => {
    const prepId = c.createPrep(1)
    const rowId = c.addPrepEncounter(prepId)
    const row = c.prepView(prepId).items.find((i) => i.id === rowId)!
    expect(row).toMatchObject({ kind: 'scene', sceneType: 'combat', title: 'New encounter', encounter: { name: 'New encounter', target: 'moderate', creatures: 0 } })
    expect(c.encountersView().encounters.map((e) => e.id)).toContain(row.entityId)
    expect(onGlobal(row.entityId!)).toBe(false)
    c.updateEncounter(row.entityId!, { name: 'Bridge toll', scene: 'Trolls want a song.' })
    expect(c.prepView(prepId).items.find((i) => i.id === rowId)).toMatchObject({ title: 'Bridge toll', body: 'Trolls want a song.' })
    c.undo(); c.undo()
    expect(c.prepView(prepId).items.some((i) => i.id === rowId)).toBe(false)
  })
})

describe('session dates (owner, 2026-10-18)', () => {
  it('a session date sits on its prep sheet, made if missing; Save as notes file goes to Sessions with the label', () => {
    c.setSessionDate(2, '2026-10-24')
    const p = c.prepFor(2)!
    expect(p.playDate).toBe('2026-10-24')
    c.updatePrep(p.id, { title: 'The Drowned Bell' })
    const id = c.savePrepNote(p.id, 'Session 2 · The Drowned Bell · Oct 24, 2026', Buffer.from('x'))
    expect(c.notesScreen().docs.find((d) => d.id === id)).toMatchObject({ folder: 'Sessions', title: 'Session 2 · The Drowned Bell · Oct 24, 2026' })
    c.undo(); c.undo(); c.undo()
    expect(c.prepFor(2)).toBeNull()
  })
})
