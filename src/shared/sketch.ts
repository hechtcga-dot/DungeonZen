// A layout sketch: a small grid of one-letter codes plus text labels. Used for building
// floors and encounter battle maps, and sent to the image AI as a blueprint (a clean plan
// picture made in the renderer plus the text below). Tiny to store: one string per floor.

export interface SketchLabel { x: number; y: number; t: string }
export interface Sketch { cols: number; rows: number; cells: string; labels: SketchLabel[] }

export const SKETCH_MIN = 4
export const SKETCH_MAX = 60

export interface SketchTool { code: string; label: string; icon: string; colour: string; words: string }

/** Every code a cell can hold: what it looks like on the plan and what the AI is told. */
export const CELL: Record<string, SketchTool> = {
  '#': { code: '#', label: 'Wall', icon: '│', colour: '#000000', words: 'wall' },
  '.': { code: '.', label: 'Floor', icon: '·', colour: '#f2f2f2', words: 'open floor' },
  D: { code: 'D', label: 'Door', icon: '⊓', colour: '#c0392b', words: 'door' },
  W: { code: 'W', label: 'Window', icon: '▯', colour: '#5dade2', words: 'window' },
  S: { code: 'S', label: 'Stairs', icon: '≡', colour: '#7f8c8d', words: 'stairs or slope' },
  B: { code: 'B', label: 'Bed', icon: '▣', colour: '#d7bde2', words: 'bed' },
  T: { code: 'T', label: 'Table', icon: '◯', colour: '#a0522d', words: 'table' },
  R: { code: 'R', label: 'Bar / counter', icon: '▬', colour: '#6e2c00', words: 'bar or counter' },
  H: { code: 'H', label: 'Hearth', icon: '♨', colour: '#e67e22', words: 'hearth or fireplace' },
  '~': { code: '~', label: 'Water', icon: '≈', colour: '#2e86c1', words: 'water' },
  f: { code: 'f', label: 'Trees', icon: '♣', colour: '#1e8449', words: 'trees or bushes' },
  o: { code: 'o', label: 'Rock', icon: '●', colour: '#909497', words: 'rock or boulder' },
  P: { code: 'P', label: 'Pillar', icon: '▪', colour: '#4d5656', words: 'pillar' },
  ':': { code: ':', label: 'Difficult', icon: '░', colour: '#b7950b', words: 'difficult terrain (rubble, mud, brambles)' },
  x: { code: 'x', label: 'Start: party', icon: '✕', colour: '#27ae60', words: 'where the party starts' },
  X: { code: 'X', label: 'Start: foes', icon: '☠', colour: '#922b21', words: 'where the enemies start' }
}

/** Tool order per kind of sketch. "room" draws a walled rectangle; "label" places text; " " erases. */
export const BUILDING_TOOLS = ['room', '#', 'D', 'W', 'S', 'B', 'T', 'R', 'H', 'P', 'label', ' '] as const
export const BATTLE_TOOLS = ['#', 'D', 'room', '~', 'f', 'o', 'P', 'S', ':', 'x', 'X', 'label', ' '] as const

export function emptySketch(cols = 20, rows = 12): Sketch {
  return { cols, rows, cells: ' '.repeat(cols * rows), labels: [] }
}

export function readSketch(v: unknown): Sketch | null {
  if (!v || typeof v !== 'object') return null
  const s = v as Partial<Sketch>
  if (!Number.isInteger(s.cols) || !Number.isInteger(s.rows) || typeof s.cells !== 'string') return null
  const cols = s.cols!, rows = s.rows!
  if (cols < SKETCH_MIN || rows < SKETCH_MIN || cols > SKETCH_MAX || rows > SKETCH_MAX) return null
  const cells = s.cells.padEnd(cols * rows, ' ').slice(0, cols * rows)
  const labels = Array.isArray(s.labels) ? s.labels.filter((l) => l && Number.isFinite(l.x) && Number.isFinite(l.y) && typeof l.t === 'string') : []
  return { cols, rows, cells, labels }
}

export const cellAt = (s: Sketch, x: number, y: number) => (x < 0 || y < 0 || x >= s.cols || y >= s.rows ? ' ' : s.cells[y * s.cols + x])

/** Sets cells (x, y, code) in one go. */
export function paint(s: Sketch, list: Array<[number, number, string]>): Sketch {
  const c = s.cells.split('')
  for (const [x, y, code] of list) if (x >= 0 && y >= 0 && x < s.cols && y < s.rows) c[y * s.cols + x] = code
  return { ...s, cells: c.join('') }
}

/** A room: walls round the edge of the rectangle, floor inside. */
export function roomCells(x0: number, y0: number, x1: number, y1: number): Array<[number, number, string]> {
  const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)]
  const [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)]
  const out: Array<[number, number, string]> = []
  for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) out.push([x, y, x === ax || x === bx || y === ay || y === by ? '#' : '.'])
  return out
}

/** A new size, keeping what is drawn in the top-left corner. */
export function resize(s: Sketch, cols: number, rows: number): Sketch {
  const c = Math.max(SKETCH_MIN, Math.min(SKETCH_MAX, Math.round(cols)))
  const r = Math.max(SKETCH_MIN, Math.min(SKETCH_MAX, Math.round(rows)))
  let cells = ''
  for (let y = 0; y < r; y++) for (let x = 0; x < c; x++) cells += cellAt(s, x, y)
  return { cols: c, rows: r, cells, labels: s.labels.filter((l) => l.x < c && l.y < r) }
}

export const isBlank = (s: Sketch | null | undefined) => !s || (!s.cells.trim() && s.labels.length === 0)

/**
 * What the image AI is told with the plan picture: follow it exactly. Small sketches go in
 * square by square; big ones as the legend and labels only (the picture carries the rest).
 */
export function blueprintText(s: Sketch, opts: { labels: boolean; markers: boolean }): string {
  const used = [...new Set(s.cells.replace(/ /g, '').split(''))].filter((c) => CELL[c])
  const lines = [
    'BLUEPRINT: the attached plan picture is the exact layout. Follow it as a blueprint: keep every wall, door, window, room, stair, piece of furniture, water and terrain feature in the same place, shape and size.',
    `The plan is ${s.cols} squares across and ${s.rows} squares deep; one square is 5 feet. Draw it top-down at that size, with the plan's top at the top of the picture.`,
    `Plan colours: ${used.map((c) => `${CELL[c].colour} = ${CELL[c].words}`).join('; ')}; white = outside or empty.`
  ]
  if (s.labels.length) lines.push(`Labels on the plan: ${s.labels.map((l) => `"${l.t}" at column ${l.x + 1}, row ${l.y + 1}`).join('; ')}.`)
  if (s.cols * s.rows <= 1600) {
    lines.push(`Square by square (row 1 at the top; ${used.map((c) => `${c} ${CELL[c].words}`).join(', ')}, space empty):`)
    for (let y = 0; y < s.rows; y++) lines.push(`${String(y + 1).padStart(2)}|${s.cells.slice(y * s.cols, (y + 1) * s.cols)}|`)
  }
  lines.push(opts.labels ? 'Write the labels on the finished map.' : 'Do not write the labels or any text on the finished map.')
  if (s.cells.includes('x') || s.cells.includes('X')) lines.push(opts.markers ? 'Show the start markers on the finished map.' : 'The start markers are for placement only: do not draw them.')
  lines.push('Do not show the plan colours themselves: render real materials (stone, wood, water, grass) in the requested style.')
  return lines.join('\n')
}
