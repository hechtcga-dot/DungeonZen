import { z } from 'zod'

// A note's text with the formatting Dungeon Zen keeps: headings, bold, italic, underline,
// bullet and numbered lists, tables, read-aloud boxes, sidebars, pictures and links to cards.
// Word files are read into this and saved from it.

export const Run = z.object({
  text: z.string().max(100000),
  b: z.boolean().optional(),
  i: z.boolean().optional(),
  u: z.boolean().optional(),
  /** The DM's own link: a card id, `note:<id>` for another note, or '' = never link these words. */
  link: z.string().max(80).optional()
})
export type Run = z.infer<typeof Run>

export const Block = z.union([
  // read = read-aloud box, side = DM sidebar box (book style, 2.8.0)
  z.object({ kind: z.enum(['p', 'h1', 'h2', 'h3', 'bullet', 'number', 'read', 'side']), runs: z.array(Run).max(2000) }),
  z.object({ kind: z.literal('table'), rows: z.array(z.array(z.array(Run).max(500)).max(60)).max(1000) }),
  /** A picture the DM put in: a card's picture or a file in the campaign (assets path). */
  z.object({ kind: z.literal('pic'), card: z.string().max(80).optional(), file: z.string().max(300).optional(), side: z.enum(['left', 'right']) })
])
export type Block = z.infer<typeof Block>
export const Blocks = z.array(Block).max(20000)

/** One line of plain text per block (table rows as cells separated by " | "). */
export function blockLines(blocks: Block[]): string[] {
  const runText = (runs: Run[]) => runs.map((r) => r.text).join('')
  return blocks.map((b) => (b.kind === 'pic' ? '' : b.kind === 'table'
    ? b.rows.map((row) => row.map(runText).join(' | ')).join('\n')
    : `${b.kind === 'bullet' ? '• ' : b.kind === 'number' ? '- ' : ''}${runText(b.runs)}`)).filter((l) => l.trim())
}

/** The lines of `after` that are not in `before`: what a save changed or added (for "update cards"). */
export function changedLines(before: Block[], after: Block[]): string[] {
  const old = new Set(blockLines(before).map((l) => l.trim()))
  return blockLines(after).filter((l) => !old.has(l.trim()))
}

/** Plain text as blocks: blank lines split paragraphs; "# " lines are headings and "- " lines list items (Markdown). */
export function textToBlocks(text: string): Block[] {
  const blocks: Block[] = []
  let para: string[] = []
  const flush = () => { if (para.length) blocks.push({ kind: 'p', runs: [{ text: para.join('\n') }] }); para = [] }
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const h = /^(#{1,3}) +(.+)$/.exec(line)
    const li = /^\s*[-*] +(.+)$/.exec(line)
    const num = /^\s*\d+[.)] +(.+)$/.exec(line)
    if (h || li || num || !line.trim()) flush()
    if (h) blocks.push({ kind: `h${h[1].length}` as 'h1', runs: [{ text: h[2].trim() }] })
    else if (li) blocks.push({ kind: 'bullet', runs: [{ text: li[1].trim() }] })
    else if (num) blocks.push({ kind: 'number', runs: [{ text: num[1].trim() }] })
    else if (line.trim()) para.push(line.trim())
  }
  flush()
  return blocks
}

export type HeadingLevel = 'h1' | 'h2' | 'h3'

/** The note's headings, in order (the contents panel and the Notes list). */
export function headingsOf(blocks: Block[]): Array<{ level: HeadingLevel; text: string }> {
  return blocks.flatMap((b) => (b.kind === 'h1' || b.kind === 'h2' || b.kind === 'h3'
    ? [{ level: b.kind, text: b.runs.map((r) => r.text).join('').trim() }] : [])).filter((h) => h.text)
}

/**
 * Does this line look like a heading someone typed as plain text? Chapter/Part/Act lines are
 * top level, "1.2 Something" a small heading; numbered, ALL CAPS, Session/Scene and bold-only
 * short lines are headings. Lines ending like a sentence are not.
 */
export function headingLevel(line: string, bold = false): HeadingLevel | null {
  const t = line.trim()
  if (!t || t.length > 80 || t.includes('\n') || /[.,;]$/.test(t) || !/\p{L}/u.test(t)) return null
  const words = t.split(/\s+/).length
  if (/^(chapter|part|book|act)\b/i.test(t)) return 'h1'
  if (/^\d+(\.\d+)+\.?\s+\S/.test(t)) return 'h3'
  if (/^(session|scene|appendix|prologue|epilogue|interlude)\b/i.test(t) && words <= 10) return 'h2'
  if (/^\d+[.)]?\s+\p{Lu}/u.test(t) && words <= 7) return 'h2'
  const letters = t.replace(/[^\p{L}]/gu, '')
  if (letters.length >= 3 && t === t.toUpperCase() && words <= 10) return 'h2'
  if (bold && words <= 10) return 'h2'
  return null
}

/** Find headings: paragraphs (and bold numbered lines) that look like headings, for the DM to tick. */
export function guessHeadings(blocks: Block[]): Array<{ index: number; level: HeadingLevel; text: string }> {
  return blocks.flatMap((b, index) => {
    if (b.kind !== 'p' && b.kind !== 'number') return []
    const text = b.runs.map((r) => r.text).join('').trim()
    const bold = b.runs.filter((r) => r.text.trim()).every((r) => r.b)
    if (b.kind === 'number' && !bold) return []
    const level = headingLevel(text, bold)
    return level ? [{ index, level, text }] : []
  })
}
