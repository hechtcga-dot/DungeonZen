import { useEffect, useState } from 'react'
import { call } from '../api'
import { useBoard } from '../store'
import type { IpcOutputs } from '../../shared/ipc'

const NEW = '\u0000new'

/**
 * A card's location (owner, 2026-10-14): a Location or Building card from the list, or + New location… (makes a Location
 * card). "(from map)" marks places shown by a map region. A typed-in place that is not a card stays and shows as it is.
 */
export function LocationPick({ id, label = 'Location', value, onChange, exclude, hint }: {
  id: string; label?: string; value: string; onChange(name: string): void; exclude?: string; hint?: string
}) {
  const undo = useBoard((s) => s.view?.undo)
  const [places, setPlaces] = useState<IpcOutputs['places:list']>([])
  const [adding, setAdding] = useState<string | null>(null)
  useEffect(() => { void call('places:list', undefined).then(setPlaces).catch(() => setPlaces([])) }, [undo])
  const list = places.filter((p) => p.id !== exclude)
  const cur = list.find((p) => p.name === value)
  const add = async () => {
    const { act, info } = useBoard.getState()
    const name = adding?.trim()
    if (!name || !info) return
    const card = await act('entity:create', { boardId: info.globalBoardId, type: 'LOCATION', name })
    setAdding(null)
    if (card) onChange(card.name)
  }
  const group = (type: 'LOCATION' | 'BUILDING', title: string) => {
    const g = list.filter((p) => p.type === type)
    return g.length === 0 ? null : (
      <optgroup label={title}>
        {g.map((p) => <option key={p.id} value={p.name}>{p.name}{p.fromMap ? ' (from map)' : ''}</option>)}
      </optgroup>
    )
  }
  return (
    <div className="field location-pick">
      <label htmlFor={id}>{label}</label>
      {adding === null ? (
        <select id={id} value={value} onChange={(e) => { if (e.target.value === NEW) setAdding(''); else onChange(e.target.value) }}>
          <option value="">None</option>
          {value && !cur && <option value={value}>{value}</option>}
          {group('LOCATION', 'Locations')}
          {group('BUILDING', 'Buildings')}
          <option value={NEW}>+ New location…</option>
        </select>
      ) : (
        <form className="row tight" onSubmit={(e) => { e.preventDefault(); void add() }}>
          <input id={id} autoFocus value={adding} maxLength={200} placeholder="Name of the new location" onChange={(e) => setAdding(e.target.value)} />
          <button type="submit" disabled={!adding.trim()}>Add</button>
          <button type="button" onClick={() => setAdding(null)}>Cancel</button>
        </form>
      )}
      {cur?.fromMap && <span className="hint">(from map)</span>}
      {hint && <span className="hint">{hint}</span>}
    </div>
  )
}
