import type { EntityType } from './schemas'

// Picture compositions for card drawings (owner, 2026-10-12), after the classic forms of outdoor
// painting (pyramid, steelyard, S-curve, tunnel…). Each has prompt words; sketches live in
// src/renderer/art/compositions.tsx. The card type picks the default; the DM can choose another.

export const COMPOSITIONS = [
  { id: 'thirds', name: 'Rule of thirds', blurb: 'Subject off-centre, detail in front, depth behind.',
    prompt: 'asymmetric, rule-of-thirds: the subject off-centre, crisp specific detail in the foreground, the background pulled back into soft atmospheric depth' },
  { id: 'pyramid', name: 'Pyramid', blurb: 'A stable triangle: steady, grand, a figure standing firm.',
    prompt: 'pyramid: the subject forms a stable triangle, broad at the base and rising to a peak, set slightly off-centre with space around it' },
  { id: 'steelyard', name: 'Steelyard', blurb: 'A big mass near one side, balanced by a small one far off.',
    prompt: 'steelyard: one large mass close to one side, balanced by a small distant element on the far side, open space between them' },
  { id: 'scales', name: 'Balanced scales', blurb: 'Two masses of like weight either side of an open centre.',
    prompt: 'balanced-scales: two masses of similar weight on either side, an open centre leading the eye into the distance' },
  { id: 'scurve', name: 'S-curve', blurb: 'A road, river or shore winding into the distance.',
    prompt: 'S-curve: a winding path, river or shoreline leads the eye in a gentle S from the foreground deep into the background' },
  { id: 'diagonal', name: 'Diagonal', blurb: 'A strong slant: movement, danger, action.',
    prompt: 'dynamic diagonal: the main forms and action run along a strong diagonal across the frame, tilted and full of movement' },
  { id: 'tunnel', name: 'Tunnel', blurb: 'Framed by an arch, trees or a doorway, looking through.',
    prompt: 'tunnel: dark framing forms (arch, trees or doorway) in the foreground surround a lit view beyond, drawing the eye through' },
  { id: 'radiating', name: 'Radiating lines', blurb: 'Lines that lead to one point of interest.',
    prompt: 'radiating: lines of the land, light or architecture converge on a single point of interest' },
  { id: 'circular', name: 'Circular', blurb: 'Elements ring the centre and hold the eye inside.',
    prompt: 'circular: surrounding elements form a loose ring that holds the eye on the subject at the centre' },
  { id: 'ell', name: 'L-shape', blurb: 'A tall form on one side over a long low base.',
    prompt: 'L-shaped: a tall vertical form near one edge rises from a long low horizontal base across the picture' },
  { id: 'cross', name: 'Cross', blurb: 'One strong upright crossing a low horizon.',
    prompt: 'cross: a strong vertical form crosses a low, calm horizon line' },
  { id: 'threespot', name: 'Three spots', blurb: 'Three masses at different sizes and distances.',
    prompt: 'three-spot: three masses of different sizes placed at different distances, unevenly spaced' },
  { id: 'groupmass', name: 'Group mass', blurb: 'One gathered, dominant mass: a crowd, a town, a grove.',
    prompt: 'group-mass: the elements gather into one dominant mass, with quiet open space around it' },
  { id: 'silhouette', name: 'Silhouette', blurb: 'Dark shapes against a bright sky.',
    prompt: 'silhouette: dark, clearly shaped forms against a bright sky or glowing background' },
  { id: 'centre', name: 'Centred', blurb: 'The subject in the middle, like a still life or emblem.',
    prompt: 'centred: the subject in the middle of the frame, well lit, against a simple uncluttered background' },
  { id: 'pattern', name: 'Pattern', blurb: 'Repeating shapes across the whole picture.',
    prompt: 'pattern: repeating shapes spread across the whole picture, with one slightly stronger point of interest' }
] as const

export type CompositionId = (typeof COMPOSITIONS)[number]['id']

/** The composition that suits a card type best (the DM can choose another per drawing). */
export const DEFAULT_COMPOSITION_FOR: Record<EntityType, CompositionId> = {
  NPC: 'pyramid', PC: 'pyramid', MONSTER: 'diagonal', LOCATION: 'thirds', QUEST: 'scurve', ITEM: 'centre',
  SCENE: 'diagonal', CLUE: 'centre', FACTION: 'groupmass', HANDOUT: 'centre', BUILDING: 'thirds', ENCOUNTER: 'diagonal', OTHER: 'centre'
}

export const compositionById = (id: string) => COMPOSITIONS.find((c) => c.id === id) ?? COMPOSITIONS[0]
