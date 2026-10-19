import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Campaign } from '../src/main/campaign/campaign'

let dir: string
let c: Campaign
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dungeonzen-')); c = Campaign.create(join(dir, 'Blank test'), 'Blank test') })
afterEach(() => { c.close(); rmSync(dir, { recursive: true, force: true }) })

const at = { x: 0, y: 0 }
const has = (id: string) => c.boardView(c.info().globalBoardId).items.some((i) => i.id === id || i.entityId === id)

describe('things made empty and left untouched go away for good (owner, 2026-10-16)', () => {
  it('drops an untouched card, even if it was moved, with nothing in History or the undo trail', () => {
    const before = c.log.state()
    const e = c.createEntity({ boardId: c.info().globalBoardId, type: 'NPC', name: 'New NPC', position: at })
    const card = c.boardView(c.info().globalBoardId).items.find((i) => i.entityId === e.id)!
    c.moveItems([{ itemId: card.id, x: 50, y: 60 }])
    expect(c.discardIfBlank(e.id)).toBe(true)
    expect(has(e.id)).toBe(false)
    expect(c.history().removedEntities).toEqual([])
    expect(c.log.state()).toEqual(before)
  })

  it('keeps a card once anything was written in it', () => {
    const e = c.createEntity({ boardId: c.info().globalBoardId, type: 'NPC', name: 'New NPC', position: at })
    c.updateEntity(e.id, { name: 'Maud' })
    expect(c.discardIfBlank(e.id)).toBe(false)
    expect(has(e.id)).toBe(true)
  })

  it('drops an empty board note, keeps one with words', () => {
    const a = c.addNote({ boardId: c.info().globalBoardId, position: at, text: '' })
    const b = c.addNote({ boardId: c.info().globalBoardId, position: at, text: '' })
    c.updateNote(b.id, 'Bells at midnight')
    expect(c.discardIfBlank(a.id)).toBe(true)
    expect(c.discardIfBlank(b.id)).toBe(false)
    expect(has(a.id)).toBe(false)
    expect(has(b.id)).toBe(true)
  })

  it('drops an empty prep secret row with its secret, keeps one whose secret got text', () => {
    const p = c.createPrep(1)
    const a = c.addPrepSecret(p, 'secret')
    const b = c.addPrepSecret(p, 'clue')
    const sid = c.prepView(p).items.find((i) => i.id === b)!.secretId!
    c.setSecretText(sid, 'The bell was cracked on purpose')
    expect(c.discardIfBlank(a)).toBe(true)
    expect(c.discardIfBlank(b)).toBe(false)
    expect(c.prepView(p).items.map((i) => i.id)).toEqual([b])
  })
})

describe('Undo on "Empty card removed" (3.0)', () => {
  it('puts the card back where it was, with the step that made it', () => {
    const e = c.createEntity({ boardId: c.info().globalBoardId, type: 'NPC', name: 'New NPC', position: at })
    const card = c.boardView(c.info().globalBoardId).items.find((i) => i.entityId === e.id)!
    c.moveItems([{ itemId: card.id, x: 50, y: 60 }])
    const steps = c.log.state()
    expect(c.discardIfBlank(e.id)).toBe(true)
    expect(c.restoreDiscarded(e.id)).toBe(true)
    expect(c.boardView(c.info().globalBoardId).items.find((i) => i.entityId === e.id)).toMatchObject({ x: 50, y: 60 })
    expect(c.log.state()).toEqual(steps)
    expect(c.restoreDiscarded(e.id)).toBe(false) // only once
  })
})
