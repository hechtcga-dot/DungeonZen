import { PicturePanel } from './Pictures'
import { useState } from 'react'
import { useBoard, useUnits } from '../store'
import { call } from '../api'
import { Dialog } from './Dialog'
import { abilityModifier, ABILITY_KEYS, formatModifier, readStatBlock, type StatBlock } from '../../shared/statblock'
import { CR_STEPS, crStep, scaleToCr } from '../../shared/crscale'
import { xpForCr } from '../../shared/encounter'
import { convertText } from '../../shared/units'
import type { AbilityKind } from '../../shared/schemas'
import type { IpcOutputs } from '../../shared/ipc'
import type { SheetView } from '../../shared/types'

type Act = { name: string; kind: AbilityKind; description: string }
const GROUPS: Array<[AbilityKind[], string]> = [
  [['ACTION'], 'Actions'], [['BONUS_ACTION'], 'Bonus actions'], [['REACTION'], 'Reactions'],
  [['LEGENDARY_ACTION'], 'Legendary actions'], [['SPELL', 'OTHER'], 'Other']
]
const PB = (cr: string) => { const i = crStep(cr); return i == null ? null : Math.max(2, Math.floor((Math.max(1, crToNum(cr)) - 1) / 4) + 2) }
const crToNum = (cr: string) => (cr.includes('/') ? 0 : Number(cr) || 0)

/** A stat block laid out to run a fight: the numbers first, then what it does on its turn. */
export function StatBlockView({ name, sb, actions }: { name: string; sb: StatBlock; actions: Act[] }) {
  const units = useUnits()
  const t = (s: string) => convertText(s, units)
  const line = (label: string, value: string) => (value.trim() ? <p className="sb-line"><strong>{label}</strong> {t(value)}</p> : null)
  const pb = PB(sb.cr)
  return (
    <div className="statblock">
      <h2 className="sb-name">{name}</h2>
      <p className="sb-kind">{[sb.size, sb.creatureType].filter(Boolean).join(' ')}{sb.alignment ? `, ${sb.alignment}` : ''}</p>
      <div className="sb-core">
        <div><span>AC</span><strong>{sb.ac || '?'}</strong>{sb.acDetail && <em>{sb.acDetail}</em>}</div>
        <div><span>HP</span><strong>{sb.hp || '?'}</strong>{sb.hitDice && <em>{sb.hitDice}</em>}</div>
        <div><span>CR</span><strong>{sb.cr || '?'}</strong>{sb.cr && <em>{xpForCr(sb.cr)} XP{pb ? ` · PB +${pb}` : ''}</em>}</div>
      </div>
      {line('Speed', sb.speed)}
      <table className="sb-abilities"><tbody><tr>
        {ABILITY_KEYS.map((k) => <td key={k}><span>{k.toUpperCase()}</span><strong>{sb[k]}</strong><em>{formatModifier(abilityModifier(sb[k]))}</em></td>)}
      </tr></tbody></table>
      {line('Saving throws', sb.saves)}
      {line('Skills', sb.skills)}
      {line('Vulnerable', sb.vulnerabilities)}
      {line('Resists', sb.resistances)}
      {line('Immune', sb.immunities)}
      {line('Condition immunities', sb.conditionImmunities)}
      {line('Senses', sb.senses)}
      {line('Languages', sb.languages)}
      {sb.traits.length > 0 && <><h3 className="sb-head">Traits</h3>{sb.traits.map((x, i) => <p key={i} className="sb-entry"><strong>{x.name}.</strong> {t(x.desc)}</p>)}</>}
      {GROUPS.map(([kinds, label]) => {
        const list = actions.filter((a) => kinds.includes(a.kind))
        return list.length ? <div key={label}><h3 className="sb-head">{label}</h3>{list.map((a, i) => <p key={i} className="sb-entry"><strong>{a.name}.</strong> {t(a.description)}</p>)}</div> : null
      })}
    </div>
  )
}

/** Sheet › Fight summary: picture, the stat block to run, CR up or down, AI stat block. */
export function FightSummary({ sheet, onFullSheet }: { sheet: SheetView; onFullSheet(): void }) {
  const e = sheet.entity
  const sb = readStatBlock(e.attributes.statblock)
  const [crTarget, setCrTarget] = useState<string | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const aiStat = (e.attributes.ai_filled as Record<string, string> | undefined)?.statblock
  const step = sb ? crStep(sb.cr) : null

  return (
    <div className="fight-summary">
      <PicturePanel sheet={sheet} />
      <section className="panel fight-main">
        <div className="row tight wrap fight-tools">
          <button disabled={step == null || step === 0} title={step == null ? 'Set the challenge rating first' : undefined}
            onClick={() => setCrTarget(CR_STEPS[step! - 1])}>Lower CR</button>
          <button disabled={step == null || step === CR_STEPS.length - 1} title={step == null ? 'Set the challenge rating first' : undefined}
            onClick={() => setCrTarget(CR_STEPS[step! + 1])}>Raise CR</button>
          <button onClick={() => setAiOpen(true)}>AI stat block…</button>
          <span className="spacer" />
          <button className="link-button" onClick={onFullSheet}>Edit on the full sheet</button>
        </div>
        {aiStat && <span className="ai-badge">Stat block by AI · {aiStat}</span>}
        {sb ? <StatBlockView name={e.name} sb={sb} actions={sheet.abilities} />
          : <p className="hint">No stat block yet. Let an AI write one from a description, copy one from the SRD on the full sheet, or type it in there.</p>}
      </section>
      {crTarget && sb && <CrDialog sheet={sheet} sb={sb} target={crTarget} onClose={() => setCrTarget(null)} />}
      {aiOpen && <AiStatBlockDialog sheet={sheet} onClose={() => setAiOpen(false)} />}
    </div>
  )
}

function CrDialog({ sheet, sb, target, onClose }: { sheet: SheetView; sb: StatBlock; target: string; onClose(): void }) {
  const act = useBoard((s) => s.act)
  const [to, setTo] = useState(target)
  let preview: ReturnType<typeof scaleToCr> | null = null
  let error = ''
  try { preview = scaleToCr(sb, sheet.abilities, to) } catch (err) { error = (err as Error).message }
  return (
    <Dialog title={`Change the challenge rating of ${sheet.entity.name}`} open onClose={onClose}>
      <div className="dz-form">
        <div className="field">
          <label htmlFor="cr-to">New challenge rating</label>
          <select id="cr-to" value={to} onChange={(ev) => setTo(ev.target.value)}>{CR_STEPS.map((c) => <option key={c}>{c}</option>)}</select>
          <div className="hint">Worked out on this computer from the Dungeon Master's Guide table: hit points and damage scale, AC, attacks and DCs shift. Undo puts it back.</div>
        </div>
        {error ? <p className="field-error">{error}</p> : (
          <ul className="cr-changes">{preview!.changes.map((c) => <li key={c}>{c}</li>)}</ul>
        )}
        <div className="dz-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!preview || to === sb.cr} onClick={async () => { await act('entity:scaleCr', { entityId: sheet.entity.id, cr: to }); onClose() }}>Apply</button>
        </div>
      </div>
    </Dialog>
  )
}

const ROLES = ['', 'Brute: hits hard, soaks damage', 'Skirmisher: fast, hit and run', 'Artillery: attacks from range', 'Controller: spells and conditions', 'Leader: makes allies better', 'Minion: weak, comes in numbers', 'Solo boss: fights a whole party']

function AiStatBlockDialog({ sheet, onClose }: { sheet: SheetView; onClose(): void }) {
  const { act, setAiSettingsOpen } = useBoard()
  const e = sheet.entity
  const sb = readStatBlock(e.attributes.statblock)
  const [description, setDescription] = useState(typeof e.attributes.summary === 'string' ? e.attributes.summary : '')
  const [cr, setCr] = useState(sb?.cr ?? '')
  const [size, setSize] = useState(sb?.size ?? '')
  const [creatureType, setType] = useState(sb?.creatureType ?? '')
  const [role, setRole] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [answer, setAnswer] = useState<IpcOutputs['ai:statblock'] | null>(null)
  const write = async () => {
    setBusy(true); setError('')
    try { setAnswer(await call('ai:statblock', { entityId: e.id, description, cr, size, creatureType, role })) } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  return (
    <Dialog title={`AI stat block for ${e.name}`} open onClose={onClose} wide>
      <div className="dz-form">
        <div className="field">
          <label htmlFor="ai-sb-desc">Describe it</label>
          <textarea id="ai-sb-desc" rows={3} value={description} maxLength={4000} placeholder="A pirate captain who fights with two cutlasses and a parrot that pecks eyes…" onChange={(ev) => setDescription(ev.target.value)} />
        </div>
        <div className="ai-sb-opts">
          <div className="field"><label htmlFor="ai-sb-cr">Challenge rating</label>
            <select id="ai-sb-cr" value={cr} onChange={(ev) => setCr(ev.target.value)}><option value="">AI chooses</option>{CR_STEPS.map((c) => <option key={c}>{c}</option>)}</select></div>
          <div className="field"><label htmlFor="ai-sb-size">Size</label>
            <select id="ai-sb-size" value={size} onChange={(ev) => setSize(ev.target.value)}><option value="">AI chooses</option>{['Tiny', 'Small', 'Medium', 'Medium or Small', 'Large', 'Huge', 'Gargantuan'].map((s) => <option key={s}>{s}</option>)}</select></div>
          <div className="field"><label htmlFor="ai-sb-type">Creature type</label>
            <input id="ai-sb-type" value={creatureType} maxLength={80} placeholder="humanoid, undead…" onChange={(ev) => setType(ev.target.value)} /></div>
          <div className="field"><label htmlFor="ai-sb-role">Role in a fight</label>
            <select id="ai-sb-role" value={role} onChange={(ev) => setRole(ev.target.value)}>{ROLES.map((r) => <option key={r} value={r}>{r || 'AI chooses'}</option>)}</select></div>
        </div>
        {error && (
          <div className="field-error battle-error" role="alert"><span>{error}</span>
            <span className="row tight"><button disabled={busy} onClick={() => void write()}>Try again</button><button onClick={() => setAiSettingsOpen(true)}>AI services…</button></span></div>
        )}
        {answer && (
          <div className="ai-suggestion">
            <span className="ai-badge">AI suggestion · {answer.source}</span>
            <StatBlockView name={e.name} sb={answer.statblock} actions={answer.actions} />
          </div>
        )}
        <div className="dz-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button disabled={busy} onClick={() => void write()}>{busy ? 'Writing…' : answer ? 'Write another' : 'Write stat block'}</button>
          {answer && <button className="primary" onClick={async () => {
            await act('entity:applyStatBlock', { entityId: e.id, statblock: answer.statblock, actions: answer.actions, source: answer.source })
            onClose()
          }}>Use this stat block</button>}
        </div>
        {answer && <p className="hint">Using it replaces the stat block and moves the old actions to History. Undo puts them back.</p>}
      </div>
    </Dialog>
  )
}

