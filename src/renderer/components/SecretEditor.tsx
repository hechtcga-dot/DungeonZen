import { useEffect, useRef, useState } from 'react'
import { useBoard, useView } from '../store'
import { CardPicker } from './LinkField'
import { CommitField } from './fields'
import { Dialog } from './Dialog'
import { RELATIONSHIP_TYPES } from '../../shared/schemas'
import type { EntityBrief, SecretKind, SecretView } from '../../shared/types'

type Conn = { id?: string; sourceId: string; targetId: string; type: string }
type Draft = { kind: SecretKind; text: string; connections: Conn[] }
const words = (t: string) => t.replace(/_/g, ' ').toLowerCase()
const NEW = '__new__'
export const SECRET_LABEL: Record<SecretKind, string> = { secret: 'Secret', clue: 'Clue', connection: 'Link' }

/**
 * A secret, clue or link: its links (Card – kind – Card, each a link on the board; Add link for more)
 * and, on card sheets, its text. Saved as soon as every connection is whole (and, on a card's sheet, one of them is that
 * card); until then the red line says what is missing, and clicking elsewhere asks: Update now, or Do not save changes.
 */
export function SecretEditor({ secret, kind, cards, text, showText, mustInclude, prepItemId, start, pending, onSaved, onDiscard }: {
  secret: SecretView | null
  kind: SecretKind
  cards: EntityBrief[]
  /** The text when the editor does not show it (the prep line edits it). */
  text?: string
  showText?: boolean
  /** On a card's sheet: one connection must be this card. */
  mustInclude?: { id: string; name: string }
  prepItemId?: string
  onSaved?(id: string): void
  /** A new one dropped (Do not save changes) or an existing one put back. */
  onDiscard?(): void
  /** A new one's first connections (not saved until whole). */
  start?: Conn[]
  /** Just made or brought onto this card: not valid yet counts as held back even before any change. */
  pending?: boolean
}) {
  const act = useBoard((s) => s.act)
  const stringTypes = useView().settings.stringTypes
  const types = [...new Set([...RELATIONSHIP_TYPES.filter((t) => t !== 'BOARD_LINK'), ...stringTypes.map((t) => t.type)])]
  const saved: Draft = { kind: secret?.kind ?? kind, text: secret?.text ?? text ?? '', connections: secret?.connections ?? [] }
  const [draft, setDraft] = useState<Draft>(start ? { ...saved, connections: start } : saved)
  const [picking, setPicking] = useState<{ i: number; end: 'sourceId' | 'targetId' } | null>(null)
  const [asking, setAsking] = useState(false)
  const [newType, setNewType] = useState<{ i: number; name: string; colour: string } | null>(null)
  const root = useRef<HTMLDivElement>(null)
  // A newer saved version (undo, another screen) replaces the draft when nothing is held back here.
  const savedKey = JSON.stringify(saved)
  const [lastSaved, setLastSaved] = useState(savedKey)
  if (savedKey !== lastSaved) { setLastSaved(savedKey); setDraft(saved) }

  const name = (id: string) => cards.find((c) => c.id === id)?.name ?? ''
  const problems = [
    ...(draft.connections.some((c) => !c.sourceId || !c.targetId) ? ['Pick both cards of every link.'] : []),
    ...(draft.connections.some((c) => c.sourceId && c.sourceId === c.targetId) ? ['A link needs two different cards.'] : []),
    ...(mustInclude && !draft.connections.some((c) => c.sourceId === mustInclude.id || c.targetId === mustInclude.id)
      ? [`One link must include ${mustInclude.name}.`] : [])
  ]
  const dirty = JSON.stringify(draft) !== savedKey
  const held = (dirty || !!pending) && problems.length > 0

  const save = async (next: Draft) => {
    setDraft(next)
    const ok = next.connections.every((c) => c.sourceId && c.targetId && c.sourceId !== c.targetId)
      && (!mustInclude || next.connections.some((c) => c.sourceId === mustInclude.id || c.targetId === mustInclude.id))
    if (!ok || JSON.stringify(next) === savedKey) return
    const id = await act('secret:save', { id: secret?.id ?? null, kind: next.kind, text: next.text, connections: next.connections, prepItemId })
    if (id) onSaved?.(id)
  }
  const setConn = (i: number, patch: Partial<Conn>) => void save({ ...draft, connections: draft.connections.map((c, k) => (k === i ? { ...c, ...patch } : c)) })

  // Clicking anywhere else while a change is held back asks first.
  useEffect(() => {
    if (!held) return
    const down = (e: PointerEvent) => {
      const t = e.target as Element
      if (root.current?.contains(t) || t.closest?.('dialog')) return
      e.preventDefault(); e.stopPropagation()
      setAsking(true)
    }
    window.addEventListener('pointerdown', down, true)
    return () => window.removeEventListener('pointerdown', down, true)
  }, [held])

  return (
    <div ref={root} className={`secret-editor${held ? ' is-held' : ''}`}>
      {showText && (
        <CommitField id={`sx-${secret?.id ?? 'new'}-${kind}`} label={SECRET_LABEL[draft.kind]} value={draft.text} multiline rows={2}
          placeholder="What is true, and who knows it" onCommit={(t) => void (secret && !dirty ? act('secret:setText', { id: secret.id, text: t }) : save({ ...draft, text: t }))} />
      )}
      <div className="secret-conns">
        <span className="field-label">Links</span>
        {draft.connections.length === 0 && <p className="ink-muted">No cards yet: Add link.</p>}
        {draft.connections.map((c, i) => (
          <div key={c.id ?? `new-${i}`} className="secret-conn">
            <button type="button" className={`card-chip${c.sourceId ? '' : ' is-empty'}`} onClick={() => setPicking({ i, end: 'sourceId' })}>{name(c.sourceId) || 'Pick a card…'}</button>
            <select value={c.type} aria-label="Kind of link" onChange={(e) => (e.target.value === NEW ? setNewType({ i, name: '', colour: '#3b6e8f' }) : setConn(i, { type: e.target.value }))}>
              {[...new Set([...types, c.type])].map((t) => <option key={t} value={t}>{words(t)}</option>)}
              <option value={NEW}>+ New link type…</option>
            </select>
            <button type="button" className={`card-chip${c.targetId ? '' : ' is-empty'}`} onClick={() => setPicking({ i, end: 'targetId' })}>{name(c.targetId) || 'Pick a card…'}</button>
            <button type="button" className="link-button danger-link" aria-label="Remove this link" title="Remove this link (it goes to History)"
              onClick={() => void save({ ...draft, connections: draft.connections.filter((_, k) => k !== i) })}>×</button>
          </div>
        ))}
        <div className="row tight">
          <button type="button" className="ink-button" onClick={() => setDraft({ ...draft, connections: [...draft.connections, { sourceId: mustInclude?.id ?? '', targetId: '', type: 'KNOWS' }] })}>Add link</button>
          <select value={draft.kind} aria-label="Secret, clue or link" onChange={(e) => void save({ ...draft, kind: e.target.value as SecretKind })}>
            {(['secret', 'clue', 'connection'] as const).map((k) => <option key={k} value={k}>{SECRET_LABEL[k]}{k === 'connection' ? ' (known)' : ''}</option>)}
          </select>
        </div>
        {problems.length > 0 && <p className="secret-problem" role="alert">{problems.join(' ')}</p>}
      </div>
      {picking && (
        <CardPicker words="" title="Pick a card" cards={cards} onClose={() => setPicking(null)}
          onPick={(id) => { const p = picking; setPicking(null); setConn(p.i, { [p.end]: id }) }} />
      )}
      {newType && (
        <Dialog title="New link type" open onClose={() => setNewType(null)}>
          <form className="dz-form" onSubmit={(e) => {
            e.preventDefault()
            const type = newType.name.trim().toUpperCase().replace(/\s+/g, '_')
            if (!type) return
            const { i } = newType
            setNewType(null)
            void act('stringTypes:set', { types: [...stringTypes.filter((t) => t.type !== type), { type, colour: newType.colour }] }).then(() => setConn(i, { type }))
          }}>
            <div className="field">
              <label htmlFor="new-link-type">Name and colour</label>
              <div className="row tight">
                <input type="color" value={newType.colour} aria-label="Colour for the new link type" onChange={(e) => setNewType({ ...newType, colour: e.target.value })} />
                <input id="new-link-type" autoFocus value={newType.name} maxLength={40} placeholder="e.g. owes money to" onChange={(e) => setNewType({ ...newType, name: e.target.value })} />
              </div>
              <p className="hint">Every link of this type gets this colour. Change it later in Board › Links.</p>
            </div>
            <div className="dz-actions">
              <button type="button" onClick={() => setNewType(null)}>Cancel</button>
              <button className="primary" disabled={!newType.name.trim()}>Add</button>
            </div>
          </form>
        </Dialog>
      )}
      <Dialog title="This link is not valid" open={asking} onClose={() => setAsking(false)}>
        <p>{problems.join(' ')}</p>
        <div className="actions">
          <button className="primary" onClick={() => setAsking(false)}>Update now</button>
          <button className="danger" onClick={() => { setAsking(false); setDraft(saved); onDiscard?.() }}>Do not save changes</button>
        </div>
      </Dialog>
    </div>
  )
}

/** Prep › Links, secrets, clues › Add new: a link, secret or clue, or one that already exists (searchable, by kind). */
export function AddSecretMenu({ prepId, secrets }: { prepId: string; secrets: SecretView[] }) {
  const act = useBoard((s) => s.act)
  const [picking, setPicking] = useState(false)
  const [q, setQ] = useState('')
  const t = q.trim().toLowerCase()
  const shown = secrets.filter((x) => !t || `${x.label} ${x.text}`.toLowerCase().includes(t))
  const pick = (x: SecretView) => { setPicking(false); void act('prepItem:add', { prepId, kind: 'discovery', fields: { secretId: x.id, body: x.text } }) }
  return (
    <>
      <select className="ink-button primary-ink" value="" aria-label="Add new" onChange={(e) => {
        const v = e.target.value
        if (v === 'existing') { setQ(''); setPicking(true) } else if (v) void act('prepItem:addSecret', { prepId, kind: v as SecretKind })
      }}>
        <option value="">Add new…</option>
        {(['connection', 'secret', 'clue'] as const).map((k) => <option key={k} value={k}>{SECRET_LABEL[k]}</option>)}
        <option value="existing">Select existing…</option>
      </select>
      {picking && (
        <Dialog title="Select an existing link, secret or clue" open onClose={() => setPicking(false)}>
          <div className="card-picker">
            <input autoFocus type="search" placeholder="Search…" value={q} aria-label="Search links, secrets and clues" onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && shown.length === 1) pick(shown[0]) }} />
            <div className="card-picker-list">
              {shown.length === 0 && <p className="hint">Nothing matches.</p>}
              {(['connection', 'secret', 'clue'] as const).map((k) => {
                const list = shown.filter((x) => x.kind === k)
                return list.length === 0 ? null : (
                  <section key={k}>
                    <h3 className="panel-subheading">{SECRET_LABEL[k]}s ({list.length})</h3>
                    <ul>{list.map((x) => (
                      <li key={x.id}><button className="link-button" onClick={() => pick(x)}>{x.text || x.label}</button>
                        {x.text && x.connections.length > 0 && <span className="muted"> · {x.label}</span>}</li>
                    ))}</ul>
                  </section>
                )
              })}
            </div>
          </div>
        </Dialog>
      )}
    </>
  )
}
