import { InYourNotes } from '../components/InYourNotes'
import { LinkNameTick } from '../components/LinkField'
import { useEffect, useState } from 'react'
import { useBoard } from '../store'
import { ScreenHeader } from '../components/TopBar'
import { ContextMenu } from '../components/ContextMenu'
import { DeskFrame } from '../components/DeskFrame'
import { Roll20Dialog } from '../components/Roll20Dialog'
import { Dialog } from '../components/Dialog'
import { call } from '../api'
import { FACTION_LINK, fillableFields, INTERNAL_KEYS, SECRET, tabFields, tabTitle, type CardField } from '../../shared/cardFields'
import { ExportDialog } from '../components/ExportDialog'
import { ColourInput, CommitField, ScoreField, TitleField } from '../components/fields'
import { LocationPick } from '../components/LocationPick'
import { ENTITY_LABELS, cardColour, useTypeColour } from '../entityStyle'
import {
  ABILITY_KEYS, HAS_STATBLOCK, SKILLS, abilityModifier, emptyStatBlock, formatModifier, leadingNumber, passiveScore, profFor,
  readStatBlock, rebase, saveBonus, setListed, skillBonus, type AbilityKey, type StatBlock
} from '../../shared/statblock'
import { ENTITY_TYPES, type EntityType, type KnowledgeField } from '../../shared/schemas'
import type { IpcInput } from '../../shared/ipc'
import type { SecretKind, SecretView, SheetView } from '../../shared/types'
import { useSidePanel } from '../components/Splitter'
import { FightSummary } from '../components/FightSummary'
import { slotState } from '../../shared/slots'
import { SlotsCard } from '../components/SpellSlots'
import { PicturePanel } from '../components/Pictures'
import { useSheetFile } from '../components/ImportCharSheet'
import { BuildingFillDialog, BuildingTab } from '../components/BuildingSheet'
import { SECRET_LABEL } from '../components/SecretEditor'
import { KIND_LABELS, readBuilding } from '../../shared/building'
import { ActionsTable, ClassStrip, Extras, HpAdjust, InspirationBox, LimitedUses, SpellsTable, VitalsCard } from '../components/SheetExtras'

type Tab = 'building' | 'fight' | 'sheet' | 'traits' | 'links' | 'notes'

const ABILITY_NAMES = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' } as const
const ABILITY_FULL = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' } as const
const KNOWLEDGE_LABELS: Record<KnowledgeField, string> = {
  name: 'Name', location: 'Location', motivation: 'Motivation', statblock: 'Stat block', bio: 'Bio'
}

export function SheetScreen() {
  const sheet = useBoard((s) => s.sheet)
  return (
    <DeskFrame>
      {sheet ? <Sheet key={sheet.entity.id} sheet={sheet} /> : <><ScreenHeader title="Card" /><p className="muted page-pad">Loading…</p></>}
    </DeskFrame>
  )
}

function Sheet({ sheet }: { sheet: SheetView }) {
  const typeColour = useTypeColour()
  const side = useSidePanel('sheet-side', 'right', 340)
  const { act, showOnBoard, openSheet, goTo } = useBoard()
  const [menu, setMenu] = useState<{ x: number; y: number; kind: 'export' | 'more' } | null>(null)
  const fileHook = useSheetFile(sheet.entity.id, sheet.entity.name)
  const file = sheet.entity.type === 'PC' || sheet.entity.type === 'NPC' ? fileHook : null
  const creature = HAS_STATBLOCK.has(sheet.entity.type)
  const building = sheet.entity.type === 'BUILDING'
  // A player character opens on its character sheet: hit points, scores and level first (playtest 2026-10-21).
  const [tab, setTab] = useState<Tab>(building ? 'building' : sheet.entity.type === 'MONSTER' ? 'fight' : sheet.entity.type === 'PC' ? 'sheet' : 'traits')
  const [buildingFill, setBuildingFill] = useState(false)
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

  const wrapSide = (children: React.ReactNode) => (
    <div className="sheet-side" style={{ flex: `0 1 ${side.width}px` }}>{side.grip}{children}</div>
  )
  // Picture, name, type and quick description first on every card's sheet; the other details under them.
  const templateTop = (
            <>
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
                {e.type !== 'BUILDING' && <LocationPick id={`${p}-location`} value={str('location')} exclude={e.id}
                  onChange={(location) => update({ attributes: { location } })} />}
                {e.type === 'ITEM' && (
                  <div className="field">
                    <label htmlFor={`${p}-carried`}>Carried by</label>
                    <select id={`${p}-carried`} value={str('carried_by')} onChange={(ev) => update({ attributes: { carried_by: ev.target.value || null } })}>
                      <option value="">Nobody</option>
                      {sheet.others.filter((o) => o.type === 'PC' && o.status === 'active').map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                    <div className="hint">Listed on that character's sheet.</div>
                  </div>
                )}
                {e.type === 'PC' && sheet.carried.length > 0 && (
                  <div className="field">
                    <span className="field-label">Carrying</span>
                    <ul className="carried-list">{sheet.carried.map((x) => <li key={x.id}><button className="link-button" onClick={() => void openSheet(x.id)}>{x.name}</button></li>)}</ul>
                  </div>
                )}
                {e.type === 'LOCATION' && <CommitField id={`${p}-biome`} label="Biome" value={str('biome')} placeholder="Forest, city, swamp…"
                  onCommit={(biome) => update({ attributes: { biome } })} />}
                <CommitField id={`${p}-tags`} label="Tags" value={e.tags.join(', ')} hint="Separate tags with commas."
                  onCommit={(t) => update({ tags: [...new Set(t.split(',').map((x) => x.trim()).filter(Boolean))] })} />
                <LinkNameTick entity={e} id={`${p}-linkname`} />
                <div className="field">
                  <label htmlFor={`${p}-colour`}>Card colour</label>
                  <div className="row tight">
                    <ColourInput id={`${p}-colour`} value={cardColour(e, typeColour)} onCommit={(colour) => update({ attributes: { colour } })} />
                    {typeof e.attributes.colour === 'string' && (
                      <button type="button" onClick={() => update({ attributes: { colour: null } })}>
                        Use the {ENTITY_LABELS[e.type]} colour
                      </button>
                    )}
                  </div>
                  <div className="hint">Shown on the board card. Every card of a type: board › Card, right-click the type.</div>
                </div>
              </section>
            </>
  )
  const templateRest = (
            <>
              <DetailsPanel sheet={sheet} lab={lab} />
              <CustomFields sheet={sheet} />
              <PartyKnows sheet={sheet} />
            </>
  )
  const templateInner = <>{templateTop}{templateRest}</>
  const templateSide = wrapSide(templateInner)

  return (
    <>
      {/* Three buttons and ⋯ (3.1, owner): the rest of the old row went into Export ▾ and ⋯. */}
      <ScreenHeader title={<TitleField value={e.name} label={`${ENTITY_LABELS[e.type]} name`} onCommit={(name) => update({ name })} />}
        eyebrow={<>
          <span className="badge" style={{ background: cardColour(e, typeColour) }}>{ENTITY_LABELS[e.type].toUpperCase()}</span>
          {e.status === 'defunct' && <span className="source-tag">In History</span>}
          {e.status === 'resolved' && <span>Resolved</span>}
          {source?.name && <span className="source-tag" title="Copied into this campaign; edit it freely">Copy from {source.name}</span>}
        </>}>
        <button className="brass" onClick={() => void showOnBoard(e.id)}>Show on board</button>
        {building ? <button className="ai-button" onClick={() => setBuildingFill(true)}>✦ Fill with AI…</button>
          : <button className="ai-button" onClick={() => setFilling([])} title="AI suggests text for every empty field; you choose what to keep">Fill all blanks with AI…</button>}
        <button className="brass" aria-haspopup="menu" onClick={(ev) => { const r = ev.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4, kind: 'export' }) }}>Export ▾</button>
        <button className="brass icon" aria-label="More" title="Duplicate, show on map, move to History" aria-haspopup="menu"
          onClick={(ev) => { const r = ev.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4, kind: 'more' }) }}>⋯</button>
      </ScreenHeader>
      {menu && <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={menu.kind === 'export' ? [
        ...(file ? [{ label: 'Character sheet file', items: file.items }] : []),
        { label: e.type === 'HANDOUT' ? 'Print letter…' : 'Print or save…', onClick: () => setExporting('print') },
        ...(['NPC', 'PC', 'MONSTER'].includes(e.type) ? [{ label: 'Export to Roll20…', onClick: () => setExporting('roll20') }] : [])
      ] : [
        { label: 'Duplicate', onClick: async () => { const copy = await act('entity:duplicate', { id: e.id }); if (copy) await openSheet(copy.id) } },
        ...(e.type === 'LOCATION' || e.type === 'BUILDING' ? [{ label: 'Show on map', onClick: () => { useBoard.setState({ mapFocusId: e.id }); goTo('map') } }] : []),
        'separator',
        { label: e.status === 'defunct' ? 'Revive' : 'Move to History', danger: e.status !== 'defunct',
          onClick: () => void act('entity:setStatus', { id: e.id, status: e.status === 'defunct' ? 'active' : 'defunct' }) }
      ]} />}
      {fileHook.dialog}

      {buildingFill && <BuildingFillDialog sheet={sheet} onClose={() => setBuildingFill(false)} />}
      {filling && <FillDialog sheet={sheet} only={filling} onClose={() => setFilling(null)} />}
      {exporting === 'roll20' && <Roll20Dialog entityIds={[e.id]} title={`Roll20: ${e.name}`} onClose={() => setExporting(null)} />}
      {exporting === 'print' && <ExportDialog kind={e.type === 'HANDOUT' ? 'letters' : 'sheets'} entityIds={[e.id]} title={e.name} onClose={() => setExporting(null)} />}
      <nav className="tabs" role="tablist" aria-label="Sheet sections">
        {([
          ...(building ? [['building', KIND_LABELS[readBuilding(e.attributes).kind]]] as const : []),
          ...(creature ? [['fight', 'Stat block'], ['sheet', 'Character sheet']] as const : []),
          ...(building ? [] : [['traits', tabTitle(e.type)]] as const),
          ['links', `Links & secrets (${linkRows(sheet).length})`],
          ['notes', e.type === 'HANDOUT' ? 'Handout text and notes' : e.type === 'QUEST' ? 'Reward and notes' : 'Notes']
        ] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>

      <div className="sheet-body">
        {tab === 'building' && <BuildingTab sheet={sheet} side={templateTop} rest={templateRest} wrapSide={wrapSide} factions={<FactionsField sheet={sheet} />} lab={lab} />}
        {tab === 'fight' && <FightSummary sheet={sheet} onFullSheet={() => setTab('sheet')} />}
        {tab === 'sheet' && (
          <>
            <div className="sheet-main"><StatBlockPanel sheet={sheet} /></div>
            {templateSide}
          </>
        )}
        {tab === 'traits' && (
          <>
            <div className={creature ? 'sheet-main wide pic-beside' : 'sheet-main'}>
              {creature && <PicturePanel sheet={sheet} />}
              <TraitsPanel sheet={sheet} lab={lab} onFill={(keys) => setFilling(keys)} />
            </div>
            {!creature && templateSide}
          </>
        )}
        {tab === 'links' && <LinksTab sheet={sheet} lab={lab} own={!building} onFill={() => setFilling(['secret'])} />}
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
            <section className="panel"><InYourNotes entityId={e.id} /></section>
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

      </div>
    </>
  )
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
            <button className="chip-x" aria-label={`Remove ${c.other.name} (the link goes to History)`}
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
      <div className="hint">Each faction is a link on the board ({kind.replace(/_/g, ' ').toLowerCase()}).</div>
    </div>
  )
}

/** Sheet › Secrets: what only the DM knows, and the secrets, clues and connections the card is in. */
/** One row of Links & secrets: a record (secret, clue or link with words) or a board line not in one yet. */
type LinkRow = { key: string; kind: SecretKind; text: string; secretId: string | null; relId: string; conns: SecretView['connections']; known: boolean }

/** Every link, secret and clue this card is in (3.0: one list; a click opens the Link window). */
function linkRows(sheet: SheetView): LinkRow[] {
  const e = sheet.entity
  const known = new Map(sheet.connections.map((c) => [c.relationship.id, c.partyKnows]))
  const records: LinkRow[] = sheet.secrets.filter((x) => x.connections.some((c) => c.sourceId === e.id || c.targetId === e.id))
    .map((x) => ({ key: x.id, kind: x.kind, text: x.text, secretId: x.id, relId: x.connections[0]?.id ?? '', conns: x.connections,
      known: x.connections.every((c) => known.get(c.id)) }))
  const lines: LinkRow[] = sheet.connections.filter((c) => !c.relationship.secretId).map((c) => {
    const r = c.relationship
    return { key: r.id, kind: r.isSecret ? 'secret' : 'connection', text: r.description, secretId: null, relId: r.id,
      conns: [{ id: r.id, sourceId: r.sourceId, targetId: r.targetId, type: r.type }], known: c.partyKnows }
  })
  return [...records, ...lines]
}

/** Card sheet › Links & secrets: the card's own secret text, then its links, secrets and clues (owner's mockup B). */
function LinksTab({ sheet, lab, own, onFill }: { sheet: SheetView; lab(key: string, label: string): string; own: boolean; onFill(): void }) {
  const { act, openLink, openSheet } = useBoard()
  const e = sheet.entity
  const [show, setShow] = useState<SecretKind | 'all'>('all')
  const rows = linkRows(sheet)
  const me = { id: e.id, name: e.name }
  const names = new Map([[e.id, e.name], ...sheet.others.map((o) => [o.id, o.name] as const)])
  const words = (t: string) => t.replace(/_/g, ' ').toLowerCase()
  const add = (kind: SecretKind) => openLink({ kind, mustInclude: me, start: [{ sourceId: e.id, targetId: '', type: 'KNOWS' }] })
  const open = (r: LinkRow) => openLink(r.secretId ? { secretId: r.secretId } : { relationshipId: r.relId })
  const others = sheet.secrets.filter((x) => !rows.some((r) => r.secretId === x.id))
  return (
    <div className="sheet-main wide">
      {own && (
        <section className="panel">
          <div className="panel-head-row">
            <h2 className="panel-heading">Secrets</h2>
            <button disabled={filled(e, 'secret')} onClick={onFill}>Fill blank with AI…</button>
          </div>
          <CommitField id={`secret-${e.id}`} label={lab('secret', 'What only you know')} value={typeof e.attributes.secret === 'string' ? e.attributes.secret : ''}
            multiline rows={6} hint={SECRET.hint} onCommit={(secret) => void act('entity:update', { id: e.id, patch: { attributes: { secret } } })} />
        </section>
      )}
      <section className="panel">
        <div className="panel-head-row">
          <h2 className="panel-heading">Links, secrets and clues</h2>
          <div className="row tight">
            <select className="ink-button primary-ink" value="" aria-label="Add" onChange={(ev) => {
              const v = ev.target.value
              if (v === 'connection' || v === 'secret' || v === 'clue') add(v)
              else if (v) openLink({ secretId: v, mustInclude: me })
            }}>
              <option value="">＋ Add…</option>
              <option value="connection">Link…</option><option value="secret">Secret…</option><option value="clue">Clue…</option>
              {others.length > 0 && <optgroup label="An existing one">{others.map((x) => <option key={x.id} value={x.id}>{SECRET_LABEL[x.kind]}: {x.text.slice(0, 50) || x.label}</option>)}</optgroup>}
            </select>
            <div className="segmented" role="group" aria-label="Show">
              {(['all', 'connection', 'secret', 'clue'] as const).map((k) => (
                <button key={k} aria-pressed={show === k} onClick={() => setShow(k)}>{k === 'all' ? 'All' : `${SECRET_LABEL[k]}s`}</button>
              ))}
            </div>
          </div>
        </div>
        {rows.length === 0 && <p className="hint">No links yet. ＋ Add, or drag from this card to another on the board.</p>}
        {(['connection', 'secret', 'clue'] as const).filter((k) => show === 'all' || show === k).map((k) => {
          const list = rows.filter((r) => r.kind === k)
          return list.length === 0 ? null : (
            <div key={k} className="link-group">
              <h3 className="link-group-head">{SECRET_LABEL[k]}s</h3>
              <ul className="link-rows">{list.map((r) => (
                <li key={r.key}>
                  <span className={`link-badge k-${k}`}>{SECRET_LABEL[k]}</span>
                  <button className="link-row-main" title="Edit in the Link window" onClick={() => open(r)}>
                    <span>{r.conns.map((c, i) => {
                      const mine = c.sourceId === e.id ? 'out' : c.targetId === e.id ? 'in' : null
                      const other = mine === 'out' ? c.targetId : c.sourceId
                      return <span key={c.id}>{i > 0 && ' · '}{mine ? <><i>{mine === 'in' ? `${names.get(c.sourceId) ?? '?'} ` : ''}{words(c.type)}</i> {mine === 'out' ? names.get(other) ?? '?' : e.name}</>
                        : <>{names.get(c.sourceId) ?? '?'} <i>{words(c.type)}</i> {names.get(c.targetId) ?? '?'}</>}</span>
                    })}</span>
                    {r.text && <span className="link-row-text">{r.text}</span>}
                  </button>
                  {r.known && <span className="tag-known">Party knows</span>}
                  <button className="link-button" aria-label="Open the other card's sheet" title="Open the other card's sheet"
                    onClick={() => { const c = r.conns.find((x) => x.sourceId === e.id || x.targetId === e.id); if (c) void openSheet(c.sourceId === e.id ? c.targetId : c.sourceId) }}>↗</button>
                </li>
              ))}</ul>
            </div>
          )
        })}
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
    <Dialog title={`Fill blanks: ${e.name}`} open onClose={onClose} wide busy={busy}>
      {!answer ? (
        <div className="dz-form">
          {empty.length === 0 && !canBase ? <p>Every field on this card is filled. Empty a field to have the AI suggest it.</p> : (
            <>
              <p className="hint">The AI sees the card, its links, storylines and your notes, and suggests text for the empty fields you tick. Nothing changes until you choose what to keep.</p>
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

/** Character sheet: a character-sheet layout (ability boxes, the numbers a DM checks, saves, senses, skills, tabs). */
function StatBlockPanel({ sheet }: { sheet: SheetView }) {
  const act = useBoard((s) => s.act)
  const e = sheet.entity
  const [right, setRight] = useState<'actions' | 'spells' | 'traits' | 'extras' | 'defenses' | 'details'>('actions')
  const sb: StatBlock = readStatBlock(e.attributes.statblock) ?? emptyStatBlock()
  const setAttr = (attributes: Record<string, unknown>) => void act('entity:update', { id: e.id, patch: { attributes } })
  const p = `sb-${e.id}`
  const text = (key: keyof StatBlock, label: string, opts: { span?: boolean; placeholder?: string; hint?: string } = {}) => (
    <CommitField id={`${p}-${key}`} label={label} value={String(sb[key] ?? '')} placeholder={opts.placeholder} hint={opts.hint}
      className={opts.span ? 'span-2' : undefined} onCommit={(v) => save({ [key]: v } as Partial<StatBlock>)} />
  )
  const str = (k: string) => (typeof e.attributes[k] === 'string' ? e.attributes[k] as string : '')
  const level = str('level')
  const { prof, auto: autoProf, own: ownProf } = profFor(e.type, e.attributes, sb)
  // Scores move the listed saves and skills with them (proficiency and expertise stay).
  const save = (patch: Partial<StatBlock>) => {
    const next = { ...sb, ...patch }
    void act('entity:update', { id: e.id, patch: { attributes: { statblock: ABILITY_KEYS.some((k) => k in patch) ? { ...next, ...rebase(sb, prof, next, prof) } : next } } })
  }
  const setProf = (v: string) => {
    const n = Number.parseInt(v.replace('−', '-'), 10)
    const own = v.trim() && Number.isFinite(n) ? Math.max(0, Math.min(20, n)) : null
    setAttr({ prof_bonus: own, statblock: { ...sb, ...rebase(sb, prof, sb, own ?? autoProf) } })
  }
  const skillAdv = (e.attributes.skill_adv && typeof e.attributes.skill_adv === 'object' ? e.attributes.skill_adv : {}) as Record<string, 'A' | 'D' | undefined>
  const ownInit = typeof e.attributes.initiative === 'string' ? e.attributes.initiative : ''
  /** Proficiency dot: none → proficient → expertise (skills) → none. */
  const cycle = (field: 'saves' | 'skills', name: string, ab: AbilityKey, listed: boolean, bonus: number) => {
    const mod = abilityModifier(sb[ab])
    const p2 = prof ?? 2
    const next = !listed ? mod + p2 : field === 'skills' && bonus < mod + 2 * p2 ? mod + 2 * p2 : null
    save({ [field]: setListed(sb[field], name, next) })
  }
  const maxHp = leadingNumber(sb.hp)
  const curHp = typeof e.attributes.current_hp === 'number' ? e.attributes.current_hp : maxHp
  const tempHp = typeof e.attributes.temp_hp === 'number' ? e.attributes.temp_hp : 0
  const walk = /\d+\s*(ft|m)\.?/i.exec(sb.speed)?.[0] ?? sb.speed
  const num = (v: string) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? Math.min(n, 100000) : 0 }
  const slotInfo = slotState(e.attributes, sb.traits.map((t) => `${t.name} ${t.desc}`).join('\n'))
  const defenses = [['Resistances', sb.resistances], ['Immunities', sb.immunities], ['Vulnerabilities', sb.vulnerabilities], ['Condition immunities', sb.conditionImmunities]].filter(([, v]) => v)

  return (
    <section className="panel char-sheet">
      {e.type === 'PC' && <ClassStrip sheet={sheet} sb={sb} save={save} />}
      <div className="cs-top">
        {ABILITY_KEYS.map((k) => (
          <div key={k} className="cs-ability">
            <span className="cs-label">{ABILITY_FULL[k]}</span>
            <span className="cs-big">{formatModifier(abilityModifier(sb[k]))}</span>
            <ScoreField id={`${p}-${k}`} label={`${ABILITY_FULL[k]} score`} value={sb[k]} min={1} max={30} onCommit={(v) => save({ [k]: v } as Partial<StatBlock>)} />
          </div>
        ))}
        <div className="cs-box" title={ownProf !== null ? 'Your own number. Empty it to use the level or challenge rating.' : e.type === 'PC' ? 'From the level; type your own' : 'From the challenge rating; type your own'}>
          <CommitField id={`${p}-prof`} label="Proficiency" value={prof === null ? '' : formatModifier(prof)} placeholder="—" className="cs-big-input" onCommit={setProf} />
          <span className="cs-label">bonus{ownProf !== null ? ' (yours)' : ''}</span>
        </div>
        <div className="cs-box" title={sb.speed}>
          <CommitField id={`${p}-speed`} label="Walking" value={walk} placeholder="30 ft." className="cs-big-input cs-wide-input"
            onCommit={(v) => save({ speed: walk && sb.speed.includes(walk) ? sb.speed.replace(walk, v) : v })} />
          <span className="cs-label">speed</span>
        </div>
        <div className="cs-box" title={ownInit ? 'Your own number. Empty it to use Dexterity.' : 'From Dexterity; type your own'}>
          <CommitField id={`${p}-init`} label="Initiative" value={ownInit || formatModifier(abilityModifier(sb.dex))} className="cs-big-input"
            onCommit={(v) => setAttr({ initiative: v === formatModifier(abilityModifier(sb.dex)) ? null : v || null })} />
        </div>
        {e.type === 'PC' && <InspirationBox sheet={sheet} />}
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
          <HpAdjust sheet={sheet} cur={curHp ?? 0} temp={tempHp} max={maxHp} />
        </div>
      </div>

      <div className="cs-body">
        <div className="cs-col">
          <div className="cs-card">
            <h3 className="cs-title">Saving throws</h3>
            <ul className="cs-saves">
              {ABILITY_KEYS.map((k) => {
                const s2 = saveBonus(sb, k)
                const name = ABILITY_NAMES[k][0] + ABILITY_NAMES[k].slice(1).toLowerCase()
                return <li key={k}><ProfDot on={s2.proficient ? 1 : 0} label={`${ABILITY_FULL[k]} save`} onClick={() => cycle('saves', name, k, s2.proficient, s2.bonus)} />{ABILITY_NAMES[k]}
                  <BonusInput label={`${ABILITY_FULL[k]} saving throw`} value={s2.bonus} onCommit={(n) => save({ saves: setListed(sb.saves, name, n) })} /></li>
              })}
            </ul>
            <CommitField id={`${p}-save-notes`} label="Notes" value={str('save_notes')} placeholder="Advantage on CON saves to keep concentration" className="cs-inline"
              onCommit={(save_notes) => setAttr({ save_notes })} />
          </div>
          <div className="cs-card">
            <h3 className="cs-title">Senses</h3>
            {(['Perception', 'Investigation', 'Insight'] as const).map((s2) => (
              <div key={s2} className="cs-passive"><span className="cs-passive-n">{passiveScore(sb, s2)}</span>Passive {s2}</div>
            ))}
            <CommitField id={`${p}-senses-inline`} label="Senses" value={sb.senses} placeholder="darkvision 60 ft." className="cs-inline" onCommit={(senses) => save({ senses })} />
          </div>
          {e.type === 'PC' && <VitalsCard sheet={sheet} sb={sb} />}
          <SlotsCard sheet={sheet} slots={slotInfo} fromText={!Array.isArray(e.attributes.spell_slots) && slotInfo.max.some(Boolean)} />
          <div className="cs-card">
            <h3 className="cs-title">Proficiencies and languages</h3>
            {e.type === 'PC' && <CommitField id={`${p}-level`} label="Level" value={level} placeholder="9" onCommit={(v) => setAttr({ level: v })} />}
            <CommitField id={`${p}-langs`} label="Languages" value={sb.languages} placeholder="Common, Elvish" className="cs-inline" onCommit={(languages) => save({ languages })} />
            <CommitField id={`${p}-profs`} label="Armor, weapons, tools" value={str('proficiencies')} placeholder="Light armor, rapiers, lute" className="cs-inline"
              onCommit={(proficiencies) => setAttr({ proficiencies })} />
            {e.type !== 'PC' && <CommitField id={`${p}-cr-inline`} label="Challenge" value={sb.cr} placeholder="1" className="cs-inline" onCommit={(cr) => save({ cr })} />}
            <div className="grid-2">
              <CommitField id={`${p}-size-inline`} label="Size" value={sb.size} placeholder="Medium" className="cs-inline" onCommit={(size) => save({ size })} />
              <CommitField id={`${p}-type-inline`} label={e.type === 'PC' ? 'Species' : 'Type'} value={sb.creatureType} className="cs-inline" onCommit={(creatureType) => save({ creatureType })} />
            </div>
            <CommitField id={`${p}-align-inline`} label="Alignment" value={sb.alignment} className="cs-inline" onCommit={(alignment) => save({ alignment })} />
          </div>
        </div>
        <div className="cs-col cs-skills">
          <h3 className="cs-title">Skills</h3>
          <ul>
            {SKILLS.map(([name, ab]) => {
              const s2 = skillBonus(sb, name, ab)
              const level = !s2.proficient ? 0 : prof !== null && s2.bonus >= abilityModifier(sb[ab]) + 2 * prof ? 2 : 1
              const mark = skillAdv[name]
              return <li key={name}><ProfDot on={level} label={name} onClick={() => cycle('skills', name, ab, s2.proficient, s2.bonus)} /><span className="cs-ab">{ABILITY_NAMES[ab]}</span>{name}
                <button type="button" className={`cs-adv${mark ? ` is-${mark}` : ''}`} title={mark === 'A' ? 'Advantage (click: disadvantage)' : mark === 'D' ? 'Disadvantage (click: none)' : 'Mark advantage or disadvantage'}
                  aria-label={`${name}: ${mark === 'A' ? 'advantage' : mark === 'D' ? 'disadvantage' : 'no advantage mark'}`}
                  onClick={() => setAttr({ skill_adv: { ...skillAdv, [name]: mark === 'A' ? 'D' : mark === 'D' ? null : 'A' } })}>{mark ?? ''}</button>
                <BonusInput label={name} value={s2.bonus} onCommit={(n) => save({ skills: setListed(sb.skills, name, n) })} /></li>
            })}
          </ul>
          <p className="hint">Click a dot: proficient, expertise (skills), none. The small box marks advantage (A) or disadvantage (D). Type a bonus to set it. Scores and the proficiency bonus move them.</p>
        </div>
        <div className="cs-col cs-right">
          <div className="cs-card cs-conditions">
            <div><h3 className="cs-title">Defenses</h3>
              {defenses.length ? defenses.map(([l, v]) => <p key={l} className="cs-small"><strong>{l}:</strong> {v}</p>) : <p className="cs-small muted">None</p>}</div>
            <CommitField id={`${p}-conditions`} label="Conditions" value={typeof e.attributes.conditions === 'string' ? e.attributes.conditions : ''}
              placeholder="poisoned, prone…" onCommit={(conditions) => setAttr({ conditions })} />
          </div>
          <div className="segmented full cs-tabs" role="tablist" aria-label="Stat block sections">
            {([['actions', 'Actions'], ['spells', 'Spells'], ['traits', 'Features & traits'], ['extras', 'Extras'], ['defenses', 'Defenses'], ['details', 'Details']] as const).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={right === id} aria-pressed={right === id} onClick={() => setRight(id)}>{label}</button>
            ))}
          </div>
          {right === 'actions' && <ActionsTable sheet={sheet} />}
          {right === 'spells' && <SpellsTable sheet={sheet} sb={sb} prof={prof} slots={slotInfo} />}
          {right === 'traits' && <><LimitedUses sheet={sheet} /><Traits sb={sb} save={save} entityId={e.id} /></>}
          {right === 'extras' && <Extras sheet={sheet} />}
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

/** A proficiency dot you click: 0 none, 1 proficient, 2 expertise. */
function ProfDot({ on, label, onClick }: { on: number; label: string; onClick(): void }) {
  return <button type="button" className={`cs-dot${on ? ' is-on' : ''}${on === 2 ? ' is-expert' : ''}`} onClick={onClick}
    aria-label={`${label}: ${['not proficient', 'proficient', 'expertise'][on]}`} title={['Not proficient', 'Proficient', 'Expertise'][on]} />
}

/** A save or skill bonus you can type over. */
function BonusInput({ label, value, onCommit }: { label: string; value: number; onCommit(n: number): void }) {
  const [draft, setDraft] = useState(formatModifier(value))
  useEffect(() => setDraft(formatModifier(value)), [value])
  return <input className="cs-bonus" aria-label={`${label} bonus`} value={draft} onChange={(ev) => setDraft(ev.target.value)}
    onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLElement).blur() }}
    onBlur={() => { const n = Number.parseInt(draft.replace('−', '-'), 10); if (Number.isFinite(n) && n !== value) onCommit(n); else setDraft(formatModifier(value)) }} />
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

