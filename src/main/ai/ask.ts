// Live desk › Ask AI: quick requests about where the party is (an NPC, a complication,
// rumours…) or anything the DM types. Pure: builds the request; the answer is shown as an
// AI suggestion and only kept if the DM keeps it (rules 2 and 10).

import { scenePrompt, type SceneContext } from './scene'

export const ASK_PRESETS = {
  npc: 'Invent one NPC who could plausibly be here right now: name, ancestry, a look in one line, what they want, a secret, and one line of dialogue.',
  scene: 'Suggest one short scene that could happen here next, with a hook that ties to the open storylines or secrets.',
  complication: 'Give three quick complications that could hit the party here, one line each.',
  rumours: 'Give four rumours the party could overhear here: two true (based on the facts), two false. Mark which is which for the DM.',
  loot: 'Suggest a small find or reward that fits this place: one mundane, one curious, one useful, one line each.',
  names: 'Give eight names that fit this place and its people, as a comma-separated list.'
} as const
export type AskPreset = keyof typeof ASK_PRESETS

export const ASK_SYSTEM = [
  'You help a Dungeon Master running Dungeons & Dragons 5e (2024 rules) at the table.',
  'Answers are read mid-game: short, concrete and usable straight away, no preamble.',
  'Stay consistent with the facts given. You may use the DM-only secrets to make suggestions, but say when something would reveal one.',
  'Plain text; short lists are fine.'
].join(' ')

export interface AskExtras {
  cameFrom: string | null
  headingTo: string | null
  /** DM-only: secrets that could come out here. */
  secrets: string[]
  /** Planned scenes from the prep sheet. */
  scenes: string[]
}

export function askPrompt(ctx: SceneContext, extras: AskExtras, preset: AskPreset | null, ask: string): string {
  const base = scenePrompt({ ...ctx, current: '' }, '').split('\n').slice(0, -1) // the facts, without the scene request
  const lines = [...base]
  if (extras.cameFrom) lines.push(`They came from: ${extras.cameFrom}.`)
  if (extras.headingTo) lines.push(`They are heading to: ${extras.headingTo}.`)
  if (extras.scenes.length) lines.push(`Planned scenes: ${extras.scenes.slice(0, 6).join(' / ')}`)
  if (extras.secrets.length) lines.push(`DM-only secrets here: ${extras.secrets.slice(0, 8).join(' / ')}`)
  const request = [preset ? ASK_PRESETS[preset] : '', ask.trim()].filter(Boolean).join(' The DM adds: ')
  lines.push(`Request: ${request || 'Give the DM one useful idea for this moment.'}`)
  return lines.join('\n')
}
