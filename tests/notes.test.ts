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
