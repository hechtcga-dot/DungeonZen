import { useState, type ReactNode } from 'react'
import { useBoard } from '../store'
import { Dialog } from './Dialog'
import { ENTITY_LABELS } from '../entityStyle'

function timeAgo(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return new Date(iso).toLocaleDateString()
}

type Sort = 'recent' | 'az' | 'type'
const SORTS: Array<[Sort, string]> = [['recent', 'Recently removed'], ['az', 'A–Z'], ['type', 'Type']]
let sortKept: Sort = 'recent' // kept while the app runs
interface Row { id: string; name: string; type: string; order: number; li: ReactNode }

export function HistoryPanel() {
  const history = useBoard((s) => s.history)
  const act = useBoard((s) => s.act)
  const say = useBoard((s) => s.say)
  const [forget, setForget] = useState<{ id: string; title: string } | null>(null)
  const [sort, setSort] = useState<Sort>(sortKept)
  if (!history) return <p className="muted">Loading…</p>
  const removedCount = history.removedEntities.length + history.removedSecrets.length + history.removedStrings.length + history.removedNotes.length +
    history.removedStorylines.length + history.removedMaps.length + history.removedActs.length +
    history.removedOutcomes.length + history.removedTriggers.length + history.removedRegions.length + history.removedStyles.length + history.removedPrep.length + history.removedNoteDocs.length

  const order = history.removedOrder
  const row = (id: string, name: string, type: string, li: ReactNode): Row => ({ id, name, type, order: order[id] ?? 0, li })
  const rows: Row[] = [
    ...history.removedEntities.map((e) => row(e.id, e.name, ENTITY_LABELS[e.type],
      <li key={e.id}>
        <div className="removed-text"><strong>{e.name}</strong><span className="muted">{ENTITY_LABELS[e.type]}</span></div>
        <button onClick={() => void act('entity:setStatus', { id: e.id, status: 'active' })}>Revive</button>
      </li>)),
    ...history.removedSecrets.map((x) => row(x.id, x.text.slice(0, 60) || `Untitled ${x.kind}`, x.kind[0].toUpperCase() + x.kind.slice(1),
      <li key={x.id}>
        <div className="removed-text">
          <strong>{x.text.slice(0, 60) || `Untitled ${x.kind}`}</strong>
          <span className="muted">{x.kind[0].toUpperCase() + x.kind.slice(1)}, with its links</span>
        </div>
        <button onClick={() => void act('secret:revive', { id: x.id })}>Revive</button>
      </li>)),
    ...history.removedStrings.map((r) => row(r.id, `${r.sourceName} – ${r.targetName}`, 'Link',
      <li key={r.id}>
        <div className="removed-text">
          <strong>{r.sourceName} – {r.targetName}</strong>
          <span className="muted">Link · {r.type.replace(/_/g, ' ')}</span>
        </div>
        <button onClick={() => void act('relationship:setStatus', { id: r.id, status: 'active' })}>Restore</button>
      </li>)),
    ...history.removedNotes.map((n) => row(n.itemId, n.text.slice(0, 60) || 'Empty note', n.text.startsWith('Card: ') ? 'Taken off the board' : 'Note',
      <li key={n.itemId}>
        <div className="removed-text">
          <strong>{n.text.slice(0, 60) || 'Empty note'}</strong>
          <span className="muted">{n.text.startsWith('Card: ') ? 'Taken off the board' : 'Note'} · {n.boardName}</span>
        </div>
        <button onClick={() => void act('note:setStatus', { itemId: n.itemId, status: 'active' })}>Restore</button>
      </li>)),
    ...history.removedStorylines.map((st) => row(st.storylineId, st.title, 'Storyline',
      <li key={st.storylineId}>
        <div className="removed-text"><strong>{st.title}</strong><span className="muted">Storyline</span></div>
        <button onClick={() => void act('storyline:setRemoved', { storylineId: st.storylineId, removed: false })}>Restore</button>
      </li>)),
    ...history.removedActs.map((a) => row(a.id, a.title, 'Act',
      <li key={a.id}>
        <div className="removed-text"><strong>{a.title}</strong><span className="muted">Act · {a.storylineTitle}</span></div>
        <button onClick={() => void act('act:setStatus', { id: a.id, status: 'active' })}>Restore</button>
      </li>)),
    ...history.removedOutcomes.map((o) => row(o.id, o.label, 'Outcome',
      <li key={o.id}>
        <div className="removed-text"><strong>{o.label}</strong><span className="muted">Outcome · {o.actTitle}</span></div>
        <button onClick={() => void act('outcome:setStatus', { id: o.id, status: 'active' })}>Restore</button>
      </li>)),
    ...history.removedTriggers.map((tr) => row(tr.id, `Trigger ${tr.label}`, 'Trigger',
      <li key={tr.id}>
        <div className="removed-text"><strong>Trigger {tr.label}</strong><span className="muted">From {tr.actTitle}</span></div>
        <button onClick={() => void act('trigger:setStatus', { id: tr.id, status: 'active' })}>Restore</button>
      </li>)),
    ...history.removedMaps.map((m) => row(m.id, m.name, 'Map',
      <li key={m.id}>
        <div className="removed-text"><strong>{m.name}</strong><span className="muted">Map</span></div>
        <button onClick={() => void act('map:setStatus', { mapId: m.id, status: 'active' })}>Restore</button>
      </li>)),
    ...history.removedRegions.map((r) => row(r.id, r.name, 'Map region',
      <li key={r.id}>
        <div className="removed-text"><strong>{r.name}</strong><span className="muted">Map region</span></div>
        <button onClick={() => void act('region:setStatus', { id: r.id, status: 'active' })}>Restore</button>
      </li>)),
    ...history.removedStyles.map((r) => row(r.id, r.name, 'Library picture',
      <li key={r.id}>
        <div className="removed-text"><strong>{r.name}</strong><span className="muted">Library picture</span></div>
        <button onClick={() => void act('style:setStatus', { id: r.id, status: 'active' })}>Restore</button>
      </li>)),
    ...history.removedNoteDocs.map((r) => row(r.id, r.title, 'Notes file',
      <li key={r.id}>
        <div className="removed-text"><strong>{r.title}</strong><span className="muted">Notes file</span></div>
        <button onClick={() => void act('notedoc:setStatus', { id: r.id, status: 'active' })}>Restore</button>
        <button className="danger" title="Sends the file (every version) to the Windows Recycle Bin" onClick={() => setForget(r)}>Delete file for good</button>
      </li>)),
    ...history.removedPrep.map((r) => row(r.id, r.name, `Prep ${r.what}`,
      <li key={r.id}>
        <div className="removed-text"><strong>{r.name}</strong><span className="muted">Prep {r.what}</span></div>
        <button onClick={() => void (r.what === 'prep sheet'
          ? act('prep:setStatus', { id: r.id, status: 'active' })
          : act('prepItem:setStatus', { id: r.id, status: 'active' }))}>Restore</button>
      </li>))
  ]
  const az = (a: Row, b: Row) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  const sorted = rows.sort(sort === 'recent' ? (a, b) => b.order - a.order || az(a, b)
    : sort === 'type' ? (a, b) => a.type.localeCompare(b.type) || az(a, b) : az)

  return (
    <div className="history">
      <section>
        <h2 className="panel-heading">Removed from board</h2>
        {removedCount === 0 && <p className="hint">Anything you move to History shows here and can be revived.</p>}
        {removedCount > 0 && (
          <div className="row tight" role="group" aria-label="Sort removed things">
            <span className="muted">Sort:</span>
            {SORTS.map(([k, label]) => (
              <button key={k} className="ghost" aria-pressed={sort === k} onClick={() => { sortKept = k; setSort(k) }}>{label}</button>
            ))}
          </div>
        )}
        <ul className="removed">
          {sorted.map((r) => r.li)}
        </ul>
      </section>

      <section>
        <h2 className="panel-heading">Change log</h2>
        {history.log.length === 0 && <p className="hint">Every change you make is listed here, newest first.</p>}
        <ol className="log">
          {history.log.map((c) => (
            <li key={c.id} className={c.undone ? 'is-undone' : undefined}>
              <div className="log-text">
                <span>{c.label}</span>
                <span className="mono muted">{c.undone ? 'undone · ' : ''}{timeAgo(c.at)}</span>
              </div>
              {!c.undone && (
                <button title="Undo this change and every change after it"
                  onClick={async () => {
                    const n = await act('history:undoTo', { commandId: c.id })
                    if (n) say(`Undid ${n} change${n === 1 ? '' : 's'}`)
                  }}>Undo to here</button>
              )}
            </li>
          ))}
        </ol>
      </section>
      {forget && (
        <Dialog title="Delete the file for good?" open onClose={() => setForget(null)}>
          <p><strong>{forget.title}</strong> and all its earlier versions go to the Windows Recycle Bin and leave Dungeon Zen.</p>
          <p>This can’t be undone here. You can still restore the files from the Recycle Bin.</p>
          <div className="dz-actions">
            <button onClick={() => setForget(null)}>Cancel</button>
            <button className="danger" onClick={async () => { await act('notedoc:forget', { id: forget.id }); setForget(null); say(`${forget.title} sent to the Recycle Bin`) }}>Delete file for good</button>
          </div>
        </Dialog>
      )}
    </div>
  )
}
