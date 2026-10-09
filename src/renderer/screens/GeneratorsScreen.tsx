import { useEffect, useMemo, useState } from 'react'
import { call } from '../api'
import { useBoard } from '../store'
import { DeskFrame } from '../components/DeskFrame'
import { Dialog } from '../components/Dialog'
import { OnTheFly } from './LiveScreen'
import { ENTITY_LABELS } from '../entityStyle'
import { ENTITY_TYPES, type EntityType } from '../../shared/schemas'
import { BUILT_IN_TABLES, dieFor, GENERATOR_GROUPS, parseEntries, rollOn, type RollTable } from '../../shared/rolltables'
import type { IpcOutputs } from '../../shared/ipc'

type Own = IpcOutputs['tables:view'][number]

/**
 * Generators (rail): roll tables for prep and the table. Built-in ones (people, places, treasure,
 * travel, random encounters, dungeons…) and the DM's own (typed or pasted). A result is copied or
 * put on the board as a card; the numbered list is there for rolling in Roll20.
 */
export function GeneratorsScreen() {
  const { act, say, view } = useBoard()
  const [own, setOwn] = useState<Own[]>([])
  const [party, setParty] = useState({ size: 4, level: 1 })
  const [pick, setPick] = useState('npc')
  const [result, setResult] = useState<string | null>(null)
  const [editing, setEditing] = useState<RollTable | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const load = () => void call('tables:view', undefined).then(setOwn).catch(() => setOwn([]))
  useEffect(load, [view?.undo])
  useEffect(() => { void call('encounters:view', undefined).then((v) => setParty({ size: v.party.size, level: v.party.level })).catch(() => undefined) }, [])
  const active = own.filter((x) => x.status === 'active')
  const table = useMemo(() => active.find((x) => x.id === pick) ?? BUILT_IN_TABLES.find((x) => x.id === pick), [active, pick])
  const roll = () => { if (table) setResult(rollOn(table, active)) }
  useEffect(() => setResult(null), [pick])
  const groups = [...new Set([...active.map((x) => x.group), ...GENERATOR_GROUPS])]

  return (
    <DeskFrame>
      <main className="desk generators" aria-label="Generators">
        <header className="desk-head">
          <div className="desk-title"><span className="desk-eyebrow">Roll tables for prep and the table</span><h1>Generators</h1></div>
          <div className="desk-head-actions">
            <button className="brass" onClick={() => setEditing({ id: `own-${Date.now()}`, name: '', group: 'Your tables', card: 'SCENE', entries: [] })}>New table</button>
          </div>
        </header>
        <OnTheFly partySize={party.size} partyLevel={party.level} />
        <div className="gen-layout">
          <nav className="parchment-note gen-list" aria-label="Tables">
            {groups.map((g) => {
              const list = [...active.filter((x) => x.group === g), ...BUILT_IN_TABLES.filter((x) => x.group === g)]
              if (!list.length) return null
              return (
                <details key={g} open={list.some((x) => x.id === pick)}>
                  <summary>{g} <span className="ink-muted">({list.length})</span></summary>
                  <ul>{list.map((x) => (
                    <li key={x.id}><button className={`link-button${x.id === pick ? ' is-current' : ''}`} onClick={() => setPick(x.id)}>{x.name}</button>
                      {active.includes(x as Own) && <span className="ink-muted"> · yours</span>}</li>
                  ))}</ul>
                </details>
              )
            })}
            {own.some((x) => x.status === 'defunct') && (
              <p><button className="link-button" onClick={() => setShowHistory((v) => !v)}>Tables in History ({own.filter((x) => x.status === 'defunct').length})</button></p>
            )}
            {showHistory && <ul>{own.filter((x) => x.status === 'defunct').map((x) => (
              <li key={x.id}>{x.name} <button className="link-button" onClick={() => void act('tables:setStatus', { id: x.id, status: 'active' }).then(load)}>Bring back</button></li>
            ))}</ul>}
          </nav>
          {table && (
            <section className="parchment-sheet gen-main">
              <div className="row spread wrap">
                <h2 className="panel-title">{table.name}</h2>
                <span className="row tight wrap">
                  <button className="ink-button primary-ink" onClick={roll}>Roll</button>
                  {active.some((x) => x.id === table.id) && <>
                    <button className="ink-button" onClick={() => setEditing(table)}>Edit</button>
                    <button className="ink-button danger-ink" onClick={() => void act('tables:setStatus', { id: table.id, status: 'defunct' }).then(() => { load(); setPick('npc') })}>Move to History</button>
                  </>}
                  {!active.some((x) => x.id === table.id) && <button className="ink-button" title="Your own copy to change" onClick={() => setEditing({ ...table, id: `own-${Date.now()}`, name: `${table.name} (mine)`, group: 'Your tables' })}>Copy to my tables</button>}
                </span>
              </div>
              {table.hint && <p className="ink-muted">{table.hint}</p>}
              {result !== null && (
                <div className="gen-result suggestion" role="status">
                  <span className="eyebrow-ink">Rolled · not saved yet</span>
                  <p className="gen-result-text selectable">{result}</p>
                  <div className="row tight wrap">
                    <button className="ink-button" onClick={async () => { try { await navigator.clipboard.writeText(result); say('Copied') } catch { say('Could not copy: select the text instead', true) } }}>Copy</button>
                    <ToBoard text={result} table={table} />
                    <button className="ink-button" onClick={roll}>Roll again</button>
                  </div>
                </div>
              )}
              <h3 className="side-h">{table.entries.length === 1 ? 'Made from these tables' : `The table (${dieFor(table.entries.length)}${table.entries.length !== Number(dieFor(table.entries.length).slice(1)) ? `, ${table.entries.length} entries: reroll above ${table.entries.length}` : ''})`}</h3>
              <ol className="gen-entries">{table.entries.map((e, i) => <li key={i} className="selectable">{e}</li>)}</ol>
              <p className="hint">Words in {'{braces}'} roll on another table. Roll here, or in Roll20 with {dieFor(table.entries.length)} and read the number.</p>
            </section>
          )}
        </div>
      </main>
      {editing && <TableEditor table={editing} onClose={() => setEditing(null)} onSaved={(id) => { load(); setPick(id); setEditing(null) }} />}
    </DeskFrame>
  )
}

function ToBoard({ text, table }: { text: string; table: RollTable }) {
  const { act, say } = useBoard()
  const [type, setType] = useState<EntityType>(table.card)
  useEffect(() => setType(table.card), [table])
  const name = text.split(/[.:;(]/)[0].trim().slice(0, 80) || table.name
  return (
    <span className="row tight">
      <select className="ink-select" aria-label="Card type" value={type} onChange={(e) => setType(e.target.value as EntityType)}>
        {ENTITY_TYPES.map((t) => <option key={t} value={t}>{ENTITY_LABELS[t]}</option>)}
      </select>
      <button className="ink-button primary-ink" onClick={async () => { if (await act('generator:toBoard', { type, name, text })) say(`Put ${name} on the board. Ctrl+Z undoes it.`) }}>Put on the board</button>
    </span>
  )
}

/** Your own table: type entries one per line, or paste a list (numbers and bullets are dropped). */
function TableEditor({ table, onClose, onSaved }: { table: RollTable; onClose(): void; onSaved(id: string): void }) {
  const act = useBoard((s) => s.act)
  const [name, setName] = useState(table.name)
  const [group, setGroup] = useState(table.group)
  const [card, setCard] = useState<EntityType>(table.card)
  const [text, setText] = useState(table.entries.join('\n'))
  const entries = parseEntries(text)
  return (
    <Dialog title={table.name ? `Edit ${table.name}` : 'New roll table'} open onClose={onClose} wide>
      <form className="dz-form" onSubmit={async (e) => {
        e.preventDefault()
        if (!name.trim() || !entries.length) return
        await act('tables:save', { id: table.id, name: name.trim(), group: group.trim() || 'Your tables', card, entries, hint: table.hint })
        onSaved(table.id)
      }}>
        <div className="grid-2">
          <div className="field"><label htmlFor="tb-name">Name</label><input id="tb-name" autoFocus value={name} maxLength={200} onChange={(e) => setName(e.target.value)} placeholder="Harbour rumours" /></div>
          <div className="field"><label htmlFor="tb-group">Group</label><input id="tb-group" value={group} maxLength={80} onChange={(e) => setGroup(e.target.value)} list="tb-groups" />
            <datalist id="tb-groups">{GENERATOR_GROUPS.map((g) => <option key={g} value={g} />)}</datalist></div>
        </div>
        <div className="field"><label htmlFor="tb-card">Put on the board as</label>
          <select id="tb-card" value={card} onChange={(e) => setCard(e.target.value as EntityType)}>{ENTITY_TYPES.map((t) => <option key={t} value={t}>{ENTITY_LABELS[t]}</option>)}</select></div>
        <div className="field"><label htmlFor="tb-entries">Entries, one per line (type or paste; numbers and bullets at the start are dropped)</label>
          <textarea id="tb-entries" rows={12} value={text} onChange={(e) => setText(e.target.value)} placeholder={'1. A fisherman saw lights under the water\n2. The harbour master drinks\n3. A ship is overdue'} /></div>
        <p className="hint">{entries.length} entr{entries.length === 1 ? 'y' : 'ies'} · roll with {dieFor(Math.max(1, entries.length))}. Use {'{npc}'}, {'{weather}'} or another table's id in braces to roll on it.</p>
        <div className="dz-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={!name.trim() || !entries.length}>Save table</button>
        </div>
      </form>
    </Dialog>
  )
}
