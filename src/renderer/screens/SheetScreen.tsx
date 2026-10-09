import { useState, type FormEvent } from 'react'
import { BackButton } from '../components/BackButton'
import { useBoard } from '../store'
import { TopBar } from '../components/TopBar'
import { DeskFrame } from '../components/DeskFrame'
import { Roll20Dialog } from '../components/Roll20Dialog'
import { Dialog } from '../components/Dialog'
import { call } from '../api'
import { DETAIL_FIELDS, fillableFields, INTERNAL_KEYS, type CardField } from '../../shared/cardFields'
import { ExportDialog } from '../components/ExportDialog'
import { CommitField, ScoreField } from '../components/fields'
import { ENTITY_COLOURS, ENTITY_LABELS } from '../entityStyle'
import {
  ABILITY_KEYS, HAS_STATBLOCK, abilityModifier, emptyStatBlock, formatModifier, readStatBlock, type StatBlock
} from '../../shared/statblock'
import { AbilityKind, ENTITY_TYPES, RELATIONSHIP_TYPES, type EntityType, type KnowledgeField } from '../../shared/schemas'
import type { IpcInput } from '../../shared/ipc'
import type { AbilityView, SheetView } from '../../shared/types'
import { useSidePanel } from '../components/Splitter'
import { FightSummary } from '../components/FightSummary'

type Tab = 'fight' | 'sheet' | 'bio' | 'connections'

const ABILITY_NAMES = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' } as const
const KIND_LABELS: Record<AbilityKind, string> = {
  ACTION: 'Action', BONUS_ACTION: 'Bonus action', REACTION: 'Reaction', LEGENDARY_ACTION: 'Legendary action',
  SPELL: 'Spell', OTHER: 'Other'
}
const KNOWLEDGE_LABELS: Record<KnowledgeField, string> = {
  name: 'Name', location: 'Location', motivation: 'Motivation', statblock: 'Stat block', bio: 'Bio'
}

export function SheetScreen() {
  const sheet = useBoard((s) => s.sheet)
  return (
    <DeskFrame>
      <TopBar />
      {sheet ? <Sheet key={sheet.entity.id} sheet={sheet} /> : <p className="muted page-pad">Loading…</p>}
    </DeskFrame>
  )
}

function Sheet({ sheet }: { sheet: SheetView }) {
  const side = useSidePanel('sheet-side', 'right', 340)
  const { act, showOnBoard, openSheet } = useBoard()
  const [tab, setTab] = useState<Tab>(['NPC', 'MONSTER'].includes(sheet.entity.type) ? 'fight' : 'sheet')
  const [colourDraft, setColourDraft] = useState('')
  const [exporting, setExporting] = useState<'roll20' | 'print' | null>(null)
  const [filling, setFilling] = useState(false)
  const e = sheet.entity
  const update = (patch: IpcInput<'entity:update'>['patch']) => void act('entity:update', { id: e.id, patch })
  const str = (key: string) => (typeof e.attributes[key] === 'string' ? (e.attributes[key] as string) : '')
  const aiFilled = (e.attributes.ai_filled && typeof e.attributes.ai_filled === 'object' ? e.attributes.ai_filled : {}) as Record<string, string>
  /** A field's label, marked when its text was written by AI (rule 10). */
  const lab = (key: string, label: string) => (aiFilled[key] && str(key) ? `${label} (AI)` : label)
  const source = e.attributes.source as { name?: string } | undefined
  const p = `sheet-${e.id}`

  return (
    <>
      <div className="page-head">
        <BackButton />
        <div className="page-title">
          <span className="badge" style={{ background: colourOf(e) }}>{ENTITY_LABELS[e.type].toUpperCase()}</span>
          <h1>{e.name}</h1>
          {e.status === 'defunct' && <span className="source-tag">In History</span>}
          {e.status === 'resolved' && <span className="muted">Resolved</span>}
          {source?.name && <span className="source-tag" title="Copied into this campaign; edit it freely">Copy from {source.name}</span>}
        </div>
        <button onClick={() => void showOnBoard(e.id)}>Show on board</button>
        {e.type !== 'PC' && <button onClick={() => setFilling(true)}>Fill blanks with AI…</button>}
        <button onClick={() => setExporting('print')}>{e.type === 'HANDOUT' ? 'Print letter…' : 'Print or save…'}</button>
        {['NPC', 'PC', 'MONSTER'].includes(e.type) && <button onClick={() => setExporting('roll20')}>Export to Roll20…</button>}
        <button onClick={async () => {
          const copy = await act('entity:duplicate', { id: e.id })
          if (copy) await openSheet(copy.id)
        }}>Duplicate</button>
        <button className="danger" onClick={async () => {
          await act('entity:setStatus', { id: e.id, status: e.status === 'defunct' ? 'active' : 'defunct' })
        }}>{e.status === 'defunct' ? 'Revive' : 'Move to History'}</button>
      </div>

      {filling && <FillDialog sheet={sheet} onClose={() => setFilling(false)} />}
      {exporting === 'roll20' && <Roll20Dialog entityIds={[e.id]} title={`Roll20: ${e.name}`} onClose={() => setExporting(null)} />}
      {exporting === 'print' && <ExportDialog kind={e.type === 'HANDOUT' ? 'letters' : 'sheets'} entityIds={[e.id]} title={e.name} onClose={() => setExporting(null)} />}
      <nav className="tabs" role="tablist" aria-label="Sheet sections">
        {([...(HAS_STATBLOCK.has(e.type) ? [['fight', 'Fight summary']] as const : []), ['sheet', HAS_STATBLOCK.has(e.type) ? 'Full sheet' : 'Sheet'], ['bio', e.type === 'HANDOUT' ? 'Handout text and notes' : e.type === 'QUEST' ? 'Reward and notes' : 'Bio and notes'], ['connections', `Connections (${sheet.connections.length})`]] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>

      <div className="sheet-body">
        {tab === 'fight' && <FightSummary sheet={sheet} onFullSheet={() => setTab('sheet')} />}
        {tab === 'sheet' && (
          <>
            <div className="sheet-main">
              {HAS_STATBLOCK.has(e.type)
                ? <StatBlockPanel sheet={sheet} />
                : (
                  <section className="panel">
                    <h2 className="panel-heading">Details</h2>
                    <CommitField id={`${p}-description`} label="Description" value={str('description')} multiline rows={8}
                      onCommit={(description) => update({ attributes: { description } })} />
                    {e.type === 'LOCATION' && (
                      <>
                        <CommitField id={`${p}-biome`} label="Biome" value={str('biome')} placeholder="Forest, city, swamp…"
                          onCommit={(biome) => update({ attributes: { biome } })} />
                        <CommitField id={`${p}-atmosphere`} label="Atmosphere" value={str('atmosphere')} multiline rows={3}
                          hint="How the townsfolk behave. Scene descriptions will draw on this."
                          onCommit={(atmosphere) => update({ attributes: { atmosphere } })} />
                      </>
                    )}
                  </section>
                )}
            </div>
            <div className="sheet-side" style={{ flex: `0 1 ${side.width}px` }}>
              {side.grip}
              <section className="panel">
                <h2 className="panel-heading">Campaign template</h2>
                <CommitField id={`${p}-name`} label="Name" value={e.name} required onCommit={(name) => update({ name })} />
                <div className="field">
                  <label htmlFor={`${p}-type`}>Type</label>
                  <select id={`${p}-type`} value={e.type} onChange={(ev) => update({ type: ev.target.value as EntityType })}>
                    {ENTITY_TYPES.map((t) => <option key={t} value={t}>{ENTITY_LABELS[t]}</option>)}
                  </select>
                </div>
                <CommitField id={`${p}-summary`} label={lab('summary', 'One-line summary')} value={str('summary')}
                  hint={HAS_STATBLOCK.has(e.type) ? 'Leave empty to show the stat block line on the card.' : undefined}
                  onCommit={(summary) => update({ attributes: { summary } })} />
                <CommitField id={`${p}-location`} label={lab('location', 'Default location')} value={str('location')}
                  onCommit={(location) => update({ attributes: { location } })} />
                <CommitField id={`${p}-motivation`} label={lab('motivation', 'Motivation')} value={str('motivation')} placeholder="What this character wants"
                  onCommit={(motivation) => update({ attributes: { motivation } })} />
                <CommitField id={`${p}-tags`} label="Tags" value={e.tags.join(', ')} hint="Separate tags with commas."
                  onCommit={(t) => update({ tags: [...new Set(t.split(',').map((x) => x.trim()).filter(Boolean))] })} />
                <div className="field">
                  <label htmlFor={`${p}-colour`}>Card colour</label>
                  <div className="row tight">
                    <input id={`${p}-colour`} type="color" className="colour-input" value={colourOf(e)}
                      onChange={(ev) => setColourDraft(ev.target.value)}
                      onBlur={() => { if (colourDraft && colourDraft !== colourOf(e)) update({ attributes: { colour: colourDraft } }) }} />
                    {typeof e.attributes.colour === 'string' && (
                      <button type="button" onClick={() => { setColourDraft(''); update({ attributes: { colour: null } }) }}>
                        Use the {ENTITY_LABELS[e.type]} colour
                      </button>
                    )}
                  </div>
                  <div className="hint">Shown on the board card and its badge.</div>
                </div>
              </section>
              <DetailsPanel sheet={sheet} lab={lab} />
              <CustomFields sheet={sheet} />
              <PartyKnows sheet={sheet} />
            </div>
          </>
        )}

        {tab === 'bio' && (
          <div className="sheet-main wide">
            {e.type === 'HANDOUT' && (
              <section className="panel">
                <CommitField id={`${p}-text`} label={lab('text', 'Handout text (what the players read)')} value={str('text')} multiline rows={10}
                  hint="Printed by Print letter… and on bulletin boards." onCommit={(text) => update({ attributes: { text } })} />
                <CommitField id={`${p}-from`} label="Signed by" value={str('from')} placeholder="A friend at the harbour"
                  hint="Shown at the bottom of the letter; its first letter goes on the wax seal." onCommit={(from) => update({ attributes: { from } })} />
              </section>
            )}
            {e.type === 'QUEST' && (
              <section className="panel">
                <CommitField id={`${p}-reward`} label={lab('reward', 'Reward')} value={str('reward')} placeholder="25 gp and a favour"
                  hint="Shown on bulletin boards." onCommit={(reward) => update({ attributes: { reward } })} />
              </section>
            )}
            <section className="panel">
              <CommitField id={`${p}-bio`} label={lab('bio', 'Bio')} value={str('bio')} multiline rows={10}
                hint="Background, appearance, how they talk. Saved when you click away; Ctrl+Enter also saves."
                onCommit={(bio) => update({ attributes: { bio } })} />
              <CommitField id={`${p}-notes`} label="DM notes" value={str('notes')} multiline rows={8}
                hint="Private to you. Never shown to players."
                onCommit={(notes) => update({ attributes: { notes } })} />
            </section>
            {Array.isArray(e.attributes.provenance) && e.attributes.provenance.length > 0 && (
              <section className="panel provenance">
                <h2 className="panel-heading">Where this came from</h2>
                <p className="hint">Read from your notes by an AI{typeof (e.attributes.imported as { ai?: string } | undefined)?.ai === 'string' ? ` (${(e.attributes.imported as { ai: string }).ai})` : ''}. Quotes marked “AI guess” were not said outright.</p>
                <ul>
                  {(e.attributes.provenance as Array<{ file?: string; locator?: string; quote?: string; basis?: string }>).map((x, i) => (
                    <li key={i}>
                      {x.basis === 'inferred' && <span className="basis-badge is-guess">AI guess</span>} “{x.quote}” <span className="muted">— {x.file}, {x.locator}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}

        {tab === 'connections' && <Connections sheet={sheet} />}
      </div>
    </>
  )
}

/** The card colour: the DM's choice, or the colour for its type. */
function colourOf(e: SheetView['entity']): string {
  return typeof e.attributes.colour === 'string' ? e.attributes.colour : ENTITY_COLOURS[e.type]
}

type CustomField = { label: string; value: string }

/** Any extra fields the DM wants on this card, label and value. */
/** The per-type text fields (and any other text the card carries, e.g. from a notes import). */
function DetailsPanel({ sheet, lab }: { sheet: SheetView; lab(key: string, label: string): string }) {
  const act = useBoard((s) => s.act)
  const e = sheet.entity
  const fields = DETAIL_FIELDS[e.type]
  const shown = new Set([...fields.map((f) => f.key), ...fillableFields(e.type).map((f) => f.key)])
  const others = Object.entries(e.attributes)
    .filter(([k, v]) => typeof v === 'string' && v.trim() && !shown.has(k) && !INTERNAL_KEYS.has(k))
    .map(([k]): CardField => ({ key: k, label: k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()), long: true }))
  if (!fields.length && !others.length) return null
  const val = (k: string) => (typeof e.attributes[k] === 'string' ? (e.attributes[k] as string) : '')
  return (
    <section className="panel">
      <h2 className="panel-heading">Details</h2>
      {[...fields, ...others].map((f) => (
        <CommitField key={f.key} id={`detail-${e.id}-${f.key}`} label={lab(f.key, f.label)} value={val(f.key)}
          multiline={!!f.long} rows={3} hint={f.hint}
          onCommit={(v) => void act('entity:update', { id: e.id, patch: { attributes: { [f.key]: v } } })} />
      ))}
    </section>
  )
}

/** Card sheet › Fill blanks with AI: pick empty fields, get suggestions, keep the ones you like. */
function FillDialog({ sheet, onClose }: { sheet: SheetView; onClose(): void }) {
  const { act, say, setAiSettingsOpen } = useBoard()
  const e = sheet.entity
  const empty = fillableFields(e.type).filter((f) => !(typeof e.attributes[f.key] === 'string' && (e.attributes[f.key] as string).trim()))
  const canBase = (e.type === 'NPC' || e.type === 'MONSTER') && !readStatBlock(e.attributes.statblock)
  const [pick, setPick] = useState<Set<string>>(new Set(empty.map((f) => f.key)))
  const [base, setBase] = useState(canBase)
  const [ask, setAsk] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [answer, setAnswer] = useState<{ fields: Record<string, string>; srd: { key: string; name: string; cr: string } | null; source: string } | null>(null)
  const [keep, setKeep] = useState<Set<string>>(new Set())
  const run = async () => {
    setBusy(true); setError(null)
    try {
      const r = await call('ai:fill', { entityId: e.id, keys: [...pick], ask, statblock: base })
      setAnswer(r)
      setKeep(new Set([...Object.keys(r.fields), ...(r.srd ? ['statblock'] : [])]))
    } catch (err) { setError((err as Error).message) }
    setBusy(false)
  }
  const use = async () => {
    if (!answer) return
    const fields = Object.fromEntries(Object.entries(answer.fields).filter(([k]) => keep.has(k)))
    const done = await act('card:applyFill', { entityId: e.id, fields, source: answer.source, srdKey: keep.has('statblock') && answer.srd ? answer.srd.key : null })
    if (done) { say(`Filled ${done.length} field${done.length === 1 ? '' : 's'} on ${e.name}. Ctrl+Z undoes it.`); onClose() }
  }
  const label = (k: string) => fillableFields(e.type).find((f) => f.key === k)?.label ?? k
  return (
    <Dialog title={`Fill blanks: ${e.name}`} open onClose={onClose} wide>
      {!answer ? (
        <div className="dz-form">
          {empty.length === 0 && !canBase ? <p>Every field on this card is filled. Empty a field to have the AI suggest it.</p> : (
            <>
              <p className="hint">The AI sees the card, its strings, storylines and your notes, and suggests text for the empty fields you tick. Nothing changes until you choose what to keep.</p>
              <fieldset className="field fill-pick">
                <legend>Empty fields</legend>
                {empty.map((f) => (
                  <label key={f.key} className="field checkbox">
                    <input type="checkbox" checked={pick.has(f.key)} onChange={(ev) => setPick((p) => { const n = new Set(p); if (ev.target.checked) n.add(f.key); else n.delete(f.key); return n })} /> {f.label}
                  </label>
                ))}
                {canBase && <label className="field checkbox"><input type="checkbox" checked={base} onChange={(ev) => setBase(ev.target.checked)} /> A stat block (an SRD creature as the base)</label>}
              </fieldset>
              <div className="field"><label htmlFor="fill-ask">Anything the AI should know (optional)</label>
                <input id="fill-ask" value={ask} maxLength={2000} placeholder="Make her secretly kind; keep it grim; she is a halfling…" onChange={(ev) => setAsk(ev.target.value)} /></div>
            </>
          )}
          {error && <p className="field-error" role="alert">{error} {/service/i.test(error) && <button className="link-button" onClick={() => setAiSettingsOpen(true)}>Choose one…</button>}</p>}
          <div className="dz-actions">
            <button onClick={onClose}>Cancel</button>
            <button className="primary" disabled={busy || (pick.size === 0 && !base)} onClick={() => void run()}>{busy ? 'Thinking…' : 'Suggest'}</button>
          </div>
        </div>
      ) : (
        <div className="dz-form">
          <span className="ai-badge">AI suggestion · {answer.source}</span>
          {Object.keys(answer.fields).length === 0 && !answer.srd && <p>The AI had no suggestions. Try again, or add a hint.</p>}
          {Object.entries(answer.fields).map(([k, v]) => (
            <div key={k} className={`fill-row${keep.has(k) ? '' : ' is-off'}`}>
              <label className="field checkbox"><input type="checkbox" checked={keep.has(k)} onChange={(ev) => setKeep((p) => { const n = new Set(p); if (ev.target.checked) n.add(k); else n.delete(k); return n })} /> <strong>{label(k)}</strong></label>
              <textarea aria-label={label(k)} rows={v.length > 90 ? 3 : 1} value={v} onChange={(ev) => setAnswer({ ...answer, fields: { ...answer.fields, [k]: ev.target.value } })} />
            </div>
          ))}
          {answer.srd && (
            <div className={`fill-row${keep.has('statblock') ? '' : ' is-off'}`}>
              <label className="field checkbox"><input type="checkbox" checked={keep.has('statblock')} onChange={(ev) => setKeep((p) => { const n = new Set(p); if (ev.target.checked) n.add('statblock'); else n.delete('statblock'); return n })} />
                <strong>Stat block:</strong> the SRD {answer.srd.name} (CR {answer.srd.cr}), with its actions. Edit it freely afterwards.</label>
            </div>
          )}
          <div className="dz-actions">
            <button onClick={() => setAnswer(null)}>Back</button>
            <button disabled={busy} onClick={() => void run()}>{busy ? 'Thinking…' : 'Try again'}</button>
            <button className="primary" disabled={keep.size === 0} onClick={() => void use()}>Use selected</button>
          </div>
        </div>
      )}
    </Dialog>
  )
}

function CustomFields({ sheet }: { sheet: SheetView }) {
  const act = useBoard((s) => s.act)
  const e = sheet.entity
  const fields: CustomField[] = Array.isArray(e.attributes.custom)
    ? (e.attributes.custom as unknown[]).filter((f): f is CustomField =>
      !!f && typeof (f as CustomField).label === 'string' && typeof (f as CustomField).value === 'string')
    : []
  const save = (next: CustomField[]) => void act('entity:update', { id: e.id, patch: { attributes: { custom: next } } })
  return (
    <section className="panel">
      <h2 className="panel-heading">Your own fields</h2>
      {fields.length === 0 && <p className="hint">Add anything this card needs: a secret, a price, a favourite drink, a debt owed.</p>}
      {fields.map((f, i) => (
        <div key={i} className="custom-field">
          <CommitField id={`custom-${e.id}-${i}-label`} label="Field" value={f.label} required
            onCommit={(label) => save(fields.map((x, j) => (j === i ? { ...x, label } : x)))} />
          <CommitField id={`custom-${e.id}-${i}-value`} label="Value" value={f.value}
            onCommit={(value) => save(fields.map((x, j) => (j === i ? { ...x, value } : x)))} />
          <button className="danger align-end" aria-label={`Remove field ${f.label}`}
            onClick={() => save(fields.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <button className="align-start" onClick={() => save([...fields, { label: 'New field', value: '' }])}>Add a field</button>
    </section>
  )
}

function StatBlockPanel({ sheet }: { sheet: SheetView }) {
  const act = useBoard((s) => s.act)
  const e = sheet.entity
  const sb: StatBlock = readStatBlock(e.attributes.statblock) ?? emptyStatBlock()
  const save = (patch: Partial<StatBlock>) =>
    void act('entity:update', { id: e.id, patch: { attributes: { statblock: { ...sb, ...patch } } } })
  const p = `sb-${e.id}`
  const text = (key: keyof StatBlock, label: string, opts: { span?: boolean; placeholder?: string } = {}) => (
    <CommitField id={`${p}-${key}`} label={label} value={String(sb[key] ?? '')} placeholder={opts.placeholder}
      className={opts.span ? 'span-2' : undefined} onCommit={(v) => save({ [key]: v } as Partial<StatBlock>)} />
  )

  return (
    <section className="panel">
      <h2 className="panel-heading">Stat block (5e, editable)</h2>
      <div className="grid-2">
        {text('size', 'Size', { placeholder: 'Medium' })}
        {text('creatureType', 'Creature type', { placeholder: 'fiend' })}
        {text('alignment', 'Alignment', { span: true })}
        {text('ac', 'Armor class', { placeholder: '15' })}
        {text('acDetail', 'Armor', { placeholder: 'natural armor' })}
        {text('hp', 'Hit points', { placeholder: '82' })}
        {text('hitDice', 'Hit dice', { placeholder: '11d8 + 33' })}
        {text('speed', 'Speed', { placeholder: '30 ft., fly 60 ft.' })}
        {text('cr', 'Challenge', { placeholder: '1' })}
      </div>
      <div className="scores">
        {ABILITY_KEYS.map((k) => (
          <ScoreField key={k} id={`${p}-${k}`} label={ABILITY_NAMES[k]} value={sb[k]} min={1} max={30}
            note={formatModifier(abilityModifier(sb[k]))} onCommit={(v) => save({ [k]: v } as Partial<StatBlock>)} />
        ))}
      </div>
      <div className="grid-2">
        {text('saves', 'Saving throws', { span: true })}
        {text('skills', 'Skills', { span: true })}
        {text('vulnerabilities', 'Damage vulnerabilities')}
        {text('resistances', 'Damage resistances')}
        {text('immunities', 'Damage immunities')}
        {text('conditionImmunities', 'Condition immunities')}
        {text('senses', 'Senses', { span: true })}
        {text('languages', 'Languages', { span: true })}
      </div>
      <Traits sb={sb} save={save} entityId={e.id} />
      <Abilities sheet={sheet} />
    </section>
  )
}

function Traits({ sb, save, entityId }: { sb: StatBlock; save(patch: Partial<StatBlock>): void; entityId: string }) {
  const setTrait = (i: number, patch: Partial<StatBlock['traits'][number]>) =>
    save({ traits: sb.traits.map((t, j) => (j === i ? { ...t, ...patch } : t)) })
  return (
    <>
      <h2 className="panel-heading spaced">Traits</h2>
      {sb.traits.length === 0 && <p className="hint">Special traits such as Amphibious or Magic Resistance.</p>}
      {sb.traits.map((t, i) => (
        <div key={i} className="subcard">
          <CommitField id={`trait-${entityId}-${i}-name`} label="Trait" value={t.name} required onCommit={(name) => setTrait(i, { name })} />
          <CommitField id={`trait-${entityId}-${i}-desc`} label="Description" value={t.desc} multiline rows={3}
            onCommit={(desc) => setTrait(i, { desc })} />
          <div className="actions">
            <button className="danger" onClick={() => save({ traits: sb.traits.filter((_, j) => j !== i) })}>Remove trait</button>
          </div>
        </div>
      ))}
      <button className="align-start" onClick={() => save({ traits: [...sb.traits, { name: 'New trait', desc: '' }] })}>Add trait</button>
    </>
  )
}

function Abilities({ sheet }: { sheet: SheetView }) {
  const act = useBoard((s) => s.act)
  const e = sheet.entity
  return (
    <>
      <h2 className="panel-heading spaced">Attacks, spells and actions (for Roll20 macros)</h2>
      {sheet.abilities.length === 0 && <p className="hint">Add attacks and spells here. Each one keeps its Roll20 macro text.</p>}
      {sheet.abilities.map((a) => <AbilityCard key={a.id} a={a} />)}
      <button className="align-start" onClick={() => void act('ability:add', { entityId: e.id, ability: { name: 'New ability' } })}>
        Add ability
      </button>
    </>
  )
}

function AbilityCard({ a }: { a: AbilityView }) {
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
        placeholder="&{template:default} {{name=Bite}} {{attack=[[1d20+4]]}}" onCommit={(macroText) => update({ macroText })} />
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
        <button className="danger" onClick={() => void act('ability:setStatus', { id: a.id, status: 'defunct' })}>Remove</button>
      </div>
    </div>
  )
}

function PartyKnows({ sheet }: { sheet: SheetView }) {
  const act = useBoard((s) => s.act)
  const e = sheet.entity
  return (
    <section className="panel">
      <h2 className="panel-heading">What the party knows</h2>
      <ul className="checklist">
        {(Object.keys(KNOWLEDGE_LABELS) as KnowledgeField[])
          .filter((f) => f !== 'statblock' || HAS_STATBLOCK.has(e.type))
          .map((f) => (
            <li key={f}>
              <label htmlFor={`knows-${e.id}-${f}`}>{KNOWLEDGE_LABELS[f]}</label>
              <input id={`knows-${e.id}-${f}`} type="checkbox" checked={sheet.partyKnows[f]}
                onChange={(ev) => void act('knowledge:set', { entityId: e.id, field: f, known: ev.target.checked })} />
            </li>
          ))}
        {sheet.connections.map((c) => (
          <li key={c.relationship.id}>
            <label htmlFor={`knows-rel-${c.relationship.id}`}>Link to {c.other.name}</label>
            <input id={`knows-rel-${c.relationship.id}`} type="checkbox" checked={c.partyKnows}
              onChange={(ev) => void act('knowledge:setString', { relationshipId: c.relationship.id, known: ev.target.checked })} />
          </li>
        ))}
      </ul>
      <p className="hint">Knowledge is shared by the whole party and dated from the current campaign time.
        Ticked fields will appear in Player Preview.</p>
    </section>
  )
}

function Connections({ sheet }: { sheet: SheetView }) {
  const { act, openSheet } = useBoard()
  const e = sheet.entity
  const [otherId, setOtherId] = useState('')
  const [type, setType] = useState('KNOWS')
  const [secret, setSecret] = useState(false)

  const add = async (ev: FormEvent) => {
    ev.preventDefault()
    if (!otherId || !type.trim()) return
    const rel = await act('relationship:create', { sourceId: e.id, targetId: otherId, type, isSecret: secret })
    if (rel) { setOtherId(''); setSecret(false) }
  }

  return (
    <div className="sheet-main wide">
      <section className="panel">
        <h2 className="panel-heading">Strings to other cards</h2>
        {sheet.connections.length === 0 && <p className="hint">No strings yet. Add one below or drag between pins on the board.</p>}
        <ul className="connections">
          {sheet.connections.map((c) => (
            <li key={c.relationship.id}>
              <span className="badge" style={{ background: ENTITY_COLOURS[c.other.type] }}>{ENTITY_LABELS[c.other.type].toUpperCase()}</span>
              <span className="conn-text">
                {c.outgoing && <span>{e.name}</span>}
                {!c.outgoing && <button className="link" onClick={() => void openSheet(c.other.id)}>{c.other.name}</button>}
                <span className="mono conn-type">{c.relationship.type.replace(/_/g, ' ')} →</span>
                {c.outgoing && <button className="link" onClick={() => void openSheet(c.other.id)}>{c.other.name}</button>}
                {!c.outgoing && <span>{e.name}</span>}
              </span>
              {c.relationship.isSecret && <span className="tag-secret">Secret</span>}
              {c.partyKnows && <span className="tag-known">Party knows</span>}
              <span className="spacer" />
              <button className="danger" onClick={() => void act('relationship:setStatus', { id: c.relationship.id, status: 'defunct' })}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="panel">
        <h2 className="panel-heading">Add a string</h2>
        <form className="add-connection" onSubmit={add}>
          <div className="field">
            <label htmlFor="conn-other">Link {e.name} to</label>
            <select id="conn-other" value={otherId} onChange={(ev) => setOtherId(ev.target.value)}>
              <option value="">Choose a card…</option>
              {sheet.others.map((o) => <option key={o.id} value={o.id}>{o.name} ({ENTITY_LABELS[o.type]})</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="conn-type">Link type</label>
            <input id="conn-type" list="conn-types" value={type} onChange={(ev) => setType(ev.target.value)} />
            <datalist id="conn-types">
              {RELATIONSHIP_TYPES.map((t) => <option key={t} value={t.replace(/_/g, ' ')} />)}
            </datalist>
          </div>
          <div className="field checkbox">
            <input id="conn-secret" type="checkbox" checked={secret} onChange={(ev) => setSecret(ev.target.checked)} />
            <label htmlFor="conn-secret">Secret link</label>
          </div>
          <button type="submit" className="primary" disabled={!otherId || !type.trim()}>Add string</button>
        </form>
      </section>
    </div>
  )
}
