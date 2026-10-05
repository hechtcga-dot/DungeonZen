import type { EntityType } from '../shared/schemas'

// Entity colours from docs/UI_SPEC.md. ITEM and HANDOUT have no agreed colour yet.
export const ENTITY_COLOURS: Record<EntityType, string> = {
  NPC: '#2f5d8a',
  PC: '#23395b',
  MONSTER: '#8a2f2f',
  LOCATION: '#2f6b4f',
  QUEST: '#7a5a12',
  CLUE: '#5a3f8a',
  FACTION: '#5a3f8a',
  SCENE: '#4a4f57',
  ITEM: '#6a4526',
  HANDOUT: '#4a4f57'
}

export const ENTITY_LABELS: Record<EntityType, string> = {
  NPC: 'NPC', PC: 'PC', MONSTER: 'Monster', LOCATION: 'Location', QUEST: 'Quest', ITEM: 'Item',
  SCENE: 'Scene', CLUE: 'Clue', FACTION: 'Faction', HANDOUT: 'Handout'
}
