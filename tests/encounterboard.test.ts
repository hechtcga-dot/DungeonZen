import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { Campaign } from '../src/main/campaign/campaign'
import { MIGRATIONS } from '../src/main/db/open'

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

describe('encounter card type and Add to prep sheet (owner, 2026-10-21)', () => {
  it('Add to prep sheet: a Likely scene on the next sheet (started if missing), once per sheet, one undo step', () => {
    const id = c.createEncounter({ name: 'Ford ambush' })
    expect(c.entityRow(id).type).toBe('ENCOUNTER')
    expect(c.encounterToPrep(id)).toEqual({ number: 1, added: true })
    const row = c.prepFor(1)!.items.find((i) => i.entityId === id)!
    expect(row).toMatchObject({ kind: 'scene', sceneType: 'combat', title: 'Ford ambush' })
    expect(c.encounterToPrep(id)).toEqual({ number: 1, added: false })
    const other = c.createPrep(3)
    expect(c.encounterToPrep(id, other)).toEqual({ number: 3, added: true })
    c.undo(); c.undo(); c.undo()
    expect(c.prepFor(1)).toBeNull()
  })

  it('a prep row can be tied to another encounter', () => {
    const prepId = c.createPrep(1)
    const rowId = c.addPrepEncounter(prepId)
    const other = c.createEncounter({ name: 'Wolves' })
    c.updatePrepItem(rowId, { entityId: other })
    expect(c.prepView(prepId).items.find((i) => i.id === rowId)).toMatchObject({ title: 'Wolves', encounter: { name: 'Wolves' } })
  })

  it('upgrade: old Scene encounters (flag or "Encounter…" name) become Encounter cards, other scenes stay', () => {
    const g = c.info().globalBoardId
    const flagged = c.createEncounter({ name: 'Ambush' })
    const named = c.createEntity({ boardId: g, type: 'SCENE', name: 'Encounter: wolves', position: { x: 0, y: 0 } }).id
    const scene = c.createEntity({ boardId: g, type: 'SCENE', name: 'Encountered a bard', position: { x: 0, y: 0 } }).id
    c.close()
    const folder = join(dir, 'Enc board')
    const db = new Database(join(folder, 'campaign.db'))
    db.prepare(`UPDATE entity SET type = 'SCENE', attributes = json_set(attributes, '$.encounter', json('true')) WHERE id = ?`).run(flagged)
    db.prepare(`UPDATE entity SET type = 'SCENE' WHERE id = ?`).run(named)
    // The upgrade step itself (later steps already ran on this new campaign).
    db.exec(MIGRATIONS.find((m) => m.includes("type = 'ENCOUNTER'"))!)
    db.close()
    c = Campaign.open(folder)
    expect([flagged, named, scene].map((id) => c.entityRow(id).type)).toEqual(['ENCOUNTER', 'ENCOUNTER', 'SCENE'])
    expect(c.entityRow(flagged).attributes.encounter).toBeUndefined()
    expect(c.encountersView().encounters.map((e) => e.name).sort()).toEqual(['Ambush', 'Encounter: wolves'])
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
