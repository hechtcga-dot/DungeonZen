import { useView } from '../store'
import { RELATIONSHIP_TYPES } from '../../shared/schemas'

const NEW = '__new__'
const words = (t: string) => t.replace(/_/g, ' ').toLowerCase()

export interface LinkChoice { type: string; isNew: boolean; newName: string; colour: string; secret: boolean }
export const DEFAULT_LINK: LinkChoice = { type: 'KNOWS', isNew: false, newName: '', colour: '#3b6e8f', secret: false }

/** What relationship:create needs for this choice (a new kind brings its colour). */
export function linkInput(c: LinkChoice): { type: string; isSecret: boolean; colour?: string } {
  return c.isNew ? { type: c.newName.trim().toUpperCase().replace(/\s+/g, '_'), isSecret: c.secret, colour: c.colour } : { type: c.type, isSecret: c.secret }
}
export const linkReady = (c: LinkChoice) => (c.isNew ? c.newName.trim() !== '' : c.type !== '')

/** Link type (every kind, with its colour), "+ New link type…" with name and colour, and Secret. */
export function LinkTypeFields({ id, value, onChange }: { id: string; value: LinkChoice; onChange(next: LinkChoice): void }) {
  const view = useView()
  const types = view.settings.stringTypes
  const used = view.relationships.map((r) => r.type)
  const kinds = [...new Set([...RELATIONSHIP_TYPES.filter((t) => t !== 'BOARD_LINK'), ...types.map((t) => t.type), ...used])]
  const colourOf = (k: string) => types.find((t) => t.type === k)?.colour ?? '#d2453a'
  return (
    <>
      <div className="field">
        <label htmlFor={`${id}-type`}>Link type</label>
        <div className="row tight">
          <span className="link-swatch" aria-hidden="true" style={{ background: value.isNew ? value.colour : colourOf(value.type) }} />
          <select id={`${id}-type`} value={value.isNew ? NEW : value.type}
            onChange={(e) => onChange(e.target.value === NEW ? { ...value, isNew: true } : { ...value, isNew: false, type: e.target.value })}>
            {kinds.map((k) => <option key={k} value={k}>{words(k)}</option>)}
            <option value={NEW}>+ New link type…</option>
          </select>
        </div>
      </div>
      {value.isNew && (
        <div className="field">
          <label htmlFor={`${id}-new`}>New link type and its colour</label>
          <div className="row tight">
            <input type="color" value={value.colour} aria-label="Colour for the new link type" onChange={(e) => onChange({ ...value, colour: e.target.value })} />
            <input id={`${id}-new`} autoFocus value={value.newName} maxLength={40} placeholder="e.g. owes money to"
              onChange={(e) => onChange({ ...value, newName: e.target.value })} />
          </div>
          <p className="hint">Every string of this type gets this colour. Change it later in Board › Links.</p>
        </div>
      )}
      <div className="field checkbox">
        <input id={`${id}-secret`} type="checkbox" checked={value.secret} onChange={(e) => onChange({ ...value, secret: e.target.checked })} />
        <label htmlFor={`${id}-secret`}>Secret link (dashed; the party does not know)</label>
      </div>
    </>
  )
}
