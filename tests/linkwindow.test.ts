import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Campaign } from '../src/main/campaign/campaign'

let dir: string
let c: Campaign
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dz-link-')); c = Campaign.create(join(dir, 'C'), 'C') })
afterEach(() => { c.close(); rmSync(dir, { recursive: true, force: true }) })

describe('the Link window (3.0)', () => {
  it('a plain board line opens as a record without an id; saving it makes the record and keeps the line', () => {
    const boardId = c.info().globalBoardId
    const a = c.createEntity({ boardId, type: 'NPC', name: 'Barliman', position: { x: 0, y: 0 } })
    const b = c.createEntity({ boardId, type: 'LOCATION', name: 'Prancing Pony', position: { x: 300, y: 0 } })
    const rel = c.createRelationship({ sourceId: a.id, targetId: b.id, type: 'WORKS_AT', isSecret: false })
    const got = c.linkRecord({ relationshipId: rel.id })
    expect(got.record).toMatchObject({ id: null, kind: 'connection', connections: [{ id: rel.id }] })
    expect(got.known).toBe(false)
    const id = c.saveLink({ id: null, kind: 'secret', text: 'Owns it in secret', known: true, connections: got.record!.connections })
    const after = c.linkRecord({ relationshipId: rel.id })
    expect(after.record).toMatchObject({ id, kind: 'secret', text: 'Owns it in secret', connections: [{ id: rel.id }] })
    expect(after.known).toBe(true)
    expect(c.boardView(boardId).relationships).toMatchObject([{ id: rel.id, isSecret: true, secretId: id }])
    // One undo step takes back the record, the dashes and the party's knowledge.
    c.log.undo()
    expect(c.linkRecord({ relationshipId: rel.id })).toMatchObject({ record: { id: null, kind: 'connection' }, known: false })
  })

  it('a new link from the window lands on the board it was drawn on when links are kept per board', () => {
    const boardId = c.info().globalBoardId
    const a = c.createEntity({ boardId, type: 'NPC', name: 'Ada', position: { x: 0, y: 0 } })
    const b = c.createEntity({ boardId, type: 'NPC', name: 'Bo', position: { x: 300, y: 0 } })
    const id = c.saveLink({ id: null, kind: 'connection', text: '', known: false, boardId, connections: [{ sourceId: a.id, targetId: b.id, type: 'KNOWS' }] })
    expect(c.linkRecord({ secretId: id }).record?.connections).toHaveLength(1)
  })
})
