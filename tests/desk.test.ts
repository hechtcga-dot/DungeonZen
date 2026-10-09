import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Campaign } from '../src/main/campaign/campaign'
import { emptyStatBlock } from '../src/shared/statblock'

let dir: string
let c: Campaign
let g: string

function png(width: number, height: number): Buffer {
  const b = Buffer.alloc(24)
  b.write('\x89PNG\r\n\x1a\n', 0, 'latin1')
  b.writeUInt32BE(width, 16)
  b.writeUInt32BE(height, 20)
  return b
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dungeonzen-'))
  c = Campaign.create(join(dir, 'Desk test'), 'Desk test')
  g = c.info().globalBoardId
})
afterEach(() => {
  c.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('maps', () => {
  it('copies an imported map into the campaign and makes it the desk map', () => {
    const src = join(dir, 'Sword Coast.png')
    writeFileSync(src, png(2000, 1400))
    const m = c.importMap(src)
    expect(m).toMatchObject({ name: 'Sword Coast', width: 2000, height: 1400 })
    expect(m.url).toMatch(/^dz-asset:\/\/campaign\/maps\/.+\.png$/)
    const rel = m.url.replace('dz-asset://campaign/', '')
    expect(existsSync(c.assetFile(rel)!)).toBe(true)
    expect(c.desk().map?.id).toBe(m.id)
    c.undo()
    expect(c.desk().map).toBeNull()
  })

  it('refuses files that are not images and paths outside the assets folder', () => {
    const src = join(dir, 'notes.txt')
    writeFileSync(src, 'hi')
    expect(() => c.importMap(src)).toThrow(/PNG, JPEG/)
    expect(c.assetFile('../campaign.db')).toBeNull()
    expect(c.assetFile('maps/../../campaign.db')).toBeNull()
    expect(c.assetFile('C:/Windows/win.ini')).toBeNull()
  })
})

describe('desk', () => {
  it('lists storylines, the party and DM notes', () => {
    const sb = c.createStoryline('The Bell Tower')
    c.createEntity({ boardId: sb.id, type: 'NPC', name: 'Bell ringer', position: { x: 0, y: 0 } })
    const pc = c.createEntity({ boardId: g, type: 'PC', name: 'Ilsa', position: { x: 300, y: 0 } })
    c.updateEntity(pc.id, { attributes: { summary: 'Human cleric 3', statblock: { ...emptyStatBlock(), ac: '18 (chain mail)', hp: '24', wis: 16 } } })
    c.setSetting('dm_notes', 'Remember the bell.', 'Edited DM notes')
    const d = c.desk()
    expect(d.storylines).toMatchObject([{ title: 'The Bell Tower', cardCount: 1 }])
    expect(d.party).toEqual([{
      id: pc.id, name: 'Ilsa', summary: 'Human cleric 3', ac: '18', hp: '24', passivePerception: 13, colour: null,
      currentHp: 24, maxHp: 24, tempHp: 0, size: '', resistances: '', conditions: '', inspiration: false, exhaustion: 0, picture: null, xp: 0, level: 0
    }])
    expect(d.dmNotes).toBe('Remember the bell.')
    expect(d.counts.cards).toBe(2)
    c.undo()
    expect(c.desk().dmNotes).toBe('')
  })

  it('moves the clock with undo and never before the start', () => {
    expect(c.shiftClock(60)).toBe(600)
    expect(c.history().log[0].label).toBe('Moved the clock forward 1 h')
    expect(c.shiftClock(-10_000)).toBe(0)
    c.undo()
    expect(c.info().clockMin).toBe(600)
  })
})
