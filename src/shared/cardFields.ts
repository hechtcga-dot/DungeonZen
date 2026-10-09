import type { EntityType } from './schemas'

// Text fields a card can have, per type. The sheet shows and edits all of them
// (rule 11); "Fill blanks with AI" offers the empty ones; the notes import fills them.

export interface CardField { key: string; label: string; long?: boolean; hint?: string }

const SUMMARY: CardField = { key: 'summary', label: 'One-line summary' }
const BIO: CardField = { key: 'bio', label: 'Bio', long: true }
const MOTIVATION: CardField = { key: 'motivation', label: 'Motivation' }
const LOCATION: CardField = { key: 'location', label: 'Default location' }
const HISTORY: CardField = { key: 'history', label: 'History', long: true }
/** Every card has one; it lives on the sheet's Secrets tab. */
export const SECRET: CardField = { key: 'secret', label: 'Secrets', long: true, hint: 'DM only. Never shown to players.' }
const SENSES: CardField[] = [
  { key: 'sights', label: 'Sights', long: true }, { key: 'sounds', label: 'Sounds' }, { key: 'smells', label: 'Smells' }
]

/**
 * The fields on the sheet's "Features, traits, background" tab (characters and creatures) or
 * "Descriptions & history" tab (everything else), besides motivation and bio (see tabFields).
 */
export const DETAIL_FIELDS: Record<EntityType, CardField[]> = {
  NPC: [
    { key: 'occupation', label: 'Occupation' }, { key: 'appearance', label: 'Appearance', long: true },
    { key: 'personality', label: 'Personality' }, { key: 'voice', label: 'Voice and manner', hint: 'How they talk, a phrase they use' },
    { key: 'ideals', label: 'Ideals' }, { key: 'bonds', label: 'Bonds' }, { key: 'flaws', label: 'Flaws' },
    { key: 'tactics', label: 'Tactics', long: true, hint: 'How they fight or get their way' }, { key: 'background', label: 'Background', long: true }
  ],
  PC: [
    { key: 'appearance', label: 'Appearance', long: true }, { key: 'personality', label: 'Personality' },
    { key: 'ideals', label: 'Ideals' }, { key: 'bonds', label: 'Bonds' }, { key: 'flaws', label: 'Flaws' },
    { key: 'background', label: 'Background', long: true }
  ],
  MONSTER: [
    { key: 'appearance', label: 'Appearance', long: true }, { key: 'tactics', label: 'Tactics', long: true },
    { key: 'habitat', label: 'Habitat' }, { key: 'lore', label: 'Lore', long: true, hint: 'What legends and scholars say about it' }
  ],
  LOCATION: [
    { key: 'description', label: 'Description (DM)', long: true }, ...SENSES,
    { key: 'atmosphere', label: 'Atmosphere', long: true, hint: 'How the townsfolk behave. Scene descriptions draw on this.' },
    { key: 'dangers', label: 'Dangers', long: true },
    { key: 'player_notes', label: 'What the players see', long: true, hint: 'Shown in Player preview' }, HISTORY
  ],
  FACTION: [
    { key: 'goals', label: 'Goals' }, { key: 'leader', label: 'Leader' }, { key: 'resources', label: 'Resources' },
    { key: 'symbol', label: 'Symbol and colours' }, HISTORY
  ],
  QUEST: [
    { key: 'hook', label: 'Hook', hint: 'How the party hears of it' }, { key: 'stakes', label: 'Stakes', hint: 'What happens if nobody acts' },
    { key: 'complications', label: 'Complications', long: true }, HISTORY
  ],
  ITEM: [
    { key: 'description', label: 'Description', long: true }, { key: 'appearance', label: 'Appearance' },
    { key: 'properties', label: 'Properties' }, { key: 'value', label: 'Value' }, HISTORY
  ],
  CLUE: [{ key: 'description', label: 'Description', long: true }, { key: 'leads_to', label: 'Leads to' }, HISTORY],
  HANDOUT: [{ key: 'description', label: 'Description', long: true, hint: 'What it looks like: paper, seal, handwriting' }, HISTORY],
  SCENE: [{ key: 'description', label: 'Description', long: true }, ...SENSES, { key: 'tactics', label: 'Tactics', long: true }]
}

/** The tab's name for this type. */
export function tabTitle(type: EntityType): string {
  return ['NPC', 'PC', 'MONSTER'].includes(type) ? 'Features, traits, background' : 'Descriptions & history'
}

/** Every field on the traits or descriptions tab, in order. */
export function tabFields(type: EntityType): CardField[] {
  const withMotive = ['NPC', 'PC', 'MONSTER', 'FACTION'].includes(type)
  return [...(withMotive ? [MOTIVATION] : []), ...DETAIL_FIELDS[type], BIO]
}

/** Every text field the AI may fill for a type, in sheet order. */
export function fillableFields(type: EntityType): CardField[] {
  const extra: CardField[] = []
  if (['NPC', 'MONSTER', 'ITEM'].includes(type)) extra.push(LOCATION)
  if (type === 'QUEST') extra.push({ key: 'reward', label: 'Reward' })
  if (type === 'HANDOUT') extra.push({ key: 'text', label: 'Handout text', long: true }, { key: 'from', label: 'Signed by' })
  return [SUMMARY, ...extra, ...tabFields(type).filter((f) => f !== BIO), SECRET, BIO]
}

/** Card types whose "Factions" field links them to faction cards, and the kind of string it ties. */
export const FACTION_LINK: Partial<Record<EntityType, string>> = { NPC: 'MEMBER_OF', PC: 'MEMBER_OF', LOCATION: 'CONTROLLED_BY' }

/** Attributes that are not free text for the DM to read (never shown as "other details"). */
export const INTERNAL_KEYS = new Set([
  'statblock', 'source', 'custom', 'colour', 'color', 'generated', 'count', 'encounter', 'target', 'battle_map_id', 'provenance', 'imported',
  'ai_filled', 'picture', 'current_hp', 'notes', 'summary', 'bio', 'motivation', 'location', 'reward', 'text', 'from', 'secret',
  'temp_hp', 'conditions', 'picture_source', 'biome', 'place_kind', 'level', 'spell_slots', 'slots_used'
])
