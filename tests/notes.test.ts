import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Campaign } from '../src/main/campaign/campaign'
import { readDocxBlocks, writeDocx } from '../src/main/importers/docx'

let dir: string
let c: Campaign
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dungeonzen-')); c = Campaign.create(join(dir, 'N'), 'N') })
afterEach(() => { c.close(); rmSync(dir, { recursive: true, force: true }) })

const word = (text: string) => writeDocx([{ kind: 'p', runs: [{ text }] }])

describe('Notes screen', () => {
  it('nests folders, moves and deletes them with their notes, links them to cards (2.8.0)', () => {
    const b = c.info().globalBoardId
    const maren = c.createEntity({ boardId: b, type: 'NPC', name: 'Maren', position: { x: 0, y: 0 } }).id
    c.noteFolder({ action: 'create', path: 'World/People' })
    expect(c.notesScreen().folders.sort()).toEqual(['World', 'World/People'])
    c.noteFolder({ action: 'link', path: 'World/People', card: maren })
    const id = c.createNoteDoc('Maren', word('Harbourmaster.'), c.folderOfCard(maren))
    const other = c.createNoteDoc('Bio', word('x'), '', maren)
    expect(c.notesLinkedTo(maren).sort()).toEqual([id, other].sort())
    c.noteFolder({ action: 'rename', from: 'World', to: 'Lore/World' })
    expect(c.notesScreen().docs.find((d) => d.id === id)?.folder).toBe('Lore/World/People')
    expect(c.notesScreen().folderLinks).toEqual({ 'Lore/World/People': maren })
    c.noteFolder({ action: 'delete', path: 'Lore' })
    expect(c.notesScreen().docs.map((d) => d.id)).toEqual([other])
    expect(c.notesScreen().folders).toEqual([])
    c.undo()
    expect(c.notesScreen().docs.find((d) => d.id === id)?.folder).toBe('Lore/World/People')
  })
  it('keeps an imported file, saves versions, brings one back, and undoes', () => {
    const src = join(dir, 'Plot points.docx')
    writeFileSync(src, word('The dragon sleeps.'))
    const id = c.addNoteDoc(src)
    expect(c.notesScreen().docs).toMatchObject([{ id, title: 'Plot points', kind: 'word', originalName: 'Plot points.docx', versions: [] }])
    c.saveNoteVersion(id, word('The dragon wakes.'))
    const doc = c.notesScreen().docs[0]
    expect(doc.versions).toHaveLength(1)
    expect(readDocxBlocks(readFileSync(c.noteFile(id)))).toEqual([{ kind: 'p', runs: [{ text: 'The dragon wakes.' }] }])
    c.restoreNoteVersion(id, doc.versions[0].file)
    expect(readDocxBlocks(readFileSync(c.noteFile(id)))[0]).toEqual({ kind: 'p', runs: [{ text: 'The dragon sleeps.' }] })
    c.log.undo()
    expect(readDocxBlocks(readFileSync(c.noteFile(id)))[0]).toEqual({ kind: 'p', runs: [{ text: 'The dragon wakes.' }] })
  })

  it('replaces a note with a file of the same name, keeping the old one as an earlier version', () => {
    const src = join(dir, 'Notes.txt')
    writeFileSync(src, 'one')
    const id = c.addNoteDoc(src)
    expect(c.noteDocsNamed(['notes.TXT']).map((n) => n.id)).toEqual([id])
    writeFileSync(src, 'two')
    expect(c.addNoteDoc(src, id)).toBe(id)
    expect(c.notesScreen().docs).toHaveLength(1)
    expect(c.notesScreen().docs[0].versions).toHaveLength(1)
    expect(readFileSync(c.noteFile(id), 'utf8')).toBe('two')
  })

  it('brings in changes made in Word to the copy it opened', () => {
    const src = join(dir, 'Session plan.docx')
    writeFileSync(src, word('Act one.'))
    const id = c.addNoteDoc(src)
    const copy = c.editCopy(id)
    expect(c.editedInWord()).toEqual([])
    writeFileSync(copy, word('Act one, rewritten.'))
    const later = new Date(Date.now() + 5000)
    utimesSync(copy, later, later)
    expect(c.editedInWord()).toEqual([{ id, title: 'Session plan' }])
    c.takeWordEdit(id)
    expect(c.editedInWord()).toEqual([])
    expect(readDocxBlocks(readFileSync(c.noteFile(id)))[0].kind).toBe('p')
    expect(c.notesScreen().docs[0].versions).toHaveLength(1)
  })

  it('writes the desk journal to the running session, else between sessions', () => {
    c.setDmNotes('Before the game')
    expect(c.desk()).toMatchObject({ dmNotes: 'Before the game', dmNotesSession: null })
    const s = c.startSession()
    c.setDmNotes('At the table')
    c.appendDmNotes('A rumour')
    expect(c.desk()).toMatchObject({ dmNotes: 'At the table\n\nA rumour', dmNotesSession: s.number })
    expect(c.notesScreen()).toMatchObject({ dmNotes: 'Before the game', sessions: [{ id: s.id, running: true, dmNotes: 'At the table\n\nA rumour' }] })
  })
})

describe('Notes list (1.7.0)', () => {
  it('folders, duplicate, combine (one undo step), and delete file for good from History', () => {
    const a = c.createNoteDoc('Alpha', word('one'))
    const b = c.createNoteDoc('Beta', word('two'))
    c.setNoteFolder([a, b], 'Chapter 1')
    expect(c.notesScreen().docs.map((d) => d.folder)).toEqual(['Chapter 1', 'Chapter 1'])
    c.log.undo()
    expect(c.notesScreen().docs.every((d) => d.folder === '')).toBe(true)

    const copy = c.duplicateNoteDoc(a)
    expect(c.notesScreen().docs.find((d) => d.id === copy)).toMatchObject({ title: 'Alpha (copy)', kind: 'word' })
    expect(c.noteFile(copy)).not.toBe(c.noteFile(a))

    const both = c.combineNoteDocs('Both', word('one two'), [a, b], true)
    expect(c.notesScreen().docs.map((d) => d.id).sort()).toEqual([both, copy].sort())
    expect(c.history().removedNoteDocs.map((d) => d.title).sort()).toEqual(['Alpha', 'Beta'])
    c.log.undo()
    expect(c.notesScreen().docs.map((d) => d.id).sort()).toEqual([a, b, copy].sort())

    expect(() => c.forgetNoteDoc(a)).toThrow(/History first/)
    c.setNoteDocStatus(a, 'defunct')
    const files = c.forgetNoteDoc(a)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/notes[\\/][\w-]+\.docx$/)
    expect(c.history().removedNoteDocs).toEqual([])
    // The files are gone (the handler sends them to the Recycle Bin): an undo past it shows nothing broken.
    for (const f of files) rmSync(f)
    c.log.undo()
    expect(c.notesScreen().docs.some((d) => d.id === a)).toBe(false)
  })
})
