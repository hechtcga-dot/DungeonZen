import { useBoard } from '../store'
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

export function HistoryPanel() {
  const history = useBoard((s) => s.history)
  const act = useBoard((s) => s.act)
  const say = useBoard((s) => s.say)
  if (!history) return <p className="muted">Loading…</p>
  const removedCount = history.removedEntities.length + history.removedStrings.length + history.removedNotes.length +
    history.removedStorylines.length + history.removedMaps.length + history.removedActs.length +
    history.removedOutcomes.length + history.removedTriggers.length + history.removedRegions.length + history.removedStyles.length

  return (
    <div className="history">
      <section>
        <h2 className="panel-heading">Removed from board</h2>
        {removedCount === 0 && <p className="hint">Anything you move to History shows here and can be revived.</p>}
        <ul className="removed">
          {history.removedEntities.map((e) => (
            <li key={e.id}>
              <div className="removed-text"><strong>{e.name}</strong><span className="muted">{ENTITY_LABELS[e.type]}</span></div>
              <button onClick={() => void act('entity:setStatus', { id: e.id, status: 'active' })}>Revive</button>
            </li>
          ))}
          {history.removedStrings.map((r) => (
            <li key={r.id}>
              <div className="removed-text">
                <strong>{r.sourceName} – {r.targetName}</strong>
                <span className="muted">String · {r.type.replace(/_/g, ' ')}</span>
              </div>
              <button onClick={() => void act('relationship:setStatus', { id: r.id, status: 'active' })}>Restore</button>
            </li>
          ))}
          {history.removedNotes.map((n) => (
            <li key={n.itemId}>
              <div className="removed-text">
                <strong>{n.text.slice(0, 60) || 'Empty note'}</strong>
                <span className="muted">Note · {n.boardName}</span>
              </div>
              <button onClick={() => void act('note:setStatus', { itemId: n.itemId, status: 'active' })}>Restore</button>
            </li>
          ))}
          {history.removedStorylines.map((st) => (
            <li key={st.storylineId}>
              <div className="removed-text"><strong>{st.title}</strong><span className="muted">Storyline</span></div>
              <button onClick={() => void act('storyline:setRemoved', { storylineId: st.storylineId, removed: false })}>Restore</button>
            </li>
          ))}
          {history.removedActs.map((a) => (
            <li key={a.id}>
              <div className="removed-text"><strong>{a.title}</strong><span className="muted">Act · {a.storylineTitle}</span></div>
              <button onClick={() => void act('act:setStatus', { id: a.id, status: 'active' })}>Restore</button>
            </li>
          ))}
          {history.removedOutcomes.map((o) => (
            <li key={o.id}>
              <div className="removed-text"><strong>{o.label}</strong><span className="muted">Outcome · {o.actTitle}</span></div>
              <button onClick={() => void act('outcome:setStatus', { id: o.id, status: 'active' })}>Restore</button>
            </li>
          ))}
          {history.removedTriggers.map((tr) => (
            <li key={tr.id}>
              <div className="removed-text"><strong>Trigger {tr.label}</strong><span className="muted">From {tr.actTitle}</span></div>
              <button onClick={() => void act('trigger:setStatus', { id: tr.id, status: 'active' })}>Restore</button>
            </li>
          ))}
          {history.removedMaps.map((m) => (
            <li key={m.id}>
              <div className="removed-text"><strong>{m.name}</strong><span className="muted">Map</span></div>
              <button onClick={() => void act('map:setStatus', { mapId: m.id, status: 'active' })}>Restore</button>
            </li>
          ))}
          {history.removedRegions.map((r) => (
            <li key={r.id}>
              <div className="removed-text"><strong>{r.name}</strong><span className="muted">Map region</span></div>
              <button onClick={() => void act('region:setStatus', { id: r.id, status: 'active' })}>Restore</button>
            </li>
          ))}
          {history.removedStyles.map((r) => (
            <li key={r.id}>
              <div className="removed-text"><strong>{r.name}</strong><span className="muted">Example map (battle map style)</span></div>
              <button onClick={() => void act('style:setStatus', { id: r.id, status: 'active' })}>Restore</button>
            </li>
          ))}
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
    </div>
  )
}
