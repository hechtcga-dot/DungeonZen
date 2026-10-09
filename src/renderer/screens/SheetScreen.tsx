import { useState, type FormEvent } from 'react'
import { BackButton } from '../components/BackButton'
import { DEFAULT_LINK, LinkTypeFields, linkInput, linkReady, type LinkChoice } from '../components/LinkTypeFields'
import { useBoard } from '../store'
import { TopBar } from '../components/TopBar'
import { DeskFrame } from '../components/DeskFrame'
import { Roll20Dialog } from '../components/Roll20Dialog'
import { Dialog } from '../components/Dialog'
import { call } from '../api'
import { FACTION_LINK, fillableFields, INTERNAL_KEYS, SECRET, tabFields, tabTitle, type CardField } from '../../shared/cardFields'
import { ExportDialog } from '../components/ExportDialog'
import { CommitField, ScoreField } from '../components/fields'
import { ENTITY_COLOURS, ENTITY_LABELS } from '../entityStyle'
import {
  ABILITY_KEYS, HAS_STATBLOCK, SKILLS, abilityModifier, crToNumber, emptyStatBlock, formatModifier, leadingNumber, passiveScore, proficiencyBonus,
  readStatBlock, saveBonus, skillBonus, type StatBlock
} from '../../shared/statblock'
import { AbilityKind, ENTITY_TYPES, type EntityType, type KnowledgeField } from '../../shared/schemas'
import type { IpcInput } from '../../shared/ipc'
import type { AbilityView, SheetView } from '../../shared/types'
import { useSidePanel } from '../components/Splitter'
import { FightSummary } from '../components/FightSummary'
import { PicturePanel } from '../components/Pictures'

type Tab = 'fight' | 'sheet' | 'traits' | 'secrets' | 'notes' | 'connections'

const ABILITY_NAMES = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' } as const
const ABILITY_FULL = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' } as const
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
  const creature = HAS_STATBLOCK.has(sheet.entity.type)
  const [tab, setTab] = useState<Tab>(['NPC', 'MONSTER'].includes(sheet.entity.type) ? 'fight' : creature ? 'sheet' : 'traits')
  const [colourDraft, setColourDraft] = useState('')
  const [exporting, setExporting] = useState<'roll20' | 'print' | null>(null)
  /** Fill blanks with AI: null = closed; otherwise the fields to offer (empty list = every empty field). */
  const [filling, setFilling] = useState<string[] | null>(null)
  const e = sheet.entity
  const update = (patch: IpcInput<'entity:update'>['patch']) => void act('entity:update', { id: e.id, patch })
  const str = (key: string) => (typeof e.attributes[key] === 'string' ? (e.attributes[key] as string) : '')
  const aiFilled = (e.attributes.ai_filled && typeof e.attributes.ai_filled === 'object' ? e.attributes.ai_filled : {}) as Record<string, string>
  /** A field's label, marked when its text was written by AI (rule 10). */
  const lab = (key: string, label: string) => (aiFilled[key] && str(key) ? `${label} (AI)` : label)
  const source = e.attributes.source as { name?: string } | undefined
  const p = `sheet-${e.id}`

  const templateSide = (
            <div className="sheet-side" style={{ flex: `0 1 ${side.width}px` }}>
              {side.grip}
              <PicturePanel sheet={sheet} />
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
                {e.type === 'LOCATION' && <CommitField id={`${p}-biome`} label="Biome" value={str('biome')} placeholder="Forest, city, swamp…"
                  onCommit={(biome) => update({ attributes: { biome } })} />}
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
  )

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
        <button onClick={() => setFilling([])}>Fill blanks with AI…</button>
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

      {filling && <FillDialog sheet={sheet} only={filling} onClose={() => setFilling(null)} />}
      {exporting === 'roll20' && <Roll20Dialog entityIds={[e.id]} title={`Roll20: ${e.name}`} onClose={() => setExporting(null)} />}
      {exporting === 'print' && <ExportDialog kind={e.type === 'HANDOUT' ? 'letters' : 'sheets'} entityIds={[e.id]} title={e.name} onClose={() => setExporting(null)} />}
      <nav className="tabs" role="tablist" aria-label="Sheet sections">
        {([
          ...(creature ? [['fight', 'Fight summary'], ['sheet', 'Full sheet']] as const : []),
          ['traits', tabTitle(e.type)], ['secrets', 'Secrets'],
          ['notes', e.type === 'HANDOUT' ? 'Handout text and notes' : e.type === 'QUEST' ? 'Reward and notes' : 'Notes'],
          ['connections', `Connections (${sheet.connections.length})`]
        ] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>

      <div className="sheet-body">
        {tab === 'fight' && <FightSummary sheet={sheet} onFullSheet={() => setTab('sheet')} />}
        {tab === 'sheet' && (
          <>
            <div className="sheet-main"><StatBlockPanel sheet={sheet} /></div>
            {templateSide}
          </>
        )}
        {tab === 'traits' && (
          <>
            <div className={creature ? 'sheet-main wide' : 'sheet-main'}>
              <TraitsPanel sheet={sheet} lab={lab} onFill={(keys) => setFilling(keys)} />
            </div>
            {!creature && templateSide}
          </>
        )}
        {tab === 'secrets' && <SecretsPanel sheet={sheet} lab={lab} onFill={() => setFilling(['secret'])} />}
        {tab === 'notes' && (
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
              <CommitField id={`${p}-notes`} label="DM notes" value={str('notes')} multiline rows={10}
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
/** Any other text the card carries (e.g. from a notes import) that has no place of its own. */
function DetailsPanel({ sheet, lab }: { sheet: SheetView; lab(key: string, label: string): string }) {
  const act = useBoard((s) => s.act)
  const e = sheet.entity
  const shown = new Set(fillableFields(e.type).map((f) => f.key))
  const others = Object.entries(e.attributes)
    .filter(([k, v]) => typeof v === 'string' && v.trim() && !shown.has(k) && !INTERNAL_KEYS.has(k))
    .map(([k]): CardField => ({ key: k, label: k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()), long: true }))
  if (!others.length) return null
  const val = (k: string) => (typeof e.attributes[k] === 'string' ? (e.attributes[k] as string) : '')
  return (
    <section className="panel">
      <h2 className="panel-heading">Other details</h2>
      {others.map((f) => (
        <CommitField key={f.key} id={`detail-${e.id}-${f.key}`} label={lab(f.key, f.label)} value={val(f.key)}
          multiline rows={3} onCommit={(v) => void act('entity:update', { id: e.id, patch: { attributes: { [f.key]: v } } })} />
      ))}
    </section>
  )
}

const filled = (e: SheetView['entity'], key: string) => typeof e.attributes[key] === 'string' && (e.attributes[key] as string).trim() !== ''

/** Sheet › "Features, traits, background" or "Descriptions & history": every per-type field, with AI fill. */
function TraitsPanel({ sheet, lab, onFill }: { sheet: SheetView; lab(key: string, label: string): string; onFill(keys: string[]): void }) {
  const act = useBoard((s) => s.act)
  const e = sheet.entity
  const fields = tabFields(e.type)
  const empty = fields.filter((f) => !filled(e, f.key))
  const val = (k: string) => (typeof e.attributes[k] === 'string' ? (e.attributes[k] as string) : '')
  return (
    <section className="panel traits-panel">
      <div className="panel-head-row">
        <h2 className="panel-heading">{tabTitle(e.type)}</h2>
        <button disabled={empty.length === 0} title={empty.length ? `Suggest the ${empty.length} empty field${empty.length === 1 ? '' : 's'}` : 'Every field is filled'}
          onClick={() => onFill(empty.map((f) => f.key))}>Fill blanks with AI…</button>
      </div>
      <p className="hint">Empty spaces are yours to fill, or let the AI suggest them. Saved when you click away.</p>
      {FACTION_LINK[e.type] && <FactionsField sheet={sheet} />}
      <div className="traits-grid">
        {fields.map((f) => (
          <CommitField key={f.key} id={`trait-${e.id}-${f.key}`} label={lab(f.key, f.label)} value={val(f.key)}
            multiline={!!f.long} rows={f.long ? 4 : 1} hint={f.hint} className={f.long ? 'span-2' : undefined}
            onCommit={(v) => void act('entity:update', { id: e.id, patch: { attributes: { [f.key]: v } } })} />
        ))}
      </div>
    </section>
  )
}

/** Factions this card belongs to (people) or that hold it (places): strings to faction cards. */
function FactionsField({ sheet }: { sheet: SheetView }) {
  const { act, openSheet, info } = useBoard()
  const e = sheet.entity
  const kind = FACTION_LINK[e.type]!
  const [newName, setNewName] = useState<string | null>(null)
  const linked = sheet.connections.filter((c) => c.other.type === 'FACTION')
  const choices = sheet.others.filter((o) => o.type === 'FACTION' && !linked.some((c) => c.other.id === o.id))
  const link = (factionId: string) => act('relationship:create', { sourceId: e.id, targetId: factionId, type: kind, isSecret: false })
  const createAndLink = async () => {
    const name = newName?.trim()
    if (!name || !info) return
    const f = await act('entity:create', { boardId: info.globalBoardId, type: 'FACTION', name })
    if (f) await link(f.id)
    setNewName(null)
  }
  return (
    <div className="field factions-field">
      <span className="field-label">Factions</span>
      <div className="chips">
        {linked.length === 0 && <span className="hint">None yet.</span>}
        {linked.map((c) => (
          <span key={c.relationship.id} className="chip">
            <button className="link-button" onClick={() => void openSheet(c.other.id)}>{c.other.name}</button>
            <span className="muted"> · {c.relationship.type.replace(/_/g, ' ').toLowerCase()}{c.relationship.isSecret ? ', secret' : ''}</span>
            <button className="chip-x" aria-label={`Remove ${c.other.name} (the string goes to History)`}
              onClick={() => void act('relationship:setStatus', { id: c.relationship.id, status: 'defunct' })}>×</button>
          </span>
        ))}
        {newName === null ? (
          <select aria-label="Add a faction" value="" onChange={(ev) => {
            if (ev.target.value === '__new__') setNewName('')
            else if (ev.target.value) void link(ev.target.value)
          }}>
            <option value="">+ Add a faction…</option>
            {choices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            <option value="__new__">New faction…</option>
          </select>
        ) : (
          <form className="row tight" onSubmit={(ev) => { ev.preventDefault(); void createAndLink() }}>
            <input autoFocus value={newName} maxLength={200} placeholder="Faction name" aria-label="New faction name" onChange={(ev) => setNewName(ev.target.value)} />
            <button type="submit" className="primary" disabled={!newName.trim()}>Add</button>
            <button type="button" onClick={() => setNewName(null)}>Cancel</button>
          </form>
        )}
      </div>
      <div className="hint">Each faction is a string on the board ({kind.replace(/_/g, ' ').toLowerCase()}).</div>
    </div>
  )
}

/** Sheet › Secrets: the card's secrets and every secret string that touches it. */
function SecretsPanel({ sheet, lab, onFill }: { sheet: SheetView; lab(key: string, label: string): string; onFill(): void }) {
  const { act, openSheet } = useBoard()
  const e = sheet.entity
  const secrets = sheet.connections.filter((c) => c.relationship.isSecret)
  return (
    <div className="sheet-main wide">
      <section className="panel">
        <div className="panel-head-row">
          <h2 className="panel-heading">Secrets</h2>
          <button disabled={filled(e, 'secret')} onClick={onFill}>Fill blank with AI…</button>
        </div>
        <CommitField id={`secret-${e.id}`} label={lab('secret', 'What only you know')} value={typeof e.attributes.secret === 'string' ? e.attributes.secret : ''}
          multiline rows={8} hint={SECRET.hint} onCommit={(secret) => void act('entity:update', { id: e.id, patch: { attributes: { secret } } })} />
      </section>
      <section className="panel">
        <h2 className="panel-heading">Secret strings</h2>
        {secrets.length === 0 ? <p className="hint">No secret strings touch this card. Tick Secret link when you tie one.</p> : (
          <ul className="connections">
            {secrets.map((c) => (
              <li key={c.relationship.id}>
                <span className="conn-text">
                  {c.outgoing ? e.name : <button className="link" onClick={() => void openSheet(c.other.id)}>{c.other.name}</button>}
                  <span className="mono conn-type">{c.relationship.type.replace(/_/g, ' ')} →</span>
                  {c.outgoing ? <button className="link" onClick={() => void openSheet(c.other.id)}>{c.other.name}</button> : e.name}
                </span>
                {c.partyKnows && <span className="tag-known">Party knows</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

/** Card sheet › Fill blanks with AI: pick empty fields, get suggestions, keep the ones you like. */
function FillDialog({ sheet, only, onClose }: { sheet: SheetView; only: string[]; onClose(): void }) {
  const { act, say, setAiSettingsOpen } = useBoard()
  const e = sheet.entity
  // Opened from a tab: that tab's empty fields; from the header: every empty field.
  const empty = fillableFields(e.type).filter((f) => !filled(e, f.key) && (only.length === 0 || only.includes(f.key)))
  const canBase = only.length === 0 && (e.type === 'NPC' || e.type === 'MONSTER') && !readStatBlock(e.attributes.statblock)
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

/** Full sheet: a character-sheet layout (ability boxes, the numbers a DM checks, saves, senses, skills, tabs). */
function StatBlockPanel({ sheet }: { sheet: SheetView }) {
  const act = useBoard((s) => s.act)
  const e = sheet.entity
  const [right, setRight] = useState<'actions' | 'traits' | 'defenses' | 'details'>('actions')
  const sb: StatBlock = readStatBlock(e.attributes.statblock) ?? emptyStatBlock()
  const save = (patch: Partial<StatBlock>) =>
    void act('entity:update', { id: e.id, patch: { attributes: { statblock: { ...sb, ...patch } } } })
  const setAttr = (attributes: Record<string, unknown>) => void act('entity:update', { id: e.id, patch: { attributes } })
  const p = `sb-${e.id}`
  const text = (key: keyof StatBlock, label: string, opts: { span?: boolean; placeholder?: string; hint?: string } = {}) => (
    <CommitField id={`${p}-${key}`} label={label} value={String(sb[key] ?? '')} placeholder={opts.placeholder} hint={opts.hint}
      className={opts.span ? 'span-2' : undefined} onCommit={(v) => save({ [key]: v } as Partial<StatBlock>)} />
  )
  const level = typeof e.attributes.level === 'string' ? e.attributes.level : ''
  const rank = e.type === 'PC' ? Number.parseInt(level, 10) : crToNumber(sb.cr)
  const prof = rank && Number.isFinite(rank) ? proficiencyBonus(rank) : null
  const maxHp = leadingNumber(sb.hp)
  const curHp = typeof e.attributes.current_hp === 'number' ? e.attributes.current_hp : maxHp
  const tempHp = typeof e.attributes.temp_hp === 'number' ? e.attributes.temp_hp : 0
  const walk = /\d+\s*(ft|m)\.?/i.exec(sb.speed)?.[0] ?? sb.speed
  const num = (v: string) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? Math.min(n, 100000) : 0 }
  const defenses = [['Resistances', sb.resistances], ['Immunities', sb.immunities], ['Vulnerabilities', sb.vulnerabilities], ['Condition immunities', sb.conditionImmunities]].filter(([, v]) => v)

  return (
    <section className="panel char-sheet">
      <div className="cs-top">
        {ABILITY_KEYS.map((k) => (
          <div key={k} className="cs-ability">
            <span className="cs-label">{ABILITY_FULL[k]}</span>
            <span className="cs-big">{formatModifier(abilityModifier(sb[k]))}</span>
            <ScoreField id={`${p}-${k}`} label={`${ABILITY_FULL[k]} score`} value={sb[k]} min={1} max={30} onCommit={(v) => save({ [k]: v } as Partial<StatBlock>)} />
          </div>
        ))}
        <div className="cs-box" title={e.type === 'PC' ? 'From the level' : 'From the challenge rating'}>
          <span className="cs-label">Proficiency</span>
          <span className="cs-big">{prof === null ? '—' : formatModifier(prof)}</span>
          <span className="cs-label">bonus</span>
        </div>
        <div className="cs-box">
          <span className="cs-label">Walking</span>
          <span className="cs-big cs-mid">{walk || '—'}</span>
          <span className="cs-label">speed</span>
        </div>
        <div className="cs-box">
          <span className="cs-label">Initiative</span>
          <span className="cs-big">{formatModifier(abilityModifier(sb.dex))}</span>
        </div>
        <div className="cs-box cs-shield">
          <span className="cs-label">Armor</span>
          <CommitField id={`${p}-ac-big`} label="Armor class" value={sb.ac} className="cs-big-input" onCommit={(ac) => save({ ac })} />
          <span className="cs-label">class</span>
        </div>
        <div className="cs-box cs-hp">
          <div className="cs-hp-row">
            <CommitField id={`${p}-hp-cur`} label="Current" value={curHp === null ? '' : String(curHp)} className="cs-big-input"
              onCommit={(v) => setAttr({ current_hp: num(v) })} />
            <span className="cs-slash" aria-hidden="true">/</span>
            <CommitField id={`${p}-hp-max`} label="Max" value={maxHp === null ? sb.hp : String(maxHp)} className="cs-big-input"
              onCommit={(v) => save({ hp: sb.hitDice || !/\(/.test(sb.hp) ? v : sb.hp.replace(/^\s*\d+/, v) })} />
            <CommitField id={`${p}-hp-temp`} label="Temp" value={String(tempHp)} className="cs-big-input"
              onCommit={(v) => setAttr({ temp_hp: num(v) })} />
          </div>
          <span className="cs-label">Hit points</span>
        </div>
      </div>

      <div className="cs-body">
        <div className="cs-col">
          <div className="cs-card">
            <h3 className="cs-title">Saving throws</h3>
            <ul className="cs-saves">
              {ABILITY_KEYS.map((k) => {
                const s2 = saveBonus(sb, k)
                return <li key={k}><span className={`cs-dot${s2.proficient ? ' is-on' : ''}`} aria-label={s2.proficient ? 'proficient' : undefined} />{ABILITY_NAMES[k]}<span className="cs-bonus">{formatModifier(s2.bonus)}</span></li>
              })}
            </ul>
          </div>
          <div className="cs-card">
            <h3 className="cs-title">Senses</h3>
            {(['Perception', 'Investigation', 'Insight'] as const).map((s2) => (
              <div key={s2} className="cs-passive"><span className="cs-passive-n">{passiveScore(sb, s2)}</span>Passive {s2}</div>
            ))}
            {sb.senses && <p className="cs-small">{sb.senses}</p>}
          </div>
          <div className="cs-card">
            <h3 className="cs-title">Proficiencies and languages</h3>
            {e.type === 'PC' && <CommitField id={`${p}-level`} label="Level" value={level} placeholder="9" onCommit={(v) => setAttr({ level: v })} />}
            <p className="cs-small"><strong>Languages:</strong> {sb.languages || '—'}</p>
            <p className="cs-small"><strong>{e.type === 'PC' ? 'Challenge (not used for PCs)' : 'Challenge'}:</strong> {sb.cr || '—'}</p>
            <p className="cs-small">{[sb.size, sb.creatureType].filter(Boolean).join(' ')}{sb.alignment ? `, ${sb.alignment}` : ''}</p>
          </div>
        </div>
        <div className="cs-col cs-skills">
          <h3 className="cs-title">Skills</h3>
          <ul>
            {SKILLS.map(([name, ab]) => {
              const s2 = skillBonus(sb, name, ab)
              return <li key={name}><span className={`cs-dot${s2.proficient ? ' is-on' : ''}`} aria-label={s2.proficient ? 'proficient' : undefined} /><span className="cs-ab">{ABILITY_NAMES[ab]}</span>{name}<span className="cs-bonus">{formatModifier(s2.bonus)}</span></li>
            })}
          </ul>
          <p className="hint">Change saves and skills under Details: list the ones it is proficient in, e.g. “Stealth +6”.</p>
        </div>
        <div className="cs-col cs-right">
          <div className="cs-card cs-conditions">
            <div><h3 className="cs-title">Defenses</h3>
              {defenses.length ? defenses.map(([l, v]) => <p key={l} className="cs-small"><strong>{l}:</strong> {v}</p>) : <p className="cs-small muted">None</p>}</div>
            <CommitField id={`${p}-conditions`} label="Conditions" value={typeof e.attributes.conditions === 'string' ? e.attributes.conditions : ''}
              placeholder="poisoned, prone…" onCommit={(conditions) => setAttr({ conditions })} />
          </div>
          <div className="segmented full cs-tabs" role="tablist" aria-label="Stat block sections">
            {([['actions', 'Actions'], ['traits', 'Features & traits'], ['defenses', 'Defenses'], ['details', 'Details']] as const).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={right === id} aria-pressed={right === id} onClick={() => setRight(id)}>{label}</button>
            ))}
          </div>
          {right === 'actions' && <Abilities sheet={sheet} />}
          {right === 'traits' && <Traits sb={sb} save={save} entityId={e.id} />}
          {right === 'defenses' && (
            <div className="grid-2">
              {text('resistances', 'Damage resistances', { span: true })}
              {text('immunities', 'Damage immunities', { span: true })}
              {text('vulnerabilities', 'Damage vulnerabilities', { span: true })}
              {text('conditionImmunities', 'Condition immunities', { span: true })}
            </div>
          )}
          {right === 'details' && (
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
              {text('saves', 'Saving throws', { span: true, placeholder: 'Str +7, Con +9' })}
              {text('skills', 'Skills', { span: true, placeholder: 'Athletics +6, Stealth +6' })}
              {text('senses', 'Senses', { span: true, placeholder: 'darkvision 60 ft., passive Perception 12' })}
              {text('languages', 'Languages', { span: true })}
            </div>
          )}
        </div>
      </div>
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
  const [link, setLink] = useState<LinkChoice>(DEFAULT_LINK)

  const add = async (ev: FormEvent) => {
    ev.preventDefault()
    if (!otherId || !linkReady(link)) return
    const rel = await act('relationship:create', { sourceId: e.id, targetId: otherId, ...linkInput(link) })
    if (rel) { setOtherId(''); setLink(DEFAULT_LINK) }
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
          <LinkTypeFields id="conn" value={link} onChange={setLink} />
          <button type="submit" className="primary" disabled={!otherId || !linkReady(link)}>Add string</button>
        </form>
      </section>
    </div>
  )
}
