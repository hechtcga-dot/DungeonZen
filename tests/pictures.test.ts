import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Campaign } from '../src/main/campaign/campaign'

let dir: string
let c: Campaign
let png: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dungeonzen-'))
  c = Campaign.create(join(dir, 'Pics'), 'Pics')
  png = join(dir, 'Sunset art.png')
  writeFileSync(png, Buffer.from('89504e470d0a1a0a', 'hex'))
})
afterEach(() => { c.close(); rmSync(dir, { recursive: true, force: true }) })

describe('Library pictures', () => {
  it('uploads art as a style example for every kind of drawing, filed in a folder', () => {
    const s = c.addStyleExample(png, undefined, 'Art')
    const pics = c.pictures()
    expect(pics.pictures).toHaveLength(1)
    expect(pics.pictures[0]).toMatchObject({ key: `lib:${s.id}`, name: 'Sunset art', folder: 'Art', styleFor: ['portraits', 'maps', 'battle'] })
    expect(c.styleExamples('portraits').map((x) => x.id)).toEqual([s.id])
    expect(pics.folders).toEqual(expect.arrayContaining(['Art', 'Portraits', 'Places', 'Items', 'Maps', 'Battle maps']))
  })

  it('unticks a use, moves folders, and undoes', () => {
    const s = c.addStyleExample(png)
    c.updatePicture(`lib:${s.id}`, { styleFor: ['maps'], folder: 'Ships' })
    expect(c.styleExamples('portraits')).toEqual([])
    expect(c.pictures().pictures[0].folder).toBe('Ships')
    expect(c.pictures().folders).toContain('Ships')
    c.log.undo()
    expect(c.styleExamples('portraits')).toHaveLength(1)
  })

  it('shows card pictures in their folder; filing one adopts the same file, and cards can use Library pictures', () => {
    const g = c.info().globalBoardId
    const npc = c.createEntity({ boardId: g, type: 'NPC', name: 'Mara', position: { x: 0, y: 0 } })
    c.setPicture(npc.id, { file: png })
    const pic = c.pictures().pictures.find((p) => p.key === `card:${npc.id}`)!
    expect(pic).toMatchObject({ folder: 'Portraits', styleFor: [], from: { kind: 'card', name: 'Mara' } })
    c.updatePicture(pic.key, { styleFor: ['portraits'] })
    const after = c.pictures().pictures
    expect(after).toHaveLength(1)
    expect(after[0].key.startsWith('lib:')).toBe(true)
    expect(after[0].path).toBe(pic.path)
    const loc = c.createEntity({ boardId: g, type: 'LOCATION', name: 'Harbour', position: { x: 300, y: 0 } })
    c.setPicture(loc.id, { path: pic.path })
    expect(c.sheet(loc.id).entity.attributes.picture).toBe(pic.path)
    expect(() => c.setPicture(loc.id, { path: '../campaign.db' })).toThrow()
  })

  it('keeps empty folders the DM made', () => {
    c.addPictureFolder('Villains')
    expect(c.pictures().folders).toContain('Villains')
  })
})
