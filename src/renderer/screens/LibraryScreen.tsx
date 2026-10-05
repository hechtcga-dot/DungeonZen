import { useEffect, useState } from 'react'
import { call } from '../api'
import { useBoard } from '../store'
import { TopBar } from '../components/TopBar'
import { DeskFrame } from '../components/DeskFrame'
import { ENTITY_COLOURS, ENTITY_LABELS } from '../entityStyle'
import { ENTITY_TYPES, type EntityType } from '../../shared/schemas'
import type { LibraryFilters, LibrarySearch, SrdSearch } from '../../shared/types'

// Templates in the order of the Library mockup.
const TEMPLATES: Array<[EntityType, string]> = [
  ['NPC', 'NPC'], ['PC', 'Player character'], ['MONSTER', 'Monster'], ['LOCATION', 'Location or region'],
  ['QUEST', 'Quest'], ['SCENE', 'Scene'], ['CLUE', 'Clue'], ['FACTION', 'Faction'], ['ITEM', 'Item or treasure'],
  ['HANDOUT', 'Letter or bulletin board']
]

type SrdKind = 'monsters' | 'items'

function num(text: string): number | undefined {
  if (!text.trim()) return undefined
  const t = text.trim()
  const frac = /^(\d+)\/(\d+)$/.exec(t)
  const n = frac ? Number(frac[1]) / Number(frac[2]) : Number(t)
  return Number.isFinite(n) ? n : undefined
}

export function LibraryScreen() {
  const { act, openSheet, showOnBoard, say, view, info } = useBoard()
  const [query, setQuery] = useState('')
  const [type, setType] = useState<EntityType | ''>('')
  const [tag, setTag] = useState('')
  const [crMin, setCrMin] = useState('')
  const [crMax, setCrMax] = useState('')
  const [hpMin, setHpMin] = useState('')
  const [hpMax, setHpMax] = useState('')
  const [srdKind, setSrdKind] = useState<SrdKind>('monsters')
  const [campaign, setCampaign] = useState<LibrarySearch | null>(null)
  const [srd, setSrd] = useState<SrdSearch | null>(null)

  // Search as you type (a short pause first), and again after any change (view.undo changes then).
  useEffect(() => {
    const filters: LibraryFilters = {
      query, type: type || undefined, tag: tag || undefined,
      crMin: num(crMin), crMax: num(crMax), hpMin: num(hpMin), hpMax: num(hpMax)
    }
    const t = setTimeout(() => {
      call('library:search', filters).then(setCampaign, (err: Error) => say(err.message, true))
      call('srd:search', { query, kind: srdKind, crMin: filters.crMin, crMax: filters.crMax })
        .then(setSrd, (err: Error) => say(err.message, true))
    }, 150)
    return () => clearTimeout(t)
  }, [query, type, tag, crMin, crMax, hpMin, hpMax, srdKind, view?.undo, say])

  const createFromTemplate = async (t: EntityType, label: string) => {
    if (!info) return
    const e = await act('entity:create', { boardId: info.globalBoardId, type: t, name: `New ${label}` })
    if (e) await openSheet(e.id)
  }

  const addCopy = async (key: string, name: string) => {
    if (!info) return
    const e = await act('srd:addCopy', { key, boardId: info.globalBoardId })
    if (e) say(`Added ${name} to this campaign (a local copy you can edit)`)
  }

  const filtersActive = !!(type || tag || crMin || crMax || hpMin || hpMax)

  return (
    <DeskFrame>
      <TopBar />
      <div className="library">
        <aside className="panel library-templates">
          <h2 className="panel-heading">New from template</h2>
          {TEMPLATES.map(([t, label]) => (
            <button key={t} className="template" onClick={() => void createFromTemplate(t, label)}>
              <span className="swatch" style={{ background: ENTITY_COLOURS[t] }} aria-hidden="true" />{label}
            </button>
          ))}
          <p className="hint">Creates the card on the global board and opens its sheet.</p>
        </aside>

        <main className="library-main">
          <section className="library-search">
            <label htmlFor="lib-search" className="panel-heading">Search everything</label>
            <input id="lib-search" type="search" className="big" value={query} autoFocus
              placeholder="Names, types, tags, abilities, locations, notes" onChange={(e) => setQuery(e.target.value)} />
            <div className="filters">
              <div className="field">
                <label htmlFor="f-type">Type</label>
                <select id="f-type" value={type} onChange={(e) => setType(e.target.value as EntityType | '')}>
                  <option value="">Any</option>
                  {ENTITY_TYPES.map((t) => <option key={t} value={t}>{ENTITY_LABELS[t]}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="f-tag">Tag</label>
                <select id="f-tag" value={tag} onChange={(e) => setTag(e.target.value)}>
                  <option value="">Any</option>
                  {(campaign?.tags ?? []).map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="field range">
                <span className="range-label" id="cr-label">Challenge</span>
                <div className="row tight" role="group" aria-labelledby="cr-label">
                  <input aria-label="Lowest challenge" value={crMin} placeholder="from" onChange={(e) => setCrMin(e.target.value)} />
                  <input aria-label="Highest challenge" value={crMax} placeholder="to" onChange={(e) => setCrMax(e.target.value)} />
                </div>
              </div>
              <div className="field range">
                <span className="range-label" id="hp-label">Hit points</span>
                <div className="row tight" role="group" aria-labelledby="hp-label">
                  <input aria-label="Lowest hit points" value={hpMin} placeholder="from" onChange={(e) => setHpMin(e.target.value)} />
                  <input aria-label="Highest hit points" value={hpMax} placeholder="to" onChange={(e) => setHpMax(e.target.value)} />
                </div>
              </div>
              {filtersActive && (
                <button className="align-end" onClick={() => { setType(''); setTag(''); setCrMin(''); setCrMax(''); setHpMin(''); setHpMax('') }}>
                  Clear filters
                </button>
              )}
            </div>
          </section>

          <section className="panel">
            <h2 className="panel-heading">In this campaign {campaign && `(${campaign.results.length})`}</h2>
            {campaign && campaign.results.length === 0 && (
              <p className="hint">{query || filtersActive ? 'Nothing in this campaign matches.' : 'No cards yet. Make one from a template or add a copy from the SRD below.'}</p>
            )}
            <ul className="results">
              {campaign?.results.map(({ entity: e, line }) => (
                <li key={e.id}>
                  <span className="badge" style={{ background: ENTITY_COLOURS[e.type] }}>{ENTITY_LABELS[e.type].toUpperCase()}</span>
                  <span className="result-name">{e.name}</span>
                  <span className="muted result-line">{line}{e.status === 'resolved' ? ' · Resolved' : ''}</span>
                  <span className="spacer" />
                  <button onClick={() => void openSheet(e.id)}>Open sheet</button>
                  <button onClick={() => void showOnBoard(e.id)}>Show on board</button>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel">
            <div className="row spread wrap">
              <h2 className="panel-heading">SRD 5.2 (2024 rules)</h2>
              <div className="segmented" role="tablist" aria-label="SRD content">
                <button role="tab" aria-selected={srdKind === 'monsters'} aria-pressed={srdKind === 'monsters'} onClick={() => setSrdKind('monsters')}>Monsters</button>
                <button role="tab" aria-selected={srdKind === 'items'} aria-pressed={srdKind === 'items'} onClick={() => setSrdKind('items')}>Items</button>
              </div>
            </div>
            <p className="hint">Built into Dungeon Zen, so it works offline. Add copy puts an editable copy in this campaign.</p>
            {srd && srdKind === 'monsters' && (
              <SrdTable
                shown={srd.monsters.length} total={srd.totalMonsters}
                head={['Name', 'Kind', 'CR', 'AC', 'HP']}
                rows={srd.monsters.map((m) => ({ key: m.key, name: m.name, cells: [m.kind, m.cr, m.ac, m.hp] }))}
                onAdd={addCopy}
              />
            )}
            {srd && srdKind === 'items' && (
              (crMin || crMax)
                ? <p className="hint">Items have no challenge rating; clear the Challenge filter to see them.</p>
                : <SrdTable
                  shown={srd.items.length} total={srd.totalItems}
                  head={['Name', 'Category', 'Rarity']}
                  rows={srd.items.map((i) => ({ key: i.key, name: i.name, cells: [i.category, i.rarity || (i.magic ? '' : 'Mundane')] }))}
                  onAdd={addCopy}
                />
            )}
            {srd && <p className="attribution">{srd.attribution}</p>}
          </section>
        </main>
      </div>
    </DeskFrame>
  )
}

function SrdTable(props: {
  head: string[]
  rows: Array<{ key: string; name: string; cells: string[] }>
  shown: number
  total: number
  onAdd(key: string, name: string): void
}) {
  if (props.rows.length === 0) return <p className="hint">No SRD entries match.</p>
  return (
    <>
      <div className="table-wrap">
        <table className="srd-table">
          <thead>
            <tr>
              {props.head.map((h) => <th key={h} scope="col">{h}</th>)}
              <th scope="col"><span className="visually-hidden">Action</span></th>
            </tr>
          </thead>
          <tbody>
            {props.rows.map((r) => (
              <tr key={r.key}>
                <th scope="row">{r.name}</th>
                {r.cells.map((c, i) => <td key={i} className={i > 0 ? 'mono' : undefined}>{c}</td>)}
                <td className="cell-action"><button onClick={() => props.onAdd(r.key, r.name)}>Add copy</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {props.total > props.shown && <p className="hint">Showing {props.shown} of {props.total}. Type more to narrow the list.</p>}
    </>
  )
}
