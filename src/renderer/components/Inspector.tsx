import { useEffect, useState, type KeyboardEvent } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useBoard, useView } from '../store'
import { ENTITY_LABELS } from '../entityStyle'
import { ENTITY_TYPES, RELATIONSHIP_TYPES, type EntityType } from '../../shared/schemas'
import type { EntityView } from '../../shared/types'
import type { IpcInput } from '../../shared/ipc'

/** A text field that saves when you leave it or press Enter (one undo step per edit, not per key). */
function CommitField(props: {
  id: string
  label: string
  value: string
  onCommit(value: string): void
  multiline?: boolean
  placeholder?: string
  hint?: string
  list?: string
  required?: boolean
}) {
  const [draft, setDraft] = useState(props.value)
  useEffect(() => setDraft(props.value), [props.value])
  const commit = () => {
    const next = draft.trim()
    if (props.required && !next) { setDraft(props.value); return }
    if (next !== props.value) props.onCommit(next)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (!props.multiline || e.ctrlKey)) { e.preventDefault(); (e.target as HTMLElement).blur() }
    if (e.key === 'Escape') { setDraft(props.value); (e.target as HTMLElement).blur() }
  }
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      {props.multiline ? (
        <textarea id={props.id} value={draft} rows={5} placeholder={props.placeholder}
          onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={onKey} />
      ) : (
        <input id={props.id} value={draft} placeholder={props.placeholder} list={props.list}
          onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={onKey} />
      )}
      {props.hint && <div className="hint">{props.hint}</div>}
    </div>
  )
}

export function Inspector() {
  const selection = useBoard((s) => s.selection)
  const view = useView()
  if (!selection) {
    return (
      <div className="inspector-empty">
        <p>Select a card, string or note to edit it.</p>
        <p className="hint">Tie a string by dragging from one card's red pin to another card's pin.
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
    if (item) return <NoteInspector key={item.id} itemId={item.id} text={item.content?.text ?? ''} />
  }
  return null
}

function EntityInspector({ entity }: { entity: EntityView }) {
  const act = useBoard((s) => s.act)
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

  return (
    <div className="inspector">
      <h2 className="panel-heading">{ENTITY_LABELS[entity.type]} card</h2>
      <CommitField id={`${p}-name`} label="Name" value={entity.name} required onCommit={(name) => update({ name })} />
      <div className="field">
        <label htmlFor={`${p}-type`}>Type</label>
        <select id={`${p}-type`} value={entity.type} onChange={(e) => update({ type: e.target.value as EntityType })}>
          {ENTITY_TYPES.map((t) => <option key={t} value={t}>{ENTITY_LABELS[t]}</option>)}
        </select>
      </div>
      <fieldset className="field">
        <legend>Status</legend>
        <div className="segmented">
          <button aria-pressed={entity.status === 'active'} onClick={() => void act('entity:setStatus', { id: entity.id, status: 'active' })}>Active</button>
          <button aria-pressed={entity.status === 'resolved'} onClick={() => void act('entity:setStatus', { id: entity.id, status: 'resolved' })}>Resolved</button>
        </div>
        <div className="hint">Resolved cards stay on the board, greyed, until their storyline ends.</div>
      </fieldset>
      <CommitField id={`${p}-summary`} label="One-line summary" value={str('summary')}
        placeholder="Medium fiend · CR 1 · HP 82" onCommit={(summary) => update({ attributes: { summary } })} />
      <CommitField id={`${p}-location`} label="Location" value={str('location')}
        onCommit={(location) => update({ attributes: { location } })} />
      <CommitField id={`${p}-motivation`} label="Motivation" value={str('motivation')}
        onCommit={(motivation) => update({ attributes: { motivation } })} />
      <CommitField id={`${p}-tags`} label="Tags" value={entity.tags.join(', ')} hint="Separate tags with commas."
        onCommit={(t) => update({ tags: [...new Set(t.split(',').map((x) => x.trim()).filter(Boolean))] })} />
      <CommitField id={`${p}-notes`} label="DM notes" value={str('notes')} multiline
        hint="Saved when you click away. Ctrl+Enter also saves." onCommit={(notes) => update({ attributes: { notes } })} />

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
        <button className="danger" onClick={async () => { await act('entity:setStatus', { id: entity.id, status: 'defunct' }); select(null) }}>
          Move to History
        </button>
      </div>
      <p className="hint">Nothing is deleted: History keeps it, and Revive brings it back with its strings.</p>
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
      <h2 className="panel-heading">String</h2>
      <p className="string-ends">{name(rel.sourceId)} <span aria-hidden="true">—</span><span className="visually-hidden">to</span> {name(rel.targetId)}</p>
      <CommitField id={`rel-${id}-type`} label="Link type" value={rel.type.replace(/_/g, ' ')} list="relationship-types" required
        hint="Pick a suggestion or type your own." onCommit={(type) => void act('relationship:update', { id, patch: { type } })} />
      <datalist id="relationship-types">
        {RELATIONSHIP_TYPES.map((t) => <option key={t} value={t.replace(/_/g, ' ')} />)}
      </datalist>
      <div className="field checkbox">
        <input id={`rel-${id}-secret`} type="checkbox" checked={rel.isSecret}
          onChange={(e) => void act('relationship:update', { id, patch: { isSecret: e.target.checked } })} />
        <label htmlFor={`rel-${id}-secret`}>Secret link (dashed): the party doesn't know about it</label>
      </div>
      <div className="actions">
        <button className="danger" onClick={async () => { await act('relationship:setStatus', { id, status: 'defunct' }); select(null) }}>
          Remove string
        </button>
      </div>
    </div>
  )
}

function NoteInspector({ itemId, text }: { itemId: string; text: string }) {
  const act = useBoard((s) => s.act)
  const select = useBoard((s) => s.select)
  return (
    <div className="inspector">
      <h2 className="panel-heading">Note</h2>
      <CommitField id={`note-${itemId}`} label="Text" value={text} multiline
        hint="Saved when you click away. Ctrl+Enter also saves." onCommit={(t) => void act('note:update', { itemId, text: t })} />
      <div className="actions">
        <button className="danger" onClick={async () => { await act('note:setStatus', { itemId, status: 'defunct' }); select(null) }}>
          Remove note
        </button>
      </div>
    </div>
  )
}
