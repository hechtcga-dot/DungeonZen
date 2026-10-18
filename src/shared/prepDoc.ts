import type { Block, Run } from './noteDoc'
import type { PrepView } from './types'

/** The prep sheet as a notes file, in the order of the owner's one-page DM tool. */
export function prepBlocks(p: PrepView): Block[] {
  const out: Block[] = []
  const t = (text: string): Run[] => [{ text }]
  const h = (text: string) => out.push({ kind: 'h2', runs: t(text) })
  const para = (text: string) => { if (text.trim()) out.push({ kind: 'p', runs: t(text.trim()) }) }
  const list = (lines: string[]) => lines.filter((l) => l.trim()).forEach((l) => out.push({ kind: 'bullet', runs: t(l.trim()) }))
  const items = (k: string) => p.items.filter((i) => i.kind === k)
  const join = (...parts: Array<string | null | undefined>) => parts.map((x) => x?.trim()).filter(Boolean).join(' — ')
  // Nothing written = nothing printed: the heading stays, the space under it is left blank (owner, 2026-10-18).
  const labelled = (label: string, text: string) => { if (text.trim()) out.push({ kind: 'p', runs: [{ text: `${label} `, b: true }, ...t(text.trim())] }) }

  h('1. Session opening'); para(p.premise)
  h('2. Likely scenes'); list(items('scene').map((i) => join(i.title, i.locationName, i.body)))
  h('3. Secrets & clues'); list(items('discovery').map((i) => `${join(i.title, i.body, i.locationName && `where: ${i.locationName}`)}${i.done ? ' (revealed)' : ''}`))
  h('4. NPCs'); list(items('npc').map((i) => join(i.title || i.entityName, i.role && `wants ${i.role}`, i.body)))
  h('5. Loose threads'); list(items('thread').map((i) => `${i.body || i.title}${i.done ? ' (followed up)' : ''}`))
  h('6. Session recap')
  labelled('What happened:', p.session?.recap ?? '')
  labelled('What the players seem to want next:', p.wantNext)
  h('7. World bible updates'); list(items('bible').map((i) => i.body || i.title))
  if (p.backupNames.trim()) { h('Backup names'); list(p.backupNames.split('\n')) }
  if (p.notes.trim()) { h('Notes'); p.notes.split(/\n{2,}/).forEach(para) }
  return out
}
