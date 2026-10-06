import type { EntityType } from '../shared/schemas'

// Entity colours from docs/UI_SPEC.md (ITEM copper and HANDOUT sepia chosen 2026-10-06; the DM can recolour any card).
export const ENTITY_COLOURS: Record<EntityType, string> = {
  NPC: '#2f5d8a',
  PC: '#23395b',
  MONSTER: '#8a2f2f',
  LOCATION: '#2f6b4f',
  QUEST: '#7a5a12',
  CLUE: '#5a3f8a',
  FACTION: '#5a3f8a',
  SCENE: '#4a4f57',
  ITEM: '#9c4f1f',
  HANDOUT: '#6b5a3a'
}

export const ENTITY_LABELS: Record<EntityType, string> = {
  NPC: 'NPC', PC: 'PC', MONSTER: 'Monster', LOCATION: 'Location', QUEST: 'Quest', ITEM: 'Item',
  SCENE: 'Scene', CLUE: 'Clue', FACTION: 'Faction', HANDOUT: 'Handout'
}
