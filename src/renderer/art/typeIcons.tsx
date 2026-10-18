import type { EntityType } from '../../shared/schemas'

// Small line icons for card types (16 × 16, drawn in the card's light ink on its type colour).
const PATHS: Record<EntityType | 'ENCOUNTER', string> = {
  NPC: 'M8 2.5a2.6 2.6 0 1 1 0 5.2a2.6 2.6 0 1 1 0-5.2M3 14c0-3 2.2-4.8 5-4.8s5 1.8 5 4.8', // head and shoulders
  PC: 'M8 1.8l5 2v4c0 3.2-2.2 5.3-5 6.4c-2.8-1.1-5-3.2-5-6.4v-4zM8 5v6M5.5 7.5h5', // shield
  MONSTER: 'M4 2.5l2.5 11M7.5 2l1.8 11.5M11 2.5l1 10', // claw marks
  LOCATION: 'M8 14.5s-4.5-4.6-4.5-8a4.5 4.5 0 0 1 9 0c0 3.4-4.5 8-4.5 8zM8 4.6a1.7 1.7 0 1 0 0 3.4a1.7 1.7 0 1 0 0-3.4', // map pin
  QUEST: 'M4 2.5h7.5v11H4zM4 2.5c-1.2 0-1.8.7-1.8 1.6h1.8M11.5 13.5c1.2 0 1.8-.7 1.8-1.6h-1.8M6 5.5h3.5M6 8h3.5M6 10.5h2', // scroll
  ITEM: 'M12.5 2l1.5 1.5l-7 7l-1.5-1.5zM4.5 9l2.5 2.5M3 13l2.5-2.5', // sword
  SCENE: 'M2.5 5h11v8.5h-11zM2.5 5l2-2.5h9l-2 2.5M6 5l2-2.5M9.5 5l2-2.5', // clapper board
  CLUE: 'M6.8 2.5a4.3 4.3 0 1 1 0 8.6a4.3 4.3 0 1 1 0-8.6M10 10l4 4', // magnifying glass
  FACTION: 'M3.5 14.5V2M3.5 2.5h9l-2 3l2 3h-9', // banner
  HANDOUT: 'M2.5 4h11v8.5h-11zM2.5 4l5.5 4.8l5.5-4.8', // letter
  BUILDING: 'M2.5 7.5l5.5-5l5.5 5M4 6.5v7.5h8V6.5M6.8 14v-3.5h2.4V14', // house
  OTHER: 'M8 2l6 6l-6 6l-6-6z', // diamond
  ENCOUNTER: 'M3 2.5l8.5 8.5M13 2.5l-8.5 8.5M9.5 12.5l3-3M3.5 9.5l3 3M2.5 13.5l1.5-1.5M13.5 13.5l-1.5-1.5' // crossed swords
}

export function TypeIcon({ type, encounter }: { type: EntityType; encounter?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[encounter ? 'ENCOUNTER' : type]} />
    </svg>
  )
}
