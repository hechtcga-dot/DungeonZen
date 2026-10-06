import type { EntityType } from './schemas'

// Text fields a card can have, per type. The sheet shows and edits all of them
// (rule 11); "Fill blanks with AI" offers the empty ones; the notes import fills them.

export interface CardField { key: string; label: string; long?: boolean; hint?: string }

const SUMMARY: CardField = { key: 'summary', label: 'One-line summary' }
const BIO: CardField = { key: 'bio', label: 'Bio', long: true }
const MOTIVATION: CardField = { key: 'motivation', label: 'Motivation' }
const LOCATION: CardField = { key: 'location', label: 'Default location' }

/** Fields shown in the sheet's Details panel (the rest have their own place on the sheet). */
export const DETAIL_FIELDS: Record<EntityType, CardField[]> = {
  NPC: [
    { key: 'occupation', label: 'Occupation' }, { key: 'appearance', label: 'Appearance', long: true },
    { key: 'personality', label: 'Personality' }, { key: 'voice', label: 'Voice and manner', hint: 'How they talk, a phrase they use' },
    { key: 'secret', label: 'Secret', hint: 'DM only' }
  ],
  PC: [{ key: 'appearance', label: 'Appearance', long: true }, { key: 'personality', label: 'Personality' }],
  MONSTER: [{ key: 'appearance', label: 'Appearance', long: true }, { key: 'tactics', label: 'Tactics', long: true }, { key: 'habitat', label: 'Habitat' }],
  LOCATION: [
    { key: 'description', label: 'Description (DM)', long: true }, { key: 'atmosphere', label: 'Sights, sounds and smells' },
    { key: 'player_notes', label: 'What the players see', long: true, hint: 'Shown in Player preview' }, { key: 'dangers', label: 'Dangers' }
  ],
  FACTION: [{ key: 'goals', label: 'Goals' }, { key: 'leader', label: 'Leader' }, { key: 'resources', label: 'Resources' }, { key: 'symbol', label: 'Symbol and colours' }],
  QUEST: [{ key: 'hook', label: 'Hook', hint: 'How the party hears of it' }, { key: 'complications', label: 'Complications', long: true }],
  ITEM: [{ key: 'description', label: 'Description', long: true }, { key: 'properties', label: 'Properties' }, { key: 'value', label: 'Value' }, { key: 'history', label: 'History', long: true }],
  CLUE: [{ key: 'description', label: 'Description', long: true }, { key: 'leads_to', label: 'Leads to' }],
  HANDOUT: [],
  SCENE: [{ key: 'description', label: 'Description', long: true }, { key: 'tactics', label: 'Tactics', long: true }]
}

/** Every text field the AI may fill for a type, in sheet order. */
export function fillableFields(type: EntityType): CardField[] {
  const extra: CardField[] = []
  if (['NPC', 'PC', 'MONSTER', 'FACTION'].includes(type)) extra.push(MOTIVATION)
  if (['NPC', 'MONSTER', 'ITEM'].includes(type)) extra.push(LOCATION)
  if (type === 'QUEST') extra.push({ key: 'reward', label: 'Reward' })
  if (type === 'HANDOUT') extra.push({ key: 'text', label: 'Handout text', long: true }, { key: 'from', label: 'Signed by' })
  return [SUMMARY, ...extra, ...DETAIL_FIELDS[type], BIO]
}

/** Attributes that are not free text for the DM to read (never shown as "other details"). */
export const INTERNAL_KEYS = new Set([
  'statblock', 'source', 'custom', 'colour', 'color', 'generated', 'count', 'encounter', 'target', 'battle_map_id', 'provenance', 'imported',
  'ai_filled', 'picture', 'current_hp', 'notes', 'summary', 'bio', 'motivation', 'location', 'reward', 'text', 'from'
])
