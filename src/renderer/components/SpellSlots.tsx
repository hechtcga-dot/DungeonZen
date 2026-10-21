import { useState } from 'react'
import { Dialog } from './Dialog'
import { useSetAttr } from './SheetExtras'
import { usesOf } from '../../shared/charsheet'
import { convertSorcery, pactLeft, slotsLeft, slotsTotal, SORCERY_COST, type SlotState } from '../../shared/slots'
import type { SheetView } from '../../shared/types'

/** Ticks for used slots: click the next one to use it, a used one to give it back. */
function Ticks({ total, used, label, onSet }: { total: number; used: number; label: string; onSet(n: number): void }) {
  return (
    <span className="cs-slot-ticks" role="group" aria-label={`${label}: ${Math.max(0, total - used)} of ${total} left`}>
      {Array.from({ length: Math.min(total, 12) }, (_, x) => (
        <button key={x} type="button" className={`cs-tick${x < used ? ' is-on' : ''}`} aria-label={`${label} ${x + 1}${x < used ? ' (used)' : ''}`} aria-pressed={x < used}
          onClick={() => onSet(x < used ? x : x + 1)} />
      ))}
    </span>
  )
}

/**
 * Character sheet tab › Spell slots: the most per level (typed; never changed by casting), used ticks
 * and how many are left, slots made from Sorcery Points (+n), Pact Magic, Convert Sorcery Points.
 */
export function SlotsCard({ sheet, slots, fromText }: { sheet: SheetView; slots: SlotState; fromText: boolean }) {
  const e = sheet.entity
  const setAttr = useSetAttr(e.id)
  const [convert, setConvert] = useState(false)
  const total = slotsTotal(slots)
  const left = slotsLeft(slots)
  const setUsed = (k: number, n: number) => setAttr({ slots_used: slots.used.map((u, j) => (j === k ? Math.max(0, Math.min(total[k], n)) : u)) })
  const setPact = (patch: Partial<{ count: number; level: number }>) => {
    const p = { count: slots.pact.count, level: slots.pact.level, ...patch }
    setAttr({ pact_slots: p.count ? p : null, pact_used: Math.min(slots.pact.used, p.count) || null })
  }
  const sorcery = usesOf(e.attributes).some((u) => /sorcery points?/i.test(u.name))
  return (
    <div className="cs-card">
      <h3 className="cs-title">Spell slots</h3>
      <div className="cs-slots">
        {Array.from({ length: 9 }, (_, k) => (
          <label key={k}>{k + 1}
            <input inputMode="numeric" aria-label={`Level ${k + 1} spell slots`} defaultValue={slots.max[k] || ''} key={`${k}-${slots.max[k]}`} placeholder="–"
              onBlur={(ev) => {
                const n = Math.max(0, Math.min(9, Math.round(Number(ev.target.value)) || 0))
                if (n !== slots.max[k]) setAttr({ spell_slots: slots.max.map((x, j) => (j === k ? n : x)) })
              }} />
            {total[k] > 0 && <span className={`cs-slot-left${left[k] ? '' : ' is-empty'}`} title={slots.bonus[k] ? `${slots.bonus[k]} made from Sorcery Points (gone after a long rest)` : undefined}>
              {left[k]}/{total[k]}{slots.bonus[k] ? ` (+${slots.bonus[k]})` : ''}</span>}
            {total[k] > 0 && <Ticks total={total[k]} used={slots.used[k]} label={`Level ${k + 1} slot`} onSet={(n) => setUsed(k, n)} />}
          </label>
        ))}
      </div>
      <p className="cs-small">Boxes: most slots per level (only changed here). Under them: left/most and ticks for used ones; casting ticks them, a long rest refills them.{fromText ? ' Read from its Spellcasting text.' : ''}</p>
      <div className="cs-pact">
        <span className="cs-small"><b>Pact Magic</b></span>
        <label className="cs-small">Slots <input inputMode="numeric" aria-label="Pact Magic slots" className="cs-pact-n" defaultValue={slots.pact.count || ''} key={`pc-${slots.pact.count}`} placeholder="–"
          onBlur={(ev) => { const n = Math.max(0, Math.min(9, Math.round(Number(ev.target.value)) || 0)); if (n !== slots.pact.count) setPact({ count: n }) }} /></label>
        <label className="cs-small">Level <select aria-label="Pact Magic slot level" value={slots.pact.level} onChange={(ev) => setPact({ level: Number(ev.target.value) })}>
          {[1, 2, 3, 4, 5].map((l) => <option key={l} value={l}>{l}</option>)}
        </select></label>
        {slots.pact.count > 0 && <><span className="cs-slot-left">{pactLeft(slots)}/{slots.pact.count}</span>
          <Ticks total={slots.pact.count} used={slots.pact.used} label="Pact slot" onSet={(n) => setAttr({ pact_used: n || null })} /></>}
        <span className="cs-small ink-muted">Warlock: back on a short rest.</span>
      </div>
      {sorcery && <button type="button" className="align-start" onClick={() => setConvert(true)}>Convert Sorcery Points…</button>}
      {convert && <SorceryDialog sheet={sheet} slots={slots} onClose={() => setConvert(false)} />}
    </div>
  )
}

/** Font of Magic (2024): make a slot from Sorcery Points, or turn a slot into points. Each click is one undo step. */
export function SorceryDialog({ sheet, slots, onClose }: { sheet: SheetView; slots: SlotState; onClose(): void }) {
  const e = sheet.entity
  const setAttr = useSetAttr(e.id)
  const [error, setError] = useState('')
  const sp = usesOf(e.attributes).find((u) => /sorcery points?/i.test(u.name))
  const left = slotsLeft(slots)
  const run = (how: 'make' | 'burn', level: number) => {
    const r = convertSorcery(e.attributes, slots, how, level)
    if ('error' in r) setError(r.error)
    else { setError(''); setAttr(r.patch) }
  }
  return (
    <Dialog title="Convert Sorcery Points" open onClose={onClose}>
      <div className="dz-form">
        <p><strong>{sp ? sp.max - sp.used : 0} of {sp?.max ?? 0}</strong> Sorcery Points left.</p>
        <fieldset className="field">
          <legend>Make a spell slot (gone after a long rest)</legend>
          <div className="row tight wrap">
            {SORCERY_COST.map((cost, k) => (
              <button key={k} type="button" disabled={!sp || sp.max - sp.used < cost} onClick={() => run('make', k + 1)}>Level {k + 1} ({cost} points)</button>
            ))}
          </div>
        </fieldset>
        <fieldset className="field">
          <legend>Turn a slot into Sorcery Points (as many as its level)</legend>
          <div className="row tight wrap">
            {left.map((n, k) => n > 0 && (
              <button key={k} type="button" disabled={!sp || sp.used <= 0} onClick={() => run('burn', k + 1)}>Level {k + 1} → {k + 1} point{k ? 's' : ''} ({n} left)</button>
            ))}
            {!left.some(Boolean) && <span className="ink-muted">No slots left.</span>}
          </div>
        </fieldset>
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="dz-actions"><button className="primary" onClick={onClose}>Done</button></div>
      </div>
    </Dialog>
  )
}
