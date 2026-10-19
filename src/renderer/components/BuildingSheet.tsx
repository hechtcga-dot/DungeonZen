import { useEffect, useState, type ReactNode } from 'react'
import { LocationPick } from './LocationPick'
import { useBoard } from '../store'
import { call } from '../api'
import { CommitField, TitleField } from './fields'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { Dialog } from './Dialog'
import { SketchPad } from './SketchPad'
import { BuildingBackdrop } from '../art/buildings'
import {
  BUILDING_KINDS, buildingAttrs, byScore, clampScore, FLOOR_NAMES, formatPrice, isRevealed, KIND_LABELS, MAIN_FLOOR, newId, parsePrice,
  readBuilding, ROOM_LABELS, ROOM_STATUSES, scaledPrice, SECRET_KINDS, SECRET_LABELS, SHOP_TYPES,
  type BSecret, type Building, type BuildingKind, type BuildingProposal, type Patron, type Room, type SecretKind, type StockItem
} from '../../shared/building'
import { BUILDING_TOOLS, isBlank, type Sketch } from '../../shared/sketch'
import { PRICE_LIST } from '../../shared/prices'
import type { SheetView } from '../../shared/types'

type Menu = { x: number; y: number; items: MenuItem[] } | null
type Pool = NonNullable<Awaited<ReturnType<typeof call<'building:secretPool'>>>>
const upd = <T extends { id: string }>(list: T[], id: string, patch: Partial<T>) => list.map((x) => (x.id === id ? { ...x, ...patch } : x))
const live = <T extends { removed?: boolean }>(list: T[]) => list.filter((x) => !x.removed)
const DEFAULT_SCORE: Record<SecretKind, number> = { rumour: 4, secret: 10, clue: 16 }

/** A rumour, secret or clue tag: every line says which it is (owner, 2026-10-13). */
function KindTag({ kind }: { kind: SecretKind }) {
  return <span className={`kind-tag is-${kind}`}>{SECRET_LABELS[kind]}</span>
}

/** "Removed: 2 · Bring back ▾" under a list: items moved to History come back from here (rule 3). */
function Removed<T extends { id: string; removed?: boolean }>({ items, name, onRestore }: { items: T[]; name(x: T): string; onRestore(id: string): void }) {
  const gone = items.filter((x) => x.removed)
  if (!gone.length) return null
  return (
    <select className="removed-select" value="" aria-label="Bring back from History" onChange={(e) => e.target.value && onRestore(e.target.value)}>
      <option value="">In History: {gone.length} · Bring back…</option>
      {gone.map((x) => <option key={x.id} value={x.id}>{name(x) || 'Untitled'}</option>)}
    </select>
  )
}

/** What kind of shop (shows when Kind is Shop): common D&D shops or Custom… with your own words. */
export function ShopTypePick({ id, value, onChange }: { id: string; value: string; onChange(v: string): void }) {
  const [custom, setCustom] = useState(!!value && !SHOP_TYPES.includes(value))
  return (
    <span className="shop-type">
      <select id={id} aria-label="What kind of shop" value={custom ? '__custom' : value}
        onChange={(ev) => { const v = ev.target.value; setCustom(v === '__custom'); if (v !== '__custom') onChange(v) }}>
        <option value="">What kind of shop…</option>
        {SHOP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        <option value="__custom">Custom…</option>
      </select>
      {custom && <CommitField id={`${id}-custom`} label="Your own kind of shop" className="label-hidden" value={value} placeholder="Type your own (e.g. Mapmaker)" onCommit={onChange} />}
    </span>
  )
}

/**
 * Building sheet (tavern, shop or any building): backdrop, floor tabs, keeper and patrons with
 * scored secrets, layout sketch, rooms, stock with prices, Secrets & clues folders. Each edit is
 * one entity:update (undo); removing moves to History inside the card.
 */
export function BuildingTab({ sheet, side, rest, wrapSide, factions, lab }: {
  sheet: SheetView; side: ReactNode; rest: ReactNode; wrapSide(children: ReactNode): ReactNode; factions: ReactNode; lab(key: string, label: string): string
}) {
  const { act, openSheet, say, setBattleMapOpen, info } = useBoard()
  const e = sheet.entity
  const b = readBuilding(e.attributes)
  const [floor, setFloor] = useState(MAIN_FLOOR)
  const [showLayout, setShowLayout] = useState(true)
  const [menu, setMenu] = useState<Menu>(null)
  const [highlight, setHighlight] = useState<string | undefined>()
  const save = (patch: Partial<Building>) => act('entity:update', { id: e.id, patch: { attributes: buildingAttrs(patch) } })
  const text = (key: string) => (typeof e.attributes[key] === 'string' ? (e.attributes[key] as string) : '')
  const floors = live(b.floors)
  const cur = floors.find((f) => f.id === floor) ?? floors[0]
  const campaignPct = info?.priceScale ?? 100
  const price = (cp: number) => formatPrice(scaledPrice(cp, campaignPct, b.priceScale))
  const freeRooms = live(b.rooms).filter((r) => r.status === 'free').length
  const factor = (campaignPct * b.priceScale) / 10000
  const kind = b.kind

  const setLayout = (s: Sketch) => save({ floors: upd(b.floors, cur.id, { layout: s }) })
  const drawMap = () => setBattleMapOpen({
    name: `${e.name} · ${cur.name}`, description: text('description'), sketch: cur.layout ?? null, indoors: true,
    onKept: (mapId) => void save({ floors: upd(readBuilding(useBoard.getState().sheet?.entity.attributes ?? e.attributes).floors, cur.id, { mapId }) })
  })

  const people = <PeoplePanel key="people" b={b} kind={kind} floor={cur.id} floors={floors} save={save} setMenu={setMenu}
    makeCard={async (p, type) => { const id = await act('building:patronCard', { buildingId: e.id, patronId: p.id, type }); if (id) say(`Made ${type === 'NPC' ? 'an' : 'a'} ${type} card for ${p.name}, tied to ${e.name}. Ctrl+Z undoes it.`) }}
    openSheet={openSheet} />
  const layout = showLayout && (
    <section key="layout" className="panel">
      <div className="panel-head-row">
        <h2 className="panel-heading">Layout · {cur.name}</h2>
        {cur.mapId && <button className="link-button" onClick={() => { void act('map:setActive', { mapId: cur.mapId! }); useBoard.getState().goTo('map') }}>Open the floor map</button>}
      </div>
      <SketchPad label={`Layout of ${cur.name}`} sketch={cur.layout ?? null} tools={BUILDING_TOOLS} onCommit={setLayout} highlight={highlight} />
      <p className="hint">Click and drag to draw; each stroke is one undo step. ✦ Draw floor map sends this sketch to the map service as a blueprint.</p>
    </section>
  )
  const rooms = (kind === 'tavern' || live(b.rooms).length > 0) && <RoomsPanel key="rooms" b={b} floor={cur} save={save} price={price} onPick={setHighlight} />
  const stock = <StockPanel key="stock" b={b} kind={kind} floor={cur.id} save={save} price={price} factor={factor} />
  const words = (
    <section key="words" className="panel">
      <CommitField id={`b-${e.id}-desc`} label={lab('description', 'Description')} value={text('description')} multiline rows={4}
        onCommit={(description) => void act('entity:update', { id: e.id, patch: { attributes: { description } } })} />
      <CommitField id={`b-${e.id}-hist`} label={lab('history', 'History')} value={text('history')} multiline rows={5}
        hint="Says how the place got its name." onCommit={(history) => void act('entity:update', { id: e.id, patch: { attributes: { history } } })} />
    </section>
  )
  const secrets = <SecretsFolders key="secrets" sheet={sheet} b={b} save={save} setMenu={setMenu} />
  // Layout always last (owner, 2026-10-14); description, history and Secrets & clues in the centre after patrons/inventory (owner, 2026-10-19).
  const order = kind === 'shop' ? [stock, words, secrets, people, rooms, layout] : [people, words, secrets, rooms, stock, layout]

  return (
    <>
      <div className="building-top">
        <BuildingBackdrop kind={kind} title={<TitleField value={e.name} label="Building name" onCommit={(name) => void act('entity:update', { id: e.id, patch: { name } })} />}
          sub={`${kind === 'shop' && text('shop_type') ? text('shop_type') : KIND_LABELS[kind]} · ${floors.length} floor${floors.length === 1 ? '' : 's'}${kind === 'tavern' || freeRooms ? ` · ${freeRooms} room${freeRooms === 1 ? '' : 's'} free` : ''} · prices ×${factor.toFixed(2)}`} />
        <FloorTabs b={b} current={cur.id} onPick={setFloor} save={save} setMenu={setMenu}
          onDropPatron={(pid, fid) => void save({ patrons: upd(b.patrons, pid, { floor: fid }) })} />
        <div className="floor-bar">
          <strong>{cur.name}</strong>
          <span className="hint">Patrons, rooms, stock and layout below are for this floor. Drag a patron onto a tab to move them.</span>
          <span className="spacer" />
          <label className="field floor-kind">Kind
            <select value={kind} onChange={(ev) => void save({ kind: ev.target.value as BuildingKind })}>
              {BUILDING_KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
            </select>
          </label>
          {kind === 'shop' && <ShopTypePick id={`b-${e.id}-shop`} value={text('shop_type')} onChange={(shop_type) => void act('entity:update', { id: e.id, patch: { attributes: { shop_type } } })} />}
          <span className="spacer" />
          <label className="field checkbox"><input type="checkbox" checked={showLayout} onChange={(ev) => setShowLayout(ev.target.checked)} /> Show layout</label>
          <button className="ai-button" onClick={drawMap} title={isBlank(cur.layout) ? 'Draw a map of this floor' : 'Draw a map of this floor, following the layout as a blueprint'}>✦ Draw floor map</button>
        </div>
      </div>
      <div className="sheet-main">{order}</div>
      {wrapSide(<>
        {side}
        <section className="panel">
          <h2 className="panel-heading">Details</h2>
          <p className="hint">Floors: {floors.length} ({floors.map((f) => f.name.toLowerCase()).join(', ')}). Add one with + Floor.</p>
          <LocationPick id={`b-${e.id}-inside`} label="Inside" value={text('location')} exclude={e.id}
            hint="Its region on the map shows who is in here." onChange={(location) => void act('entity:update', { id: e.id, patch: { attributes: { location } } })} />
          {factions}
        </section>
        {rest}
        <details className="panel price-settings">
          <summary><span className="panel-heading">Price settings</span> <span className="hint">campaign {campaignPct}% · this {KIND_LABELS[kind].toLowerCase()} {b.priceScale}%</span></summary>
          <div className="field">
            <label htmlFor={`b-${e.id}-scale`}>This {KIND_LABELS[kind].toLowerCase()}'s prices (%)</label>
            <input id={`b-${e.id}-scale`} type="number" min={1} max={10000} defaultValue={b.priceScale} key={b.priceScale}
              onBlur={(ev) => { const n = Math.round(Number(ev.target.value)); if (n >= 1 && n !== b.priceScale) void save({ priceScale: n }) }} />
            <span className="hint">Campaign prices are under Setup › Campaign settings ({campaignPct}%). Shown price = base × campaign × this one.</span>
          </div>
        </details>
      </>)}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </>
  )
}

function FloorTabs({ b, current, onPick, save, setMenu, onDropPatron }: {
  b: Building; current: string; onPick(id: string): void; save(p: Partial<Building>): void; setMenu(m: Menu): void; onDropPatron(patronId: string, floorId: string): void
}) {
  const [naming, setNaming] = useState<{ id: string | null; name: string } | null>(null)
  const floors = live(b.floors)
  const commit = () => {
    const name = naming?.name.trim()
    if (name) {
      if (naming!.id) save({ floors: upd(b.floors, naming!.id, { name }) })
      else { const id = newId(); save({ floors: [...b.floors, { id, name }] }); onPick(id) }
    }
    setNaming(null)
  }
  const move = (id: string, dir: -1 | 1) => {
    const list = [...b.floors]
    const i = list.findIndex((f) => f.id === id)
    let j = i + dir
    while (list[j]?.removed) j += dir
    if (j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
    save({ floors: list })
  }
  return (
    <div className="floor-tabs" role="tablist" aria-label="Floors">
      {floors.map((f) => naming?.id === f.id ? (
        <input key={f.id} autoFocus className="floor-tab-input" value={naming.name} maxLength={60} aria-label="Floor name"
          onChange={(ev) => setNaming({ ...naming, name: ev.target.value })} onBlur={commit} onKeyDown={(ev) => { if (ev.key === 'Enter') commit(); if (ev.key === 'Escape') setNaming(null) }} />
      ) : (
        <button key={f.id} role="tab" aria-selected={f.id === current} className="floor-tab" onClick={() => onPick(f.id)} title="Right-click: rename, move, remove"
          onDragOver={(ev) => ev.preventDefault()} onDrop={(ev) => { const pid = ev.dataTransfer.getData('text/x-patron'); if (pid) onDropPatron(pid, f.id) }}
          onContextMenu={(ev) => { ev.preventDefault(); setMenu({ x: ev.clientX, y: ev.clientY, items: [
            { label: 'Rename', onClick: () => setNaming({ id: f.id, name: f.name }) },
            { label: 'Move left', onClick: () => move(f.id, -1) }, { label: 'Move right', onClick: () => move(f.id, 1) },
            'separator',
            { label: 'Move to History', danger: true, disabled: f.id === MAIN_FLOOR, hint: f.id === MAIN_FLOOR ? 'The main floor stays' : undefined, onClick: () => { save({ floors: upd(b.floors, f.id, { removed: true }) }); onPick(MAIN_FLOOR) } }
          ] }) }}>{f.name}</button>
      ))}
      {naming?.id === null ? (
        <input autoFocus className="floor-tab-input" value={naming.name} maxLength={60} placeholder="Floor name" aria-label="New floor name"
          onChange={(ev) => setNaming({ id: null, name: ev.target.value })} onBlur={commit} onKeyDown={(ev) => { if (ev.key === 'Enter') commit(); if (ev.key === 'Escape') setNaming(null) }} />
      ) : (
        <select className="floor-tab is-add" value="" aria-label="Add a floor" onChange={(ev) => {
          const v = ev.target.value
          if (v === '__own') setNaming({ id: null, name: '' })
          else if (v.startsWith('back:')) { const id = v.slice(5); save({ floors: upd(b.floors, id, { removed: false }) }); onPick(id) }
          else if (v) { const id = newId(); save({ floors: [...b.floors, { id, name: v }] }); onPick(id) }
        }}>
          <option value="">+ Floor ▾</option>
          {FLOOR_NAMES.filter((n) => !floors.some((f) => f.name === n)).map((n) => <option key={n} value={n}>{n}</option>)}
          <option value="__own">Another name…</option>
          {b.floors.filter((f) => f.removed).map((f) => <option key={f.id} value={`back:${f.id}`}>Bring back: {f.name}</option>)}
        </select>
      )}
    </div>
  )
}

function PeoplePanel({ b, kind, floor, floors, save, setMenu, makeCard, openSheet }: {
  b: Building; kind: BuildingKind; floor: string; floors: Building['floors']; save(p: Partial<Building>): void; setMenu(m: Menu): void
  makeCard(p: Patron, type: 'NPC' | 'PC'): void; openSheet(id: string): void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [roll, setRoll] = useState(b.roll === null ? '' : String(b.roll))
  useEffect(() => setRoll(b.roll === null ? '' : String(b.roll)), [b.roll])
  const here = live(b.patrons).filter((p) => p.floor === floor || !floors.some((f) => f.id === p.floor))
  const list = [...here.filter((p) => p.keeper), ...here.filter((p) => !p.keeper)]
  const keeperWord = kind === 'tavern' ? 'barkeeper' : kind === 'shop' ? 'shopkeeper' : 'in charge'
  const title = kind === 'tavern' ? 'Barkeeper & patrons' : kind === 'shop' ? 'Shopkeeper & customers' : 'People here'
  const addSecret = (patronId?: string) => { const s: BSecret = { id: newId(), kind: 'secret', score: 10, text: 'New secret', patronId }; save({ secrets: [...b.secrets, s] }); if (patronId) setEditing(patronId) }
  const commitRoll = () => {
    const n = roll.trim() === '' ? null : Math.max(1, Math.min(40, Math.round(Number(roll)) || 0))
    if (n !== b.roll) save({ roll: n })
  }
  const menuFor = (ev: React.MouseEvent, p: Patron) => {
    ev.preventDefault()
    setMenu({ x: ev.clientX, y: ev.clientY, items: [
      ...(p.entityId ? [{ label: 'Open card', onClick: () => openSheet(p.entityId!) }] : [
        { label: 'Make NPC card', onClick: () => makeCard(p, 'NPC') }, { label: 'Make PC card', onClick: () => makeCard(p, 'PC') }
      ]),
      'separator',
      { label: editing === p.id ? 'Done editing' : 'Edit', onClick: () => setEditing(editing === p.id ? null : p.id) },
      { label: 'Add secret', onClick: () => addSecret(p.id) },
      { label: p.keeper ? `Not the ${keeperWord}` : `Make ${keeperWord}`, onClick: () => save({ patrons: upd(b.patrons, p.id, { keeper: !p.keeper }) }) },
      ...(floors.length > 1 ? [{ label: 'Move to floor', items: floors.filter((f) => f.id !== p.floor).map((f) => ({ label: f.name, onClick: () => save({ patrons: upd(b.patrons, p.id, { floor: f.id }) }) })) }] : []),
      'separator',
      { label: 'Move to History', danger: true, onClick: () => save({ patrons: upd(b.patrons, p.id, { removed: true }) }) }
    ] })
  }
  return (
    <section className="panel">
      <div className="panel-head-row">
        <h2 className="panel-heading">{title}</h2>
        <button onClick={() => { const p: Patron = { id: newId(), name: 'New patron', role: '', desc: '', knows: '', floor }; save({ patrons: [...b.patrons, p] }); setEditing(p.id) }}>+ {kind === 'shop' ? 'Person' : 'Patron'}</button>
      </div>
      <div className="roll-bar">
        <label htmlFor="b-roll">Players rolled</label>
        <input id="b-roll" inputMode="numeric" value={roll} placeholder="–" onChange={(ev) => setRoll(ev.target.value)} onBlur={commitRoll}
          onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLElement).blur() }} />
        <span>{b.roll === null ? 'Type their roll: secrets with that score or less open up.' : `Secrets with score ${b.roll} or less are open.`}</span>
        <span className="spacer" /><span className="hint-light">Roll in Roll20, type it here</span>
      </div>
      {list.length === 0 && <p className="hint">Nobody on this floor yet. Add someone, or let Fill with AI people it.</p>}
      {list.map((p) => {
        const secrets = live(b.secrets).filter((s) => s.patronId === p.id).sort(byScore)
        const edit = editing === p.id
        return (
          <div key={p.id} className={`patron${p.keeper ? ' is-keeper' : ''}`} draggable={!edit} title="Right-click for more; drag to another floor"
            onDragStart={(ev) => ev.dataTransfer.setData('text/x-patron', p.id)} onContextMenu={(ev) => menuFor(ev, p)}>
            {edit ? (
              <div className="patron-edit">
                <CommitField id={`p-${p.id}-name`} label="Name" value={p.name} required onCommit={(name) => save({ patrons: upd(b.patrons, p.id, { name }) })} />
                <CommitField id={`p-${p.id}-role`} label="Role" value={p.role} placeholder={keeperWord} onCommit={(role) => save({ patrons: upd(b.patrons, p.id, { role }) })} />
                <CommitField id={`p-${p.id}-desc`} label="Look and manner" value={p.desc} className="span-2" onCommit={(desc) => save({ patrons: upd(b.patrons, p.id, { desc }) })} />
                <CommitField id={`p-${p.id}-knows`} label="Knows" value={p.knows} className="span-2" onCommit={(knows) => save({ patrons: upd(b.patrons, p.id, { knows }) })} />
              </div>
            ) : (
              <>
                <div className="patron-who">
                  <strong>{p.name}</strong>
                  {p.keeper && p.role.toLowerCase() !== keeperWord && <span className="p-tag">{keeperWord}</span>}
                  {p.role && <span className="p-tag">{p.role}</span>}
                  {p.desc && <span className="p-tag">{p.desc}</span>}
                  {p.entityId ? <button className="p-tag is-card" onClick={() => openSheet(p.entityId!)}>◆ Card</button> : null}
                  <span className="spacer" />
                  <button className="link-button" onClick={(ev) => menuFor(ev, p)} aria-label={`More for ${p.name}`}>⋯</button>
                </div>
                {p.knows && <div className="patron-knows">Knows: {p.knows}</div>}
              </>
            )}
            {secrets.map((s) => <SecretLine key={s.id} s={s} roll={b.roll} edit={edit} onChange={(patch) => save({ secrets: upd(b.secrets, s.id, patch) })} />)}
            {edit && (
              <div className="row tight">
                <button onClick={() => addSecret(p.id)}>+ Secret</button>
                <button className="primary" onClick={() => setEditing(null)}>Done</button>
              </div>
            )}
          </div>
        )
      })}
      <div className="b-legend">Sorted low → high. <KindTag kind="rumour" /> everyday gossip <KindTag kind="secret" /> <KindTag kind="clue" /> <span className="has-card-key">purple = has its own card</span> Right-click a person for more.</div>
      <Removed items={b.patrons} name={(p) => p.name} onRestore={(id) => save({ patrons: upd(b.patrons, id, { removed: false }) })} />
    </section>
  )
}

function SecretLine({ s, roll, edit, onChange }: { s: BSecret; roll: number | null; edit: boolean; onChange(patch: Partial<BSecret>): void }) {
  const open = isRevealed(s, roll)
  if (edit) {
    return (
      <div className={`secret-line is-edit${s.cardId ? ' has-card' : ''}`}>
        <input className="secret-score" type="number" min={1} max={20} defaultValue={s.score} key={s.score} aria-label="Score (1 to 20)"
          onBlur={(ev) => { const n = clampScore(Number(ev.target.value)); if (n !== s.score) onChange({ score: n }) }} />
        <select value={s.kind} aria-label="Rumour, secret or clue" onChange={(ev) => onChange({ kind: ev.target.value as SecretKind })}>
          {SECRET_KINDS.map((k) => <option key={k} value={k}>{SECRET_LABELS[k]}</option>)}
        </select>
        <CommitField id={`s-${s.id}`} label="Text" value={s.text} required onCommit={(text) => onChange({ text })} />
        <button className="link-button" onClick={() => onChange({ removed: true })}>Move to History</button>
      </div>
    )
  }
  return (
    <div className={`secret-line${open ? ' is-open' : ''}${s.cardId ? ' has-card' : ''}`}>
      <span className="secret-score">{s.score}</span>
      <KindTag kind={s.kind} />
      <span className="secret-text">{s.text}</span>
      {s.cardId && <span className="card-mark">◆ {SECRET_LABELS[s.kind]} card</span>}
    </div>
  )
}

function RoomsPanel({ b, floor, save, price, onPick }: { b: Building; floor: Building['floors'][number]; save(p: Partial<Building>): void; price(cp: number): string; onPick(no: string | undefined): void }) {
  const rooms = live(b.rooms).filter((r) => r.floor === floor.id)
  const rentable = rooms.filter((r) => r.status !== 'closed')
  const set = (id: string, patch: Partial<Room>) => save({ rooms: upd(b.rooms, id, patch) })
  return (
    <section className="panel">
      <div className="panel-head-row">
        <h2 className="panel-heading">Rooms · {floor.name}</h2>
        <span className="hint">{rentable.filter((r) => r.status === 'free').length} free of {rentable.length} to rent</span>
        <button onClick={() => save({ rooms: [...b.rooms, { id: newId(), no: String(live(b.rooms).length + 1), name: 'Private room', price: 80, status: 'free', who: '', floor: floor.id }] })}>+ Room</button>
      </div>
      {rooms.length === 0 ? <p className="hint">No rooms on this floor.</p> : (
        <table className="b-table">
          <thead><tr><th>No.</th><th>Name</th><th>Price</th><th>Here</th><th>Status</th><th>Who / notes</th><th /></tr></thead>
          <tbody>
            {rooms.map((r) => (
              <tr key={r.id} className={`room-row is-${r.status}`} onMouseEnter={() => onPick(r.no)} onMouseLeave={() => onPick(undefined)}>
                <td><input className="room-no" value={r.no} aria-label="Room number" onChange={(ev) => set(r.id, { no: ev.target.value.slice(0, 10) })} /></td>
                <td><CellInput value={r.name} label="Room name" onCommit={(name) => set(r.id, { name })} /></td>
                <td><CellInput value={formatPrice(r.price)} label="Base price" onCommit={(v) => { const n = parsePrice(v); if (n !== null) set(r.id, { price: n }) }} /></td>
                <td className="num">{r.status === 'closed' ? '—' : price(r.price)}</td>
                <td>
                  <select value={r.status} aria-label="Status" onChange={(ev) => set(r.id, { status: ev.target.value as Room['status'] })}>
                    {ROOM_STATUSES.map((st) => <option key={st} value={st}>{ROOM_LABELS[st]}</option>)}
                  </select>
                </td>
                <td><CellInput value={r.who} label="Who or notes" onCommit={(who) => set(r.id, { who })} /></td>
                <td><button className="link-button" aria-label={`Move room ${r.no} to History`} onClick={() => set(r.id, { removed: true })}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="hint">Hover a room to find its label on the layout (label it with the room number). Prices follow Price settings.</p>
      <Removed items={b.rooms} name={(r) => `${r.no} ${r.name}`} onRestore={(id) => set(id, { removed: false })} />
    </section>
  )
}

/** A table cell text input that saves on leaving it. */
function CellInput({ value, label, onCommit }: { value: string; label: string; onCommit(v: string): void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return <input className="cell-input" value={draft} aria-label={label} onChange={(ev) => setDraft(ev.target.value)}
    onBlur={() => { if (draft.trim() !== value) onCommit(draft.trim()) }} onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLElement).blur() }} />
}

function StockPanel({ b, kind, floor, save, price, factor }: { b: Building; kind: BuildingKind; floor: string; save(p: Partial<Building>): void; price(cp: number): string; factor: number }) {
  const items = live(b.stock).filter((s) => s.floor === floor)
  const set = (id: string, patch: Partial<StockItem>) => save({ stock: upd(b.stock, id, patch) })
  const groups = [...new Set(PRICE_LIST.map((p) => p.group))]
  const add = (name: string) => {
    const known = PRICE_LIST.find((p) => p.name === name)
    const have = items.find((s) => s.name === name)
    if (have) set(have.id, { qty: have.qty === null ? null : have.qty + 1 })
    else save({ stock: [...b.stock, { id: newId(), name, notes: known?.notes ?? '', qty: 1, price: known?.cp ?? 0, floor }] })
  }
  const title = kind === 'tavern' ? 'Menu & stock' : kind === 'shop' ? 'Inventory' : 'For sale'
  return (
    <section className="panel">
      <div className="panel-head-row">
        <h2 className="panel-heading">{title}</h2>
        <select className="add-item" value="" aria-label="Add an item" onChange={(ev) => ev.target.value && add(ev.target.value)}>
          <option value="">+ Add item ▾</option>
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {PRICE_LIST.filter((p) => p.group === g).map((p) => <option key={p.name} value={p.name}>{p.name} · {formatPrice(p.cp)}</option>)}
            </optgroup>
          ))}
        </select>
        <button onClick={() => save({ stock: [...b.stock, { id: newId(), name: 'New item', notes: '', qty: 1, price: 100, floor }] })}>+ Own item</button>
      </div>
      {items.length === 0 ? <p className="hint">Nothing here yet. Add items from the list (standard 5e prices) or your own.</p> : (
        <table className="b-table">
          <thead><tr><th>Item</th><th>Notes</th><th>Qty</th><th className="num">Base</th><th className="num">Here ×{factor.toFixed(2)}</th><th /></tr></thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id} className={s.qty === 0 ? 'is-sold-out' : undefined}>
                <td><CellInput value={s.name} label="Item" onCommit={(name) => name && set(s.id, { name })} /></td>
                <td><CellInput value={s.notes} label="Notes" onCommit={(notes) => set(s.id, { notes })} /></td>
                <td className="qty">
                  <button aria-label={`One fewer ${s.name}`} disabled={s.qty === 0} onClick={() => set(s.id, { qty: s.qty === null ? 0 : Math.max(0, s.qty - 1) })}>−</button>
                  <button className="qty-n" title="Click: always in stock / a number" onClick={() => set(s.id, { qty: s.qty === null ? 1 : null })}>{s.qty === null ? '∞' : s.qty}</button>
                  <button aria-label={`One more ${s.name}`} onClick={() => set(s.id, { qty: s.qty === null ? null : s.qty + 1 })}>+</button>
                </td>
                <td className="num"><CellInput value={formatPrice(s.price)} label="Base price" onCommit={(v) => { const n = parsePrice(v); if (n !== null) set(s.id, { price: n }) }} /></td>
                <td className="num">{price(s.price)}</td>
                <td><button className="link-button" aria-label={`Move ${s.name} to History`} onClick={() => set(s.id, { removed: true })}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="hint">Qty 0 keeps the row (sold out); ∞ means always in stock. Type a base price like "15 gp" or "2 sp".</p>
      <Removed items={b.stock} name={(s) => s.name} onRestore={(id) => set(id, { removed: false })} />
    </section>
  )
}

/** Secrets & clues: "In this building" and "All campaign secrets"; right-click moves between them. */
function SecretsFolders({ sheet, b, save, setMenu }: { sheet: SheetView; b: Building; save(p: Partial<Building>): void; setMenu(m: Menu): void }) {
  const { act, query, openSheet } = useBoard()
  const e = sheet.entity
  const [allOpen, setAllOpen] = useState(false)
  const [pool, setPool] = useState<Pool | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  useEffect(() => { if (allOpen) void query('building:secretPool', { buildingId: e.id }).then((p) => setPool(p ?? null)) }, [allOpen, sheet, e.id, query])
  const mine = live(b.secrets).sort(byScore)
  const patron = (id?: string) => b.patrons.find((p) => p.id === id)
  const add = (kind: SecretKind) => { const s: BSecret = { id: newId(), kind, score: DEFAULT_SCORE[kind], text: `New ${SECRET_LABELS[kind].toLowerCase()}` }; save({ secrets: [...b.secrets, s] }); setEditing(s.id) }
  const fromCard = (c: Pool['clueCards'][number]) => save({ secrets: [...b.secrets, { id: newId(), kind: 'clue', score: 15, text: c.text ? `${c.name}: ${c.text}` : c.name, cardId: c.id }] })
  const menuMine = (ev: React.MouseEvent, s: BSecret) => {
    ev.preventDefault()
    setMenu({ x: ev.clientX, y: ev.clientY, items: [
      { label: 'Move to "All campaign secrets"', onClick: () => void act('building:moveSecret', { secretId: s.id, from: e.id, to: null }) },
      { label: 'Give to a patron', items: [{ label: 'No one', onClick: () => save({ secrets: upd(b.secrets, s.id, { patronId: undefined }) }) },
        ...live(b.patrons).map((p) => ({ label: p.name, checked: s.patronId === p.id, onClick: () => save({ secrets: upd(b.secrets, s.id, { patronId: p.id }) }) }))] },
      ...(s.cardId ? [{ label: 'Open card', onClick: () => void openSheet(s.cardId!) }] : []),
      'separator',
      { label: 'Edit', onClick: () => setEditing(s.id) },
      { label: 'Move to History', danger: true, onClick: () => save({ secrets: upd(b.secrets, s.id, { removed: true }) }) }
    ] })
  }
  const menuPool = (ev: React.MouseEvent, items: MenuItem[]) => { ev.preventDefault(); setMenu({ x: ev.clientX, y: ev.clientY, items }) }
  const ownList = pool ? pool.own : []
  const setOwn = (list: BSecret[], label: string) => void act('building:setCampaignSecrets', { list, label })
  return (
    <section className="panel secrets-folders">
      <div className="panel-head-row">
        <h2 className="panel-heading">Secrets &amp; clues</h2>
        <select className="add-item" value="" aria-label="Add a secret or clue" onChange={(ev) => {
          const v = ev.target.value
          if (v === 'all') setAllOpen(true)
          else if (v.startsWith('card:')) { const c = pool?.clueCards.find((x) => x.id === v.slice(5)); if (c) fromCard(c) }
          else if (v) add(v as SecretKind)
        }} onFocus={() => { if (!pool) void query('building:secretPool', { buildingId: e.id }).then((p) => setPool(p ?? null)) }}>
          <option value="">+ Add ▾</option>
          <option value="secret">New secret</option><option value="clue">New clue</option><option value="rumour">New rumour</option>
          {pool && pool.clueCards.length > 0 && (
            <optgroup label="From a Clue card on the board">
              {pool.clueCards.map((c) => <option key={c.id} value={`card:${c.id}`}>{c.name}</option>)}
            </optgroup>
          )}
          <option value="all">From All campaign secrets…</option>
        </select>
      </div>
      <details open className="folder">
        <summary>📂 In this building <span className="hint">({mine.length})</span></summary>
        {mine.length === 0 && <p className="hint">None yet. Add one, or give patrons secrets.</p>}
        <ul className="folder-list">
          {mine.map((s) => (
            <li key={s.id} className={s.cardId ? 'has-card' : undefined} onContextMenu={(ev) => menuMine(ev, s)}>
              <KindTag kind={s.kind} />
              {editing === s.id ? (
                <div className="folder-edit">
                  <SecretLine s={s} roll={b.roll} edit onChange={(patch) => save({ secrets: upd(b.secrets, s.id, patch) })} />
                  <button className="primary" onClick={() => setEditing(null)}>Done</button>
                </div>
              ) : (
                <span>
                  <strong>{s.text}</strong><br />
                  <span className="hint">{patron(s.patronId)?.name ?? 'No patron'}{s.cardId ? ` · ◆ ${SECRET_LABELS[s.kind]} card` : ''} · {isRevealed(s, b.roll) ? 'revealed' : 'hidden'} · {s.score}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
        <Removed items={b.secrets} name={(s) => s.text.slice(0, 60)} onRestore={(id) => save({ secrets: upd(b.secrets, id, { removed: false }) })} />
      </details>
      <details className="folder" open={allOpen} onToggle={(ev) => setAllOpen((ev.target as HTMLDetailsElement).open)}>
        <summary>📁 All campaign secrets {pool && <span className="hint">({live(ownList).length + pool.clueCards.length + pool.elsewhere.length})</span>}</summary>
        {!pool ? <p className="hint">Loading…</p> : (
          <ul className="folder-list">
            {live(ownList).sort(byScore).map((s) => (
              <li key={s.id} onContextMenu={(ev) => menuPool(ev, [
                { label: 'Move to "In this building"', onClick: () => void act('building:moveSecret', { secretId: s.id, from: null, to: e.id }) },
                'separator',
                { label: 'Move to History', danger: true, onClick: () => setOwn(ownList.map((x) => (x.id === s.id ? { ...x, removed: true } : x)), 'Moved a campaign secret to History') }
              ])}>
                <KindTag kind={s.kind} /><span><strong>{s.text}</strong><br /><span className="hint">Campaign · {s.score}</span></span>
              </li>
            ))}
            {pool.clueCards.filter((c) => !b.secrets.some((s) => s.cardId === c.id && !s.removed)).map((c) => (
              <li key={c.id} className="has-card" onContextMenu={(ev) => menuPool(ev, [
                { label: 'Move to "In this building"', onClick: () => fromCard(c) }, { label: 'Open card', onClick: () => void openSheet(c.id) }
              ])}>
                <KindTag kind="clue" /><span><strong>{c.name}</strong><br /><span className="hint">◆ Clue card{c.text ? ` · ${c.text.slice(0, 80)}` : ''}</span></span>
              </li>
            ))}
            {pool.elsewhere.filter((x) => !x.secret.removed).map((x) => (
              <li key={x.secret.id} className={x.secret.cardId ? 'has-card' : undefined} onContextMenu={(ev) => menuPool(ev, [
                { label: 'Move to "In this building"', onClick: () => void act('building:moveSecret', { secretId: x.secret.id, from: x.buildingId, to: e.id }) },
                { label: `Open ${x.buildingName}`, onClick: () => void openSheet(x.buildingId) }
              ])}>
                <KindTag kind={x.secret.kind} /><span><strong>{x.secret.text}</strong><br /><span className="hint">{x.buildingName} · {x.secret.score}</span></span>
              </li>
            ))}
          </ul>
        )}
        {pool && <Removed items={ownList} name={(s) => s.text.slice(0, 60)} onRestore={(id) => setOwn(ownList.map((x) => (x.id === id ? { ...x, removed: false } : x)), 'Brought back a campaign secret')} />}
      </details>
      <p className="hint">Sorted by score. Purple = has its own card. Right-click to move between folders.</p>
    </section>
  )
}

/** Building sheet › Fill with AI: the whole place in one go, as a proposal the DM keeps or not (rules 2, 10). */
export function BuildingFillDialog({ sheet, onClose }: { sheet: SheetView; onClose(): void }) {
  const { refresh, say, setAiSettingsOpen } = useBoard()
  const e = sheet.entity
  const [ask, setAsk] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [answer, setAnswer] = useState<{ proposal: BuildingProposal; source: string } | null>(null)
  const sections = ['description', 'history', 'floors', 'people', 'rooms', 'stock'] as const
  const [keep, setKeep] = useState<Set<string>>(new Set(sections))
  const run = async () => {
    setBusy(true); setError(null)
    try { setAnswer(await call('ai:building', { buildingId: e.id, ask })) } catch (err) { setError((err as Error).message) }
    setBusy(false)
  }
  const use = async () => {
    if (!answer) return
    const cur = readBuilding(e.attributes)
    const p = answer.proposal.building
    // Floors merge by name, so the AI's rooms and people land on the right tab.
    const floors = [...cur.floors]
    const floorId = new Map<string, string>()
    for (const f of p.floors ?? []) {
      const have = floors.find((x) => x.name.toLowerCase() === f.name.toLowerCase() && !x.removed) ?? (f.id === MAIN_FLOOR ? floors.find((x) => x.id === MAIN_FLOOR) : undefined)
      if (have) { floorId.set(f.id, have.id); if (keep.has('floors') && f.layout && isBlank(have.layout)) Object.assign(have, { layout: f.layout }) }
      else if (keep.has('floors')) { floors.push(f); floorId.set(f.id, f.id) }
    }
    const fl = (id: string) => floorId.get(id) ?? MAIN_FLOOR
    const patch: Partial<Building> = { floors }
    if (keep.has('people')) { patch.patrons = [...cur.patrons, ...(p.patrons ?? []).map((x) => ({ ...x, floor: fl(x.floor) }))]; patch.secrets = [...cur.secrets, ...(p.secrets ?? [])] }
    if (keep.has('rooms')) patch.rooms = [...cur.rooms, ...(p.rooms ?? []).map((x) => ({ ...x, floor: fl(x.floor) }))]
    if (keep.has('stock')) patch.stock = [...cur.stock, ...(p.stock ?? [])]
    const aiFilled = { ...((e.attributes.ai_filled as Record<string, string>) ?? {}) }
    const text: Record<string, string> = {}
    for (const k of ['description', 'history'] as const) if (keep.has(k) && answer.proposal[k]) { text[k] = answer.proposal[k]; aiFilled[k] = answer.source }
    try {
      await call('entity:update', { id: e.id, patch: { attributes: { ...buildingAttrs(patch), ...text, ai_filled: aiFilled } } })
      await refresh()
      say(`Filled ${e.name} with the AI's suggestions. Ctrl+Z undoes it all.`)
      onClose()
    } catch (err) { setError((err as Error).message) }
  }
  const p = answer?.proposal
  const toggle = (k: string) => setKeep((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const row = (k: string, title: string, body: ReactNode) => (
    <div className={`fill-row${keep.has(k) ? '' : ' is-off'}`}>
      <label className="field checkbox"><input type="checkbox" checked={keep.has(k)} onChange={() => toggle(k)} /> <strong>{title}</strong></label>
      <div className="fill-body">{body}</div>
    </div>
  )
  return (
    <Dialog title={`Fill with AI: ${e.name}`} open onClose={onClose} wide busy={busy}>
      {!p ? (
        <div className="dz-form">
          <p className="hint">The AI writes the whole {KIND_LABELS[readBuilding(e.attributes).kind].toLowerCase()} in one go: description, history (always how it got its name), floors, the keeper and patrons with scored rumours, secrets and clues tied to your cards, rooms, stock with 5e prices and a rough layout. Nothing changes until you keep it; everything stays editable.</p>
          <div className="field"><label htmlFor="bfill-ask">Anything the AI should know (optional)</label>
            <input id="bfill-ask" value={ask} maxLength={2000} placeholder="A smugglers' den behind a respectable front; grim but with jokes…" onChange={(ev) => setAsk(ev.target.value)} /></div>
          {error && <p className="field-error" role="alert">{error} {/service/i.test(error) && <button className="link-button" onClick={() => setAiSettingsOpen(true)}>Choose one…</button>}</p>}
          <div className="dz-actions">
            <button onClick={onClose}>Cancel</button>
            <button className="primary" disabled={busy} onClick={() => void run()}>{busy ? 'Thinking…' : 'Suggest'}</button>
          </div>
        </div>
      ) : (
        <div className="dz-form ai-proposal">
          <span className="ai-badge">AI suggestion · {answer!.source}</span>
          {row('description', 'Description', <p>{p.description || '—'}</p>)}
          {row('history', 'History', <p>{p.history || '—'}</p>)}
          {row('floors', `Floors and layout (${p.building.floors?.length ?? 1})`, <p>{(p.building.floors ?? []).map((f) => `${f.name}${f.layout ? ' (layout)' : ''}`).join(', ')}</p>)}
          {row('people', `People (${p.building.patrons?.length ?? 0}) and secrets (${p.building.secrets?.length ?? 0})`, (
            <ul>{(p.building.patrons ?? []).map((x) => (
              <li key={x.id}><strong>{x.name}</strong>{x.keeper ? ' (keeper)' : ''} · {x.role}
                <ul>{(p.building.secrets ?? []).filter((s) => s.patronId === x.id).sort(byScore).map((s) => <li key={s.id}>{s.score} · {SECRET_LABELS[s.kind]}: {s.text}</li>)}</ul></li>
            ))}</ul>
          ))}
          {row('rooms', `Rooms (${p.building.rooms?.length ?? 0})`, <p>{(p.building.rooms ?? []).map((r) => `${r.no} ${r.name} ${formatPrice(r.price)} (${ROOM_LABELS[r.status].toLowerCase()})`).join('; ') || '—'}</p>)}
          {row('stock', `Stock (${p.building.stock?.length ?? 0})`, <p>{(p.building.stock ?? []).map((s) => `${s.name} ${formatPrice(s.price)}`).join('; ') || '—'}</p>)}
          <div className="dz-actions">
            <button onClick={() => setAnswer(null)}>Back</button>
            <button disabled={busy} onClick={() => void run()}>{busy ? 'Thinking…' : 'Try again'}</button>
            <button className="primary" disabled={keep.size === 0} onClick={() => void use()}>Keep selected</button>
          </div>
        </div>
      )}
    </Dialog>
  )
}
