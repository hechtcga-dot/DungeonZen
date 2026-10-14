import { useMemo, useState } from 'react'
import { useBoard, useView } from '../store'
import { useBoardPrefs } from '../boardPrefs'
import { RELATIONSHIP_TYPES } from '../../shared/schemas'
import { WinnerDialog } from './WinnerDialog'
import { CommitField } from './fields'
import type { RelationshipView, StringType } from '../../shared/types'

const words = (t: string) => t.replace(/_/g, ' ').toLowerCase()
const BUILT_IN = RELATIONSHIP_TYPES.filter((t) => t !== 'BOARD_LINK')

/**
 * Board › Links: every string on this board, the kinds of string (the DM's own, with colours),
 * and whether strings are shared by every board. While open, strings stand out on the board.
 */
export function ConnectionsPanel({ cardId }: { cardId?: string | null }) {
  const view = useView()
  const { act, select, selection } = useBoard()
  const prefs = useBoardPrefs()
  const [kind, setKind] = useState('')
  const [newKind, setNewKind] = useState('')
  const [newColour, setNewColour] = useState('#3b6e8f')
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null)
  const [askShare, setAskShare] = useState(false)
  const types = view.settings.stringTypes
  const name = (id: string) => view.entities[id]?.name ?? '?'
  const used = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of view.relationships) m.set(r.type, (m.get(r.type) ?? 0) + 1)
    return m
  }, [view.relationships])
  const kinds = [...new Set([...BUILT_IN, ...types.map((t) => t.type), ...used.keys()])]
  // Known strings first, then secret ones; by kind, then by name.
  const list = view.relationships.filter((r) => !kind || r.type === kind)
    .sort((a, b) => Number(a.isSecret) - Number(b.isSecret) || a.type.localeCompare(b.type) || name(a.sourceId).localeCompare(name(b.sourceId)))
  const known = list.filter((r) => !r.isSecret)
  const secret = list.filter((r) => r.isSecret)
  const card = cardId ? view.entities[cardId] : undefined
  const mine = card ? view.relationships.filter((r) => r.sourceId === card.id || r.targetId === card.id)
    .sort((a, b) => Number(a.isSecret) - Number(b.isSecret) || a.type.localeCompare(b.type)) : []
  const row = (r: RelationshipView) => (
    <LinkRow key={r.id} r={r} name={name} colour={own(r.type)?.colour ?? undefined} selected={selection?.kind === 'string' && selection.id === r.id}
      onSelect={() => select({ kind: 'string', id: r.id })} onCard={(id) => select({ kind: 'entity', id })} />
  )
  const own = (t: string) => types.find((x) => x.type === t)

  const saveTypes = (next: StringType[]) => void act('stringTypes:set', { types: next })
  const addKind = () => {
    const t = newKind.trim().toUpperCase().replace(/\s+/g, '_')
    if (!t) return
    saveTypes([...types.filter((x) => x.type !== t), { type: t, colour: newColour }])
    setNewKind('')
  }
  const setColour = (t: string, colour: string | null) =>
    saveTypes(own(t) ? types.map((x) => (x.type === t ? { ...x, colour } : x)) : [...types, { type: t, colour }])

  const all = (
    <>
      <p className="hint">Strings stand out while this panel is open. Right-click a string on the board for the same actions.</p>
      <div className="field checkbox"><input id="lk-grey-cards" type="checkbox" checked={prefs.greyCards} onChange={(e) => prefs.set({ greyCards: e.target.checked })} />
        <label htmlFor="lk-grey-cards">Grey out cards</label></div>
      <div className="field checkbox"><input id="lk-grey-notes" type="checkbox" checked={prefs.greyNotes} onChange={(e) => prefs.set({ greyNotes: e.target.checked })} />
        <label htmlFor="lk-grey-notes">Grey out notes</label></div>
      <div className="field checkbox"><input id="lk-hidden" type="checkbox" checked={prefs.showHidden} onChange={(e) => prefs.set({ showHidden: e.target.checked })} />
        <label htmlFor="lk-hidden">Show hidden strings (greyed)</label></div>

      <div className="field">
        <label htmlFor="lk-filter">Kind</label>
        <select id="lk-filter" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">All kinds ({view.relationships.length})</option>
          {kinds.filter((k) => used.has(k)).map((k) => <option key={k} value={k}>{words(k)} ({used.get(k)})</option>)}
        </select>
      </div>
      {list.length === 0 ? <p className="hint">No strings{kind ? ' of this kind' : ''} here yet. Drag from one card's red pin to another's.</p> : (
        <>
          {known.length > 0 && <><h3 className="panel-subheading">Known ({known.length})</h3><ul className="links-list">{known.map(row)}</ul></>}
          {secret.length > 0 && <><h3 className="panel-subheading">Secret ({secret.length})</h3><ul className="links-list">{secret.map(row)}</ul></>}
        </>
      )}
      <h3 className="panel-subheading">Kinds of string</h3>
      <ul className="links-kinds">
        {kinds.map((k) => (
          <li key={k}>
            <input type="color" value={own(k)?.colour ?? '#d2453a'} aria-label={`Colour for ${words(k)}`} onChange={(e) => setColour(k, e.target.value)} />
            {renaming?.from === k ? (
              <form className="row tight" onSubmit={(e) => { e.preventDefault(); if (renaming.to.trim()) void act('stringTypes:rename', { from: k, to: renaming.to }); setRenaming(null) }}>
                <input autoFocus value={renaming.to} maxLength={40} aria-label="New name" onChange={(e) => setRenaming({ from: k, to: e.target.value })} />
                <button type="submit">Save</button>
              </form>
            ) : <span className="links-kind-name">{words(k)}{used.get(k) ? ` (${used.get(k)})` : ''}</span>}
            <span className="row tight">
              <button className="link-button" title="Renames every string of this kind" onClick={() => setRenaming({ from: k, to: words(k) })}>Rename</button>
              {own(k)?.colour && <button className="link-button" onClick={() => setColour(k, null)}>Default colour</button>}
              {own(k) && !BUILT_IN.includes(k as never) && (
                <button className="link-button danger-link" title="Takes it off the list; strings of this kind stay"
                  onClick={() => saveTypes(types.filter((x) => x.type !== k))}>Delete</button>
              )}
            </span>
          </li>
        ))}
      </ul>
      <form className="row tight" onSubmit={(e) => { e.preventDefault(); addKind() }}>
        <input type="color" value={newColour} aria-label="Colour for the new kind" onChange={(e) => setNewColour(e.target.value)} />
        <input value={newKind} maxLength={40} placeholder="New kind, e.g. owes money to" aria-label="New kind of string" onChange={(e) => setNewKind(e.target.value)} />
        <button type="submit" disabled={!newKind.trim()}>Add kind</button>
      </form>

      <details className="links-advanced">
        <summary>Advanced</summary>
        <div className="field checkbox">
          <input id="lk-shared" type="checkbox" checked={view.settings.sharedStrings}
            onChange={(e) => (e.target.checked ? setAskShare(true) : void act('board:sharedStrings', { on: false, winner: 'global' }))} />
          <label htmlFor="lk-shared">Strings are the same on every board</label>
        </div>
        <p className="hint">Untick to let each storyline board keep its own strings (each board gets a copy to change).
          Ticking it again asks which board's strings to keep.</p>
      </details>
    </>
  )

  return (
    <div className="inspector links-panel">
      {card ? (
        <>
          <h2 className="panel-heading">Links of {card.name}</h2>
          {mine.length === 0 ? <p className="hint">No strings on this card yet. Drag from its red pin to another card's.</p> : <ul className="links-list">{mine.map(row)}</ul>}
          <details className="links-all">
            <summary>Show all links ▾</summary>
            {all}
          </details>
        </>
      ) : (
        <>
          <h2 className="panel-heading">Links on this board</h2>
          {all}
        </>
      )}
      {askShare && (
        <WinnerDialog title="Same strings on every board"
          text="The boards have their own strings now. Which strings should every board share: the global board's, or the storyline boards'?"
          onChoose={(winner) => { setAskShare(false); void act('board:sharedStrings', { on: true, winner }) }} onClose={() => setAskShare(false)} />
      )}
    </div>
  )
}

/** One string, spelled out: the two cards (click to select), its kind, known or secret, and the DM's description. */
function LinkRow({ r, name, colour, selected, onSelect, onCard }: {
  r: RelationshipView; name(id: string): string; colour?: string; selected: boolean; onSelect(): void; onCard(id: string): void
}) {
  const act = useBoard((s) => s.act)
  return (
    <li className={`link-row${selected ? ' is-selected' : ''}${r.hidden ? ' is-hidden' : ''}`}>
      <div className="link-ends">
        <button className="link-button" onClick={() => onCard(r.sourceId)}>{name(r.sourceId)}</button>
        <button className="link-button links-kind" style={{ color: colour }} onClick={onSelect} title="Select this string">
          {words(r.type)} →
        </button>
        <button className="link-button" onClick={() => onCard(r.targetId)}>{name(r.targetId)}</button>
      </div>
      <span className={`link-state${r.isSecret ? ' is-secret' : ''}`}>{r.isSecret ? 'Secret' : 'Known'}</span>
      <CommitField id={`lk-d-${r.id}`} label="Description" className="label-hidden" multiline rows={2} value={r.description}
        placeholder="Description (shared with prep secrets tied to it)" onCommit={(description) => void act('relationship:update', { id: r.id, patch: { description } })} />
      <span className="row tight">
        <button className="link-button" onClick={() => void act('board:setHidden', { kind: 'string', id: r.id, hidden: !r.hidden })}>{r.hidden ? 'Unhide' : 'Hide'}</button>
        <button className="link-button danger-link" onClick={() => void act('relationship:setStatus', { id: r.id, status: 'defunct' })}>Remove</button>
      </span>
    </li>
  )
}
