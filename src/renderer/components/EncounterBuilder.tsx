import { useEffect, useState } from 'react'
import { useBoard } from '../store'
import { useTypeColour } from '../entityStyle'
import { call } from '../api'
import { itemTree } from '../../shared/encounterStory'
import type { EncounterDraft, EncountersView } from '../../shared/types'

export const CREATURE_TYPES = ['', 'aberration', 'beast', 'celestial', 'construct', 'dragon', 'elemental', 'fey', 'fiend', 'giant', 'humanoid', 'monstrosity', 'ooze', 'plant', 'undead']
const CUSTOM = '__custom'

/**
 * Build an encounter (owner, 2026-10-15), on Live and on Encounters: where (the party's place by default, any place
 * from the map or a typed one), difficulty, creature type, the DM's own cards to include and a description for the AI.
 * Suggest = an offline themed roll; Build with AI = creatures and story. Nothing is saved until Put on the board / Save for later.
 */
export function EncounterBuilder({ className, onKept }: { className: string; onKept(id: string, name: string, stash: boolean): void }) {
  const typeColour = useTypeColour()
  const { act, setAiSettingsOpen } = useBoard()
  const undo = useBoard((s) => s.view?.undo)
  const [v, setV] = useState<EncountersView | null>(null)
  const [difficulty, setDifficulty] = useState<'low' | 'moderate' | 'high'>('moderate')
  const [ctype, setCtype] = useState('')
  const [where, setWhere] = useState('')
  const [custom, setCustom] = useState('')
  const [include, setInclude] = useState<Array<{ entityId: string; count: number }>>([])
  const [description, setDescription] = useState('')
  const [draft, setDraft] = useState<EncounterDraft | null>(null)
  const [busy, setBusy] = useState<'roll' | 'ai' | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { void call('encounters:view', undefined).then(setV).catch(() => setV(null)) }, [undo])
  if (!v) return <div className={className}><strong>Suggest an encounter</strong></div>
  const ask = {
    difficulty, creatureType: ctype || undefined, include,
    place: where === CUSTOM ? (custom.trim() ? { custom: custom.trim() } : { locationId: null }) : { locationId: where || null }
  }
  const run = async (kind: 'roll' | 'ai') => {
    setBusy(kind); setError(null)
    try {
      const d = kind === 'roll' ? await call('encounter:roll', ask) : await call('ai:draftEncounter', { ...ask, description })
      if (d) setDraft(d)
      else setError('No themed group fits that place, type and budget. Try another type or difficulty.')
    } catch (e) { setError((e as Error).message) }
    setBusy(null)
  }
  const keep = async (stash: boolean) => {
    if (!draft) return
    const id = await act('encounter:keepDraft', { draft, stash })
    if (id) { onKept(id, draft.name, stash); setDraft(null) }
  }
  const fighter = (id: string) => v.fighters.find((f) => f.id === id)
  return (
    <div className={`${className} enc-builder`}>
      <h2 className="panel-title">Suggest an encounter</h2>
      <div className="row tight">For {v.party.size} characters of level
        <input aria-label="Party level" className="tiny" type="number" min={1} max={20} defaultValue={v.party.level} key={v.party.level}
          onBlur={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1 && n <= 20 && n !== v.party.level) void act('party:setLevel', { level: n }) }} /></div>
      <span className="ink-muted eb-adapt">{v.adaptation.explain}</span>
      <label className="field-label" htmlFor="eb-where">Where</label>
      <select id="eb-where" className="ink-select" value={where} onChange={(e) => setWhere(e.target.value)}>
        <option value="">{v.partyPlace ? `${v.partyPlace.name} (party location)` : 'Where the party is (not placed)'}</option>
        {v.places.filter((p) => p.id !== v.partyPlace?.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        <option value={CUSTOM}>Custom location…</option>
      </select>
      {where === CUSTOM && <input aria-label="Custom location" value={custom} maxLength={200} placeholder="Open field, mountain region, abandoned village…" onChange={(e) => setCustom(e.target.value)} />}
      <div className="row tight wrap">
        <select aria-label="Difficulty" className="ink-select" value={difficulty} onChange={(e) => setDifficulty(e.target.value as typeof difficulty)}>
          <option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option>
        </select>
        <select aria-label="Creature type" className="ink-select" value={ctype} onChange={(e) => setCtype(e.target.value)}>
          {CREATURE_TYPES.map((t) => <option key={t} value={t}>{t ? t[0].toUpperCase() + t.slice(1) : 'Any creature'}</option>)}
        </select>
      </div>
      <label className="field-label" htmlFor="eb-include">Include these cards</label>
      {include.length > 0 && (
        <div className="row tight wrap">
          {include.map((i) => {
            const f = fighter(i.entityId)
            return f && (
              <span key={i.entityId} className="eb-chip" style={{ '--c': typeColour(f.type) } as React.CSSProperties}>
                {f.type === 'NPC' ? 'NPC' : 'Monster'} · {f.name}
                <input aria-label={`How many ${f.name}`} type="number" min={1} max={100} value={i.count}
                  onChange={(e) => setInclude(include.map((x) => (x.entityId === i.entityId ? { ...x, count: Math.max(1, Number(e.target.value) || 1) } : x)))} />
                <button aria-label={`Leave out ${f.name}`} onClick={() => setInclude(include.filter((x) => x.entityId !== i.entityId))}>×</button>
              </span>
            )
          })}
        </div>
      )}
      <select id="eb-include" className="ink-select" value="" onChange={(e) => { const id = e.target.value; if (id && !include.some((x) => x.entityId === id)) setInclude([...include, { entityId: id, count: 1 }]) }}>
        <option value="">Add an NPC or monster card…</option>
        {v.fighters.filter((f) => !include.some((x) => x.entityId === f.id)).map((f) => <option key={f.id} value={f.id}>{f.name}{f.cr ? ` (CR ${f.cr})` : ''}</option>)}
      </select>
      <label className="field-label" htmlFor="eb-desc">What happens here (for the AI)</label>
      <textarea id="eb-desc" rows={3} value={description} maxLength={4000} placeholder="Goblins have ambushed the miller's cart; they took his daughter…" onChange={(e) => setDescription(e.target.value)} />
      <div className="row tight wrap">
        <button className="ink-button" disabled={!!busy} onClick={() => void run('roll')}>{busy === 'roll' ? 'Rolling…' : 'Suggest'}</button>
        <button className="ink-button primary-ink" disabled={!!busy} onClick={() => void run('ai')}>{busy === 'ai' ? 'Building…' : '✦ Build with AI'}</button>
      </div>
      {error && <p className="field-error" role="alert">{error} {/service/i.test(error) && <button className="link-button" onClick={() => setAiSettingsOpen(true)}>Choose one…</button>}</p>}
      {draft && <DraftView d={draft} again={() => void run(draft.source ? 'ai' : 'roll')} keep={(s) => void keep(s)} discard={() => setDraft(null)} busy={!!busy} />}
    </div>
  )
}

function DraftView({ d, again, keep, discard, busy }: { d: EncounterDraft; again(): void; keep(stash: boolean): void; discard(): void; busy: boolean }) {
  const s = d.story
  return (
    <div className={d.source ? 'ai-suggestion eb-draft' : 'eb-draft suggestion'} role="region" aria-label="Suggested encounter">
      {d.source ? <span className="ai-badge">AI suggestion · {d.source}</span> : <span className="eyebrow-ink">Suggested · not saved yet</span>}
      <h3>{d.name}</h3>
      <span className="ink-muted">{d.difficulty[0].toUpperCase() + d.difficulty.slice(1)} · {d.totalXp} of {d.budget} XP</span>
      <ul>
        {d.groups.map((g) => <li key={g.key}>{g.count} × {g.name} <span className="ink-muted">(CR {g.cr}){g.notes ? `: ${g.notes}` : ''}</span></li>)}
        {d.include.map((i) => <li key={i.entityId}>{i.count} × {i.name} <span className="ink-muted">(your card{i.cr ? `, CR ${i.cr}` : ''})</span></li>)}
      </ul>
      {d.scene && <p><i>{d.scene}</i></p>}
      {s && (
        <div className="eb-story">
          {s.npcs.length > 0 && <p><strong>NPCs:</strong> {s.npcs.map((n) => n.name).join(', ')}</p>}
          {s.items.length > 0 && <p><strong>On the ground:</strong> {itemTree(s.items).map((x) => `${'→ '.repeat(x.depth)}${x.item.name}${x.item.count > 1 ? ` ×${x.item.count}` : ''}`).join(', ')}</p>}
          {s.checks.filter((c) => c.tiers.some((t) => t.text)).map((c) => <p key={c.id}><strong>{c.skill}:</strong> {c.tiers.map((t) => t.dc).join(' / ')}</p>)}
          {(s.rewards.gold || s.rewards.items || s.rewards.secretIds.length > 0) && <p><strong>Rewards:</strong> {[s.rewards.gold, s.rewards.items, s.rewards.secretIds.length ? `${s.rewards.secretIds.length} campaign secret${s.rewards.secretIds.length > 1 ? 's' : ''}` : ''].filter(Boolean).join('; ')}</p>}
        </div>
      )}
      <div className="row tight wrap">
        <button className="ink-button primary-ink" onClick={() => keep(false)}>Put on the board</button>
        <button className="ink-button" onClick={() => keep(true)}>Save for later</button>
        <button className="ink-button" disabled={busy} onClick={again}>{d.source ? 'Build again' : 'Roll again'}</button>
        <button className="ink-button" onClick={discard}>Discard</button>
      </div>
      <span className="ink-muted">Opens in Encounters with everything editable{d.source ? '' : '; Write it up with AI there adds NPCs, items, checks and rewards'}.</span>
    </div>
  )
}
