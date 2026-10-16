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
  it('keeps links, read-aloud boxes, sidebars and pictures through Word (2.8.0)', () => {
    const book: Block[] = [
      { kind: 'read', runs: [{ text: 'The road drops out of the fog.' }] },
      { kind: 'p', runs: [{ text: 'Ask ' }, { text: 'Maren', link: 'card-1' }, { text: ' or ' }, { text: 'Chapter 3', link: 'note:doc-9' }, { text: '. Not ' }, { text: 'Maren', link: '' }, { text: ' here.' }] },
      { kind: 'pic', card: 'card-1', side: 'left' },
      { kind: 'pic', file: 'notes/pictures/a.png', side: 'right' },
      { kind: 'stat', card: 'card-1', layout: 'beside', side: 'left' },
      { kind: 'side', runs: [{ text: 'Running the bell', b: true }] }
    ]
    const file = writeDocx(book, { 'card-1': 'Maren Holloway' })
    expect(readDocxBlocks(file)).toEqual(book)
    expect(docxParagraphs(file).join('\n')).toContain('[Picture: Maren Holloway]')
    expect(docxParagraphs(file).join('\n')).not.toContain('dz:')
    expect(docxParagraphs(file).join('\n')).toContain('[Stat block: Maren Holloway]')
  })
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
