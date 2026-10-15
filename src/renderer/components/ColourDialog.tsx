import { useState } from 'react'
import { Dialog } from './Dialog'
import { useBoard } from '../store'
import { ENTITY_COLOURS, ENTITY_LABELS, cardColour, useTypeColour } from '../entityStyle'
import type { EntityType } from '../../shared/schemas'
import type { EntityView } from '../../shared/types'

export type ColourTarget = { kind: 'type'; type: EntityType } | { kind: 'card'; entity: EntityView } | { kind: 'cards'; entities: EntityView[] }

/** The colour of one card (card right-click) or of every card of a type (board › Card, right-click a type). */
export function ColourDialog({ target, onClose }: { target: ColourTarget; onClose(): void }) {
  const { act, view } = useBoard()
  const typeColour = useTypeColour()
  const first = target.kind === 'card' ? target.entity : target.kind === 'cards' ? target.entities[0] : null
  const type = target.kind === 'type' ? target.type : first!.type
  const label = ENTITY_LABELS[type]
  const [colour, setColour] = useState(first ? cardColour(first, typeColour) : typeColour(type))
  const own = Object.values(view?.entities ?? {}).filter((e) => e.type === type && typeof e.attributes.colour === 'string').length
  const [clearOwn, setClearOwn] = useState(true)
  const done = (p: Promise<unknown>) => void p.then(onClose)
  const setType = (c: string | null) => done(act('entityType:setColour', { type, colour: c, clearOwn: own > 0 && clearOwn }))
  const setCard = (c: string | null) => {
    if (target.kind === 'card') done(act('entity:update', { id: target.entity.id, patch: { attributes: { colour: c } } }))
    if (target.kind === 'cards') done(act('board:many', { label: `Coloured ${target.entities.length} cards`, ops: target.entities.map((e) => ({ op: 'colour' as const, id: e.id, colour: c })) }))
  }
  return (
    <Dialog title={target.kind === 'type' ? `Colour of every ${label} card` : target.kind === 'cards' ? `Colour of ${target.entities.length} cards` : `Colour of ${target.entity.name}`} open onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); if (target.kind === 'type') setType(colour); else setCard(colour) }}>
        <div className="field">
          <label htmlFor="colour-pick">Colour</label>
          <input id="colour-pick" type="color" className="colour-input" value={colour} onChange={(e) => setColour(e.target.value)} />
        </div>
        {target.kind === 'type' && own > 0 && (
          <div className="field checkbox">
            <input id="colour-own" type="checkbox" checked={clearOwn} onChange={(e) => setClearOwn(e.target.checked)} />
            <label htmlFor="colour-own">Also the {own} {label} card{own === 1 ? '' : 's'} given {own === 1 ? 'its' : 'their'} own colour</label>
          </div>
        )}
        <div className="dz-actions">
          {target.kind === 'type'
            ? <button type="button" onClick={() => setType(null)} disabled={typeColour(type) === ENTITY_COLOURS[type] && !(own > 0 && clearOwn)}>Standard colour</button>
            : target.kind === 'cards'
              ? <button type="button" onClick={() => setCard(null)} disabled={target.entities.every((e) => typeof e.attributes.colour !== 'string')}>Use each card's type colour</button>
              : <button type="button" onClick={() => setCard(null)} disabled={typeof target.entity.attributes.colour !== 'string'}>Use the {label} colour</button>}
          <span className="spacer" />
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary">Save</button>
        </div>
      </form>
    </Dialog>
  )
}
