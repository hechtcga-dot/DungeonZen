import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { RELATIONSHIP_TYPES } from '../../shared/schemas'
import { IMPORT_CARD_TYPES, type Basis, type CardProposal, type ImportDraft, type LinkProposal, type QuestionProposal, type Source, type StorylineProposal } from '../../shared/notesImport'

// Notes import, step 2: ask the AI what is in each chunk, then put the answers together.
// Pure (the AI call is passed in), so it is tested without a network.

export const NOTES_SYSTEM = `You read a Dungeon Master's campaign notes for Dungeons & Dragons 5e and propose structured cards.
Reply with ONE JSON object and nothing else, in this shape:
{
 "cards": [{"ref": "c1", "type": one of ${JSON.stringify(IMPORT_CARD_TYPES)}, "name": "...", "summary": "one line",
   "details": {"motivation": "...", "location": "...", "appearance": "...", "bio": "...", "description": "...", "reward": "..."},
   "tags": ["..."], "quote": "exact words from the notes", "where": "the [¶n] or [pn] marker before the quote", "basis": "stated" or "inferred"}],
 "storylines": [{"ref": "s1", "title": "...", "summary": "...", "acts": [{"title": "...", "summary": "..."}], "cards": ["c1"], "quote": "...", "where": "...", "basis": "stated" or "inferred"}],
 "links": [{"from": "c1", "to": "c2", "type": one of ${JSON.stringify(RELATIONSHIP_TYPES.filter((t) => t !== 'BOARD_LINK'))}, "secret": true or false, "quote": "...", "where": "...", "basis": "stated" or "inferred"}],
 "questions": [{"text": "a question for the DM where the notes are unclear or contradict", "about": "c1" or null, "options": ["..."]}]
}
Rules:
- People are NPC (or MONSTER for creatures to fight); towns, buildings, regions and rooms are LOCATION; groups are FACTION; jobs and hooks are QUEST; secrets and leads are CLUE; objects are ITEM; documents the players can read are HANDOUT; set pieces and encounters are SCENE.
- "basis" is "stated" when the notes say it outright and "inferred" when you are guessing. Never present a guess as stated.
- Every card, storyline and link needs a short exact "quote" from the notes. Leave details out rather than invent them.
- "secret": true when the players should not know the link yet.
- If a card already exists in the campaign (list given), use exactly the same name.
- Ask a question instead of guessing when something important is unclear.`

export interface ChunkInput {
  file: string
  locator: string
  text: string
  image?: { bytes: Buffer; mime: string } | null
}

export function notesPrompt(chunk: ChunkInput, existing: Array<{ name: string; type: string }>, campaignName: string): string {
  const known = existing.slice(0, 300).map((e) => `${e.name} (${e.type})`).join('; ')
  return [
    `Campaign: ${campaignName}.`,
    known ? `Cards already in the campaign: ${known}.` : 'The campaign has no cards yet.',
    `File: ${chunk.file}, ${chunk.locator}.`,
    chunk.image
      ? 'The notes are in the attached picture (a photo, scan or hand-drawn map or module). Read the handwriting and labels; for "where" describe the spot ("top left", "the tower drawing").'
      : `Notes:\n"""\n${chunk.text}\n"""`
  ].join('\n')
}

// What one AI answer may contain. Each item is checked on its own; bad ones are dropped.
const RawBasis = z.string().transform((s): Basis => (/infer|guess/i.test(s) ? 'inferred' : 'stated'))
const RawCard = z.object({
  ref: z.coerce.string(), type: z.string(), name: z.string().trim().min(1).max(200),
  summary: z.string().max(2000).catch(''), details: z.record(z.string(), z.unknown()).catch({}),
  tags: z.array(z.string()).catch([]), quote: z.string().catch(''), where: z.string().catch(''), basis: RawBasis.catch('inferred')
})
const RawStory = z.object({
  ref: z.coerce.string().catch(''), title: z.string().trim().min(1).max(200), summary: z.string().catch(''),
  acts: z.array(z.object({ title: z.string().trim().min(1), summary: z.string().catch('') })).catch([]),
  cards: z.array(z.coerce.string()).catch([]), quote: z.string().catch(''), where: z.string().catch(''), basis: RawBasis.catch('inferred')
})
const RawLink = z.object({
  from: z.coerce.string(), to: z.coerce.string(), type: z.string().catch('KNOWS'), secret: z.boolean().catch(false),
  quote: z.string().catch(''), where: z.string().catch(''), basis: RawBasis.catch('inferred')
})
const RawQuestion = z.object({ text: z.string().trim().min(3).max(1000), about: z.coerce.string().nullable().catch(null), options: z.array(z.string()).catch([]) })

export interface ChunkResult {
  cards: Array<z.infer<typeof RawCard>>
  storylines: Array<z.infer<typeof RawStory>>
  links: Array<z.infer<typeof RawLink>>
  questions: Array<z.infer<typeof RawQuestion>>
  dropped: number
}

/** Finds the JSON object in a reply (code fences and chatter around it are fine). */
export function extractJson(reply: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(reply)
  const body = fenced ? fenced[1] : reply
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('The AI did not send back the expected list (no JSON found)')
  try {
    return JSON.parse(body.slice(start, end + 1))
  } catch {
    // A common slip: trailing commas.
    return JSON.parse(body.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1'))
  }
}

export function parseChunkReply(reply: string): ChunkResult {
  const raw = extractJson(reply) as Record<string, unknown>
  let dropped = 0
  const list = <T>(v: unknown, schema: z.ZodType<T>): T[] => {
    if (!Array.isArray(v)) return []
    return v.flatMap((x) => { const r = schema.safeParse(x); if (!r.success) dropped++; return r.success ? [r.data] : [] })
  }
  return {
    cards: list(raw.cards, RawCard), storylines: list(raw.storylines, RawStory),
    links: list(raw.links, RawLink), questions: list(raw.questions, RawQuestion), dropped
  }
}

const TYPE_WORDS: Record<string, string> = {
  PERSON: 'NPC', CHARACTER: 'NPC', NPC: 'NPC', VILLAIN: 'NPC', CREATURE: 'MONSTER', MONSTER: 'MONSTER', ENEMY: 'MONSTER',
  PLACE: 'LOCATION', LOCATION: 'LOCATION', TOWN: 'LOCATION', CITY: 'LOCATION', BUILDING: 'LOCATION', ROOM: 'LOCATION', REGION: 'LOCATION',
  GROUP: 'FACTION', FACTION: 'FACTION', ORGANIZATION: 'FACTION', ORGANISATION: 'FACTION', GUILD: 'FACTION', CULT: 'FACTION',
  QUEST: 'QUEST', HOOK: 'QUEST', JOB: 'QUEST', CLUE: 'CLUE', SECRET: 'CLUE', LEAD: 'CLUE', ITEM: 'ITEM', OBJECT: 'ITEM', ARTIFACT: 'ITEM',
  SCENE: 'SCENE', ENCOUNTER: 'SCENE', EVENT: 'SCENE', HANDOUT: 'HANDOUT', LETTER: 'HANDOUT', DOCUMENT: 'HANDOUT'
}
export function cardType(t: string): CardProposal['type'] {
  return (TYPE_WORDS[t.trim().toUpperCase()] ?? 'NPC') as CardProposal['type']
}
export function linkType(t: string): string {
  const u = t.trim().toUpperCase().replace(/[\s-]+/g, '_')
  if ((RELATIONSHIP_TYPES as readonly string[]).includes(u)) return u
  if (/ALL(Y|IES|IED)|FRIEND|SERVES|WORKS_FOR|EMPLOY/.test(u)) return 'ALLIED_WITH'
  if (/ENEM|HOSTIL|RIVAL|HATE|HUNT/.test(u)) return 'HOSTILE_TO'
  if (/MEMBER|BELONG|LEAD/.test(u)) return 'MEMBER_OF'
  if (/(^|_)(LIVES|LOCATED|AT|IN|FOUND|BASED)(_|$)/.test(u)) return 'LOCATED_AT'
  if (/QUEST/.test(u)) return 'TIED_TO_QUEST'
  return 'KNOWS'
}

// ---- matching names

export function normName(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/^(the|a|an)\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim()
}

function levenshtein(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]
    d[0] = i
    for (let j = 1; j <= b.length; j++) {
      const t = d[j]
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = t
    }
  }
  return d[b.length]
}

/** 1 for the same name, near 1 for a typo or one word added ("Ciaf" / "Ciaf Crol"). */
export function nameLikeness(a: string, b: string): number {
  const x = normName(a)
  const y = normName(b)
  if (!x || !y) return 0
  if (x === y) return 1
  const wordsX = x.split(' ')
  const wordsY = y.split(' ')
  // One name is all the words of the other ("Ciaf" in "Ciaf Crol", "Old Harbour" in "The Old Harbour district").
  if (wordsX.every((w) => wordsY.includes(w)) || wordsY.every((w) => wordsX.includes(w))) return 0.9
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length)
}

export function findDuplicate(name: string, type: string, existing: Array<{ id: string; name: string; type: string }>): CardProposal['duplicateOf'] {
  let best: { e: (typeof existing)[number]; score: number } | null = null
  for (const e of existing) {
    const score = nameLikeness(name, e.name) - (e.type === type ? 0 : 0.15)
    if (!best || score > best.score) best = { e, score }
  }
  if (!best || best.score < 0.8) return null
  return { id: best.e.id, name: best.e.name, type: best.e.type, exact: normName(best.e.name) === normName(name) && best.e.type === type }
}

// ---- putting the chunks together

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')

export interface ChunkAnswer { file: string; locator: string; result: ChunkResult }

/**
 * Turns the AI's answers for every chunk into one draft: the same card found in two
 * places becomes one proposal with both sources; links and storylines point at it.
 */
export function buildDraft(
  answers: ChunkAnswer[],
  existing: Array<{ id: string; name: string; type: string }>,
  meta: { title: string; source: string; files: ImportDraft['files'] }
): ImportDraft {
  const cards: CardProposal[] = []
  const storylines: StorylineProposal[] = []
  const links: LinkProposal[] = []
  const questions: QuestionProposal[] = []
  let dropped = 0
  const src = (a: ChunkAnswer, quote: string, where: string, basis: Basis): Source =>
    ({ file: a.file, locator: where.trim() ? `${a.locator}, ${where.trim().replace(/^\[|\]$/g, '')}` : a.locator, quote: quote.trim().slice(0, 2000), basis })

  for (const a of answers) {
    dropped += a.result.dropped
    const refs = new Map<string, string>()
    for (const c of a.result.cards) {
      const type = cardType(c.type)
      const details: Record<string, string> = {}
      for (const [k, v] of Object.entries(c.details)) if (str(v)) details[k.toLowerCase()] = str(v).slice(0, 5000)
      const same = cards.find((x) => x.type === type && normName(x.name) === normName(c.name))
      const source = src(a, c.quote, c.where, c.basis)
      if (same) {
        refs.set(c.ref, same.id)
        same.sources.push(source)
        if (c.summary.length > same.summary.length) same.summary = c.summary
        for (const [k, v] of Object.entries(details)) if (!same.details[k]) same.details[k] = v
        same.tags = [...new Set([...same.tags, ...c.tags])].slice(0, 20)
        if (c.basis === 'stated') same.basis = 'stated'
        continue
      }
      const dup = findDuplicate(c.name, type, existing)
      const p: CardProposal = {
        id: randomUUID(), type, name: c.name.trim(), summary: c.summary.trim(), details, tags: c.tags.map((t) => t.trim()).filter(Boolean).slice(0, 20),
        sources: [source], basis: c.basis, duplicateOf: dup, decision: dup?.exact ? 'merge' : 'create'
      }
      refs.set(c.ref, p.id)
      cards.push(p)
    }
    // A ref the AI did not define may be a card name (or an existing card's name).
    const resolve = (ref: string): string | null => {
      if (refs.has(ref)) return refs.get(ref)!
      const byName = cards.find((x) => normName(x.name) === normName(ref))
      if (byName) return byName.id
      const ex = existing.find((e) => normName(e.name) === normName(ref))
      return ex ? `entity:${ex.id}` : null
    }
    for (const s of a.result.storylines) {
      const same = storylines.find((x) => normName(x.title) === normName(s.title))
      const ids = s.cards.map(resolve).filter((x): x is string => !!x && !x.startsWith('entity:'))
      if (same) {
        same.sources.push(src(a, s.quote, s.where, s.basis))
        same.cardIds = [...new Set([...same.cardIds, ...ids])]
        for (const act of s.acts) if (!same.acts.some((x) => normName(x.title) === normName(act.title))) same.acts.push(act)
        continue
      }
      storylines.push({
        id: randomUUID(), title: s.title.trim(), summary: s.summary.trim(), acts: s.acts.slice(0, 20), cardIds: ids,
        sources: [src(a, s.quote, s.where, s.basis)], basis: s.basis, decision: 'create'
      })
    }
    for (const l of a.result.links) {
      const from = resolve(l.from)
      const to = resolve(l.to)
      if (!from || !to || from === to) { dropped++; continue }
      const type = linkType(l.type)
      if (links.some((x) => x.fromId === from && x.toId === to && x.type === type)) continue
      links.push({ id: randomUUID(), fromId: from, toId: to, type, secret: l.secret, sources: [src(a, l.quote, l.where, l.basis)], basis: l.basis, decision: 'create' })
    }
    for (const q of a.result.questions) {
      questions.push({ id: randomUUID(), text: q.text, aboutId: q.about ? resolve(q.about) : null, options: q.options.slice(0, 6), answer: '', status: 'open' })
    }
  }
  return {
    id: randomUUID(), title: meta.title, createdAt: new Date().toISOString(), status: 'open', source: meta.source,
    files: meta.files, cards, storylines, links, questions, dropped
  }
}
