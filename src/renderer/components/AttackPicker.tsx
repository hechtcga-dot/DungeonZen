import { useEffect, useMemo, useState } from 'react'
import { call } from '../api'
import { useBoard } from '../store'
import { Dialog } from './Dialog'
import { ABILITY_KEYS, abilityModifier, castingAbility, emptyStatBlock, formatModifier, profFor, readStatBlock, type AbilityKey } from '../../shared/statblock'
import { buildAttack, spellSpec, weaponSpec, type AttackSpec, type SrdAttacks } from '../../shared/attacks'
import type { AbilityKind } from '../../shared/schemas'
import type { SheetView } from '../../shared/types'

export type PickerTab = 'weapons' | 'spells' | 'custom'
const ABILITY_FULL: Record<AbilityKey, string> = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' }
let cache: SrdAttacks | null = null

/**
 * Sheet › Actions or Spells › Add from the SRD / Your own attack: SRD weapons and spells, or an
 * attack you describe, made into a description and a Roll20 macro with this card's numbers.
 * Everything added stays editable on the card.
 */
export function AttackPicker({ sheet, tab: start, onClose }: { sheet: SheetView; tab: PickerTab; onClose(): void }) {
  const { act, say } = useBoard()
  const e = sheet.entity
  const sb = readStatBlock(e.attributes.statblock) ?? emptyStatBlock()
  const prof = profFor(e.type, e.attributes, sb).prof ?? 2
  const charLevel = Number.parseInt(String(e.attributes.level ?? ''), 10) || 1
  const [tab, setTab] = useState<PickerTab>(start)
  const [data, setData] = useState<SrdAttacks | null>(cache)
  const [q, setQ] = useState('')
  const [pick, setPick] = useState<Set<string>>(new Set())
  const [proficient, setProficient] = useState(true)
  const [magic, setMagic] = useState(0)
  const [caster, setCaster] = useState<AbilityKey>(castingAbility(e.attributes, sb))
  const [level, setLevel] = useState('all')
  const [cls, setCls] = useState('all')
  useEffect(() => { if (!cache) void call('srd:attacks', undefined).then((d) => { cache = d; setData(d) }) }, [])
  const have = new Set(sheet.abilities.map((a) => a.name.toLowerCase()))
  const words = q.trim().toLowerCase()
  const weapons = useMemo(() => (data?.weapons ?? []).filter((w) => !words || w.name.toLowerCase().includes(words)), [data, words])
  const classes = useMemo(() => [...new Set((data?.spells ?? []).flatMap((s) => s.classes))].sort(), [data])
  const spells = useMemo(() => (data?.spells ?? []).filter((s) => (!words || s.name.toLowerCase().includes(words))
    && (level === 'all' || s.level === Number(level)) && (cls === 'all' || s.classes.includes(cls))), [data, words, level, cls])
  const castMod = abilityModifier(sb[caster])
  // Every ticked one, also those the current search hides.
  const made = () => tab === 'weapons'
    ? (data?.weapons ?? []).filter((w) => pick.has(w.key)).map((w) => buildAttack(weaponSpec(w, sb, prof, { proficient, magic })))
    : (data?.spells ?? []).filter((s) => pick.has(s.key)).map((s) => buildAttack(spellSpec(s, castMod, prof, charLevel)))
  const add = async (list: ReturnType<typeof buildAttack>[]) => {
    if (!list.length) return
    const ok = await act('ability:addMany', { entityId: e.id, abilities: list })
    if (ok !== undefined) {
      if (tab === 'spells' && e.attributes.spell_ability !== caster) await act('entity:update', { id: e.id, patch: { attributes: { spell_ability: caster } } })
      say(`Added ${list.length === 1 ? list[0].name : `${list.length} ${tab === 'spells' ? 'spells' : 'attacks'}`} to ${e.name}. Ctrl+Z undoes it.`)
      onClose()
    }
  }
  const toggle = (k: string, v: boolean) => setPick((p) => { const n = new Set(p); if (v) n.add(k); else n.delete(k); return n })

  return (
    <Dialog title={`Attacks and spells for ${e.name}`} open onClose={onClose} wide>
      <div className="dz-form">
        <div className="segmented" role="tablist" aria-label="Kind">
          {([['weapons', 'SRD weapons'], ['spells', 'SRD spells'], ['custom', 'Your own attack']] as const).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} aria-pressed={tab === id} onClick={() => { setTab(id); setPick(new Set()) }}>{label}</button>
          ))}
        </div>
        <p className="hint">Numbers from this card: proficiency {formatModifier(prof)}{tab === 'spells' ? `, ${ABILITY_FULL[caster]} ${formatModifier(castMod)} (save DC ${8 + castMod + prof}, spell attack ${formatModifier(castMod + prof)})` : `, Str ${formatModifier(abilityModifier(sb.str))}, Dex ${formatModifier(abilityModifier(sb.dex))}`}. Each one gets a Roll20 macro; edit anything afterwards.</p>
        {tab !== 'custom' && !data && <p>Loading…</p>}
        {tab !== 'custom' && data && (
          <>
            <div className="attack-filters">
              <input aria-label="Search" placeholder="Search…" value={q} onChange={(ev) => setQ(ev.target.value)} />
              {tab === 'weapons' && <>
                <label className="field checkbox"><input type="checkbox" checked={proficient} onChange={(ev) => setProficient(ev.target.checked)} /> Proficient</label>
                <label>Magic <select aria-label="Magic bonus" value={magic} onChange={(ev) => setMagic(Number(ev.target.value))}>{[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n ? `+${n}` : 'none'}</option>)}</select></label>
              </>}
              {tab === 'spells' && <>
                <select aria-label="Spell level" value={level} onChange={(ev) => setLevel(ev.target.value)}>
                  <option value="all">Every level</option>{Array.from({ length: 10 }, (_, n) => <option key={n} value={n}>{n ? `Level ${n}` : 'Cantrips'}</option>)}
                </select>
                <select aria-label="Class" value={cls} onChange={(ev) => setCls(ev.target.value)}>
                  <option value="all">Every class</option>{classes.map((c) => <option key={c}>{c}</option>)}
                </select>
                <label>Casts with <select aria-label="Spellcasting ability" value={caster} onChange={(ev) => setCaster(ev.target.value as AbilityKey)}>
                  {ABILITY_KEYS.map((k) => <option key={k} value={k}>{ABILITY_FULL[k]}</option>)}</select></label>
              </>}
            </div>
            <ul className="attack-pick">
              {tab === 'weapons' && weapons.map((w) => {
                const s = weaponSpec(w, sb, prof, { proficient, magic })
                return <li key={w.key}><label className="field checkbox"><input type="checkbox" checked={pick.has(w.key)} onChange={(ev) => toggle(w.key, ev.target.checked)} />
                  <strong>{w.name}</strong>{have.has(w.name.toLowerCase()) && <span className="tag-known">on the card</span>}
                  <span className="muted">{formatModifier(s.toHit ?? 0)} · {w.dice}{formatModifier(s.damage[0].bonus)} {w.type} · {w.properties.join(', ')}</span></label></li>
              })}
              {tab === 'spells' && spells.map((x) => (
                <li key={x.key}><label className="field checkbox"><input type="checkbox" checked={pick.has(x.key)} onChange={(ev) => toggle(x.key, ev.target.checked)} />
                  <strong>{x.name}</strong>{have.has(x.name.toLowerCase()) && <span className="tag-known">on the card</span>}
                  <span className="muted">{x.level ? `Level ${x.level}` : 'Cantrip'} {x.school} · {x.time}{x.attack ? ` · attack ${formatModifier(castMod + prof)}` : ''}{x.save ? ` · ${x.save} save DC ${8 + castMod + prof}` : ''}{x.dice ? ` · ${x.dice} ${x.types.join('/')}` : ''}{x.concentration ? ' · concentration' : ''}</span></label></li>
              ))}
            </ul>
            <p className="hint">{data.attribution}</p>
            <div className="dz-actions">
              <button onClick={onClose}>Cancel</button>
              <button className="primary" disabled={pick.size === 0} onClick={() => void add(made())}>Add {pick.size || ''} {tab === 'spells' ? 'spells' : 'attacks'}</button>
            </div>
          </>
        )}
        {tab === 'custom' && <CustomAttack sheet={sheet} prof={prof} onAdd={(a) => void add([a])} onCancel={onClose} />}
      </div>
    </Dialog>
  )
}

/** Your own attack: the roll, the numbers and the damage; the description and macro follow. */
function CustomAttack({ sheet, prof, onAdd, onCancel }: { sheet: SheetView; prof: number; onAdd(a: ReturnType<typeof buildAttack>): void; onCancel(): void }) {
  const sb = readStatBlock(sheet.entity.attributes.statblock) ?? emptyStatBlock()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<AbilityKind>('ACTION')
  const [roll, setRoll] = useState<'attack' | 'save' | 'none'>('attack')
  const [ab, setAb] = useState<AbilityKey>('str')
  const [proficient, setProficient] = useState(true)
  const [extra, setExtra] = useState(0)
  const [attackType, setAttackType] = useState('Melee')
  const [reach, setReach] = useState('reach 5 ft.')
  const [saveAb, setSaveAb] = useState<AbilityKey>('dex')
  const [damage, setDamage] = useState([{ dice: '1d8', addMod: true, type: 'Slashing' }, { dice: '', addMod: false, type: '' }])
  const [note, setNote] = useState('')
  const mod = abilityModifier(sb[ab])
  const toHit = mod + (proficient ? prof : 0) + extra
  const dc = 8 + mod + (proficient ? prof : 0) + extra
  const spec: AttackSpec = {
    name: name.trim() || 'New attack', kind, toHit: roll === 'attack' ? toHit : null, attackType, reach: reach.trim(),
    save: roll === 'save' ? { dc, ability: ABILITY_FULL[saveAb] } : null,
    damage: damage.filter((d) => /^\d+d\d+$/i.test(d.dice.trim())).map((d) => ({ dice: d.dice.trim(), bonus: d.addMod ? mod + extra : 0, type: d.type.trim() })),
    note
  }
  const out = buildAttack(spec)
  const setDmg = (i: number, patch: Partial<(typeof damage)[number]>) => setDamage(damage.map((d, j) => (j === i ? { ...d, ...patch } : d)))
  return (
    <>
      <div className="grid-2">
        <div className="field"><label htmlFor="ca-name">Name</label><input id="ca-name" value={name} maxLength={120} placeholder="Chill Touch, Tail Swipe…" onChange={(ev) => setName(ev.target.value)} /></div>
        <div className="field"><label htmlFor="ca-kind">Kind</label>
          <select id="ca-kind" value={kind} onChange={(ev) => setKind(ev.target.value as AbilityKind)}>
            {([['ACTION', 'Action'], ['BONUS_ACTION', 'Bonus action'], ['REACTION', 'Reaction'], ['SPELL', 'Spell'], ['OTHER', 'Other']] as const).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select></div>
        <div className="field"><label htmlFor="ca-roll">Roll</label>
          <select id="ca-roll" value={roll} onChange={(ev) => setRoll(ev.target.value as typeof roll)}>
            <option value="attack">Attack roll</option><option value="save">Saving throw (targets)</option><option value="none">No roll (damage only)</option>
          </select></div>
        <div className="field"><label htmlFor="ca-ab">Uses</label>
          <select id="ca-ab" value={ab} onChange={(ev) => setAb(ev.target.value as AbilityKey)}>
            {ABILITY_KEYS.map((k) => <option key={k} value={k}>{ABILITY_FULL[k]} ({formatModifier(abilityModifier(sb[k]))})</option>)}
          </select></div>
        <label className="field checkbox"><input type="checkbox" checked={proficient} onChange={(ev) => setProficient(ev.target.checked)} /> Add proficiency ({formatModifier(prof)})</label>
        <div className="field"><label htmlFor="ca-extra">Extra bonus (magic, feat)</label><input id="ca-extra" inputMode="numeric" value={extra} onChange={(ev) => setExtra(Number.parseInt(ev.target.value, 10) || 0)} /></div>
        {roll === 'attack' && <div className="field"><label htmlFor="ca-type">Attack</label>
          <select id="ca-type" value={attackType} onChange={(ev) => setAttackType(ev.target.value)}>
            {['Melee', 'Ranged', 'Melee or Ranged', 'Melee spell', 'Ranged spell'].map((t) => <option key={t}>{t}</option>)}
          </select></div>}
        {roll === 'save' && <div className="field"><label htmlFor="ca-save">Save</label>
          <select id="ca-save" value={saveAb} onChange={(ev) => setSaveAb(ev.target.value as AbilityKey)}>
            {ABILITY_KEYS.map((k) => <option key={k} value={k}>{ABILITY_FULL[k]} (DC {dc})</option>)}
          </select></div>}
        <div className="field"><label htmlFor="ca-reach">Reach or range</label><input id="ca-reach" value={reach} placeholder="reach 5 ft. / range 120 ft. / 15-foot Cone" onChange={(ev) => setReach(ev.target.value)} /></div>
      </div>
      {damage.map((d, i) => (
        <div key={i} className="row tight wrap">
          <label>{i ? 'Extra damage' : 'Damage'} <input aria-label={`${i ? 'Extra damage' : 'Damage'} dice`} value={d.dice} placeholder="2d6" size={6} onChange={(ev) => setDmg(i, { dice: ev.target.value })} /></label>
          <label className="field checkbox"><input type="checkbox" checked={d.addMod} onChange={(ev) => setDmg(i, { addMod: ev.target.checked })} /> add {ABILITY_FULL[ab]}{extra ? ' and extra' : ''}</label>
          <input aria-label={`${i ? 'Extra damage' : 'Damage'} type`} value={d.type} placeholder="Fire" size={10} onChange={(ev) => setDmg(i, { type: ev.target.value })} />
        </div>
      ))}
      <div className="field"><label htmlFor="ca-note">Other effects (optional)</label><input id="ca-note" value={note} maxLength={2000} placeholder="The target can't regain hit points until the start of your next turn." onChange={(ev) => setNote(ev.target.value)} /></div>
      <div className="subcard">
        <p className="selectable"><strong>{out.name}.</strong> {out.description}</p>
        <code className="selectable mono">{out.macroText}</code>
      </div>
      <div className="dz-actions">
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={!name.trim()} onClick={() => onAdd(out)}>Add attack</button>
      </div>
    </>
  )
}
