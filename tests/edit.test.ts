import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Campaign } from '../src/main/campaign/campaign'

let dir: string
let c: Campaign

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dungeonzen-'))
  c = Campaign.create(join(dir, 'Edit test'), 'Edit test')
})
afterEach(() => {
  c.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('the DM can change everything', () => {
  it('changes campaign name, rules edition and moon phase in one undoable step', () => {
    c.setSettings({ name: 'Renamed', rules_edition: '2014', moon_offset_days: -6 }, 'Changed campaign settings')
    expect(c.info()).toMatchObject({ name: 'Renamed', rulesEdition: '2014' })
    expect(c.desk().moonOffsetDays).toBe(-6)
    c.undo()
    expect(c.info()).toMatchObject({ name: 'Edit test', rulesEdition: '2024' })
    expect(c.desk().moonOffsetDays).toBe(0)
  })

  it('sets the clock to an exact time', () => {
    c.setClock(3 * 1440 + 22 * 60 + 15)
    expect(c.info().clockMin).toBe(5655)
    expect(c.history().log[0].label).toBe('Set the clock to Day 4 · 22:15')
  })

  it('edits a storyline and renames its board view', () => {
    const b = c.createStoryline('Old title')
    c.updateStoryline(b.storylineId!, { title: 'The Drowned Bell', status: 'player_active', isMajor: true, emblem: 'moon' })
    const view = c.boardView(b.id)
    expect(view.board).toMatchObject({
      name: 'The Drowned Bell',
      storyline: { title: 'The Drowned Bell', status: 'player_active', isMajor: true, emblem: 'moon' }
    })
    expect(c.desk().storylines[0]).toMatchObject({ title: 'The Drowned Bell', emblem: 'moon', isMajor: true })
  })

  it('moves a storyline to History and restores it, keeping its cards', () => {
    const b = c.createStoryline('Heist')
    const npc = c.createEntity({ boardId: b.id, type: 'NPC', name: 'Fence', position: { x: 0, y: 0 } })
    c.setStorylineRemoved(b.storylineId!, true)
    expect(c.desk().storylines).toEqual([])
    expect(c.boardView(c.info().globalBoardId).boards.map((x) => x.name)).toEqual(['Global'])
    expect(c.history().removedStorylines).toEqual([{ storylineId: b.storylineId, title: 'Heist' }])
    expect(c.entityView(npc.id).status).toBe('active')
    c.setStorylineRemoved(b.storylineId!, false)
    expect(c.desk().storylines.map((s) => s.title)).toEqual(['Heist'])
  })

  it('renames, removes and restores maps', () => {
    const src = join(dir, 'region.png')
    const png = Buffer.alloc(24); png.write('\x89PNG\r\n\x1a\n', 0, 'latin1'); png.writeUInt32BE(10, 16); png.writeUInt32BE(10, 20)
    writeFileSync(src, png)
    const m = c.importMap(src)
    c.renameMap(m.id, 'The Mistreach')
    expect(c.desk().map?.name).toBe('The Mistreach')
    c.setMapStatus(m.id, 'defunct')
    expect(c.desk().map).toBeNull()
    expect(c.history().removedMaps).toEqual([{ id: m.id, name: 'The Mistreach' }])
    c.setMapStatus(m.id, 'active')
    expect(c.desk().map?.id).toBe(m.id)
  })

  it('keeps custom fields and a card colour on an entity', () => {
    const e = c.createEntity({ boardId: c.info().globalBoardId, type: 'ITEM', name: 'Bell', position: { x: 0, y: 0 } })
    c.updateEntity(e.id, { attributes: { colour: '#aa3355', custom: [{ label: 'Weight', value: '2 tons' }] } })
    expect(c.entityView(e.id).attributes).toMatchObject({ colour: '#aa3355', custom: [{ label: 'Weight', value: '2 tons' }] })
  })
})
