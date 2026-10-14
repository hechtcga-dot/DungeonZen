import { useState } from 'react'
import { useBoard } from '../store'
import { Dialog } from './Dialog'
import { useOrderScope, type OrderScope } from '../fold'
import { ENTITY_LABELS } from '../entityStyle'

/** Asked on the first ↑ / ↓ on a card sheet: this card's own order, or every card of its type. Setup › Box order changes it. */
export function OrderScopeDialog() {
  const asking = useOrderScope((s) => s.asking)
  const setScope = useOrderScope((s) => s.set)
  const type = useBoard((s) => s.sheet?.entity.type)
  const [remember, setRemember] = useState(false)
  const pick = (scope: OrderScope | null) => {
    if (scope && remember) setScope(scope)
    setRemember(false)
    asking?.(scope)
  }
  const kind = type ? ENTITY_LABELS[type] : 'card'
  return (
    <Dialog title="Move this box where?" open={!!asking} onClose={() => pick(null)}>
      <p>Should this new order of boxes be for this card only, or for every {kind} card?</p>
      <div className="field checkbox">
        <input id="order-scope-remember" type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        <label htmlFor="order-scope-remember">Don't ask me again (change it under Setup › Box order on card sheets)</label>
      </div>
      <div className="actions">
        <button className="primary" onClick={() => pick('card')}>This card only</button>
        <button onClick={() => pick('type')}>Every {kind} card</button>
      </div>
    </Dialog>
  )
}
