// Line-art emblems for tarot-style cards, one per entity type plus a set for
// storylines. Original drawings in ink on parchment.

import type { EntityType } from '../../shared/schemas'

const INK = '#2a1f12'

function Svg({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <svg viewBox="0 0 100 100" className="emblem" role={label ? 'img' : undefined} aria-label={label}
      aria-hidden={label ? undefined : true} fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  )
}

const RAYS = Array.from({ length: 12 }, (_, i) => {
  const a = (i * Math.PI) / 6
  return `M${50 + Math.cos(a) * 22} ${50 + Math.sin(a) * 22} L${50 + Math.cos(a) * 34} ${50 + Math.sin(a) * 34}`
}).join(' ')

export const STORY_EMBLEMS = {
  sun: <><circle cx="50" cy="50" r="16" fill="#f0c24a" /><path d={RAYS} /></>,
  moon: <><path d="M60 20 A32 32 0 1 0 62 80 A26 26 0 1 1 60 20 Z" fill="#d9d2b8" /><circle cx="70" cy="30" r="2" fill={INK} /><circle cx="78" cy="56" r="1.5" fill={INK} /></>,
  star: <><path d="M50 14 L58 40 L86 42 L64 58 L72 86 L50 70 L28 86 L36 58 L14 42 L42 40 Z" fill="#f0c24a" /></>,
  tower: <><path d="M36 88 L40 30 L60 30 L64 88 Z" fill="#b8a37a" /><path d="M36 30 L36 20 L42 20 L42 26 L47 26 L47 20 L53 20 L53 26 L58 26 L58 20 L64 20 L64 30" /><path d="M46 88 L46 74 Q50 68 54 74 L54 88" fill={INK} /><path d="M48 44 L52 44 L52 54 L48 54 Z" fill={INK} /><path d="M70 12 L60 24 L68 26 L58 40" stroke="#c4433a" strokeWidth="3" /></>,
  wheel: <><circle cx="50" cy="50" r="32" /><circle cx="50" cy="50" r="22" fill="#d9c08a" /><circle cx="50" cy="50" r="6" fill={INK} /><path d="M50 18 L50 82 M18 50 L82 50 M27 27 L73 73 M73 27 L27 73" /></>,
  sword: <><path d="M50 10 L56 22 L54 66 L46 66 L44 22 Z" fill="#cfd6dc" /><path d="M34 66 L66 66" strokeWidth="4" /><path d="M50 66 L50 84" strokeWidth="5" stroke="#6a4526" /><circle cx="50" cy="88" r="4" fill="#d9a84e" /></>,
  chalice: <><path d="M30 22 L70 22 Q70 52 50 56 Q30 52 30 22 Z" fill="#d9a84e" /><path d="M50 56 L50 76 M36 84 Q50 74 64 84 Z" fill="#d9a84e" /><path d="M36 84 L64 84" /><path d="M40 30 Q50 34 60 30" /></>,
  crown: <><path d="M20 70 L24 30 L38 50 L50 22 L62 50 L76 30 L80 70 Z" fill="#f0c24a" /><path d="M20 78 L80 78" strokeWidth="4" /><circle cx="50" cy="60" r="4" fill="#c4433a" /><circle cx="34" cy="62" r="3" fill="#2f5d8a" /><circle cx="66" cy="62" r="3" fill="#2f5d8a" /></>,
  key: <><circle cx="34" cy="36" r="14" fill="#d9a84e" /><circle cx="34" cy="36" r="5" fill="#efe3c4" /><path d="M44 46 L80 82 M66 68 L74 60 M74 76 L82 68" strokeWidth="4" /></>,
  eye: <><path d="M12 50 Q50 14 88 50 Q50 86 12 50 Z" fill="#efe3c4" /><circle cx="50" cy="50" r="13" fill="#2f5d8a" /><circle cx="50" cy="50" r="5" fill={INK} /><path d="M50 18 L50 10 M30 24 L26 16 M70 24 L74 16" /></>
} as const
export type StoryEmblem = keyof typeof STORY_EMBLEMS
const STORY_KEYS = Object.keys(STORY_EMBLEMS) as StoryEmblem[]

/** A stable emblem for a storyline, chosen from its id. */
export function storyEmblemFor(id: string): StoryEmblem {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return STORY_KEYS[h % STORY_KEYS.length]
}

export function StoryEmblemArt({ emblem }: { emblem: StoryEmblem }) {
  return <Svg>{STORY_EMBLEMS[emblem]}</Svg>
}

const TYPE_ART: Record<EntityType, React.ReactNode> = {
  NPC: <><circle cx="50" cy="36" r="14" fill="#e3cfa6" /><path d="M24 84 Q24 56 50 56 Q76 56 76 84 Z" fill="#2f5d8a" /><path d="M44 34 L46 34 M54 34 L56 34 M45 42 Q50 45 55 42" /></>,
  PC: <><path d="M50 12 L80 24 L76 58 Q70 78 50 88 Q30 78 24 58 L20 24 Z" fill="#23395b" /><path d="M50 22 L50 78 M32 42 L68 42" stroke="#f0c24a" strokeWidth="4" /></>,
  MONSTER: <><path d="M22 74 Q18 40 34 24 L38 40 L44 22 L50 38 L56 22 L62 40 L66 24 Q82 40 78 74 Z" fill="#8a2f2f" /><circle cx="40" cy="54" r="4" fill="#f0c24a" /><circle cx="60" cy="54" r="4" fill="#f0c24a" /><path d="M38 68 L42 74 L46 68 L50 74 L54 68 L58 74 L62 68" /></>,
  LOCATION: <><path d="M10 82 L34 40 L48 60 L64 30 L90 82 Z" fill="#2f6b4f" /><path d="M58 40 L64 30 L70 40" fill="#efe3c4" /><path d="M10 82 L90 82" /></>,
  QUEST: <><path d="M26 20 L70 20 Q78 20 78 28 L78 80 L32 80 Q24 80 24 72 L24 28" fill="#efe3c4" /><path d="M20 20 Q20 28 26 28 Q32 28 32 20 Q32 14 26 14 L70 14" /><path d="M36 36 L66 36 M36 46 L66 46 M36 56 L58 56" /><circle cx="62" cy="68" r="7" fill="#8f2a21" /></>,
  ITEM: STORY_EMBLEMS.chalice,
  SCENE: <><path d="M14 80 L14 22 L86 22 L86 80 Z" fill="#4a4f57" /><path d="M14 22 Q30 40 26 80 M86 22 Q70 40 74 80" fill="#8f2a21" /><path d="M36 70 L50 46 L64 70 Z" fill="#efe3c4" /></>,
  CLUE: <><circle cx="42" cy="42" r="20" fill="#efe3c4" /><circle cx="42" cy="42" r="14" /><path d="M56 56 L82 82" strokeWidth="6" /><path d="M36 36 Q40 32 46 34" /></>,
  FACTION: <><path d="M30 12 L30 90" strokeWidth="3" /><path d="M30 16 L78 16 L70 34 L78 52 L30 52 Z" fill="#5a3f8a" /><circle cx="52" cy="34" r="7" fill="#f0c24a" /></>,
  HANDOUT: <><path d="M18 30 L82 30 L82 76 L18 76 Z" fill="#efe3c4" /><path d="M18 30 L50 56 L82 30" /><circle cx="50" cy="60" r="8" fill="#8f2a21" /></>
}

export function TypeEmblem({ type }: { type: EntityType }) {
  return <Svg>{TYPE_ART[type]}</Svg>
}

// Heraldic shields for party cards, so each player character's card looks different.
const SHIELD = 'M50 10 L82 22 L78 58 Q72 80 50 90 Q28 80 22 58 L18 22 Z'
const CHARGES = [
  <path key="cross" d="M50 22 L50 80 M30 44 L70 44" stroke="#f0c24a" strokeWidth="5" />,
  <path key="star" d="M50 26 L55 42 L72 42 L58 52 L63 68 L50 58 L37 68 L42 52 L28 42 L45 42 Z" fill="#f0c24a" strokeWidth="1.5" />,
  <g key="moon" stroke="none"><circle cx="48" cy="50" r="20" fill="#f0c24a" /><circle cx="57" cy="45" r="17" fill="#24553a" /></g>,
  <g key="sword" stroke="#f0c24a" strokeWidth="4"><path d="M50 24 L50 70" /><path d="M38 60 L62 60" /><path d="M50 70 L50 78" stroke="#c9a95a" /></g>,
  <path key="tree" d="M50 74 L50 50 M50 50 L38 40 M50 50 L62 40 M50 58 L40 52 M50 58 L60 52 M36 34 Q50 16 64 34 Q70 46 50 48 Q30 46 36 34 Z" stroke="#f0c24a" strokeWidth="3" />,
  <path key="chevron" d="M28 62 L50 34 L72 62 M32 74 L50 50 L68 74" stroke="#f0c24a" strokeWidth="5" />
]
const SHIELD_FILLS = ['#23395b', '#7a2230', '#24553a', '#4b2d6b', '#5c4a2a', '#2f4f5a']

export function PartyEmblem({ index }: { index: number }) {
  return (
    <Svg>
      <path d={SHIELD} fill={SHIELD_FILLS[index % SHIELD_FILLS.length]} />
      <path d="M50 16 L76 26 L72 57 Q67 75 50 84 Q33 75 28 57 L24 26 Z" stroke="#d9c08a" strokeWidth="1.2" />
      {CHARGES[index % CHARGES.length]}
    </Svg>
  )
}

const ROMAN: Array<[number, string]> = [[100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
export function roman(n: number): string {
  let out = ''
  let rest = n
  for (const [v, s] of ROMAN) while (rest >= v) { out += s; rest -= v }
  return out || '0'
}
