import { InYourNotes } from './InYourNotes'
import { useEffect, useState } from 'react'
import { LocationPick } from './LocationPick'
import { useReactFlow } from '@xyflow/react'
import { useBoard, useView } from '../store'
import { CommitField } from './fields'
import { ENTITY_LABELS } from '../entityStyle'
import { TypeEmblem } from '../art/emblems'
import { ENTITY_TYPES, RELATIONSHIP_TYPES, type EntityType } from '../../shared/schemas'
import type { EntityView } from '../../shared/types'
import type { IpcInput } from '../../shared/ipc'

export function Inspector() {
  const selection = useBoard((s) => s.selection)
  const view = useView()
  if (!selection) {
    return (
      <div className="inspector-empty">
        <p>Select a card, link or note to edit it.</p>
        <p className="hint">Tie a link by dragging from one card's red pin to another card's pin.
          Shift-drag on the board to select several. Delete moves the selection to History.</p>
      </div>
    )
  }
  if (selection.kind === 'entity' && view.entities[selection.id]) {
    return <EntityInspector key={selection.id} entity={view.entities[selection.id]} />
  }
  if (selection.kind === 'string') {
    const rel = view.relationships.find((r) => r.id === selection.id)
    if (rel) return <StringInspector key={rel.id} id={rel.id} />
  }
  if (selection.kind === 'note') {
    const item = view.items.find((i) => i.id === selection.id)
    if (item?.kind === 'image') return <ImageInspector key={item.id} itemId={item.id} />
    if (item) return <NoteInspector key={item.id} itemId={item.id} text={item.content?.text ?? ''} hidden={item.hidden} />
  }
  return null
}

const sentence = (type: string) => { const t = type.replace(/_/g, ' ').toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1) }

function EntityInspector({ entity }: { entity: EntityView }) {
  const act = useBoard((s) => s.act)
  const query = useBoard((s) => s.query)
  const openSheet = useBoard((s) => s.openSheet)
  const openEncounter = useBoard((s) => s.openEncounter)
  const select = useBoard((s) => s.select)
  const view = useView()
  const { screenToFlowPosition } = useReactFlow()
  const str = (key: string) => (typeof entity.attributes[key] === 'string' ? (entity.attributes[key] as string) : '')
  const update = (patch: IpcInput<'entity:update'>['patch']) =>
    void act('entity:update', { id: entity.id, patch })
  const storylines = view.boards.filter((b) => b.storylineId)
  const linked = storylines.filter((b) => entity.storylineIds.includes(b.storylineId!))
  const unlinked = storylines.filter((b) => !entity.storylineIds.includes(b.storylineId!))
  const p = `entity-${entity.id}`
  const picture = str('picture')
  // Direct ties: every string on this card, read from this card's side.
  const ties = view.relationships.filter((r) => r.status === 'active' && (r.sourceId === entity.id || r.targetId === entity.id))
    .map((r) => ({ r, other: r.sourceId === entity.id ? r.targetId : r.sourceId }))
  // Encounters this card is part of: a creature in it, its place, or a PC taking part.
  const [encounters, setEncounters] = useState<Array<{ id: string; name: string }>>([])
  useEffect(() => {
    void query('encounters:view', undefined).then((v) => setEncounters((v?.encounters ?? []).filter((e) =>
      e.locationId === entity.id || e.creatures.some((c) => c.entityId === entity.id) || e.pcs.some((pc) => pc.in && pc.id === entity.id))))
  }, [query, entity.id, view])
  const goTo = (id: string) => {
    if (view.entities[id]) useBoard.setState({ selection: { kind: 'entity', id }, focusEntityId: id })
    else void openSheet(id)
  }

  return (
    <div className="inspector">
      <div className="row spread inspector-top">
        <CommitField id={`${p}-name`} label="Name" className="inspector-name" value={entity.name} required onCommit={(name) => update({ name })} />
        <button className="outline" onClick={() => void openSheet(entity.id)}>Open full sheet</button>
      </div>
      <button className="inspector-picture" onClick={() => void openSheet(entity.id)}
        title={picture ? 'Open the sheet to change the picture' : 'No picture yet: open the sheet to add or draw one'}>
        {picture ? <img src={`dz-asset://campaign/${picture}?w=512`} alt={entity.name} /> : <TypeEmblem type={entity.type} />}
      </button>
      <CommitField id={`${p}-summary`} label="One-line summary" value={str('summary')}
        placeholder="Shown on the card" hint="Leave empty to show the stat block line (size, type, CR, HP, AC)."
        onCommit={(summary) => update({ attributes: { summary } })} />

      <fieldset className="field">
        <legend>Direct ties</legend>
        {ties.length === 0 && encounters.length === 0 && <div className="hint">No links yet: drag from this card's red pin to another card.</div>}
        <ul className="ties">
          {ties.map(({ r, other }) => (
            <li key={r.id}>
              {/* A string from this card reads "knows → Name"; one to it "knows ← Name". */}
              <button className="link" onClick={() => goTo(other)} title={`Show ${view.entities[other]?.name ?? 'the card'}`}>
                <span className="tie-type">{r.isSecret ? 'Secret · ' : ''}{sentence(r.type)}</span> {r.sourceId === entity.id ? '→' : '←'} {view.entities[other]?.name ?? 'a card'}
              </button>
            </li>
          ))}
          {encounters.map((e) => (
            <li key={e.id}>
              <button className="link" onClick={() => openEncounter(e.id)} title="Open the encounter">
                <span className="tie-type">Encounter</span> → {e.name}
              </button>
            </li>
          ))}
        </ul>
      </fieldset>

      <CommitField id={`${p}-notes`} label="DM notes" value={str('notes')} multiline
        hint="Saved when you click away. Ctrl+Enter also saves." onCommit={(notes) => update({ attributes: { notes } })} />
      <fieldset className="field">
        <legend>Status</legend>
        <div className="segmented">
          <button aria-pressed={entity.status === 'active'} onClick={() => void act('entity:setStatus', { id: entity.id, status: 'active' })}>Active</button>
          <button aria-pressed={entity.status === 'resolved'} onClick={() => void act('entity:setStatus', { id: entity.id, status: 'resolved' })}>Resolved</button>
        </div>
        <div className="hint">Resolved cards stay on the board, greyed, until their storyline ends.</div>
      </fieldset>

      <InYourNotes entityId={entity.id} />
      <details className="inspector-more">
        <summary>More: type, location, tags, storylines</summary>
        <div className="field">
          <label htmlFor={`${p}-type`}>Type</label>
          <select id={`${p}-type`} value={entity.type} onChange={(e) => update({ type: e.target.value as EntityType })}>
            {ENTITY_TYPES.map((t) => <option key={t} value={t}>{ENTITY_LABELS[t]}</option>)}
          </select>
        </div>
        <LocationPick id={`${p}-location`} value={str('location')} exclude={entity.id}
          onChange={(location) => update({ attributes: { location } })} />
        <CommitField id={`${p}-motivation`} label="Motivation" value={str('motivation')}
          onCommit={(motivation) => update({ attributes: { motivation } })} />
        <CommitField id={`${p}-tags`} label="Tags" value={entity.tags.join(', ')} hint="Separate tags with commas."
          onCommit={(t) => update({ tags: [...new Set(t.split(',').map((x) => x.trim()).filter(Boolean))] })} />
        <fieldset className="field">
          <legend>Storylines</legend>
          {linked.length === 0 && <div className="hint">Not on any storyline view yet.</div>}
          <ul className="chips">
            {linked.map((b) => (
              <li key={b.id} className="chip">
                {b.name}
                <button aria-label={`Take ${entity.name} off ${b.name}`} title="Take off this storyline"
                  onClick={() => void act('entity:removeFromStoryline', { entityId: entity.id, storylineId: b.storylineId! })}>×</button>
              </li>
            ))}
          </ul>
          {unlinked.length > 0 && (
            <>
              <label htmlFor={`${p}-add-story`} className="visually-hidden">Add to storyline</label>
              <select id={`${p}-add-story`} value="" onChange={(e) => {
                const b = storylines.find((s) => s.id === e.target.value)
                if (b) void act('entity:addToStoryline', {
                  entityId: entity.id, storylineId: b.storylineId!, position: screenToFlowPosition({ x: 400, y: 300 })
                })
              }}>
                <option value="">Add to storyline…</option>
                {unlinked.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </>
          )}
        </fieldset>
        <div className="actions">
          <button onClick={() => void act('board:setHidden', { kind: 'entity', id: entity.id, hidden: !entity.hidden })}
            title="Hidden cards leave every board; Show hidden shows them greyed">{entity.hidden ? 'Unhide' : 'Hide on every board'}</button>
          <button className="danger" onClick={async () => { await act('entity:setStatus', { id: entity.id, status: 'defunct' }); select(null) }}>
            Move to History
          </button>
        </div>
        <p className="hint">Nothing is deleted: History keeps it, and Revive brings it back with its links.</p>
      </details>
    </div>
  )
}

function StringInspector({ id }: { id: string }) {
  const act = useBoard((s) => s.act)
  const select = useBoard((s) => s.select)
  const view = useView()
  const rel = view.relationships.find((r) => r.id === id)!
  const name = (eid: string) => view.entities[eid]?.name ?? '?'
  return (
    <div className="inspector">
      <h2 className="panel-heading">Link</h2>
      <p className="string-ends">{name(rel.sourceId)} <span aria-hidden="true">—</span><span className="visually-hidden">to</span> {name(rel.targetId)}</p>
      <CommitField id={`rel-${id}-type`} label="Link type" value={rel.type.replace(/_/g, ' ')} list="relationship-types" required
        hint="Pick a suggestion or type your own." onCommit={(type) => void act('relationship:update', { id, patch: { type } })} />
      <datalist id="relationship-types">
        {[...new Set([...RELATIONSHIP_TYPES, ...view.settings.stringTypes.map((t) => t.type)])].map((t) => <option key={t} value={t.replace(/_/g, ' ')} />)}
      </datalist>
      <CommitField id={`rel-${id}-desc`} label="Description" value={rel.description} multiline rows={3}
        hint="Prep secrets tied to this link share this text." onCommit={(description) => void act('relationship:update', { id, patch: { description } })} />
      <div className="field checkbox">
        <input id={`rel-${id}-secret`} type="checkbox" checked={rel.isSecret}
          onChange={(e) => void act('relationship:update', { id, patch: { isSecret: e.target.checked } })} />
        <label htmlFor={`rel-${id}-secret`}>Secret link (dashed): the party doesn't know about it</label>
      </div>
      <div className="actions">
        <button onClick={() => void act('board:setHidden', { kind: 'string', id, hidden: !rel.hidden })}>{rel.hidden ? 'Unhide' : 'Hide'}</button>
        <button className="danger" onClick={async () => { await act('relationship:setStatus', { id, status: 'defunct' }); select(null) }}>
          Remove link
        </button>
      </div>
    </div>
  )
}

function NoteInspector({ itemId, text, hidden }: { itemId: string; text: string; hidden: boolean }) {
  const act = useBoard((s) => s.act)
  const select = useBoard((s) => s.select)
  return (
    <div className="inspector">
      <h2 className="panel-heading">Note</h2>
      <CommitField id={`note-${itemId}`} label="Text" value={text} multiline
        hint="Saved when you click away. Ctrl+Enter also saves." onCommit={(t) => void act('note:update', { itemId, text: t })} />
      <div className="actions">
        <button onClick={() => void act('board:setHidden', { kind: 'item', id: itemId, hidden: !hidden })}>{hidden ? 'Unhide' : 'Hide'}</button>
        <button className="danger" onClick={async () => { await act('note:setStatus', { itemId, status: 'defunct' }); select(null) }}>
          Remove note
        </button>
      </div>
    </div>
  )
}

function ImageInspector({ itemId }: { itemId: string }) {
  const act = useBoard((s) => s.act)
  const select = useBoard((s) => s.select)
  const view = useView()
  const item = view.items.find((i) => i.id === itemId)!
  const c = item.content ?? {}
  const opacity = c.opacity ?? 0.6
  return (
    <div className="inspector">
      <h2 className="panel-heading">Picture under the cards</h2>
      <CommitField id={`pic-${itemId}-name`} label="Name" value={c.name ?? ''} required onCommit={(name) => void act('boardImage:update', { itemId, patch: { name } })} />
      <div className="field">
        <label htmlFor={`pic-${itemId}-op`}>How solid ({Math.round(opacity * 100)}%)</label>
        <input id={`pic-${itemId}-op`} type="range" min={0.1} max={1} step={0.05} defaultValue={opacity}
          onPointerUp={(e) => void act('boardImage:update', { itemId, patch: { opacity: Number(e.currentTarget.value) } })}
          onKeyUp={(e) => void act('boardImage:update', { itemId, patch: { opacity: Number(e.currentTarget.value) } })} />
      </div>
      <div className="field checkbox">
        <input id={`pic-${itemId}-lock`} type="checkbox" checked={!!c.locked} onChange={(e) => void act('boardImage:update', { itemId, patch: { locked: e.target.checked } })} />
        <label htmlFor={`pic-${itemId}-lock`}>Locked: it stays put while you arrange cards on top</label>
      </div>
      <p className="hint">Drag a corner to resize it (unlock it first). Display › Pictures under the cards turns them all off and on.</p>
      <div className="actions">
        <button onClick={() => void act('board:setHidden', { kind: 'item', id: itemId, hidden: !item.hidden })}>{item.hidden ? 'Unhide' : 'Hide'}</button>
        <button className="danger" onClick={async () => { await act('note:setStatus', { itemId, status: 'defunct' }); select(null) }}>Remove picture</button>
      </div>
    </div>
  )
}
