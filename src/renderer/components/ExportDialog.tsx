import { useEffect, useState } from 'react'
import { Dialog } from './Dialog'
import { call } from '../api'
import { useBoard } from '../store'
import { ENTITY_COLOURS, ENTITY_LABELS } from '../entityStyle'
import { OpenFolder } from './OpenFolder'
import type { EntityView } from '../../shared/types'

export type ExportKind = 'sheets' | 'letters' | 'board'
const KIND_LABELS: Record<ExportKind, string> = { sheets: 'Character sheets', letters: 'Letters and handouts', board: 'Bulletin board' }
const KIND_HINTS: Record<ExportKind, string> = {
  sheets: 'Stat block, abilities and bio, one page per card.',
  letters: 'Each card as a letter on aged paper: its text (or bio, description), signed with “from” if the card has one.',
  board: 'Notices pinned to a cork board: quests, handouts, rumours. Shows each card\'s text and reward.'
}
const DEFAULT_TYPES: Record<ExportKind, string[]> = { sheets: ['NPC', 'PC', 'MONSTER'], letters: ['HANDOUT', 'CLUE'], board: ['QUEST', 'HANDOUT', 'CLUE'] }

/**
 * Print or save cards as PDF or JPG: character sheets (DM or player copy), letters and
 * handouts, or a bulletin board. Pass entityIds to export those; otherwise pick cards here.
 */
export function ExportDialog({ kind: fixedKind, entityIds, title, onClose }: { kind?: ExportKind; entityIds?: string[]; title?: string; onClose(): void }) {
  const say = useBoard((s) => s.say)
  const [kind, setKind] = useState<ExportKind>(fixedKind ?? 'sheets')
  const [cards, setCards] = useState<EntityView[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set(entityIds ?? []))
  const [format, setFormat] = useState<'pdf' | 'jpg'>('pdf')
  const [size, setSize] = useState<'A4' | 'Letter'>('A4')
  const [playerSafe, setPlayerSafe] = useState(false)
  const [includeNotes, setIncludeNotes] = useState(true)
  const [hand, setHand] = useState<'handwritten' | 'printed'>('handwritten')
  const [seal, setSeal] = useState(true)
  const [boardTitle, setBoardTitle] = useState(title ?? 'Notices')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (entityIds) return
    call('library:search', { query: '' }).then((r) => setCards(r.results.map((x) => x.entity).filter((e) => e.status !== 'defunct'))).catch(() => setCards([]))
  }, [entityIds])
  const choosable = cards.filter((c) => DEFAULT_TYPES[kind].includes(c.type) || picked.has(c.id))
  const ids = entityIds ?? [...picked]

  const run = async () => {
    setBusy(true)
    try {
      const out = await call('export:pages', { kind, entityIds: ids, format, size, playerSafe, includeNotes, hand, seal, title: kind === 'board' ? boardTitle : title })
      if (out) { say(`Saved ${out}`); onClose() }
    } catch (e) { say((e as Error).message, true) }
    setBusy(false)
  }

  return (
    <Dialog title={title ? `Print or save: ${title}` : 'Print or save as PDF or JPG'} open onClose={onClose} wide>
      <div className="dz-form export-form">
        {!fixedKind && (
          <div className="tabs-row" role="tablist">
            {(Object.keys(KIND_LABELS) as ExportKind[]).map((k) => (
              <button key={k} role="tab" aria-selected={kind === k} aria-pressed={kind === k} onClick={() => setKind(k)}>{KIND_LABELS[k]}</button>
            ))}
          </div>
        )}
        <p className="hint">{KIND_HINTS[kind]}</p>
        {!entityIds && (
          <fieldset className="field export-pick">
            <legend>Cards ({picked.size} chosen)</legend>
            {choosable.length === 0 ? <p className="hint">No {DEFAULT_TYPES[kind].map((t) => ENTITY_LABELS[t as keyof typeof ENTITY_LABELS].toLowerCase()).join(' or ')} cards yet.</p> : (
              <ul>
                {choosable.map((c) => (
                  <li key={c.id}>
                    <label>
                      <input type="checkbox" checked={picked.has(c.id)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(c.id); else n.delete(c.id); return n })} />
                      <span className="swatch" style={{ background: ENTITY_COLOURS[c.type] }} aria-hidden="true" /> {c.name}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
        )}
        {kind === 'sheets' && (
          <div className="row tight wrap">
            <label className="field checkbox"><input type="checkbox" checked={playerSafe} onChange={(e) => setPlayerSafe(e.target.checked)} /> Player copy: only what the party knows</label>
            {!playerSafe && <label className="field checkbox"><input type="checkbox" checked={includeNotes} onChange={(e) => setIncludeNotes(e.target.checked)} /> Include DM notes</label>}
          </div>
        )}
        {kind === 'letters' && (
          <div className="row tight wrap">
            <div className="field"><label htmlFor="ex-hand">Writing</label>
              <select id="ex-hand" value={hand} onChange={(e) => setHand(e.target.value as 'handwritten' | 'printed')}><option value="handwritten">Handwritten</option><option value="printed">Printed</option></select></div>
            <label className="field checkbox"><input type="checkbox" checked={seal} onChange={(e) => setSeal(e.target.checked)} /> Wax seal</label>
          </div>
        )}
        {kind === 'board' && (
          <div className="field"><label htmlFor="ex-title">Board title</label><input id="ex-title" value={boardTitle} maxLength={200} onChange={(e) => setBoardTitle(e.target.value)} /></div>
        )}
        <div className="row tight wrap">
          <div className="field"><label htmlFor="ex-format">Format</label>
            <select id="ex-format" value={format} onChange={(e) => setFormat(e.target.value as 'pdf' | 'jpg')}><option value="pdf">PDF (to print)</option><option value="jpg">JPG image{ids.length > 1 && kind !== 'board' ? 's (one per card)' : ''}</option></select></div>
          <div className="field"><label htmlFor="ex-size">Page size</label>
            <select id="ex-size" value={size} onChange={(e) => setSize(e.target.value as 'A4' | 'Letter')}><option value="A4">A4</option><option value="Letter">US Letter</option></select></div>
        </div>
        <div className="dz-actions">
          <OpenFolder sub="exports" label="Open saved files folder" />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || ids.length === 0} onClick={() => void run()}>{busy ? 'Making it…' : format === 'pdf' ? 'Save PDF…' : 'Save JPG…'}</button>
        </div>
      </div>
    </Dialog>
  )
}
