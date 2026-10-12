import type { EntityType } from '../shared/schemas'
import { useCallback } from 'react'
import { useBoard } from './store'

// Entity colours from docs/UI_SPEC.md (ITEM copper and HANDOUT sepia chosen 2026-10-06; the DM can recolour any card).
export const ENTITY_COLOURS: Record<EntityType, string> = {
  NPC: '#2f5d8a',
  PC: '#23395b',
  MONSTER: '#8a2f2f',
  LOCATION: '#2f6b4f',
  QUEST: '#7a5a12',
  CLUE: '#5a3f8a',
  FACTION: '#7a3a66',
  SCENE: '#4a4f57',
  ITEM: '#9c4f1f',
  HANDOUT: '#6b5a3a'
}

export const ENTITY_LABELS: Record<EntityType, string> = {
  NPC: 'NPC', PC: 'PC', MONSTER: 'Monster', LOCATION: 'Location', QUEST: 'Quest', ITEM: 'Item',
  SCENE: 'Scene', CLUE: 'Clue', FACTION: 'Faction', HANDOUT: 'Handout'
}

/** The colour of each card type in this campaign: the DM's choice (board › Card, right-click a type) or the standard one. */
export function useTypeColour(): (t: EntityType) => string {
  const own = useBoard((s) => s.view?.settings.typeColours)
  return useCallback((t: EntityType) => own?.[t] ?? ENTITY_COLOURS[t], [own])
}

/** A card's colour: its own (sheet › Card colour, or right-click › Card colour), else its type's. */
export function cardColour(e: { type: EntityType; attributes: Record<string, unknown> }, typeColour: (t: EntityType) => string): string {
  return typeof e.attributes.colour === 'string' ? e.attributes.colour : typeColour(e.type)
}
