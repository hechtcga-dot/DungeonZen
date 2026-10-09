import { useEffect, useMemo, useState } from 'react'
import { call } from '../api'
import { useUnits } from '../store'
import { convertText } from '../../shared/units'
import { Dialog } from './Dialog'
import { xpForCr } from '../../shared/encounter'
import type { SrdMonsterRow } from '../../shared/types'

const SIZES = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan']
const sizeRank = (s: string) => { const i = SIZES.findIndex((x) => s.startsWith(x)); return i < 0 ? 2 : i }
const CRS = ['0', '1/8', '1/4', '1/2', ...Array.from({ length: 30 }, (_, i) => String(i + 1))]
const crNum = (c: string) => (c.includes('/') ? 1 / Number(c.split('/')[1]) : Number(c))
const ALIGN = ['lawful', 'neutral', 'chaotic', 'good', 'evil', 'unaligned', 'any']
type SortKey = 'name' | 'type' | 'size' | 'cr' | 'ac' | 'hp'
let cache: SrdMonsterRow[] | null = null

/**
 * Every SRD monster in one list: search, filter by type, size, CR, alignment and movement,
 * sort by any column, and add any number of each.
 */
export function SrdBrowser({ title, actionLabel, onPick, onClose }: {
  title: string; actionLabel: string; onPick(key: string, count: number, name: string): unknown; onClose(): void
}) {
  const [all, setAll] = useState<SrdMonsterRow[]>(cache ?? [])
  const [q, setQ] = useState('')
  const [type, setType] = useState('')
  const [size, setSize] = useState('')
  const [crMin, setCrMin] = useState('')
  const [crMax, setCrMax] = useState('')
  const [align, setAlign] = useState('')
  const [moves, setMoves] = useState<string[]>([])
  const [legendary, setLegendary] = useState(false)
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'cr', desc: false })
  const [open, setOpen] = useState<string | null>(null)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [added, setAdded] = useState<Record<string, number>>({})

  useEffect(() => { if (!cache) void call('srd:monsters', undefined).then((r) => { cache = r; setAll(r) }) }, [])
  const types = useMemo(() => [...new Set(all.map((m) => m.type).filter(Boolean))].sort(), [all])

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase()
    const list = all.filter((m) =>
      (!t || `${m.name} ${m.type} ${m.alignment}`.toLowerCase().includes(t)) &&
      (!type || m.type === type) &&
      (!size || sizeRank(m.size) === SIZES.indexOf(size)) &&
      (!crMin || m.crNum >= crNum(crMin)) && (!crMax || m.crNum <= crNum(crMax)) &&
      (!align || m.alignment.toLowerCase().includes(align)) &&
      moves.every((w) => m.moves.includes(w as never)) &&
      (!legendary || m.legendary))
    const by: Record<SortKey, (a: SrdMonsterRow, b: SrdMonsterRow) => number> = {
      name: (a, b) => a.name.localeCompare(b.name),
      type: (a, b) => a.type.localeCompare(b.type),
      size: (a, b) => sizeRank(a.size) - sizeRank(b.size),
      cr: (a, b) => a.crNum - b.crNum, ac: (a, b) => a.ac - b.ac, hp: (a, b) => a.hp - b.hp
    }
    return list.sort((a, b) => (sort.desc ? -1 : 1) * (by[sort.key](a, b) || a.name.localeCompare(b.name)))
  }, [all, q, type, size, crMin, crMax, align, moves, legendary, sort])

  const head = (key: SortKey, label: string) => (
    <th scope="col" aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button className="link-button sort-head" onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : false }))}>
        {label}{sort.key === key ? (sort.desc ? ' ▼' : ' ▲') : ''}
      </button>
    </th>
  )
  const clear = () => { setQ(''); setType(''); setSize(''); setCrMin(''); setCrMax(''); setAlign(''); setMoves([]); setLegendary(false) }

  return (
    <Dialog title={title} open onClose={onClose} wide>
      <div className="srd-browser">
        <div className="srd-filters">
          <div className="field"><label htmlFor="sb-q">Search</label>
            <input id="sb-q" autoFocus value={q} placeholder="name, type or alignment" onChange={(e) => setQ(e.target.value)} /></div>
          <div className="field"><label htmlFor="sb-type">Type</label>
            <select id="sb-type" value={type} onChange={(e) => setType(e.target.value)}><option value="">Any</option>{types.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
          <div className="field"><label htmlFor="sb-size">Size</label>
            <select id="sb-size" value={size} onChange={(e) => setSize(e.target.value)}><option value="">Any</option>{SIZES.map((t) => <option key={t}>{t}</option>)}</select></div>
          <div className="field"><label htmlFor="sb-crmin">CR from</label>
            <select id="sb-crmin" value={crMin} onChange={(e) => setCrMin(e.target.value)}><option value="">Any</option>{CRS.map((c) => <option key={c}>{c}</option>)}</select></div>
          <div className="field"><label htmlFor="sb-crmax">CR to</label>
            <select id="sb-crmax" value={crMax} onChange={(e) => setCrMax(e.target.value)}><option value="">Any</option>{CRS.map((c) => <option key={c}>{c}</option>)}</select></div>
          <div className="field"><label htmlFor="sb-align">Alignment</label>
            <select id="sb-align" value={align} onChange={(e) => setAlign(e.target.value)}><option value="">Any</option>{ALIGN.map((a) => <option key={a}>{a}</option>)}</select></div>
        </div>
        <div className="row tight wrap srd-moves">
          {(['fly', 'swim', 'climb', 'burrow'] as const).map((w) => (
            <label key={w} className="act-tick"><input type="checkbox" checked={moves.includes(w)}
              onChange={(e) => setMoves((m) => (e.target.checked ? [...m, w] : m.filter((x) => x !== w)))} />Can {w}</label>
          ))}
          <label className="act-tick"><input type="checkbox" checked={legendary} onChange={(e) => setLegendary(e.target.checked)} />Legendary actions</label>
          <span className="hint">{all.length ? `${rows.length} of ${all.length} monsters` : 'Loading…'}</span>
          <button className="link-button" onClick={clear}>Clear filters</button>
        </div>
        <div className="table-wrap srd-browser-table">
          <table className="srd-table">
            <thead><tr>{head('name', 'Name')}{head('size', 'Size')}{head('type', 'Type')}{head('cr', 'CR')}<th scope="col">XP</th>{head('ac', 'AC')}{head('hp', 'HP')}<th scope="col">How many</th></tr></thead>
            <tbody>
              {rows.map((m) => (
                <SrdRow key={m.key} m={m} open={open === m.key} onToggle={() => setOpen(open === m.key ? null : m.key)}
                  count={counts[m.key] ?? 1} setCount={(n) => setCounts((c) => ({ ...c, [m.key]: n }))} added={added[m.key] ?? 0}
                  actionLabel={actionLabel}
                  onPick={async () => { const n = counts[m.key] ?? 1; await onPick(m.key, n, m.name); setAdded((a) => ({ ...a, [m.key]: (a[m.key] ?? 0) + n })) }} />
              ))}
            </tbody>
          </table>
        </div>
        <div className="dz-actions"><button onClick={onClose}>Done</button></div>
      </div>
    </Dialog>
  )
}

function SrdRow({ m, open, onToggle, count, setCount, added, actionLabel, onPick }: {
  m: SrdMonsterRow; open: boolean; onToggle(): void; count: number; setCount(n: number): void; added: number; actionLabel: string; onPick(): void
}) {
  const units = useUnits()
  return (
    <>
      <tr>
        <th scope="row"><button className="link-button" aria-expanded={open} onClick={onToggle}>{m.name}</button>{m.legendary && <span className="hint"> · legendary</span>}</th>
        <td>{m.size}</td><td>{m.type}</td><td className="mono">{m.cr}</td><td className="mono">{xpForCr(m.cr)}</td><td className="mono">{m.ac}</td><td className="mono">{m.hp}</td>
        <td className="cell-action">
          <span className="row tight">
            <input className="short" type="number" min={1} max={50} value={count} aria-label={`How many ${m.name}`}
              onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} />
            <button onClick={onPick}>{actionLabel}</button>
            {added > 0 && <span className="hint">+{added}</span>}
          </span>
        </td>
      </tr>
      {open && (
        <tr className="srd-detail"><td colSpan={8}>
          <span>{m.alignment}</span> · <span>Speed {convertText(m.speed, units)}</span>{m.senses && <> · <span>{convertText(m.senses, units)}</span></>}
          {m.actions.length > 0 && <div>Actions: {m.actions.join(', ')}</div>}
        </td></tr>
      )}
    </>
  )
}
