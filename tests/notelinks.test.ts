import { describe, expect, it } from 'vitest'
import { setLinkRange, autoBanner, autoPictures, cardMentions, makeMatcher, paragraphLinks, segments, unknownNames, type LinkCard } from '../src/shared/noteLinks'
import type { Block } from '../src/shared/noteDoc'

const cards: LinkCard[] = [
  { id: 'maren', name: 'Maren Holloway', type: 'NPC', picture: 'p/maren.png' },
  { id: 'salt', name: 'Saltmere', type: 'LOCATION', picture: 'p/salt.png' },
  { id: 'hag', name: 'Sea Hag', type: 'MONSTER', picture: '' },
  { id: 'old', name: 'Old Wyn', type: 'NPC', picture: 'p/wyn.png' }
]
const m = makeMatcher(cards, [], [], ['Charmed', 'Detect Magic'])
const p = (text: string): Block => ({ kind: 'p', runs: [{ text }] })

describe('notes book links (2.8.0)', () => {
  it('links the first mention of each card and term in a paragraph, whole words only', () => {
    const hits = paragraphLinks([{ text: 'Maren Holloway is charmed in Saltmere. Saltmere is cold; Maren smiles. Saltmeres no.' }], m)
    expect(hits.map((h) => h.target)).toEqual(['maren', 'term:Charmed', 'salt'])
  })
  it('uses a short first name for people, with its capital letter, and never an everyday word', () => {
    expect(paragraphLinks([{ text: 'Then Maren left.' }], m).map((h) => h.target)).toEqual(['maren'])
    expect(paragraphLinks([{ text: 'Then maren left.' }], m)).toEqual([])
    expect(paragraphLinks([{ text: 'An Old man.' }], m)).toEqual([])
  })
  it('keeps the DM’s own links and no-link words', () => {
    const runs = [{ text: 'Saltmere', link: '' }, { text: ' and ' }, { text: 'the town', link: 'salt' }, { text: ' and Saltmere' }]
    expect(paragraphLinks(runs, m)).toEqual([{ from: 13, to: 21, target: 'salt' }])
  })
  it('puts the DM’s own link on part of a paragraph', () => {
    expect(setLinkRange([{ text: 'Ask Maren ', b: true }, { text: 'now' }], 4, 9, '')).toEqual([
      { text: 'Ask ', b: true }, { text: 'Maren', b: true, link: '' }, { text: ' ', b: true }, { text: 'now' }])
  })
  it('cuts runs at links, keeping formatting', () => {
    const segs = segments([{ text: 'See Maren ', b: true }, { text: 'Holloway now' }], [{ from: 4, to: 18, target: 'maren' }])
    expect(segs).toEqual([
      { run: { text: 'See ', b: true } }, { run: { text: 'Maren ', b: true }, target: 'maren' }, { run: { text: 'Holloway' }, target: 'maren' }, { run: { text: ' now' } }
    ])
  })
  it('puts a picture at a card’s first mention, one per paragraph, heading pictures under the heading', () => {
    const blocks: Block[] = [{ kind: 'h2', runs: [{ text: 'Maren Holloway' }] }, p('She lives in Saltmere.'), p('Saltmere again, with Old Wyn.'), p('Old Wyn.')]
    expect([...autoPictures(blocks, m, cards, [])]).toEqual([[1, 'maren'], [2, 'salt'], [3, 'old']])
    expect([...autoPictures(blocks, m, cards, ['maren'])]).toEqual([[1, 'salt'], [2, 'old']])
    expect([...autoPictures([...blocks, { kind: 'pic', card: 'salt', side: 'left' }], m, cards, ['maren'])]).toEqual([[2, 'old']])
    expect(autoBanner(blocks, m, cards)).toBe('salt')
  })
  it('lists mentions under their heading and names that are not cards yet', () => {
    const blocks: Block[] = [p('Maren knows.'), { kind: 'h2', runs: [{ text: 'The Tower' }] }, p('The stranger Talis paid Maren. Talis left for Greyhollow Keep. The end.')]
    expect(cardMentions(blocks, m).map((x) => [x.target, x.heading])).toEqual([['maren', -1], ['maren', 0]])
    expect(unknownNames(blocks, m, ['greyhollow keep']).map((x) => [x.name, x.count])).toEqual([['Talis', 2]])
  })
})
