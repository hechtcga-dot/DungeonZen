import { useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import type { z } from 'zod'
import type { ipcInputs } from '../../shared/ipc'
import { ContextMenu } from './ContextMenu'
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
type Kind = z.infer<(typeof ipcInputs)['history:forget']>['items'][number]['kind'] | 'notedoc' | 'event' | 'moon' | 'token'
interface Row { key: string; name: string; type: string; order: number; body: ReactNode }

export function HistoryPanel() {
  const history = useBoard((s) => s.history)
  const act = useBoard((s) => s.act)
  const say = useBoard((s) => s.say)
  const [forgetFile, setForgetFile] = useState<{ id: string; title: string } | null>(null)
  const [sort, setSort] = useState<Sort>(sortKept)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const anchor = useRef<number | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; keys: string[] } | null>(null)
  const [confirm, setConfirm] = useState<string[] | null>(null)
  if (!history) return <p className="muted">Loading…</p>
  const removedCount = history.removedEntities.length + history.removedSecrets.length + history.removedStrings.length + history.removedNotes.length +
    history.removedStorylines.length + history.removedMaps.length + history.removedActs.length +
    history.removedOutcomes.length + history.removedTriggers.length + history.removedRegions.length + history.removedTokens.length + history.removedStyles.length + history.removedPrep.length + history.removedNoteDocs.length +
    history.removedEvents.length + history.removedMoons.length

  const order = history.removedOrder
  const row = (kind: Kind, id: string, name: string, type: string, body: ReactNode): Row => ({ key: `${kind}:${id}`, name, type, order: order[id] ?? 0, body })
  const rows: Row[] = [
    ...history.removedEntities.map((e) => row('entity', e.id, e.name, ENTITY_LABELS[e.type],
      <>
        <div className="removed-text"><strong>{e.name}</strong><span className="muted">{ENTITY_LABELS[e.type]}</span></div>
        <button onClick={() => void act('entity:setStatus', { id: e.id, status: 'active' })}>Revive</button>
      </>)),
    ...history.removedSecrets.map((x) => row('secret', x.id, x.text.slice(0, 60) || `Untitled ${x.kind}`, x.kind[0].toUpperCase() + x.kind.slice(1),
      <>
        <div className="removed-text">
          <strong>{x.text.slice(0, 60) || `Untitled ${x.kind}`}</strong>
          <span className="muted">{x.kind[0].toUpperCase() + x.kind.slice(1)}, with its links</span>
        </div>
        <button onClick={() => void act('secret:revive', { id: x.id })}>Revive</button>
      </>)),
    ...history.removedStrings.map((r) => row('string', r.id, `${r.sourceName} – ${r.targetName}`, 'Link',
      <>
        <div className="removed-text">
          <strong>{r.sourceName} – {r.targetName}</strong>
          <span className="muted">Link · {r.type.replace(/_/g, ' ')}</span>
        </div>
        <button onClick={() => void act('relationship:setStatus', { id: r.id, status: 'active' })}>Restore</button>
      </>)),
    ...history.removedNotes.map((n) => row('note', n.itemId, n.text.slice(0, 60) || 'Empty note', n.text.startsWith('Card: ') ? 'Taken off the board' : 'Note',
      <>
        <div className="removed-text">
          <strong>{n.text.slice(0, 60) || 'Empty note'}</strong>
          <span className="muted">{n.text.startsWith('Card: ') ? 'Taken off the board' : 'Note'} · {n.boardName}</span>
        </div>
        <button onClick={() => void act('note:setStatus', { itemId: n.itemId, status: 'active' })}>Restore</button>
      </>)),
    ...history.removedStorylines.map((st) => row('storyline', st.storylineId, st.title, 'Storyline',
      <>
        <div className="removed-text"><strong>{st.title}</strong><span className="muted">Storyline</span></div>
        <button onClick={() => void act('storyline:setRemoved', { storylineId: st.storylineId, removed: false })}>Restore</button>
      </>)),
    ...history.removedActs.map((a) => row('act', a.id, a.title, 'Act',
      <>
        <div className="removed-text"><strong>{a.title}</strong><span className="muted">Act · {a.storylineTitle}</span></div>
        <button onClick={() => void act('act:setStatus', { id: a.id, status: 'active' })}>Restore</button>
      </>)),
    ...history.removedOutcomes.map((o) => row('outcome', o.id, o.label, 'Outcome',
      <>
        <div className="removed-text"><strong>{o.label}</strong><span className="muted">Outcome · {o.actTitle}</span></div>
        <button onClick={() => void act('outcome:setStatus', { id: o.id, status: 'active' })}>Restore</button>
      </>)),
    ...history.removedTriggers.map((tr) => row('trigger', tr.id, `Trigger ${tr.label}`, 'Trigger',
      <>
        <div className="removed-text"><strong>Trigger {tr.label}</strong><span className="muted">From {tr.actTitle}</span></div>
        <button onClick={() => void act('trigger:setStatus', { id: tr.id, status: 'active' })}>Restore</button>
      </>)),
    ...history.removedMaps.map((m) => row('map', m.id, m.name, 'Map',
      <>
        <div className="removed-text"><strong>{m.name}</strong><span className="muted">Map</span></div>
        <button onClick={() => void act('map:setStatus', { mapId: m.id, status: 'active' })}>Restore</button>
      </>)),
    ...history.removedRegions.map((r) => row('region', r.id, r.name, 'Map region',
      <>
        <div className="removed-text"><strong>{r.name}</strong><span className="muted">Map region</span></div>
        <button onClick={() => void act('region:setStatus', { id: r.id, status: 'active' })}>Restore</button>
      </>)),
    ...history.removedTokens.map((r) => row('token', r.id, `Token of ${r.name}`, 'Token',
      <>
        <div className="removed-text"><strong>Token of {r.name}</strong><span className="muted">Token</span></div>
        <button onClick={() => void act('token:setRemoved', { entityId: r.id, removed: false })}>Restore</button>
      </>)),
    ...history.removedStyles.map((r) => row('style', r.id, r.name, 'Library picture',
      <>
        <div className="removed-text"><strong>{r.name}</strong><span className="muted">Library picture</span></div>
        <button onClick={() => void act('style:setStatus', { id: r.id, status: 'active' })}>Restore</button>
      </>)),
    ...history.removedEvents.map((r) => row('event', r.id, r.title, 'Calendar event',
      <>
        <div className="removed-text"><strong>{r.title}</strong><span className="muted">Calendar event · {r.when}</span></div>
        <button onClick={() => void act('calendar:setEventRemoved', { id: r.id, removed: false })}>Restore</button>
      </>)),
    ...history.removedMoons.map((r) => row('moon', String(r.index), r.name, 'Moon',
      <>
        <div className="removed-text"><strong>{r.name}</strong><span className="muted">Moon</span></div>
        <button onClick={() => void act('calendar:setMoonRemoved', { index: r.index, removed: false })}>Restore</button>
      </>)),
    ...history.removedNoteDocs.map((r) => row('notedoc', r.id, r.title, 'Notes file',
      <>
        <div className="removed-text"><strong>{r.title}</strong><span className="muted">Notes file</span></div>
        <button onClick={() => void act('notedoc:setStatus', { id: r.id, status: 'active' })}>Restore</button>
        <button className="danger" title="Sends the file (every version) to the Windows Recycle Bin" onClick={() => setForgetFile(r)}>Delete file for good</button>
      </>)),
    ...history.removedPrep.map((r) => row(r.what === 'prep sheet' ? 'prep' : 'prepItem', r.id, r.name, `Prep ${r.what}`,
      <>
        <div className="removed-text"><strong>{r.name}</strong><span className="muted">Prep {r.what}</span></div>
        <button onClick={() => void (r.what === 'prep sheet'
          ? act('prep:setStatus', { id: r.id, status: 'active' })
          : act('prepItem:setStatus', { id: r.id, status: 'active' }))}>Restore</button>
      </>))
  ]
  const az = (a: Row, b: Row) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  const sorted = rows.sort(sort === 'recent' ? (a, b) => b.order - a.order || az(a, b)
    : sort === 'type' ? (a, b) => a.type.localeCompare(b.type) || az(a, b) : az)
  const picked = sorted.map((r) => r.key).filter((k) => sel.has(k))
  // Click: just this one (again: none). Ctrl+click: add/remove. Shift+click: everything from the last click.
  const pick = (e: ReactMouseEvent, i: number) => {
    if ((e.target as HTMLElement).closest('button, input, a')) return
    const k = sorted[i].key
    if (e.shiftKey && anchor.current !== null) {
      const [a, b] = [Math.min(anchor.current, i), Math.max(anchor.current, i)]
      const next = new Set(e.ctrlKey || e.metaKey ? sel : [])
      for (const r of sorted.slice(a, b + 1)) next.add(r.key)
      return setSel(next)
    }
    anchor.current = i
    if (e.ctrlKey || e.metaKey) { const next = new Set(sel); if (next.has(k)) next.delete(k); else next.add(k); return setSel(next) }
    setSel(sel.size === 1 && sel.has(k) ? new Set() : new Set([k]))
  }
  const forget = async (keys: string[]) => {
    const split = keys.map((k) => { const at = k.indexOf(':'); return { kind: k.slice(0, at) as Kind, id: k.slice(at + 1) } })
    // Calendar events, moons and tokens stay in History (no delete for good; settings and card looks).
    const items = split.filter((x): x is { kind: Exclude<Kind, 'notedoc' | 'event' | 'moon' | 'token'>; id: string } => !['notedoc', 'event', 'moon', 'token'].includes(x.kind))
    await act('history:forget', { items, noteDocs: split.filter((x) => x.kind === 'notedoc').map((x) => x.id) })
    setSel(new Set()); setConfirm(null)
    say(keys.length === 1 ? 'Deleted for good (Ctrl+Z brings it back)' : `Deleted ${keys.length} things for good (Ctrl+Z brings them back)`)
  }

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
        {removedCount > 0 && (
          <div className="row tight wrap">
            {picked.length > 0
              ? <><span className="muted">{picked.length} selected</span>
                <button className="danger" onClick={() => setConfirm(picked)}>Delete for good…</button>
                <button className="ghost" onClick={() => setSel(new Set())}>Clear selection</button></>
              : <button className="ghost" onClick={() => setSel(new Set(sorted.map((r) => r.key)))}>Select all</button>}
            <span className="spacer" />
            <button className="danger" title="Deletes everything in this list for good; the Change log stays" onClick={() => setConfirm(sorted.map((r) => r.key))}>Clear all history…</button>
          </div>
        )}
        <ul className="removed" aria-label="Removed things; Ctrl+click or Shift+click to select several, right-click to delete for good">
          {sorted.map((r, i) => {
            const on = sel.has(r.key)
            return (
              <li key={r.key} className={on ? 'is-picked' : undefined} onClick={(e) => pick(e, i)} title="Right-click: bring back or delete for good"
                onContextMenu={(e) => {
                  e.preventDefault()
                  const keys = on ? picked : [r.key]
                  if (!on) { setSel(new Set(keys)); anchor.current = i }
                  setMenu({ x: e.clientX, y: e.clientY, keys })
                }}>
                <input type="checkbox" checked={on} aria-label={`Select ${r.name}`} onChange={() => {
                  const next = new Set(sel); if (on) next.delete(r.key); else next.add(r.key); setSel(next); anchor.current = i
                }} />
                {r.body}
              </li>
            )
          })}
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
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[
          { label: menu.keys.length === 1 ? 'Delete for good…' : `Delete ${menu.keys.length} for good…`, danger: true, onClick: () => setConfirm(menu.keys) }
        ]} />
      )}
      {confirm && (
        <Dialog title={confirm.length === 1 ? 'Delete for good?' : `Delete ${confirm.length} things for good?`} open onClose={() => setConfirm(null)}>
          <p>{confirm.length === 1 ? 'It leaves' : 'They leave'} History and the campaign, with everything that belongs to {confirm.length === 1 ? 'it' : 'them'} (cards, links, abilities).</p>
          <p>Ctrl+Z or the Change log can still bring {confirm.length === 1 ? 'it' : 'them'} back.</p>
          {confirm.some((k) => k.startsWith('notedoc:')) && <p>Notes files go to the Windows Recycle Bin instead; restore those from there.</p>}
          <div className="dz-actions">
            <button onClick={() => setConfirm(null)}>Cancel</button>
            <button className="danger" onClick={() => void forget(confirm)}>Delete for good</button>
          </div>
        </Dialog>
      )}
      {forgetFile && (
        <Dialog title="Delete the file for good?" open onClose={() => setForgetFile(null)}>
          <p><strong>{forgetFile.title}</strong> and all its earlier versions go to the Windows Recycle Bin and leave Dungeon Zen.</p>
          <p>This can’t be undone here. You can still restore the files from the Recycle Bin.</p>
          <div className="dz-actions">
            <button onClick={() => setForgetFile(null)}>Cancel</button>
            <button className="danger" onClick={async () => { await act('notedoc:forget', { id: forgetFile.id }); setForgetFile(null); say(`${forgetFile.title} sent to the Recycle Bin`) }}>Delete file for good</button>
          </div>
        </Dialog>
      )}
    </div>
  )
}
