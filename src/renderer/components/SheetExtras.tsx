import { useEffect, useState } from 'react'
import { call } from '../api'
import { useBoard } from '../store'
import { CommitField } from './fields'
import { AttackPicker, type PickerTab } from './AttackPicker'
import { macroFor, spellLevel } from '../../shared/attacks'
import { ACTIONS_IN_COMBAT, abilityRow, applyHp, classLine, classesOf, hitDice, usesOf, xpProgress, type ClassLevel, type LimitedUse } from '../../shared/charsheet'
import { ABILITY_KEYS, abilityModifier, castingAbility, formatModifier, readStatBlock, statLine, type StatBlock } from '../../shared/statblock'
import { AbilityKind } from '../../shared/schemas'
import type { IpcInput } from '../../shared/ipc'
import type { AbilityView, SheetView } from '../../shared/types'

// The full sheet's D&D Beyond-style parts (owner, 2026-10-09): classes line, Heroic Inspiration,
// heal and damage, hit dice, death saves, exhaustion, limited uses, Actions and Spells tables,
// companions. Everything is editable and undoable (rules 4, 11).

const ABILITY_FULL = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' } as const
const KIND_LABELS: Record<AbilityKind, string> = {
  ACTION: 'Action', BONUS_ACTION: 'Bonus action', REACTION: 'Reaction', LEGENDARY_ACTION: 'Legendary action', SPELL: 'Spell', OTHER: 'Other'
}

function useSetAttr(id: string) {
  const act = useBoard((s) => s.act)
  return (attributes: Record<string, unknown>) => void act('entity:update', { id, patch: { attributes } })
}

/** Species, classes with subclass and level (the total sets the character level). */
export function ClassStrip({ sheet, sb, save }: { sheet: SheetView; sb: StatBlock; save(patch: Partial<StatBlock>): void }) {
  const e = sheet.entity
  const setAttr = useSetAttr(e.id)
  const classes = classesOf(e.attributes)
  const level = typeof e.attributes.level === 'string' ? e.attributes.level : ''
  const put = (next: ClassLevel[]) => {
    const total = next.reduce((s, c) => s + c.level, 0)
    setAttr({ classes: next, ...(total ? { level: String(total) } : {}) })
  }
  const p = `cls-${e.id}`
  return (
    <div className="cs-card cs-classes">
      <p className="cs-class-line"><strong>{[sb.creatureType, classLine(classes)].filter(Boolean).join(' · ') || 'Species and class not set'}</strong>{level && <> · Level {level}</>}</p>
      {e.type === 'PC' && <XpLine sheet={sheet} />}
      <div className="cs-class-rows">
        <CommitField id={`${p}-species`} label="Species" value={sb.creatureType} placeholder="Half-Elf" className="cs-inline" onCommit={(creatureType) => save({ creatureType })} />
        {classes.map((c, i) => (
          <div key={i} className="cs-class-row">
            <CommitField id={`${p}-${i}-name`} label="Class" value={c.name} placeholder="Bard" className="cs-inline" onCommit={(name) => put(classes.map((x, j) => (j === i ? { ...x, name } : x)))} />
            <CommitField id={`${p}-${i}-sub`} label="Subclass" value={c.subclass} placeholder="College of Lore" className="cs-inline" onCommit={(subclass) => put(classes.map((x, j) => (j === i ? { ...x, subclass } : x)))} />
            <CommitField id={`${p}-${i}-lvl`} label="Level" value={c.level ? String(c.level) : ''} placeholder="1" className="cs-inline cs-narrow"
              onCommit={(v) => put(classes.map((x, j) => (j === i ? { ...x, level: Math.max(0, Math.min(20, Number.parseInt(v, 10) || 0)) } : x)))} />
            <button className="link-button danger-ink" aria-label={`Remove class ${c.name}`} onClick={() => put(classes.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        <button className="align-start" onClick={() => put([...classes, { name: '', subclass: '', level: classes.length ? 1 : Number.parseInt(level, 10) || 1 }])}>{classes.length ? 'Add a class (multiclass)' : 'Add class'}</button>
      </div>
    </div>
  )
}

/** A character's experience points: the running total (fights add to it; type to change) and the next level. */
function XpLine({ sheet }: { sheet: SheetView }) {
  const e = sheet.entity
  const setAttr = useSetAttr(e.id)
  const xp = typeof e.attributes.xp === 'number' ? e.attributes.xp : 0
  const level = classesOf(e.attributes).reduce((n, c) => n + c.level, 0) || Number.parseInt(String(e.attributes.level ?? ''), 10) || 0
  const p = xpProgress(xp, level)
  return (
    <div className={`cs-xp${p.levelUp || p.close ? ' is-close' : ''}`}>
      <CommitField id={`xp-${e.id}`} label="XP" value={String(xp)} className="cs-inline cs-narrow"
        onCommit={(v) => { const n = Math.max(0, Number.parseInt(v.replace(/[^0-9]/g, ''), 10) || 0); if (n !== xp) setAttr({ xp: n }) }} />
      <span className="ink-muted">{p.levelUp ? `Enough XP for level ${p.xpLevel}: level up!` : p.toNext === null ? 'Top level' : `${p.toNext.toLocaleString()} XP to level ${level + 1 || 2}${p.close ? ': almost there' : ''}`}</span>
    </div>
  )
}

/** Heroic Inspiration: click to give or spend. */
export function InspirationBox({ sheet }: { sheet: SheetView }) {
  const setAttr = useSetAttr(sheet.entity.id)
  const on = sheet.entity.attributes.inspiration === true
  return (
    <button type="button" className={`cs-box cs-inspiration${on ? ' is-on' : ''}`} aria-pressed={on} title={on ? 'Has Heroic Inspiration: click when spent' : 'Click to give Heroic Inspiration'}
      onClick={() => setAttr({ inspiration: !on })}>
      <span className="cs-big" aria-hidden="true">{on ? '★' : '☆'}</span>
      <span className="cs-label">Heroic inspiration</span>
    </button>
  )
}

/** Heal or damage by an amount: damage takes temporary hit points first. */
export function HpAdjust({ sheet, cur, temp, max }: { sheet: SheetView; cur: number; temp: number; max: number | null }) {
  const setAttr = useSetAttr(sheet.entity.id)
  const [n, setN] = useState('')
  const amount = Math.max(0, Number.parseInt(n, 10) || 0)
  const go = (heal: boolean) => { if (amount) { setAttr(applyHp(cur, temp, max, amount, heal)); setN('') } }
  return (
    <div className="cs-hp-adjust">
      <button type="button" className="cs-heal" disabled={!amount} onClick={() => go(true)}>Heal</button>
      <input inputMode="numeric" aria-label="Heal or damage amount" value={n} placeholder="0" onChange={(ev) => setN(ev.target.value)}
        onKeyDown={(ev) => { if (ev.key === 'Enter') go(ev.shiftKey) }} title="Enter: damage · Shift+Enter: heal" />
      <button type="button" className="cs-damage" disabled={!amount} onClick={() => go(false)}>Damage</button>
    </div>
  )
}

/** Hit dice spent, death saves and exhaustion (a long rest on the Live screen resets them). */
export function VitalsCard({ sheet, sb }: { sheet: SheetView; sb: StatBlock }) {
  const a = sheet.entity.attributes
  const setAttr = useSetAttr(sheet.entity.id)
  const hd = hitDice(sb.hitDice || sb.hp, classesOf(a))
  const used = typeof a.hit_dice_used === 'number' ? Math.min(a.hit_dice_used, hd.total) : 0
  const ds = (a.death_saves && typeof a.death_saves === 'object' ? a.death_saves : {}) as { s?: number; f?: number }
  const exhaustion = typeof a.exhaustion === 'number' ? a.exhaustion : 0
  const boxes = (key: 's' | 'f', label: string) => (
    <div className="cs-ds-row"><span>{label}</span>
      {[1, 2, 3].map((k) => {
        const n = ds[key] ?? 0
        return <button key={k} type="button" className={`cs-tick${n >= k ? ' is-on' : ''}${key === 'f' ? ' is-fail' : ''}`} aria-label={`${label} ${k}`} aria-pressed={n >= k}
          onClick={() => setAttr({ death_saves: { ...ds, [key]: n >= k ? k - 1 : k } })} />
      })}
    </div>
  )
  return (
    <div className="cs-card">
      <h3 className="cs-title">Hit dice, death saves, exhaustion</h3>
      {hd.total ? (
        <div className="cs-hd">
          <span>{hd.dice}</span>
          <button type="button" aria-label="Spend a hit die" disabled={used >= hd.total} onClick={() => setAttr({ hit_dice_used: used + 1 })}>−</button>
          <strong>{hd.total - used}/{hd.total}</strong>
          <button type="button" aria-label="Get a hit die back" disabled={used <= 0} onClick={() => setAttr({ hit_dice_used: used - 1 })}>+</button>
        </div>
      ) : <p className="cs-small muted">Hit dice: add classes above, or set them under Details (e.g. 7d8 + 8d8).</p>}
      {boxes('s', 'Successes')}
      {boxes('f', 'Failures')}
      <div className="field cs-inline">
        <label htmlFor={`exh-${sheet.entity.id}`}>Exhaustion</label>
        <select id={`exh-${sheet.entity.id}`} value={exhaustion} onChange={(ev) => setAttr({ exhaustion: Number(ev.target.value) })}>
          {[0, 1, 2, 3, 4, 5, 6].map((k) => <option key={k} value={k}>{k ? `Level ${k}: −${2 * k} to d20 tests, −${5 * k} ft. speed${k === 6 ? ' (dies)' : ''}` : 'None'}</option>)}
        </select>
      </div>
    </div>
  )
}

/** Features with uses (Sorcery Points, Bardic Inspiration…): tick when used; rests on the Live screen refill them. */
export function LimitedUses({ sheet }: { sheet: SheetView }) {
  const e = sheet.entity
  const setAttr = useSetAttr(e.id)
  const uses = usesOf(e.attributes)
  const put = (next: LimitedUse[]) => setAttr({ uses: next })
  const set = (i: number, patch: Partial<LimitedUse>) => put(uses.map((u, j) => (j === i ? { ...u, ...patch } : u)))
  return (
    <>
      <h2 className="panel-heading spaced">Limited uses</h2>
      {uses.length === 0 && <p className="hint">Features used a number of times between rests: Sorcery Points, Bardic Inspiration, Channel Divinity…</p>}
      {uses.map((u, i) => (
        <div key={i} className="cs-use">
          <CommitField id={`use-${e.id}-${i}-name`} label="Feature" value={u.name} required className="cs-inline" onCommit={(name) => set(i, { name })} />
          <div className="cs-use-ticks" role="group" aria-label={`${u.name} uses`}>
            {Array.from({ length: Math.min(u.max, 20) }, (_, k) => (
              <button key={k} type="button" className={`cs-tick${k < u.used ? ' is-on' : ''}`} aria-label={`${u.name} use ${k + 1}`} aria-pressed={k < u.used}
                onClick={() => set(i, { used: k < u.used ? k : k + 1 })} />
            ))}
            {u.max > 20 && <span className="cs-small">{u.max - u.used} of {u.max} left</span>}
          </div>
          <CommitField id={`use-${e.id}-${i}-max`} label="Uses" value={String(u.max)} className="cs-inline cs-narrow"
            onCommit={(v) => { const max = Math.max(0, Math.min(99, Number.parseInt(v, 10) || 0)); set(i, { max, used: Math.min(u.used, max) }) }} />
          <div className="field cs-inline">
            <label htmlFor={`use-${e.id}-${i}-reset`}>Back on</label>
            <select id={`use-${e.id}-${i}-reset`} value={u.reset} onChange={(ev) => set(i, { reset: ev.target.value as LimitedUse['reset'] })}>
              <option value="short">Short rest</option><option value="long">Long rest</option>
            </select>
          </div>
          <button disabled={!u.used} onClick={() => set(i, { used: 0 })}>Refill</button>
          <button className="link-button danger-ink" onClick={() => put(uses.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <button className="align-start" onClick={() => put([...uses, { name: 'New feature', max: 1, used: 0, reset: 'long' }])}>Add a limited use</button>
      <p className="hint">Short and long rests on the Live screen refill them.</p>
    </>
  )
}

type ActionFilter = 'all' | 'attack' | 'ACTION' | 'BONUS_ACTION' | 'REACTION' | 'OTHER' | 'limited'

/** Actions tab: a table of attacks and actions (attack cantrips too), filters, and what anyone can do in combat. */
export function ActionsTable({ sheet }: { sheet: SheetView }) {
  const act = useBoard((s) => s.act)
  const e = sheet.entity
  const setAttr = useSetAttr(e.id)
  const [picker, setPicker] = useState<PickerTab | null>(null)
  const [filter, setFilter] = useState<ActionFilter>('all')
  const [open, setOpen] = useState<string | null>(null)
  const rows = sheet.abilities
    .filter((a) => a.kind !== 'SPELL' || (spellLevel(a.description) === 0 && (/Attack Roll|Saving Throw/i.test(a.description))))
    .map((a) => ({ a, r: abilityRow(a.description, a.kind) }))
    .filter(({ a, r }) => filter === 'all' || (filter === 'attack' ? r.attack : filter === 'limited' ? r.limited
      : filter === 'OTHER' ? ['OTHER', 'LEGENDARY_ACTION'].includes(a.kind) : a.kind === filter))
  const perAction = typeof e.attributes.attacks_per_action === 'number' ? e.attributes.attacks_per_action : 1
  return (
    <>
      <div className="segmented cs-filters" role="tablist" aria-label="Show">
        {([['all', 'All'], ['attack', 'Attack'], ['ACTION', 'Action'], ['BONUS_ACTION', 'Bonus action'], ['REACTION', 'Reaction'], ['OTHER', 'Other'], ['limited', 'Limited use']] as const).map(([id, l]) => (
          <button key={id} role="tab" aria-selected={filter === id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{l}</button>
        ))}
      </div>
      <label className="cs-small cs-per-action">Attacks per Attack action
        <input inputMode="numeric" aria-label="Attacks per Attack action" defaultValue={perAction} key={perAction}
          onBlur={(ev) => { const n = Math.max(1, Math.min(8, Number.parseInt(ev.target.value, 10) || 1)); if (n !== perAction) setAttr({ attacks_per_action: n }) }} />
      </label>
      <table className="cs-table">
        <thead><tr><th>Name</th><th>Range</th><th>Hit / DC</th><th>Damage</th><th>Notes</th></tr></thead>
        <tbody>
          {rows.map(({ a, r }) => (
            <AbilityRows key={a.id} a={a} open={open === a.id} onToggle={() => setOpen(open === a.id ? null : a.id)}
              cells={<><td>{r.range || '—'}</td><td>{r.hitDc || '—'}</td><td>{r.effect || '—'}</td><td className="cs-notes">{r.notes || (a.kind === 'SPELL' ? 'Cantrip' : KIND_LABELS[a.kind])}</td></>} />
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="hint">{filter === 'all' ? 'No attacks yet: add SRD weapons or your own. Spells are on the Spells tab.' : 'None of this kind.'}</p>}
      <div className="row tight wrap">
        <button onClick={() => setPicker('weapons')}>Add from the SRD…</button>
        <button onClick={() => setPicker('custom')}>Your own attack…</button>
        <button onClick={() => void act('ability:add', { entityId: e.id, ability: { name: 'New ability' } })}>Add a blank one</button>
      </div>
      <p className="cs-small"><strong>Actions in combat:</strong> {ACTIONS_IN_COMBAT}</p>
      {picker && <AttackPicker sheet={sheet} tab={picker} onClose={() => setPicker(null)} />}
    </>
  )
}

/** One table row (click the name to edit it below) and, when open, its edit card. */
function AbilityRows({ a, open, onToggle, cells, lead }: { a: AbilityView; open: boolean; onToggle(): void; cells: React.ReactNode; lead?: React.ReactNode }) {
  return (
    <>
      <tr className={open ? 'is-open' : undefined}>
        {lead}
        <td><button className="link-button cs-row-name" aria-expanded={open} onClick={onToggle}>{a.name}</button></td>
        {cells}
      </tr>
      {open && <tr><td colSpan={lead ? 7 : 5}><AbilityCard a={a} /></td></tr>}
    </>
  )
}

/** Spells tab: casting numbers, a table per level with slot boxes, prepared ticks, Cast spends a slot. */
export function SpellsTable({ sheet, sb, prof, slots }: { sheet: SheetView; sb: StatBlock; prof: number | null; slots: number[] }) {
  const act = useBoard((s) => s.act)
  const e = sheet.entity
  const setAttr = useSetAttr(e.id)
  const [picker, setPicker] = useState<PickerTab | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [lv, setLv] = useState<'all' | number>('all')
  const [q, setQ] = useState('')
  const caster = castingAbility(e.attributes, sb)
  const mod = abilityModifier(sb[caster])
  const prepared = new Set(Array.isArray(e.attributes.prepared) ? (e.attributes.prepared as string[]) : [])
  const used = Array.from({ length: 9 }, (_, k) => Math.max(0, Number((Array.isArray(e.attributes.slots_used) ? e.attributes.slots_used as unknown[] : [])[k]) || 0))
  const spells = sheet.abilities.filter((a) => a.kind === 'SPELL')
  const levels = [...new Set(spells.map((a) => spellLevel(a.description)))].sort((a, b) => (a ?? 99) - (b ?? 99))
  const shown = levels.filter((l) => lv === 'all' || l === lv)
  const words = q.trim().toLowerCase()
  const setUsed = (k: number, n: number) => setAttr({ slots_used: used.map((x, j) => (j === k ? Math.max(0, Math.min(slots[k], n)) : x)) })
  const setPrepared = (id: string, on: boolean) => { const next = new Set(prepared); if (on) next.add(id); else next.delete(id); setAttr({ prepared: [...next] }) }
  return (
    <>
      <div className="row tight wrap">
        <div className="field cs-inline">
          <label htmlFor={`spell-ab-${e.id}`}>Spellcasting ability</label>
          <select id={`spell-ab-${e.id}`} value={caster} onChange={(ev) => setAttr({ spell_ability: ev.target.value })}>
            {ABILITY_KEYS.map((k) => <option key={k} value={k}>{ABILITY_FULL[k]} ({formatModifier(abilityModifier(sb[k]))})</option>)}
          </select>
        </div>
        {prof !== null && <div className="cs-spell-nums"><span><b>{formatModifier(mod)}</b>Modifier</span><span><b>{formatModifier(mod + prof)}</b>Spell attack</span><span><b>{8 + mod + prof}</b>Save DC</span></div>}
      </div>
      <div className="row tight wrap">
        <input className="cs-search" aria-label="Search spells" placeholder="Search spells…" value={q} onChange={(ev) => setQ(ev.target.value)} />
        <div className="segmented cs-filters" role="tablist" aria-label="Spell level">
          {(['all', ...levels.filter((l): l is number => l !== null)] as const).map((l) => (
            <button key={String(l)} role="tab" aria-selected={lv === l} aria-pressed={lv === l} onClick={() => setLv(l)}>{l === 'all' ? 'All' : l === 0 ? '0' : `${l}`}</button>
          ))}
        </div>
      </div>
      {spells.length === 0 && <p className="hint">No spells yet. Add SRD spells or your own.</p>}
      {shown.map((l) => {
        const list = spells.filter((a) => spellLevel(a.description) === l && (!words || a.name.toLowerCase().includes(words) || a.description.toLowerCase().includes(words)))
        if (!list.length) return null
        const k = (l ?? 0) - 1
        return (
          <div key={String(l)} className="cs-spell-level">
            <div className="row tight">
              <h3 className="cs-title cs-left">{l === null ? 'Level not given' : l === 0 ? 'Cantrips' : `Level ${l}`}</h3>
              <span className="spacer" />
              {l !== null && l > 0 && slots[k] > 0 && (
                <span className="cs-use-ticks" role="group" aria-label={`Level ${l} slots used`}>
                  {Array.from({ length: slots[k] }, (_, x) => (
                    <button key={x} type="button" className={`cs-tick${x < used[k] ? ' is-on' : ''}`} aria-label={`Level ${l} slot ${x + 1}`} aria-pressed={x < used[k]}
                      onClick={() => setUsed(k, x < used[k] ? x : x + 1)} />
                  ))}
                  <span className="cs-small">slots</span>
                </span>
              )}
            </div>
            <table className="cs-table">
              <thead><tr><th aria-label="Prepared or cast" /><th>Name</th><th>Time</th><th>Range</th><th>Hit / DC</th><th>Effect</th><th>Notes</th></tr></thead>
              <tbody>
                {list.map((a) => {
                  const r = abilityRow(a.description, a.kind)
                  return (
                    <AbilityRows key={a.id} a={a} open={open === a.id} onToggle={() => setOpen(open === a.id ? null : a.id)}
                      lead={<td className="cs-cast">{l === 0 ? <span className="cs-small">At will</span> : (
                        <>
                          <input type="checkbox" aria-label={`${a.name} prepared`} title="Prepared" checked={prepared.has(a.id)} onChange={(ev) => setPrepared(a.id, ev.target.checked)} />
                          {l !== null && slots[k] > 0 && <button type="button" className="cs-cast-btn" disabled={used[k] >= slots[k]} title={`Cast: uses a level ${l} slot`} onClick={() => setUsed(k, used[k] + 1)}>Cast</button>}
                        </>
                      )}</td>}
                      cells={<><td>{r.time || '—'}</td><td>{r.range || '—'}</td><td>{r.hitDc || '—'}</td><td>{r.effect || '—'}</td><td className="cs-notes">{r.notes}</td></>} />
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      })}
      <p className="hint">{spells.length ? `${spells.length} spell${spells.length === 1 ? '' : 's'}, ${spells.filter((a) => prepared.has(a.id)).length} prepared. ` : ''}Tick prepared spells; Cast uses a slot (also ticked on Run encounter; a long rest refills them). Click a name to edit it and its macro.</p>
      <div className="row tight wrap">
        <button onClick={() => setPicker('spells')}>Add spells from the SRD…</button>
        <button onClick={() => void act('ability:add', { entityId: e.id, ability: { name: 'New spell', kind: 'SPELL', description: 'Level 1 · action · 60 feet. ' } })}>Add your own spell</button>
      </div>
      <p className="hint">Your own spell: start its description like “Level 2 · action · 60 feet.” for the table columns.</p>
      {picker && <AttackPicker sheet={sheet} tab={picker} onClose={() => setPicker(null)} />}
    </>
  )
}

export function AbilityCard({ a }: { a: AbilityView }) {
  const act = useBoard((s) => s.act)
  const update = (patch: IpcInput<'ability:update'>['patch']) => void act('ability:update', { id: a.id, patch })
  const p = `ability-${a.id}`
  return (
    <div className="subcard">
      <div className="grid-2">
        <CommitField id={`${p}-name`} label="Name" value={a.name} required onCommit={(name) => update({ name })} />
        <div className="field">
          <label htmlFor={`${p}-kind`}>Kind</label>
          <select id={`${p}-kind`} value={a.kind} onChange={(ev) => update({ kind: ev.target.value as AbilityKind })}>
            {AbilityKind.options.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
          </select>
        </div>
      </div>
      <CommitField id={`${p}-desc`} label="Description" value={a.description} multiline rows={3}
        onCommit={(description) => update({ description })} />
      <CommitField id={`${p}-macro`} label="Macro script" value={a.macroText} multiline rows={3} mono
        placeholder="Empty: Make macro builds one from the description (to-hit, damage, save)" onCommit={(macroText) => update({ macroText })} />
      <div className="row wrap">
        <div className="field checkbox">
          <input id={`${p}-token`} type="checkbox" checked={a.showTokenAction}
            onChange={(ev) => update({ showTokenAction: ev.target.checked })} />
          <label htmlFor={`${p}-token`}>Show as token action</label>
        </div>
        <div className="field checkbox">
          <input id={`${p}-bar`} type="checkbox" checked={a.showMacroBar}
            onChange={(ev) => update({ showMacroBar: ev.target.checked })} />
          <label htmlFor={`${p}-bar`}>Show in macro bar</label>
        </div>
        <span className="spacer" />
        <button title="Builds the Roll20 macro from the description (to-hit, damage, save)" onClick={() => update({ macroText: macroFor({ ...a, macroText: '' }) })}>Make macro</button>
        <button className="danger" onClick={() => void act('ability:setStatus', { id: a.id, status: 'defunct' })}>Remove</button>
      </div>
    </div>
  )
}

/** Extras: companions, familiars, mounts: creature cards tied to this character with a Companion string. */
export function Extras({ sheet }: { sheet: SheetView }) {
  const { act, openSheet, info } = useBoard()
  const e = sheet.entity
  const [pick, setPick] = useState('')
  const [name, setName] = useState('')
  const companions = sheet.connections.filter((c) => c.outgoing && c.relationship.type === 'COMPANION')
  const tie = (targetId: string) => act('relationship:create', { sourceId: e.id, targetId, type: 'COMPANION', isSecret: false })
  return (
    <>
      <h2 className="panel-heading spaced">Companions, familiars, mounts</h2>
      {companions.length === 0 && <p className="hint">Creatures that go with {e.name}. Each is its own card (stat block, AI or SRD), tied by a Companion string on the board.</p>}
      {companions.map((c) => <Companion key={c.relationship.id} id={c.other.id} name={c.other.name} onOpen={() => void openSheet(c.other.id)}
        onRemove={() => void act('relationship:setStatus', { id: c.relationship.id, status: 'defunct' })} />)}
      <div className="row tight wrap">
        <select aria-label="Choose a creature card" value={pick} onChange={(ev) => setPick(ev.target.value)}>
          <option value="">Choose a creature card…</option>
          {sheet.others.filter((o) => (o.type === 'MONSTER' || o.type === 'NPC') && !companions.some((c) => c.other.id === o.id)).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <button disabled={!pick} onClick={async () => { if (await tie(pick)) setPick('') }}>Add</button>
      </div>
      <div className="row tight wrap">
        <input aria-label="New companion name" placeholder="Name of a new one (e.g. Owl familiar)" value={name} maxLength={200} onChange={(ev) => setName(ev.target.value)} />
        <button disabled={!name.trim() || !info} onClick={async () => {
          const card = await act('entity:create', { boardId: info!.globalBoardId, type: 'MONSTER', name: name.trim() })
          if (card && await tie(card.id)) { setName(''); void openSheet(card.id) }
        }}>Make a companion card</button>
      </div>
    </>
  )
}

function Companion({ id, name, onOpen, onRemove }: { id: string; name: string; onOpen(): void; onRemove(): void }) {
  const view = useBoard((s) => s.view)
  const [line, setLine] = useState('')
  useEffect(() => {
    void call('sheet:view', { entityId: id }).then((s) => {
      const sb = readStatBlock(s.entity.attributes.statblock)
      const hp = s.entity.attributes.current_hp
      setLine([sb ? statLine(sb) : 'No stat block yet', typeof hp === 'number' ? `HP now ${hp}` : ''].filter(Boolean).join(' · '))
    }).catch(() => setLine(''))
  }, [id, view?.undo])
  return (
    <div className="cs-companion">
      <button className="link-button" onClick={onOpen}>{name}</button>
      <span className="cs-small muted">{line}</span>
      <span className="spacer" />
      <button className="link-button danger-ink" onClick={onRemove}>Untie</button>
    </div>
  )
}
