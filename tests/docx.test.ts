import { describe, expect, it } from 'vitest'
import { readDocxBlocks, writeDocx } from '../src/main/importers/docx'
import { docxParagraphs } from '../src/main/importers/read'
import { changedLines, textToBlocks, type Block } from '../src/shared/noteDoc'

const doc: Block[] = [
  { kind: 'h1', runs: [{ text: 'The Grove' }] },
  { kind: 'p', runs: [{ text: 'Captain ' }, { text: 'Al-Habs', b: true }, { text: ' owes ' }, { text: '650 gp', i: true, u: true }, { text: ' & more <soon>.' }] },
  { kind: 'bullet', runs: [{ text: 'Ships berth by day' }] },
  { kind: 'number', runs: [{ text: 'First clue\nsecond line' }] },
  { kind: 'table', rows: [[[{ text: 'Name' }], [{ text: 'Role' }]], [[{ text: 'Mara' }], [{ text: 'Spy', b: true }]]] }
]

describe('Word files for notes', () => {
  it('writes a .docx and reads it back with headings, bold, italic, underline, lists and tables', () => {
    const file = writeDocx(doc)
    expect(file.subarray(0, 2).toString()).toBe('PK')
    expect(readDocxBlocks(file)).toEqual(doc)
  })
  it('still reads as plain paragraphs for the notes import', () => {
    expect(docxParagraphs(writeDocx(doc))).toContain('Captain Al-Habs owes 650 gp & more <soon>.')
  })
  it('finds what a save changed', () => {
    const after: Block[] = [...doc.slice(0, 2), { kind: 'p', runs: [{ text: 'Mara is secretly the harbour master.' }] }]
    expect(changedLines(doc, after)).toEqual(['Mara is secretly the harbour master.'])
  })
  it('turns plain text and Markdown into blocks', () => {
    expect(textToBlocks('# Title\nSome text.\n\n- one\n- two')).toEqual([
      { kind: 'h1', runs: [{ text: 'Title' }] }, { kind: 'p', runs: [{ text: 'Some text.' }] },
      { kind: 'bullet', runs: [{ text: 'one' }] }, { kind: 'bullet', runs: [{ text: 'two' }] }
    ])
  })
})
