import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Campaign } from '../src/main/campaign/campaign'

let dir: string
let c: Campaign
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dungeonzen-'))
  c = Campaign.create(join(dir, 'Pics'), 'Pics')
})
afterEach(() => { c.close(); rmSync(dir, { recursive: true, force: true }) })

describe('encounter pictures folder', () => {
  it('keeps pictures in a campaign folder named after the encounter', () => {
    const id = c.createEncounter({ name: 'Ambush: at the bridge?' })
    expect(c.encounterPictures(id).files).toEqual([])
    const src = join(dir, 'map.png')
    writeFileSync(src, 'png')
    writeFileSync(join(dir, 'notes.txt'), 'x')
    expect(c.addEncounterPictures(id, [src, src])).toBe(2)
    const p = c.encounterPictures(id)
    expect(p.folder).toBe(join(dir, 'Pics', 'assets', 'encounters', 'Ambush at the bridge'))
    expect(p.files.map((f) => f.name)).toEqual(['map 2.png', 'map.png'])
    expect(p.files[0].url).toBe(`dz-asset://encounter/${id}/map%202.png`)
    expect(c.encounterFile(id, '../campaign.db')).toBeNull()
    c.removeEncounterPicture(id, 'map.png')
    expect(c.encounterPictures(id)).toMatchObject({ removed: 1, files: [{ name: 'map 2.png' }] })
    // Another encounter with the same name gets its own folder.
    const twin = c.createEncounter({ name: 'Ambush: at the bridge?' })
    c.addEncounterPictures(twin, [src])
    expect(c.encounterPictures(twin).folder).toMatch(/Ambush at the bridge 2$/)
  })

  it('uses a folder the DM chose, undoably', () => {
    const id = c.createEncounter({ name: 'Dragon' })
    const mine = join(dir, 'My maps')
    mkdirSync(mine)
    writeFileSync(join(mine, 'lair.jpg'), 'jpg')
    c.setEncounterFolder(id, mine)
    expect(c.encounterPictures(id)).toMatchObject({ folder: mine, own: true, files: [{ name: 'lair.jpg', picture: true }] })
    c.undo()
    expect(c.encounterPictures(id).own).toBe(false)
    expect(existsSync(join(mine, 'lair.jpg'))).toBe(true)
  })
})
