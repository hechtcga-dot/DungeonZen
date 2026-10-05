import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Campaign } from '../src/main/campaign/campaign'

let dir: string
let c: Campaign

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'chronos-'))
  c = Campaign.create(join(dir, 'Test campaign'), 'Test campaign')
})
afterEach(() => {
  c.close()
  rmSync(dir, { recursive: true, force: true })
})

const at = { x: 10, y: 20 }

describe('creating and reopening', () => {
  it('starts with settings, a global board and nothing to undo', () => {
    const info = c.info()
    expect(info.name).toBe('Test campaign')
    expect(info.rulesEdition).toBe('2024')
    expect(info.clockMin).toBe(540)
    const view = c.boardView(info.globalBoardId)
    expect(view.board.name).toBe('Global')
    expect(view.items).toEqual([])
    expect(view.undo).toEqual({ undoLabel: null, redoLabel: null })
  })

  it('keeps data after closing and reopening', () => {
    const { globalBoardId } = c.info()
    c.createEntity({ boardId: globalBoardId, type: 'NPC', name: 'Ciaf Crol', position: at })
    c.close()
    c = Campaign.open(join(dir, 'Test campaign'))
    const view = c.boardView(globalBoardId)
    expect(Object.values(view.entities).map((e) => e.name)).toEqual(['Ciaf Crol'])
  })

  it('refuses to create over an existing campaign or open a folder without one', () => {
    expect(() => Campaign.create(join(dir, 'Test campaign'), 'Again')).toThrow(/already exists/)
    expect(() => Campaign.open(join(dir, 'nothing here'))).toThrow(/No campaign/)
  })
})

describe('cards, strings and notes', () => {
  it('places a new card on the global board at the given position', () => {
    const { globalBoardId } = c.info()
    const npc = c.createEntity({ boardId: globalBoardId, type: 'NPC', name: 'Ciaf Crol', position: at })
    const view = c.boardView(globalBoardId)
    expect(view.items).toMatchObject([{ kind: 'card', entityId: npc.id, x: 10, y: 20 }])
    expect(view.undo.undoLabel).toBe('Added npc Ciaf Crol')
  })

  it('links two cards and hides the string while one end is in History', () => {
    const g = c.info().globalBoardId
    const a = c.createEntity({ boardId: g, type: 'NPC', name: 'A', position: at })
    const b = c.createEntity({ boardId: g, type: 'MONSTER', name: 'B', position: at })
    const r = c.createRelationship({ sourceId: a.id, targetId: b.id, type: 'HOSTILE_TO', isSecret: true })
    expect(c.boardView(g).relationships).toMatchObject([{ id: r.id, isSecret: true }])

    c.setEntityStatus(b.id, 'defunct')
    let view = c.boardView(g)
    expect(Object.keys(view.entities)).toEqual([a.id])
    expect(view.relationships).toEqual([])
    expect(c.history().removedEntities.map((e) => e.name)).toEqual(['B'])

    c.setEntityStatus(b.id, 'active')
    view = c.boardView(g)
    expect(view.relationships.map((x) => x.id)).toEqual([r.id])
    expect(c.history().log[0].label).toBe('Revived B')
  })

  it('keeps resolved cards on the board', () => {
    const g = c.info().globalBoardId
    const s = c.createEntity({ boardId: g, type: 'SCENE', name: 'Ambush', position: at })
    c.setEntityStatus(s.id, 'resolved')
    expect(c.boardView(g).entities[s.id].status).toBe('resolved')
  })

  it('does not link a card to itself', () => {
    const g = c.info().globalBoardId
    const a = c.createEntity({ boardId: g, type: 'NPC', name: 'A', position: at })
    expect(() => c.createRelationship({ sourceId: a.id, targetId: a.id, type: 'KNOWS', isSecret: false })).toThrow()
  })

  it('removes and restores strings and notes without deleting them', () => {
    const g = c.info().globalBoardId
    const a = c.createEntity({ boardId: g, type: 'NPC', name: 'A', position: at })
    const b = c.createEntity({ boardId: g, type: 'NPC', name: 'B', position: at })
    const r = c.createRelationship({ sourceId: a.id, targetId: b.id, type: 'KNOWS', isSecret: false })
    const note = c.addNote({ boardId: g, position: at, text: 'Remember the bell' })

    c.setRelationshipStatus(r.id, 'defunct')
    c.setNoteStatus(note.id, 'defunct')
    expect(c.boardView(g).relationships).toEqual([])
    expect(c.boardView(g).items.filter((i) => i.kind === 'note')).toEqual([])
    const h = c.history()
    expect(h.removedStrings).toMatchObject([{ id: r.id, sourceName: 'A', targetName: 'B' }])
    expect(h.removedNotes).toMatchObject([{ itemId: note.id, text: 'Remember the bell', boardName: 'Global' }])

    c.setRelationshipStatus(r.id, 'active')
    c.setNoteStatus(note.id, 'active')
    expect(c.boardView(g).relationships).toHaveLength(1)
  })

  it('merges attribute edits instead of replacing them', () => {
    const g = c.info().globalBoardId
    const a = c.createEntity({ boardId: g, type: 'NPC', name: 'A', position: at })
    c.updateEntity(a.id, { attributes: { motivation: 'Revenge' } })
    c.updateEntity(a.id, { attributes: { location: 'District C' }, tags: ['fiend'] })
    expect(c.entityView(a.id)).toMatchObject({
      attributes: { motivation: 'Revenge', location: 'District C' }, tags: ['fiend']
    })
  })

  it('records nothing when an edit changes nothing', () => {
    const g = c.info().globalBoardId
    const a = c.createEntity({ boardId: g, type: 'NPC', name: 'A', position: at })
    c.updateEntity(a.id, { name: 'A' })
    expect(c.history().log).toHaveLength(1)
  })
})

describe('storylines', () => {
  it('shows cards created in a storyline view on that view and the global view', () => {
    const g = c.info().globalBoardId
    const sb = c.createStoryline('The Bell Tower')
    const npc = c.createEntity({ boardId: sb.id, type: 'NPC', name: 'Bell ringer', position: at })
    const other = c.createEntity({ boardId: g, type: 'NPC', name: 'Elsewhere', position: at })
    expect(Object.keys(c.boardView(sb.id).entities)).toEqual([npc.id])
    expect(Object.keys(c.boardView(g).entities).sort()).toEqual([npc.id, other.id].sort())
    expect(c.entityView(npc.id).storylineIds).toEqual([sb.storylineId])
    expect(c.boardView(g).boards.map((b) => b.name)).toEqual(['Global', 'The Bell Tower'])
  })

  it('adds an existing card to a storyline and takes it off again', () => {
    const g = c.info().globalBoardId
    const sb = c.createStoryline('Heist')
    const npc = c.createEntity({ boardId: g, type: 'NPC', name: 'Fence', position: at })
    c.addToStoryline(npc.id, sb.storylineId!, { x: 5, y: 5 })
    expect(c.boardView(sb.id).items).toMatchObject([{ entityId: npc.id, x: 5, y: 5 }])
    c.removeFromStoryline(npc.id, sb.storylineId!)
    expect(c.boardView(sb.id).items).toEqual([])
    expect(c.entityView(npc.id).storylineIds).toEqual([])
    // Adding back revives the old card where it was.
    c.addToStoryline(npc.id, sb.storylineId!, { x: 99, y: 99 })
    expect(c.boardView(sb.id).items).toMatchObject([{ x: 5, y: 5 }])
  })
})

describe('undo and redo', () => {
  it('undoes and redoes creating a card, a move and an edit', () => {
    const g = c.info().globalBoardId
    const a = c.createEntity({ boardId: g, type: 'NPC', name: 'A', position: at })
    const item = c.boardView(g).items[0]
    c.moveItems([{ itemId: item.id, x: 300, y: 400 }])
    c.updateEntity(a.id, { name: 'Renamed' })

    expect(c.undo()).toBe('Edited Renamed')
    expect(c.entityView(a.id).name).toBe('A')
    expect(c.undo()).toBe('Moved A')
    expect(c.boardView(g).items[0]).toMatchObject({ x: 10, y: 20 })
    expect(c.undo()).toBe('Added npc A')
    expect(c.boardView(g).items).toEqual([])
    expect(c.undo()).toBeNull()

    expect(c.redo()).toBe('Added npc A')
    expect(c.redo()).toBe('Moved A')
    expect(c.redo()).toBe('Edited Renamed')
    expect(c.redo()).toBeNull()
    expect(c.entityView(a.id).name).toBe('Renamed')
    expect(c.boardView(g).items[0]).toMatchObject({ x: 300, y: 400 })
  })

  it('drops the redo list when a new change is made after undoing', () => {
    const g = c.info().globalBoardId
    c.createEntity({ boardId: g, type: 'NPC', name: 'A', position: at })
    c.createEntity({ boardId: g, type: 'NPC', name: 'B', position: at })
    c.undo()
    c.createEntity({ boardId: g, type: 'NPC', name: 'C', position: at })
    expect(c.redo()).toBeNull()
    expect(c.undo()).toBe('Added npc C')
    // B was discarded, so redo brings back C, not B.
    expect(c.redo()).toBe('Added npc C')
    expect(c.history().log.map((l) => l.label)).toEqual(['Added npc C', 'Added npc A'])
  })

  it('undoes a whole storyline creation with its board', () => {
    const g = c.info().globalBoardId
    c.createStoryline('Short-lived')
    c.undo()
    expect(c.boardView(g).boards.map((b) => b.name)).toEqual(['Global'])
  })

  it('undoes back to a chosen change in the log', () => {
    const g = c.info().globalBoardId
    c.createEntity({ boardId: g, type: 'NPC', name: 'A', position: at })
    c.createEntity({ boardId: g, type: 'NPC', name: 'B', position: at })
    c.createEntity({ boardId: g, type: 'NPC', name: 'C', position: at })
    const target = c.history().log.find((l) => l.label === 'Added npc B')!
    expect(c.undoTo(target.id)).toBe(2)
    expect(Object.values(c.boardView(g).entities).map((e) => e.name)).toEqual(['A'])
  })

  it('survives a reopen in the middle of an undo history', () => {
    const g = c.info().globalBoardId
    c.createEntity({ boardId: g, type: 'NPC', name: 'A', position: at })
    c.undo()
    c.close()
    c = Campaign.open(join(dir, 'Test campaign'))
    expect(c.redo()).toBe('Added npc A')
  })
})
