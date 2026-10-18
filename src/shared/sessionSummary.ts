// Session summary (owner, 2026-10-18): the session's "What happened", filled from what the table did.
// The plain version needs no AI: short sentences the DM polishes. The AI reads the same facts.

export interface SessionFacts {
  number: number
  /** Where the party was when the session started, with its card's one-line summary. */
  start: { name: string; about: string } | null
  /** Where they travelled to, in order. */
  places: Array<{ name: string; about: string }>
  /** People met (logged meetings, prep NPCs ticked Met). */
  npcs: Array<{ name: string; about: string }>
  /** Secrets and clues ticked Revealed. */
  clues: string[]
  /** Scenes ticked Played (not encounters). */
  scenes: Array<{ title: string; place: string | null }>
  /** Fights logged: the encounter (or the fight's own words) and where. */
  fights: Array<{ name: string; place: string | null }>
  /** Other logged moments: notes, quests delivered, rests. */
  events: string[]
  /** The DM's notes from the Live desk for this session. */
  notes: string
}

const about = (s: string) => s.trim().replace(/[.!?]+$/, '').replace(/^\p{Lu}(?!\p{Lu})/u, (c) => c.toLowerCase())
const named = (x: { name: string; about: string }) => (x.about.trim() ? `${x.name}, ${about(x.about)}` : x.name)
const and = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`)
const sentence = (s: string) => { const t = s.trim(); return t ? `${t[0].toUpperCase()}${t.slice(1)}${/[.!?]$/.test(t) ? '' : '.'}` : '' }

/** The plain summary: one paragraph of what happened, then the DM's notes as they are. Empty when nothing is known. */
export function summaryText(f: SessionFacts): string {
  const s: string[] = []
  if (f.start) s.push(`The party continues their adventures in ${named(f.start)}`)
  if (f.places.length) s.push(`they travelled to ${and(f.places.map(named))}`)
  if (f.npcs.length) s.push(`they met ${and(f.npcs.map(named))}`)
  if (f.clues.length) s.push(`they learned ${and(f.clues.map(about))}`)
  if (f.scenes.length) s.push(`they went through ${and(f.scenes.map((x) => (x.place ? `${x.title} at ${x.place}` : x.title)))}`)
  if (f.fights.length) s.push(`they fought ${and(f.fights.map((x) => (x.place ? `${x.name} at ${x.place}` : x.name)))}`)
  s.push(...f.events)
  return [s.map(sentence).filter(Boolean).join(' '), f.notes.trim()].filter(Boolean).join('\n\n')
}

/** The same facts as a list, for the AI to tell as a story. */
export function factsText(f: SessionFacts): string {
  const list = (title: string, xs: string[]) => (xs.length ? `${title}:\n${xs.map((x) => `- ${x}`).join('\n')}` : '')
  return [
    f.start ? `Where the party started: ${named(f.start)}` : '',
    list('Places they travelled to', f.places.map(named)),
    list('People they met', f.npcs.map(named)),
    list('Secrets and clues they learned', f.clues),
    list('Scenes played', f.scenes.map((x) => (x.place ? `${x.title} (at ${x.place})` : x.title))),
    list('Fights', f.fights.map((x) => (x.place ? `${x.name} (at ${x.place})` : x.name))),
    list('Other moments from the log', f.events)
  ].filter(Boolean).join('\n\n')
}
