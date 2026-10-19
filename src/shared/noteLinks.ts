import type { Block, Run } from './noteDoc'
import type { EntityType } from './schemas'

// Notes book view (2.8.0, owner): card names, spells and conditions link by themselves, like the official
// books: the first mention in each paragraph. The DM's own links (Run.link) win: a card or note id, or ''
// for "never link these words here". A card's picture shows at its first mention in the note.

export interface LinkCard { id: string; name: string; type: EntityType; picture: string; linkName?: boolean }

/** Setup › Linking names (3.0, owner): which card names link by themselves in notes and text boxes. Per campaign. */
export interface LinkRules { never: string[]; minLength: number; capitalOnly: boolean }
/** Everyday words a card may be called that never link by themselves (the DM edits the list). */
export const COMMON_WORDS = ['inn', 'tavern', 'rat', 'rats', 'guard', 'guards', 'the docks', 'docks', 'king', 'queen', 'temple', 'market', 'castle',
  'tower', 'gate', 'road', 'river', 'forest', 'city', 'town', 'village', 'shop', 'farm', 'mill', 'bridge', 'cave', 'church', 'priest', 'merchant',
  'soldier', 'bandit', 'bandits', 'wolf', 'wolves', 'spider', 'goblin', 'goblins', 'orc', 'orcs', 'dragon', 'letter', 'map', 'key', 'sword', 'ring', 'book']
export const DEFAULT_LINK_RULES: LinkRules = { never: COMMON_WORDS, minLength: 4, capitalOnly: true }
/** Types whose names link by themselves unless the DM unticks it on the card (owner, 2026-10-19). */
const BY_ITSELF: EntityType[] = ['NPC', 'PC', 'LOCATION', 'FACTION']
export const linksByItself = (c: { type: EntityType; linkName?: boolean }) => c.linkName ?? BY_ITSELF.includes(c.type)

/**
 * The card names that link by themselves (notes and every text box use this one rule): the card's tick, not on the
 * never list nor switched off, at least minLength letters; a one-word name only with its capital letter (exact).
 */
export function autoNames(cards: Array<{ id: string; name: string; type: EntityType; linkName?: boolean }>, rules: LinkRules, off: string[]): Array<{ text: string; target: Target; exact: boolean }> {
  const never = new Set([...rules.never, ...off].map((w) => w.trim().toLowerCase()))
  return cards.flatMap((c) => {
    const n = c.name.trim()
    if (!linksByItself(c) || n.length < rules.minLength || never.has(n.toLowerCase())) return []
    return [{ text: n, target: c.id, exact: rules.capitalOnly && !/\s/.test(n) }]
  })
}
/** What a piece of text links to: a card id, `note:<id>`, or a rules term (`term:<name>`). */
export type Target = string
export interface Hit { from: number; to: number; target: Target }
export interface Matcher { phrases: Array<{ text: string; target: Target; exact?: boolean }> }

const WORD = /[\p{L}\p{N}]/u

/** Short first names that are everyday words: never used alone as a card's short name. */
const NOT_ALIAS = new Set(['the', 'old', 'young', 'lady', 'lord', 'sir', 'captain', 'king', 'queen', 'mister', 'master', 'mother', 'father', 'brother', 'sister', 'little', 'big', 'black', 'white', 'red', 'green', 'blue', 'grey', 'gray', 'dark', 'great'])

/**
 * Everything a note can link by itself: card names (and an NPC or PC's first name when no other card shares it,
 * matched with its capital letter), the DM's own linked words, spells and conditions. Names switched off are left out.
 */
export function makeMatcher(cards: LinkCard[], own: Array<{ text: string; entityId: string }>, off: string[], terms: string[], rules: LinkRules = DEFAULT_LINK_RULES): Matcher {
  const offSet = new Set([...off, ...rules.never].map((o) => o.toLowerCase()))
  const phrases: Matcher['phrases'] = []
  for (const o of own) if (o.text.trim()) phrases.push({ text: o.text, target: o.entityId })
  phrases.push(...autoNames(cards, rules, off))
  const firsts = new Map<string, LinkCard[]>()
  for (const c of cards) {
    const first = c.name.trim().split(/\s+/)[0]
    if (c.name.trim().includes(' ') && first.length >= Math.max(4, rules.minLength)) firsts.set(first, [...(firsts.get(first) ?? []), c])
  }
  const names = new Set(cards.map((c) => c.name.trim().toLowerCase()))
  for (const [first, list] of firsts) {
    if (list.length !== 1 || !['NPC', 'PC'].includes(list[0].type) || !linksByItself(list[0]) || NOT_ALIAS.has(first.toLowerCase()) || names.has(first.toLowerCase()) || offSet.has(first.toLowerCase())) continue
    phrases.push({ text: first, target: list[0].id, exact: true })
  }
  for (const t of terms) if (!offSet.has(t.toLowerCase())) phrases.push({ text: t, target: `term:${t}` })
  phrases.sort((a, b) => b.text.length - a.text.length)
  return { phrases }
}

/** Every whole-word place a phrase appears (longest first, never overlapping), skipping the `blocked` ranges. */
export function findAll(text: string, m: Matcher, blocked: Array<[number, number]> = []): Hit[] {
  const low = text.toLowerCase()
  const hits: Hit[] = []
  const free = (a: number, b: number) => !hits.some((h) => a < h.to && b > h.from) && !blocked.some(([x, y]) => a < y && b > x)
  // Plain text search, no pattern per phrase (speed: 1,000 cards over 200 notes, 2026-10-19).
  for (const p of m.phrases) {
    const t = p.exact ? p.text : p.text.toLowerCase()
    const hay = p.exact ? text : low
    for (let i = hay.indexOf(t); i >= 0 && t; i = hay.indexOf(t, i + t.length)) {
      if (WORD.test(text[i - 1] ?? '') || WORD.test(text[i + t.length] ?? '')) continue
      if (free(i, i + t.length)) hits.push({ from: i, to: i + t.length, target: p.target })
    }
  }
  return hits.sort((a, b) => a.from - b.from)
}

/** The block's text and where the DM's own links sit in it. */
function flat(runs: Run[]): { text: string; own: Hit[]; blocked: Array<[number, number]> } {
  let text = ''
  const own: Hit[] = []
  const blocked: Array<[number, number]> = []
  for (const r of runs) {
    const from = text.length
    text += r.text
    if (r.link !== undefined) {
      blocked.push([from, text.length])
      if (r.link) {
        const last = own.at(-1)
        if (last && last.to === from && last.target === r.link) last.to = text.length
        else own.push({ from, to: text.length, target: r.link })
      }
    }
  }
  return { text, own, blocked }
}

/** A paragraph's links: the DM's own, then the first mention of each other card or term (book style). */
export function paragraphLinks(runs: Run[], m: Matcher): Hit[] {
  const { text, own, blocked } = flat(runs)
  const seen = new Set(own.map((h) => h.target))
  const auto = findAll(text, m, blocked).filter((h) => (seen.has(h.target) ? false : (seen.add(h.target), true)))
  return [...own, ...auto].sort((a, b) => a.from - b.from)
}

/** A piece of a paragraph to draw: the run's formatting, and what it links to. */
export interface Segment { run: Run; target?: Target; own?: boolean }

/** Cuts the runs at the links (a link may span runs with different formatting). */
export function segments(runs: Run[], hits: Hit[]): Segment[] {
  const out: Segment[] = []
  let pos = 0
  for (const r of runs) {
    const end = pos + r.text.length
    let at = pos
    for (const h of hits) {
      if (h.to <= at || h.from >= end) continue
      if (h.from > at) out.push({ run: { ...r, text: r.text.slice(at - pos, h.from - pos) } })
      const to = Math.min(h.to, end)
      out.push({ run: { ...r, text: r.text.slice(Math.max(h.from, at) - pos, to - pos) }, target: h.target, ...(r.link ? { own: true } : {}) })
      at = to
    }
    if (at < end) out.push({ run: { ...r, text: r.text.slice(at - pos) } })
    pos = end
  }
  return out
}

/** The text pieces of a block (a table gives one per cell; a picture none). */
export const blockRuns = (b: Block): Run[][] => (b.kind === 'pic' || b.kind === 'stat' ? [] : b.kind === 'table' ? b.rows.flat() : [b.runs])

/** Card types that show a picture at their first mention. */
const PICTURE_TYPES = new Set<EntityType>(['NPC', 'PC', 'MONSTER', 'LOCATION', 'BUILDING', 'ITEM', 'FACTION', 'HANDOUT', 'OTHER'])

/**
 * Where cards' pictures go by themselves: at the first paragraph that mentions the card (a heading's picture goes
 * with the paragraph under it), one picture per paragraph; a card the DM put in or took out is skipped.
 */
export function autoPictures(blocks: Block[], m: Matcher, cards: LinkCard[], hidden: string[]): Map<number, string> {
  const byId = new Map(cards.map((c) => [c.id, c]))
  const done = new Set([...hidden, ...blocks.flatMap((b) => ((b.kind === 'pic' || b.kind === 'stat') && b.card ? [b.card] : []))])
  const out = new Map<number, string>()
  let waiting: string[] = [] // mentioned in a heading: placed with the next paragraph
  blocks.forEach((b, i) => {
    if (b.kind === 'pic' || b.kind === 'stat') return
    const ids = blockRuns(b).flatMap((runs) => paragraphLinks(runs, m).map((h) => h.target))
    if (b.kind === 'h1' || b.kind === 'h2' || b.kind === 'h3') { waiting = [...waiting, ...ids]; return }
    const id = [...waiting, ...ids].find((x) => !done.has(x) && byId.get(x)?.picture && PICTURE_TYPES.has(byId.get(x)!.type))
    waiting = []
    if (id && b.kind !== 'table') { out.set(i, id); done.add(id) }
  })
  return out
}

/** The banner: the first place (Location or Building card) with a picture that the note mentions. */
export function autoBanner(blocks: Block[], m: Matcher, cards: LinkCard[]): string | null {
  const places = new Map(cards.filter((c) => (c.type === 'LOCATION' || c.type === 'BUILDING') && c.picture).map((c) => [c.id, c]))
  for (const b of blocks) for (const runs of blockRuns(b)) for (const h of paragraphLinks(runs, m)) if (places.has(h.target)) return h.target
  return null
}

/** Each card the note links to, with the heading it sits under (for "In your notes" on sheets). */
export function cardMentions(blocks: Block[], m: Matcher): Array<{ target: Target; heading: number; text: string }> {
  const out: Array<{ target: Target; heading: number; text: string }> = []
  let heading = -1
  blocks.forEach((b) => {
    if (b.kind === 'h1' || b.kind === 'h2' || b.kind === 'h3') { if (b.runs.some((r) => r.text.trim())) heading++; return }
    for (const runs of blockRuns(b)) {
      const text = runs.map((r) => r.text).join('')
      for (const h of paragraphLinks(runs, m)) out.push({ target: h.target, heading, text: snippet(text, h.from, h.to) })
    }
  })
  return out
}

/** About 120 characters around a mention. */
export function snippet(text: string, from: number, to: number): string {
  const a = Math.max(0, from - 60), b = Math.min(text.length, to + 60)
  return `${a > 0 ? '…' : ''}${text.slice(a, b).replace(/\s+/g, ' ').trim()}${b < text.length ? '…' : ''}`
}

const STOP = new Set(['I', 'A', 'An', 'The', 'This', 'That', 'These', 'Those', 'He', 'She', 'It', 'They', 'We', 'You', 'His', 'Her', 'Its', 'Their', 'Our', 'Your',
  'If', 'When', 'While', 'But', 'And', 'Or', 'So', 'As', 'At', 'In', 'On', 'Of', 'To', 'For', 'With', 'By', 'From', 'After', 'Before', 'Then', 'There', 'Here',
  'Chapter', 'Part', 'Act', 'Scene', 'Session', 'Appendix', 'DM', 'DC', 'XP', 'HP', 'AC', 'CR', 'PC', 'PCs', 'NPC', 'NPCs', 'Each', 'Every', 'Any', 'Some', 'No', 'Not', 'One', 'Two', 'Three',
  'Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma', 'Common', 'Hit', 'Melee', 'Ranged', 'Weapon', 'Attack', 'Monday', 'Mr', 'Mrs'])

/**
 * Names in the note that are not cards yet (for Make a card): capitalised words or runs of them that are not at the
 * start of a sentence, not a card, term or linked words, and not ignored. Most mentioned first.
 */
export function unknownNames(blocks: Block[], m: Matcher, ignore: string[]): Array<{ name: string; count: number; text: string }> {
  const skip = new Set(ignore.map((x) => x.toLowerCase()))
  const found = new Map<string, { count: number; text: string }>()
  const starts: string[] = [] // one word at a sentence start: counted only when the name shows elsewhere too
  for (const b of blocks) {
    if (b.kind === 'h1' || b.kind === 'h2' || b.kind === 'h3') continue
    for (const runs of blockRuns(b)) {
      const { text, blocked } = flat(runs)
      const linked = [...blocked, ...findAll(text, m).map((h) => [h.from, h.to] as [number, number])]
      for (const r of text.matchAll(/\p{Lu}[\p{L}'’-]+(?:\s+(?:of\s+|the\s+)?\p{Lu}[\p{L}'’-]+)*/gu)) {
        const i = r.index
        let name = r[0].replace(/['’]s$/, '')
        const before = text.slice(0, i).trimEnd()
        const sentenceStart = !before || /[.!?:;"“(]$/.test(before) || /\n$/.test(text.slice(0, i))
        const words = name.split(/\s+/)
        if (sentenceStart && words.length === 1) { starts.push(name); continue }
        if (sentenceStart && STOP.has(words[0])) { words.shift(); name = words.join(' ') }
        while (words.length && STOP.has(words[0])) { words.shift(); name = words.join(' ') }
        if (!name || name.length < 3 || STOP.has(name) || skip.has(name.toLowerCase())) continue
        if (linked.some(([x, y]) => i < y && i + r[0].length > x)) continue
        if (/^[\p{Lu}\s]+$/u.test(name) && name.length < 5) continue
        const f = found.get(name)
        if (f) f.count++
        else found.set(name, { count: 1, text: snippet(text, i, i + r[0].length) })
      }
    }
  }
  for (const n of starts) { const f = found.get(n); if (f) f.count++ }
  return [...found].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 40)
}

/** The runs with the DM's own link (or '' = no link) on the text from..to, formatting kept. */
export function setLinkRange(runs: Run[], from: number, to: number, link: string): Run[] {
  const out: Run[] = []
  let pos = 0
  for (const r of runs) {
    const end = pos + r.text.length
    const a = Math.max(from, pos), b = Math.min(to, end)
    if (a >= b) out.push(r)
    else {
      if (a > pos) out.push({ ...r, text: r.text.slice(0, a - pos) })
      out.push({ ...r, text: r.text.slice(a - pos, b - pos), link })
      if (b < end) out.push({ ...r, text: r.text.slice(b - pos) })
    }
    pos = end
  }
  return out
}
