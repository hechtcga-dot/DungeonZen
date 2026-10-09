import { useEffect, useState } from 'react'
import { call } from '../api'
import { useBoard } from '../store'
import { Dialog } from './Dialog'
import { ABILITY_KEYS, readStatBlock, type StatBlock } from '../../shared/statblock'
import type { IpcOutputs } from '../../shared/ipc'
import { classLine } from '../../shared/charsheet'
import type { NoteDocView, SheetView } from '../../shared/types'

type Answer = IpcOutputs['ai:charsheet']
const FIELD_LABELS: Record<string, string> = {
  gender: 'Gender', age: 'Age', height: 'Height', weight: 'Weight', eyes: 'Eyes', hair: 'Hair', skin: 'Skin', faith: 'Faith',
  summary: 'One-line summary', motivation: 'Motivation', appearance: 'Appearance', personality: 'Personality', ideals: 'Ideals',
  bonds: 'Bonds', flaws: 'Flaws', background: 'Background', bio: 'Bio', proficiencies: 'Armor, weapons, tools', notes: 'DM notes (added below the ones there)'
}

const sbLine = (sb: StatBlock) => [
  sb.ac && `AC ${sb.ac}`, sb.hp && `HP ${sb.hp}`, sb.speed && `Speed ${sb.speed}`,
  ABILITY_KEYS.map((k) => `${k.toUpperCase()} ${sb[k]}`).join(' '),
  sb.saves && `Saves ${sb.saves}`, sb.skills && `Skills ${sb.skills}`, sb.senses, sb.languages && `Languages ${sb.languages}`,
  sb.traits.length && `${sb.traits.length} features and traits`
].filter(Boolean).join(' · ')

/**
 * Notes › a character sheet file › Make a character card: the AI reads the ticked files and copies
 * them into a PC card (new or one you have); tick what to keep. Nothing changes until "Use selected".
 */
export function CharSheetDialog({ doc, docs, ids, targetId, onClose }: { doc: NoteDocView; docs: NoteDocView[]; ids?: string[]; targetId?: string; onClose(): void }) {
  const { act, say, openSheet, setAiSettingsOpen } = useBoard()
  const texts = docs
  const first = doc.title.toLowerCase().split(/[^a-z0-9]+/)[0]
  const [pick, setPick] = useState<Set<string>>(new Set(ids ?? texts.filter((d) => d.id === doc.id || (first.length > 2 && d.title.toLowerCase().startsWith(first))).map((d) => d.id)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [target, setTarget] = useState('')
  const [now, setNow] = useState<SheetView | null>(null)
  const [keep, setKeep] = useState<Set<string>>(new Set())
  useEffect(() => { if (target) void call('sheet:view', { entityId: target }).then(setNow).catch(() => setNow(null)); else setNow(null) }, [target])

  const read = async () => {
    setBusy(true); setError('')
    try {
      const r = await call('ai:charsheet', { docIds: [...pick] })
      setAnswer({ ...r, name: r.name || doc.title.replace(/[_-]+/g, ' ').replace(/\bcharacter sheet\b/i, '').trim() })
      setTarget(targetId ?? r.match ?? '')
      setKeep(new Set([
        ...Object.keys(r.fields), 'statblock', ...(r.actions.length ? ['actions'] : []), ...(r.level ? ['level'] : []),
        ...(r.currentHp !== null ? ['currentHp'] : []), ...(r.spellSlots ? ['spellSlots'] : [])
      ]))
    } catch (e) { setError((e as Error).message) }
    setBusy(false)
  }
  const nowAttr = (k: string) => { const v = now?.entity.attributes[k]; return typeof v === 'string' || typeof v === 'number' ? String(v) : Array.isArray(v) ? v.join(' ') : '' }
  const use = async () => {
    if (!answer) return
    const on = (k: string) => keep.has(k)
    const fields = Object.fromEntries(Object.entries(answer.fields).filter(([k]) => on(k))
      .map(([k, v]) => [k, k === 'notes' && nowAttr('notes').trim() ? `${nowAttr('notes').trim()}\n\n${v}` : v]))
    const id = await act('entity:applyCharSheet', {
      entityId: target || null, name: answer.name.trim() || 'New character', source: answer.source,
      statblock: on('statblock') ? answer.statblock : null, actions: on('actions') ? answer.actions : null,
      level: on('level') ? answer.level : null, currentHp: on('currentHp') ? answer.currentHp : null,
      spellSlots: on('spellSlots') ? answer.spellSlots : null, fields,
      spellAbility: on('actions') ? answer.spellAbility as 'str' | null : null, prepared: on('actions') ? answer.prepared : [],
      classes: on('level') && answer.classes.length ? answer.classes : null, saveNotes: on('statblock') && answer.saveNotes ? answer.saveNotes : null
    })
    if (id) { say(`${answer.name} filled from the character sheet. Ctrl+Z undoes it.`); onClose(); await openSheet(id) }
  }
  const toggle = (k: string, v: boolean) => setKeep((p) => { const n = new Set(p); if (v) n.add(k); else n.delete(k); return n })
  const row = (k: string, label: string, proposed: React.ReactNode, was: string) => (
    <div key={k} className={`fill-row${keep.has(k) ? '' : ' is-off'}`}>
      <label className="field checkbox"><input type="checkbox" checked={keep.has(k)} onChange={(ev) => toggle(k, ev.target.checked)} /> <strong>{label}</strong></label>
      {proposed}
      {target && <span className="hint">Now: {was.trim() ? (was.length > 160 ? `${was.slice(0, 160)}…` : was) : 'empty'}</span>}
    </div>
  )

  return (
    <Dialog title="Make a character card" open onClose={onClose} wide>
      {!answer ? (
        <div className="dz-form">
          <p className="hint">The writing AI reads the files you tick (the sheet, a background, notes) and copies them into a character card: stat block, attacks and spells, spell slots, level, hit points and the traits tab. You choose what to keep; nothing changes until then.
            Pictures of a sheet need a model that can see images.</p>
          <fieldset className="field fill-pick">
            <legend>Files with this character</legend>
            {texts.map((d) => (
              <label key={d.id} className="field checkbox">
                <input type="checkbox" checked={pick.has(d.id)} onChange={(ev) => setPick((p) => { const n = new Set(p); if (ev.target.checked) n.add(d.id); else n.delete(d.id); return n })} /> {d.title}{d.kind === 'picture' ? ' (picture)' : d.kind === 'pdf' ? ' (PDF)' : ''}
              </label>
            ))}
          </fieldset>
          {error && <p className="field-error" role="alert">{error} {/service/i.test(error) && <button className="link-button" onClick={() => setAiSettingsOpen(true)}>Choose one…</button>}</p>}
          <div className="dz-actions">
            <button onClick={onClose}>Cancel</button>
            <button className="primary" disabled={busy || pick.size === 0 || pick.size > 10} onClick={() => void read()}>{busy ? 'Reading…' : 'Read with AI'}</button>
          </div>
        </div>
      ) : (
        <div className="dz-form">
          <span className="ai-badge">AI suggestion · {answer.source}</span>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="cs-target">Put it on</label>
              <select id="cs-target" value={target} onChange={(ev) => setTarget(ev.target.value)}>
                <option value="">A new PC card</option>
                {answer.targets.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.type === 'PC' ? 'PC' : 'NPC'})</option>)}
              </select>
            </div>
            {!target && <div className="field"><label htmlFor="cs-name">Name</label>
              <input id="cs-name" value={answer.name} maxLength={200} onChange={(ev) => setAnswer({ ...answer, name: ev.target.value })} /></div>}
          </div>
          {row('statblock', 'Stat block', <p className="selectable">{sbLine(answer.statblock)}</p>, (() => { const sb = readStatBlock(now?.entity.attributes.statblock); return sb ? sbLine(sb) : '' })())}
          {answer.actions.length > 0 && row('actions', `Attacks, spells and actions (${answer.actions.length})`,
            <p className="selectable">{answer.actions.map((a) => a.name).join(', ')}</p>,
            now ? `${now.abilities.map((a) => a.name).join(', ')}${now.abilities.length ? ' (these go to History)' : ''}` : '')}
          {answer.level && row('level', answer.classes.length ? `Level and classes (${classLine(answer.classes)})` : 'Level', <input aria-label="Level" value={answer.level} onChange={(ev) => setAnswer({ ...answer, level: ev.target.value })} />, nowAttr('level'))}
          {answer.currentHp !== null && row('currentHp', 'Hit points now', <span>{answer.currentHp}</span>, nowAttr('current_hp'))}
          {answer.spellSlots && row('spellSlots', 'Spell slots (levels 1–9)', <span>{answer.spellSlots.join(' · ')}</span>, nowAttr('spell_slots'))}
          {Object.entries(answer.fields).map(([k, v]) => row(k, FIELD_LABELS[k] ?? k,
            <textarea aria-label={FIELD_LABELS[k] ?? k} rows={v.length > 90 ? 3 : 1} value={v} onChange={(ev) => setAnswer({ ...answer, fields: { ...answer.fields, [k]: ev.target.value } })} />,
            nowAttr(k)))}
          <div className="dz-actions">
            <button onClick={() => setAnswer(null)}>Back</button>
            <button disabled={busy} onClick={() => void read()}>{busy ? 'Reading…' : 'Read again'}</button>
            <button className="primary" disabled={keep.size === 0 || (!target && !answer.name.trim())} onClick={() => void use()}>Use selected</button>
          </div>
        </div>
      )}
    </Dialog>
  )
}
