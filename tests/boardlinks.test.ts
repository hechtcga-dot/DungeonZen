import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Campaign } from '../src/main/campaign/campaign'
import { encodePng } from '../src/main/png'

let dir: string
let c: Campaign
let g: string
let sb: string // storyline board
let sid: string
const at = { x: 0, y: 0 }
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dz-links-'))
  c = Campaign.create(join(dir, 'Camp'), 'Links')
  g = c.info().globalBoardId
  const s = c.createStoryline('The Festival')
  sb = s.id; sid = s.storylineId!
})
afterEach(() => {
  c.close()
  rmSync(dir, { recursive: true, force: true })
})

const itemOf = (boardId: string, entityId: string) => c.boardView(boardId).items.find((i) => i.entityId === entityId)!

describe('hiding', () => {
  it('hides a card on every board, a string and a note; undo shows them again', () => {
    const a = c.createEntity({ boardId: sb, type: 'NPC', name: 'Ann', position: at })
    const b = c.createEntity({ boardId: g, type: 'NPC', name: 'Bo', position: { x: 300, y: 0 } })
    const r = c.createRelationship({ sourceId: a.id, targetId: b.id, type: 'KNOWS', isSecret: false })
    const note = c.addNote({ boardId: g, position: at, text: 'Hi' })
    c.setHidden('item', itemOf(sb, a.id).id, true) // a card item hides the card everywhere
    expect(c.boardView(g).entities[a.id].hidden).toBe(true)
    expect(c.boardView(sb).entities[a.id].hidden).toBe(true)
    c.setHidden('string', r.id, true)
    c.setHidden('item', note.id, true)
    expect(c.boardView(g).relationships[0].hidden).toBe(true)
    expect(c.boardView(g).items.find((i) => i.id === note.id)!.hidden).toBe(true)
    c.undo(); c.undo(); c.undo()
    expect(c.boardView(g).entities[a.id].hidden).toBe(false)
  })
})

describe('act marks and storyline colours', () => {
  it('numbers act marks like the Timeline and shows them on the card and the act', () => {
    const a = c.createEntity({ boardId: g, type: 'NPC', name: 'Ann', position: { x: 50, y: 60 } })
    const late = c.createAct({ storylineId: sid, title: 'Late', startMin: 2000, endMin: 3000 })
    const early = c.createAct({ storylineId: sid, title: 'Early', startMin: 0, endMin: 1000 })
    c.setActMark(a.id, late, true)
    // Marking adds the card to the storyline's board.
    expect(c.boardView(sb).entities[a.id].acts).toEqual([{ actId: late, storylineId: sid, number: 2, title: 'Late' }])
    c.setActMark(a.id, early, true)
    expect(c.entityView(a.id).acts.map((m) => m.number)).toEqual([1, 2])
    expect(c.timeline().acts.find((x) => x.id === early)!.cards).toEqual([{ id: a.id, name: 'Ann' }])
    // Moving an act on the Timeline renumbers the marks.
    c.updateAct(late, { startMin: -0 + 0, endMin: 500 })
    c.setActMark(a.id, early, false)
    expect(c.entityView(a.id).acts).toEqual([{ actId: late, storylineId: sid, number: 1, title: 'Late' }])
    c.updateStoryline(sid, { colour: '#336699' })
    expect(c.boardView(g).boards.find((b) => b.id === sb)!.storyline!.colour).toBe('#336699')
    expect(c.timeline().storylines[0].colour).toBe('#336699')
  })
})

describe('linked boards', () => {
  it('moves and resizes a card on every board while positions are linked', () => {
    const a = c.createEntity({ boardId: sb, type: 'NPC', name: 'Ann', position: { x: 10, y: 10 } })
    c.moveItems([{ itemId: itemOf(sb, a.id).id, x: 500, y: 500 }])
    expect(itemOf(g, a.id).x).not.toBe(500) // not linked yet
    c.setLinkPositions(true, 'storyline')
    expect(itemOf(g, a.id)).toMatchObject({ x: 500, y: 500 })
    c.moveItems([{ itemId: itemOf(g, a.id).id, x: 40, y: 80 }])
    expect(itemOf(sb, a.id)).toMatchObject({ x: 40, y: 80 })
    c.resizeItem(itemOf(g, a.id).id, { w: 300, h: 90 })
    expect(itemOf(sb, a.id)).toMatchObject({ w: 300, h: 90 })
    c.resizeItem(itemOf(g, a.id).id, null)
    expect(itemOf(sb, a.id).w).toBeNull()
    c.setLinkPositions(false)
    c.moveItems([{ itemId: itemOf(g, a.id).id, x: 0, y: 0 }])
    expect(itemOf(sb, a.id).x).toBe(40)
  })

  it('global layout wins when linking with global chosen', () => {
    const a = c.createEntity({ boardId: sb, type: 'NPC', name: 'Ann', position: { x: 10, y: 10 } })
    c.moveItems([{ itemId: itemOf(g, a.id).id, x: 900, y: 20 }])
    c.setLinkPositions(true, 'global')
    expect(itemOf(sb, a.id)).toMatchObject({ x: 900, y: 20 })
  })

  it('keeps strings per board, then shares them again with the chosen winner', () => {
    const a = c.createEntity({ boardId: sb, type: 'NPC', name: 'Ann', position: at })
    const b = c.createEntity({ boardId: sb, type: 'NPC', name: 'Bo', position: { x: 300, y: 0 } })
    c.createRelationship({ sourceId: a.id, targetId: b.id, type: 'KNOWS', isSecret: false })
    expect(c.boardView(sb).relationships).toHaveLength(1)
    c.setSharedStrings(false)
    // Each board has its own copy now.
    expect(c.boardView(g).relationships).toHaveLength(1)
    expect(c.boardView(sb).relationships).toHaveLength(1)
    const local = c.boardView(sb).relationships[0]
    c.setRelationshipStatus(local.id, 'defunct') // removed on the storyline board only
    c.createRelationship({ sourceId: a.id, targetId: b.id, type: 'HOSTILE_TO', isSecret: true, boardId: sb })
    expect(c.boardView(g).relationships.map((r) => r.type)).toEqual(['KNOWS'])
    expect(c.boardView(sb).relationships.map((r) => r.type)).toEqual(['HOSTILE_TO'])
    c.setSharedStrings(true, 'storyline')
    expect(c.boardView(g).relationships.map((r) => r.type)).toEqual(['HOSTILE_TO'])
    expect(c.boardView(sb).relationships.map((r) => r.boardId)).toEqual([null])
    c.undo()
    c.setSharedStrings(true, 'global')
    expect(c.boardView(sb).relationships.map((r) => r.type)).toEqual(['KNOWS'])
  })
})

describe('string kinds', () => {
  it('renames a kind on every string and in the list, as one undo step', () => {
    const a = c.createEntity({ boardId: g, type: 'NPC', name: 'Ann', position: at })
    const b = c.createEntity({ boardId: g, type: 'NPC', name: 'Bo', position: at })
    c.setStringTypes([{ type: 'OWES_MONEY', colour: '#aa3300' }])
    c.createRelationship({ sourceId: a.id, targetId: b.id, type: 'OWES_MONEY', isSecret: false })
    expect(c.renameStringType('OWES_MONEY', 'IN_DEBT_TO')).toBe(1)
    expect(c.boardView(g).relationships[0].type).toBe('IN_DEBT_TO')
    expect(c.boardSettings().stringTypes).toEqual([{ type: 'IN_DEBT_TO', colour: '#aa3300' }])
    c.undo()
    expect(c.boardView(g).relationships[0].type).toBe('OWES_MONEY')
  })
})

describe('pictures under the cards', () => {
  it('puts a picture file or a campaign map on a board; lock, opacity, remove to History', () => {
    writeFileSync(join(dir, 'town.png'), encodePng(40, 20, new Uint8Array(40 * 20 * 3)))
    const fromFile = c.addBoardImage(g, { file: join(dir, 'town.png') }, at)
    expect(fromFile).toMatchObject({ kind: 'image', w: 1200, h: 600, content: { name: 'town', opacity: 0.6, locked: false } })
    expect(c.assetFile(fromFile.content!.image!)).not.toBeNull()
    const m = c.importMap(join(dir, 'town.png'), 'World')
    const fromMap = c.addBoardImage(sb, { mapId: m.id }, at)
    expect(fromMap.content!.image).toBe(c.maps()[0].url.replace('dz-asset://campaign/', ''))
    expect(c.boardView(g).items.filter((i) => i.kind === 'image')).toHaveLength(1)
    c.updateBoardImage(fromFile.id, { locked: true, opacity: 0.3 })
    expect(c.boardView(g).items[0].content).toMatchObject({ locked: true, opacity: 0.3, name: 'town' })
    c.setNoteStatus(fromFile.id, 'defunct')
    expect(c.history().removedNotes.map((n) => n.text)).toEqual(['Picture: town'])
  })
})
