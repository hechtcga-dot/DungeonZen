// Battle maps drawn by an AI image service, held to fixed local rules (owner, 2026-10-06):
// top-down, a square grid of 5-foot squares, the size in squares, the scene's facts,
// and the DM's own example maps for the style. Shared so the dialog can show the
// exact request before it is sent (the DM can edit it).

export const BATTLE_SETTINGS = ['outdoors', 'indoors', 'underground', 'town street', 'ship or dock', 'other'] as const
export type BattleSetting = (typeof BATTLE_SETTINGS)[number]

export type Aspect = '1:1' | '3:2' | '2:3' | '16:9' | '9:16'

export interface BattleMapSpec {
  /** What is there: the DM's own words, the scene text or the place's notes. */
  description: string
  setting: BattleSetting
  cols: number
  rows: number
  /** "night", "dusk"… from the campaign clock. */
  light: string
  /** True when example maps go with the request. */
  withExamples: boolean
}

export const GRID_MIN = 5
export const GRID_MAX = 60

/** The image shape closest to the grid, from the shapes every image service supports. */
export function aspectFor(cols: number, rows: number): Aspect {
  const r = cols / rows
  const options: Array<[Aspect, number]> = [['1:1', 1], ['3:2', 1.5], ['2:3', 2 / 3], ['16:9', 16 / 9], ['9:16', 9 / 16]]
  return options.reduce((best, o) => (Math.abs(Math.log(o[1] / r)) < Math.abs(Math.log(best[1] / r)) ? o : best))[0]
}

/** Rows that fit an image of this size when it has `cols` square cells across. */
export function rowsFor(cols: number, width: number, height: number): number {
  return Math.max(1, Math.round((cols * height) / width))
}

export function battleMapPrompt(spec: BattleMapSpec): string {
  const lines = [
    `A top-down battle map for a tabletop role-playing game: ${spec.setting}.`,
    `Seen from directly above (orthographic, 90 degrees, no perspective or horizon).`,
    `The area is ${spec.cols} squares wide and ${spec.rows} squares deep, each square 5 feet; walls, doors, furniture and terrain line up with that square grid.`,
    `Lighting: ${spec.light}.`,
    spec.description.trim() ? `What is there: ${spec.description.trim().replace(/\s+/g, ' ')}` : 'An open area with a few obstacles to fight around.',
    'No grid lines (the app draws them), no text, labels, letters, numbers, compass or legend, no people, creatures or tokens, no frame or border.',
    'Clear readable floor and terrain with room to move; rich painted detail.'
  ]
  if (spec.withExamples) lines.push('Match the art style, colours and line work of the example maps provided; do not copy their layout.')
  return lines.join('\n')
}
