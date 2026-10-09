import { z } from 'zod'

// A note's text with the formatting Dungeon Zen keeps: headings, bold, italic, underline,
// bullet and numbered lists, and tables. Word files are read into this and saved from it.

export const Run = z.object({
  text: z.string().max(100000),
  b: z.boolean().optional(),
  i: z.boolean().optional(),
  u: z.boolean().optional()
})
export type Run = z.infer<typeof Run>

export const Block = z.union([
  z.object({ kind: z.enum(['p', 'h1', 'h2', 'h3', 'bullet', 'number']), runs: z.array(Run).max(2000) }),
  z.object({ kind: z.literal('table'), rows: z.array(z.array(z.array(Run).max(500)).max(60)).max(1000) })
])
export type Block = z.infer<typeof Block>
export const Blocks = z.array(Block).max(20000)

/** One line of plain text per block (table rows as cells separated by " | "). */
export function blockLines(blocks: Block[]): string[] {
  const runText = (runs: Run[]) => runs.map((r) => r.text).join('')
  return blocks.map((b) => (b.kind === 'table'
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
