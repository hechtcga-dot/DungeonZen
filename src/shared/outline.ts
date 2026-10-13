import { z } from 'zod'

// A rough outline for a drawing: freehand pencil strokes (or one uploaded picture) plus
// labels ("river", "town"). The AI gets the outline as a layout picture, never as style,
// and the labels as words with where they are; the labels are not written on the picture
// unless the DM ticks "Write the labels on the picture". Points are 0..1000 across and down
// the drawing's frame, so the outline fits any size. Also the marks on a picture to Update.

export const OUTLINE_COLOURS = [
  { colour: '#d62828', name: 'red' }, { colour: '#1d4ed8', name: 'blue' }, { colour: '#15803d', name: 'green' },
  { colour: '#eab308', name: 'yellow' }, { colour: '#ffffff', name: 'white' }, { colour: '#111111', name: 'black' }
] as const

const Point = z.number().int().min(0).max(1000)
export const OutlineStroke = z.object({ c: z.string().regex(/^#[0-9a-fA-F]{6}$/), p: z.array(Point).max(4000) })
export const OutlineLabel = z.object({ x: Point, y: Point, t: z.string().trim().min(1).max(60) })
export const Outline = z.object({
  strokes: z.array(OutlineStroke).max(500).default([]),
  labels: z.array(OutlineLabel).max(40).default([]),
  /** An uploaded picture used as the outline instead of the sketch (asset path); the sketch is kept. */
  picture: z.string().max(500).nullable().default(null),
  use: z.enum(['sketch', 'picture']).default('sketch'),
  writeLabels: z.boolean().default(false)
})
export type Outline = z.infer<typeof Outline>
export type OutlineStroke = z.infer<typeof OutlineStroke>

export const emptyOutline = (): Outline => ({ strokes: [], labels: [], picture: null, use: 'sketch', writeLabels: false })

/** Reads a stored outline; anything broken counts as none. */
export function readOutline(v: unknown): Outline {
  const r = Outline.safeParse(v)
  return r.success ? r.data : emptyOutline()
}

/** True when the outline in use has nothing to send. */
export const outlineBlank = (o: Outline) => (o.use === 'picture' ? !o.picture : o.strokes.length === 0 && o.labels.length === 0)

/** "left middle" and so on for a spot on the frame. */
export function whereOnFrame(x: number, y: number): string {
  const across = x < 333 ? 'left' : x > 666 ? 'right' : 'centre'
  const down = y < 333 ? 'top' : y > 666 ? 'bottom' : 'middle'
  const place = across === 'centre' && down === 'middle' ? 'centre' : `${down} ${across}`
  return `${place}, ${Math.round(x / 10)}% across and ${Math.round(y / 10)}% down`
}

/** The words that go with an outline in the prompt (the DM sees and can edit them). */
export function outlineText(o: Outline): string {
  const lines = ['Layout: follow the attached outline for where things go (rough shapes only; do not copy its lines, colours or style).']
  if (o.labels.length) {
    lines.push(`Labelled parts of the outline: ${o.labels.map((l) => `"${l.t}" (${whereOnFrame(l.x, l.y)})`).join('; ')}.`)
    lines.push(o.writeLabels ? 'Write these labels on the picture where they are.' : 'The labels only say what each part is: do not write them or any other words on the picture.')
  }
  return lines.join('\n')
}

export interface MarkLabel { colour: string; label: string }

/** The words sent to change a drawn picture: the change, what each mark colour means, keep the rest. */
export function changePrompt(change: string, marks: MarkLabel[] | null): string {
  const named = (c: string) => OUTLINE_COLOURS.find((x) => x.colour === c)?.name ?? c
  return [
    `Change the first attached picture: ${change.trim().replace(/[.\s]+$/, '')}.`,
    marks ? 'The second attached picture is the same picture with coloured marks drawn on it by hand, showing where to change it.' : '',
    ...(marks ?? []).filter((m) => m.label.trim()).map((m) => `The ${named(m.colour)} marks: ${m.label.trim().replace(/[.\s]+$/, '')}.`),
    'Keep everything else exactly as it is: the layout, art style, colours, light and framing.',
    marks ? 'Do not draw the marks themselves. No text, no frame.' : 'No text, no frame.'
  ].filter(Boolean).join('\n')
}

/**
 * Lays a marks layer over a picture. Both are width × height × 4 bytes in the same channel
 * order, alpha last, colours premultiplied by alpha (how Electron's nativeImage bitmaps come).
 */
export function blendMarks(base: Uint8Array, marks: Uint8Array): Uint8Array {
  const out = new Uint8Array(base)
  for (let i = 0; i < out.length; i += 4) {
    const a = marks[i + 3] / 255
    if (a === 0) continue
    for (let k = 0; k < 3; k++) out[i + k] = Math.min(255, Math.round(marks[i + k] + out[i + k] * (1 - a)))
  }
  return out
}
