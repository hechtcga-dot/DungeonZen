import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Campaign } from '../src/main/campaign/campaign'
import { chunkBlocks, CHUNK_CHARS, docxParagraphs, readNotesFile } from '../src/main/importers/read'
import { readZipEntry } from '../src/main/importers/zip'
import { buildDraft, cardType, extractJson, findDuplicate, linkType, nameLikeness, notesPrompt, parseChunkReply } from '../src/main/importers/notes'
import { generateText, resolve, type Fetch } from '../src/main/ai/client'

let dir: string
let c: Campaign
let g: string
const at = { x: 0, y: 0 }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dz-imp-'))
  c = Campaign.create(join(dir, 'Camp'), 'The Mistreach')
  g = c.info().globalBoardId
})
afterEach(() => {
  c.close()
  rmSync(dir, { recursive: true, force: true })
})

/** A small zip writer (one deflated file per entry), enough to make a .docx for tests. */
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8')
    const packed = deflateRawSync(data)
    const n = Buffer.from(name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8)
    local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10)
    central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42)
    locals.push(local, n, packed)
    centrals.push(central, n)
    offset += 30 + n.length + packed.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

const docx = (paras: string[]) => zip({
  '[Content_Types].xml': '<Types/>',
  'word/document.xml': `<w:document><w:body>${paras.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`).join('')}<w:p/></w:body></w:document>`
})

describe('reading notes files', () => {
  it('reads Word files from the zip, with paragraph locators', async () => {
    const file = docx(['The Old Harbour', 'Ciaf Crol &amp; his crew run the docks.', 'Father Brine rings the bell.'])
    expect(readZipEntry(file, 'word/document.xml')?.toString()).toContain('Ciaf Crol')
    expect(docxParagraphs(file)).toEqual(['The Old Harbour', 'Ciaf Crol & his crew run the docks.', 'Father Brine rings the bell.'])
    writeFileSync(join(dir, 'notes.docx'), file)
    const f = await readNotesFile(join(dir, 'notes.docx'))
    expect(f).toMatchObject({ kind: 'word', name: 'notes.docx' })
    expect(f.chunks).toEqual([{ locator: 'paragraphs 1–3', text: '[¶1] The Old Harbour\n\n[¶2] Ciaf Crol & his crew run the docks.\n\n[¶3] Father Brine rings the bell.' }])
  })

  it('splits long notes into parts and reads text and pictures', async () => {
    const paras = Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1} ${'x'.repeat(800)}`)
    const chunks = chunkBlocks(paras, 'paragraph')
    expect(chunks.length).toBeGreaterThan(2)
    expect(chunks[0].locator).toBe('paragraphs 1–11')
    expect(chunks[1].locator.startsWith('paragraphs 12')).toBe(true)
    expect(chunks.every((ch) => ch.text.length <= CHUNK_CHARS + 2000)).toBe(true)
    writeFileSync(join(dir, 'a.md'), '# Session one\r\n\r\nThe bell rings.\r\n\r\n\r\nNobody sleeps.')
    expect((await readNotesFile(join(dir, 'a.md'))).chunks[0].locator).toBe('paragraphs 1–3')
    writeFileSync(join(dir, 'map.png'), Buffer.from('png'))
    expect(await readNotesFile(join(dir, 'map.png'))).toMatchObject({ kind: 'picture', image: { mime: 'image/png' } })
    await expect(readNotesFile(join(dir, 'x.xlsx'))).rejects.toThrow(/notes must be/)
  })
})

describe('what the AI sends back', () => {
  const reply = '```json\n' + JSON.stringify({
    cards: [
      { ref: 'c1', type: 'person', name: 'Ciaf Crol', summary: 'Harbourmaster', details: { motivation: 'Hide the cult', age: 52 }, quote: 'Ciaf Crol runs the docks', where: '[¶2]', basis: 'stated' },
      { ref: 'c2', type: 'Cult', name: 'The Drowned Choir', summary: 'Bell cult', quote: 'the choir sings below', basis: 'inferred' },
      { ref: 'c3', type: 'LOCATION', name: 'Old Harbour', quote: 'The Old Harbour', basis: 'stated' },
      { ref: 'bad', type: 'NPC' }
    ],
    links: [
      { from: 'c1', to: 'c2', type: 'member', secret: true, quote: 'Ciaf sings with them', basis: 'guess' },
      { from: 'c1', to: 'Old Harbour', type: 'lives in', quote: 'runs the docks' },
      { from: 'c1', to: 'nobody', type: 'KNOWS' }
    ],
    storylines: [{ ref: 's1', title: 'The Drowned Bell', summary: 'A cult wakes the drowned', acts: [{ title: 'The bell tolls' }], cards: ['c1', 'c2'], quote: 'the bell', basis: 'stated' }],
    questions: [{ text: 'Is Ciaf a willing cultist or blackmailed?', about: 'c1', options: ['Willing', 'Blackmailed'] }]
  },) + ',\n```\nHope that helps!'

  it('finds the JSON, keeps good items and counts bad ones', () => {
    expect(extractJson('Sure! {"a": [1, 2,],} thanks')).toEqual({ a: [1, 2] })
    expect(() => extractJson('no idea')).toThrow(/no JSON/)
    const r = parseChunkReply(reply)
    expect(r.cards.map((x) => x.name)).toEqual(['Ciaf Crol', 'The Drowned Choir', 'Old Harbour'])
    expect(r.dropped).toBe(1)
    expect(r.links[0].basis).toBe('inferred')
    expect(cardType('Cult')).toBe('FACTION')
    expect(cardType('town')).toBe('LOCATION')
    expect(linkType('lives in')).toBe('LOCATED_AT')
    expect(linkType('member')).toBe('MEMBER_OF')
    expect(linkType('sworn enemy')).toBe('HOSTILE_TO')
    expect(linkType('trained by')).toBe('KNOWS')
  })

  it('matches names to cards already in the campaign', () => {
    expect(nameLikeness('Ciaf Crol', 'ciaf crol')).toBe(1)
    expect(nameLikeness('Ciaf', 'Ciaf Crol')).toBe(0.9)
    expect(nameLikeness('The Old Harbour', 'Old Harbor')).toBeGreaterThan(0.85)
    expect(nameLikeness('Ciaf Crol', 'Father Brine')).toBeLessThan(0.5)
    const existing = [{ id: 'e1', name: 'Ciaf Crol', type: 'NPC' }, { id: 'e2', name: 'Old Harbor', type: 'LOCATION' }]
    expect(findDuplicate('Ciaf Crol', 'NPC', existing)).toEqual({ id: 'e1', name: 'Ciaf Crol', type: 'NPC', exact: true })
    expect(findDuplicate('The Old Harbour', 'LOCATION', existing)).toMatchObject({ id: 'e2', exact: false })
    expect(findDuplicate('Bell Tower', 'LOCATION', existing)).toBeNull()
  })

  it('puts the parts together into one draft', () => {
    const existing = [{ id: 'e1', name: 'Old Harbour', type: 'LOCATION' }]
    const second = parseChunkReply(JSON.stringify({ cards: [{ ref: 'x', type: 'NPC', name: 'ciaf crol', summary: 'Harbourmaster of the Old Harbour', details: { appearance: 'Salt-white beard' }, quote: 'Ciaf again', basis: 'stated' }] }))
    const d = buildDraft([{ file: 'notes.docx', locator: 'paragraphs 1–3', result: parseChunkReply(reply) }, { file: 'notes.docx', locator: 'paragraphs 4–9', result: second }],
      existing, { title: 'notes', source: 'Test AI', files: [] })
    const ciaf = d.cards.find((x) => x.name === 'Ciaf Crol')!
    expect(ciaf.sources.map((s) => s.locator)).toEqual(['paragraphs 1–3, ¶2', 'paragraphs 4–9'])
    expect(ciaf.summary).toBe('Harbourmaster of the Old Harbour')
    expect(ciaf.details).toEqual({ motivation: 'Hide the cult', age: '52', appearance: 'Salt-white beard' })
    const harbour = d.cards.find((x) => x.name === 'Old Harbour')!
    expect(harbour).toMatchObject({ decision: 'merge', duplicateOf: { id: 'e1', exact: true } })
    expect(d.cards.find((x) => x.name === 'The Drowned Choir')).toMatchObject({ type: 'FACTION', basis: 'inferred', decision: 'create' })
    expect(d.links.map((l) => l.type)).toEqual(['MEMBER_OF', 'LOCATED_AT'])
    expect(d.links[0]).toMatchObject({ secret: true, basis: 'inferred' })
    expect(d.storylines[0].cardIds).toHaveLength(2)
    expect(d.questions[0]).toMatchObject({ aboutId: ciaf.id, options: ['Willing', 'Blackmailed'], status: 'open' })
    expect(d.dropped).toBe(2) // the bad card and the link to nobody
  })

  it('asks with the campaign cards, and sends pictures to the AI', async () => {
    const p = notesPrompt({ file: 'notes.docx', locator: 'paragraphs 1–3', text: '[¶1] The bell' }, [{ name: 'Ciaf Crol', type: 'NPC' }], 'The Mistreach')
    expect(p).toContain('Cards already in the campaign: Ciaf Crol (NPC).')
    expect(p).toContain('[¶1] The bell')
    const sent: Array<Record<string, any>> = []
    const f = (async (_u: string, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify({ content: [{ type: 'text', text: '{}' }], choices: [{ message: { content: '{}' } }], candidates: [{ content: { parts: [{ text: '{}' }] } }] }), { status: 200 })
    }) as unknown as Fetch
    const img = [{ bytes: Buffer.from('img'), mime: 'image/png' }]
    await generateText(resolve({ provider: 'anthropic', model: 'm', baseUrl: 'https://api.anthropic.com' }, 'k'), { system: 's', prompt: 'p', images: img }, f)
    await generateText(resolve({ provider: 'openai', model: 'm', baseUrl: 'https://api.openai.com/v1' }, 'k'), { system: 's', prompt: 'p', images: img, json: true }, f)
    await generateText(resolve({ provider: 'gemini', model: 'm', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' }, 'k'), { system: 's', prompt: 'p', images: img, json: true }, f)
    expect(sent[0].messages[0].content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW1n' } })
    expect(sent[1].messages[1].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,aW1n' } })
    expect(sent[1].response_format).toEqual({ type: 'json_object' })
    expect(sent[2].contents[0].parts[0]).toEqual({ inlineData: { mimeType: 'image/png', data: 'aW1n' } })
    expect(sent[2].generationConfig).toEqual({ responseMimeType: 'application/json' })
  })
})

describe('creating what the DM kept', () => {
  function draftFor() {
    const harbour = c.createEntity({ boardId: g, type: 'LOCATION', name: 'Old Harbour', position: at })
    c.updateEntity(harbour.id, { attributes: { summary: 'My own words' } })
    const answer = parseChunkReply(JSON.stringify({
      cards: [
        { ref: 'c1', type: 'NPC', name: 'Ciaf Crol', summary: 'Harbourmaster', details: { motivation: 'Hide the cult' }, quote: 'Ciaf Crol runs the docks', where: '¶2', basis: 'stated' },
        { ref: 'c2', type: 'FACTION', name: 'The Drowned Choir', quote: 'the choir', basis: 'inferred' },
        { ref: 'c3', type: 'LOCATION', name: 'Old Harbour', summary: 'AI words', details: { description: 'Fog and piers' }, quote: 'The Old Harbour', basis: 'stated' },
        { ref: 'c4', type: 'ITEM', name: 'Bell rope', quote: 'a rope', basis: 'inferred' }
      ],
      links: [{ from: 'c1', to: 'c2', type: 'MEMBER_OF', secret: true, quote: 'q' }, { from: 'c1', to: 'c3', type: 'LOCATED_AT', quote: 'q' }, { from: 'c4', to: 'c3', type: 'LOCATED_AT', quote: 'q' }],
      storylines: [{ ref: 's1', title: 'The Drowned Bell', summary: 'A cult wakes the drowned', acts: [{ title: 'The bell tolls', summary: 'Night one' }, { title: 'The drowned rise' }], cards: ['c1', 'c2'], quote: 'q' }],
      questions: [{ text: 'Willing or blackmailed?', about: 'c1' }, { text: 'How old is the bell?' }]
    }))
    const d = buildDraft([{ file: 'notes.docx', locator: 'paragraphs 1–3', result: answer }], c.importTargets(), { title: 'Session notes', source: 'Test AI · m', files: [] })
    return { d, harbour }
  }

  it('saves drafts in the campaign folder, outside the database', () => {
    const { d } = draftFor()
    c.saveImportDraft(d)
    expect(c.importDrafts()).toEqual([{ id: d.id, title: 'Session notes', createdAt: d.createdAt, status: 'open', cards: 4, openQuestions: 2 }])
    expect(c.history().log).toEqual(expect.not.arrayContaining([expect.objectContaining({ label: expect.stringContaining('Imported') })]))
    c.setImportStatus(d.id, 'discarded')
    expect(c.importDrafts()).toEqual([])
    expect(() => c.importDraft('../campaign')).toThrow(/Not an import draft/)
  })

  it('creates, merges, links, makes storylines and saves answers in one undo step', () => {
    const { d, harbour } = draftFor()
    d.cards.find((x) => x.name === 'Bell rope')!.decision = 'skip'
    d.questions[0] = { ...d.questions[0], answer: 'Blackmailed', status: 'answered' }
    c.saveImportDraft(d)
    const before = c.history().log.length
    expect(c.commitImport(d.id)).toEqual({ created: 2, merged: 1, storylines: 1, links: 2 })
    expect(c.history().log.length).toBe(before + 1)
    const ciaf = c.importTargets().find((x) => x.name === 'Ciaf Crol')!
    const sheet = c.sheet(ciaf.id)
    expect(sheet.entity.attributes).toMatchObject({
      summary: 'Harbourmaster', motivation: 'Hide the cult',
      notes: 'Q (notes import): Willing or blackmailed?\nA: Blackmailed',
      imported: { ai: 'Test AI · m', basis: 'stated', import: 'Session notes' }
    })
    expect(sheet.entity.attributes.provenance).toEqual([{ file: 'notes.docx', locator: 'paragraphs 1–3, ¶2', quote: 'Ciaf Crol runs the docks', basis: 'stated', import: 'Session notes', ai: 'Test AI · m' }])
    // Merge filled only the empty field and kept the DM's summary.
    expect(c.sheet(harbour.id).entity.attributes).toMatchObject({ summary: 'My own words', description: 'Fog and piers' })
    expect(c.importTargets().some((x) => x.name === 'Bell rope')).toBe(false)
    const tl = c.timeline()
    expect(tl.storylines.map((x) => x.title)).toContain('The Drowned Bell')
    expect(tl.acts.map((a) => a.title)).toEqual(['The bell tolls', 'The drowned rise'])
    expect(c.importDraft(d.id).status).toBe('committed')
    expect(() => c.commitImport(d.id)).toThrow(/already used/)
    // One Ctrl+Z takes it all back.
    c.undo()
    expect(c.importTargets().map((x) => x.name)).toEqual(['Old Harbour'])
    expect(c.sheet(harbour.id).entity.attributes.description).toBeUndefined()
    expect(c.timeline().acts).toEqual([])
  })
})
