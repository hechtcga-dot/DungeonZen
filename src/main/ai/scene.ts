// Read-aloud scene text (docs/ARCHITECTURE.md §4, "Scene description").
// Pure: builds the request from what the campaign knows; the reply is shown to the
// DM as a suggestion and only saved when the DM uses it (rules 2 and 10).

export interface SceneContext {
  campaignName: string
  /** "Day 3 · 21:40" */
  when: string
  light: 'night' | 'dawn' | 'daylight' | 'dusk'
  moon: string
  place: { name: string; notes: string; inside: string | null } | null
  /** Who and what the cards place there (names and types only). */
  present: Array<{ name: string; type: string }>
  /** The last few session log lines, newest last. */
  recent: string[]
  /** What is already written, if the DM wants it reworked. */
  current: string
}

export const SCENE_SYSTEM = [
  'You help a Dungeon Master running Dungeons & Dragons 5e.',
  'Write read-aloud text: what the players see, hear and smell, in second person ("You...").',
  'Two short paragraphs at most, about 90 to 140 words, vivid and plain.',
  'Never decide what the characters do or feel, never reveal secrets, numbers or rules, and do not name people the party has not met unless the DM asks.',
  'Use only the facts given; invent small sensory details, not new people, places or plot.',
  'Reply with the read-aloud text only, no title or notes.'
].join(' ')

export function scenePrompt(ctx: SceneContext, ask: string): string {
  const lines: string[] = [`Campaign: ${ctx.campaignName}.`, `Time: ${ctx.when} (${ctx.light}). Moon: ${ctx.moon}.`]
  if (ctx.place) {
    lines.push(`Where the party is: ${ctx.place.name}${ctx.place.inside ? `, in ${ctx.place.inside}` : ''}.`)
    if (ctx.place.notes.trim()) lines.push(`DM notes on this place: ${clip(ctx.place.notes, 1200)}`)
  } else {
    lines.push('Where the party is: not placed on a map.')
  }
  if (ctx.present.length) lines.push(`Also there (from the DM's cards): ${ctx.present.slice(0, 12).map((p) => `${p.name} (${p.type.toLowerCase()})`).join(', ')}.`)
  if (ctx.recent.length) lines.push(`What just happened: ${ctx.recent.slice(-5).map((l) => clip(l, 200)).join(' / ')}`)
  if (ctx.current.trim()) lines.push(`The DM's current text, to rework: ${clip(ctx.current, 1500)}`)
  lines.push(ask.trim() ? `The DM asks for: ${clip(ask, 600)}` : 'Describe the scene as the party arrives or looks around.')
  return lines.join('\n')
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}
