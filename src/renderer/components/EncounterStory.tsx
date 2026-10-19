import { useState } from 'react'
import { useBoard } from '../store'
import { call } from '../api'
import { CommitField } from './fields'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { CHECK_SKILLS, emptyStory, itemTree, newRowId, withContents, type EncounterStory } from '../../shared/encounterStory'
import type { EncountersView, EncounterView } from '../../shared/types'

/**
 * Encounters › NPCs, Items on the ground, Checks, Rewards, and Write it up with AI (owner, 2026-10-15). The whole story
 * saves as one value per change (undoable). Items hold items; right-click one to put it on the board as an Item card.
 */
export function EncounterStoryEditor({ e, v }: { e: EncounterView; v: EncountersView }) {
  const { act, openSheet, say } = useBoard()
  const s = e.story
  const save = (next: EncounterStory) => void act('encounter:update', { id: e.id, patch: { story: next } })
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const npcCards = v.fighters.filter((f) => f.type === 'NPC')
  const setNpc = (id: string, p: Partial<EncounterStory['npcs'][number]>) => save({ ...s, npcs: s.npcs.map((n) => (n.id === id ? { ...n, ...p } : n)) })
  const setItem = (id: string, p: Partial<EncounterStory['items'][number]>) => save({ ...s, items: s.items.map((n) => (n.id === id ? { ...n, ...p } : n)) })
  const addItem = (parentId: string | null) => save({ ...s, items: [...s.items, { id: newRowId(), name: '', count: 1, notes: '', parentId, entityId: null }] })
  const removeItem = (id: string) => { const gone = withContents(s.items, id); save({ ...s, items: s.items.filter((x) => !gone.has(x.id)) }) }
  const toCard = async (kind: 'npc' | 'item', rowId: string, name: string) => {
    const id = await act('encounter:storyCard', { encounterId: e.id, kind, rowId })
    if (id) say(kind === 'item' ? `${name || 'The item'} is on the board as an Item card.` : `Made an NPC card for ${name || 'them'}.`)
  }
  const setCheck = (id: string, p: Partial<EncounterStory['checks'][number]>) => save({ ...s, checks: s.checks.map((c) => (c.id === id ? { ...c, ...p } : c)) })
  const secret = (id: string) => v.secrets.find((x) => x.id === id)
  return (
    <>
      <section className="enc-story">
        <h3 className="side-h row tight">NPCs <button className="ink-button icon" aria-label="Add an NPC" title="Add an NPC"
          onClick={() => save({ ...s, npcs: [...s.npcs, { id: newRowId(), name: '', entityId: null, notes: '' }] })}>+</button></h3>
        {s.npcs.length === 0 && <p className="ink-muted">Nobody yet. + adds a card or a one-time NPC.</p>}
        {s.npcs.map((n) => (
          <div key={n.id} className="story-row story-grid">
            {n.entityId && npcCards.some((c) => c.id === n.entityId) ? (
              <select aria-label="NPC card" value={n.entityId} onChange={(ev) => {
                const c = npcCards.find((x) => x.id === ev.target.value)
                setNpc(n.id, c ? { entityId: c.id, name: c.name } : { entityId: null })
              }}>
                {npcCards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                <option value="">One-time NPC (no card)</option>
              </select>
            ) : (
              <span className="story-name">
                <CommitField id={`npc-${n.id}`} label="NPC name" className="label-hidden" value={n.name} placeholder="Name, or pick a card →" onCommit={(name) => setNpc(n.id, { name })} />
                <select aria-label="Pick an NPC card" value="" onChange={(ev) => {
                  const c = npcCards.find((x) => x.id === ev.target.value)
                  if (c) setNpc(n.id, { entityId: c.id, name: c.name })
                }}>
                  <option value="">Card…</option>
                  {npcCards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </span>
            )}
            <CommitField id={`npcn-${n.id}`} label="Notes" className="label-hidden story-wide" value={n.notes} placeholder="Hiding under the cart, wounded" onCommit={(notes) => setNpc(n.id, { notes })} />
            {n.entityId
              ? <button className="ink-button" title="Open the NPC's card" onClick={() => void openSheet(n.entityId!)}>Sheet</button>
              : <button className="ink-button" title="Make an NPC card for them" disabled={!n.name.trim()} onClick={() => void toCard('npc', n.id, n.name)}>Card</button>}
            <button className="ink-button icon" aria-label={`Remove ${n.name || 'this NPC'}`} onClick={() => save({ ...s, npcs: s.npcs.filter((x) => x.id !== n.id) })}>×</button>
          </div>
        ))}
      </section>

      <section className="enc-story">
        <h3 className="side-h row tight">Items on the ground <button className="ink-button icon" aria-label="Add an item" title="Add an item" onClick={() => addItem(null)}>+</button></h3>
        {s.items.length === 0 ? <p className="ink-muted">Nothing yet. + adds an item; “+ inside” puts things in it. Right-click an item to put it on the board.</p>
          : <p className="hint">Right-click an item: Put on the board makes an Item card; the line stays here.</p>}
        {itemTree(s.items).map(({ item: it, depth }) => (
          <div key={it.id} className="story-row story-grid"
            onContextMenu={(ev) => {
              ev.preventDefault()
              setMenu({ x: ev.clientX, y: ev.clientY, items: [
                it.entityId
                  ? { label: 'Open its card', onClick: () => void openSheet(it.entityId!) }
                  : { label: 'Put on the board (Item card)', disabled: !it.name.trim(), onClick: () => void toCard('item', it.id, it.name) },
                { label: 'Add something inside', onClick: () => addItem(it.id) },
                { label: 'Remove (with what is inside)', danger: true, onClick: () => removeItem(it.id) }
              ] })
            }}>
            <span className="story-name" style={{ paddingLeft: depth * 18 }}>
              {depth > 0 && <span className="ink-muted" aria-hidden="true">↳</span>}
              <CommitField id={`it-${it.id}`} label="Item" className="label-hidden" value={it.name} placeholder="Cart, crates of goods, a body…" onCommit={(name) => setItem(it.id, { name })} />
              {it.entityId && <span className="ink-muted" title="Has an Item card">▣</span>}
            </span>
            <input className="short" type="number" min={1} aria-label={`How many: ${it.name}`} defaultValue={it.count} key={`${it.id}-${it.count}`}
              onBlur={(ev) => { const n = Math.max(1, Math.round(Number(ev.target.value) || 1)); if (n !== it.count) setItem(it.id, { count: n }) }} />
            <CommitField id={`itn-${it.id}`} label="Notes" className="label-hidden" value={it.notes} placeholder="Notes" onCommit={(notes) => setItem(it.id, { notes })} />
            <button className="ink-button" title="Put something inside this" onClick={() => addItem(it.id)}>+ inside</button>
            <button className="ink-button icon" aria-label={`Remove ${it.name || 'this item'}`} onClick={() => removeItem(it.id)}>×</button>
          </div>
        ))}
        {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      </section>

      <section className="enc-story">
        <h3 className="side-h">Checks</h3>
        {s.checks.map((c) => (
          <div key={c.id} className="story-check">
            <div className="row tight">
              <select aria-label="Skill" value={c.skill} onChange={(ev) => setCheck(c.id, { skill: ev.target.value })}>
                {[...new Set([...CHECK_SKILLS, c.skill])].map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <span className="spacer" />
              <CheckAi e={e} check={c} onKeep={(tiers) => setCheck(c.id, { tiers })} />
              <button className="ink-button icon" aria-label={`Remove the ${c.skill} check`} onClick={() => save({ ...s, checks: s.checks.filter((x) => x.id !== c.id) })}>×</button>
            </div>
            {c.tiers.map((t, i) => (
              <div key={i} className="story-tier">
                <CommitField id={`dc-${c.id}-${i}`} label="DC" className="label-hidden" value={t.dc} placeholder="DC" onCommit={(dc) => setCheck(c.id, { tiers: c.tiers.map((x, k) => (k === i ? { ...x, dc } : x)) })} />
                <CommitField id={`dct-${c.id}-${i}`} label="What they notice" className="label-hidden" value={t.text} placeholder="What a roll this high finds" onCommit={(text) => setCheck(c.id, { tiers: c.tiers.map((x, k) => (k === i ? { ...x, text } : x)) })} />
                <button className="ink-button icon" aria-label="Remove this result" onClick={() => setCheck(c.id, { tiers: c.tiers.filter((_, k) => k !== i) })}>×</button>
              </div>
            ))}
            <button className="ink-button" onClick={() => setCheck(c.id, { tiers: [...c.tiers, { dc: '', text: '' }] })}>+ Add a result</button>
          </div>
        ))}
        <button className="ink-button" onClick={() => save({ ...s, checks: [...s.checks, { id: newRowId(), skill: s.checks.length ? 'Investigation' : 'Perception', tiers: [{ dc: '10', text: '' }, { dc: '15', text: '' }] }] })}>+ Add a check (Perception, Investigation, Insight…)</button>
      </section>

      <section className="enc-story">
        <h3 className="side-h">Rewards</h3>
        <div className="prep-row-fields two">
          <CommitField id={`rg-${e.id}`} label="Gold" value={s.rewards.gold} placeholder="25 gp + 3 gp on the body" onCommit={(gold) => save({ ...s, rewards: { ...s.rewards, gold } })} />
          <CommitField id={`ri-${e.id}`} label="Items" value={s.rewards.items} placeholder="A share of the goods (5 bottles of fine wine)" onCommit={(items) => save({ ...s, rewards: { ...s.rewards, items } })} />
        </div>
        <span className="field-label">Secret or clue from the campaign</span>
        <div className="row tight wrap">
          {s.rewards.secretIds.map((id) => {
            const x = secret(id)
            return (
              <span key={id} className={`eb-chip t-${x?.kind ?? 'secret'}`}>
                {x ? `${x.kind === 'clue' ? 'Clue' : 'Secret'} · ${x.label.slice(0, 80)}` : 'A removed secret'}
                <button aria-label="Take it off the rewards" onClick={() => save({ ...s, rewards: { ...s.rewards, secretIds: s.rewards.secretIds.filter((y) => y !== id) } })}>×</button>
              </span>
            )
          })}
          <select aria-label="Add a secret or clue" value="" onChange={(ev) => { const id = ev.target.value; if (id) save({ ...s, rewards: { ...s.rewards, secretIds: [...s.rewards.secretIds, id] } }) }}>
            <option value="">{v.secrets.length ? 'Add a secret or clue…' : 'No secrets or clues in the campaign yet'}</option>
            {v.secrets.filter((x) => !s.rewards.secretIds.includes(x.id)).map((x) => <option key={x.id} value={x.id}>{x.kind === 'clue' ? 'Clue' : 'Secret'} · {x.label.slice(0, 90)}</option>)}
          </select>
        </div>
      </section>

      <WriteItUp e={e} />
    </>
  )
}

type Check = EncounterStory['checks'][number]

/** ✦ Build with AI on one check: the AI writes what each DC finds; nothing changes until Keep (rule 2). */
function CheckAi({ e, check, onKeep }: { e: EncounterView; check: Check; onKeep(tiers: Check['tiers']): void }) {
  const { setAiSettingsOpen } = useBoard()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [got, setGot] = useState<{ tiers: Check['tiers']; source: string } | null>(null)
  const run = async () => {
    setBusy(true); setError(null)
    const s = e.story
    const dcs = check.tiers.map((t) => t.dc).filter(Boolean).join(', ') || '10, 15'
    const ask = [
      `Only one thing matters here: write the "${check.skill}" check, one result for each DC (${dcs}), each saying what a roll that high finds or learns in this encounter.`,
      s.npcs.length ? `NPCs: ${s.npcs.map((n) => `${n.name}${n.notes ? ` (${n.notes})` : ''}`).join('; ')}.` : '',
      s.items.length ? `On the ground: ${s.items.map((x) => x.name).filter(Boolean).join(', ')}.` : ''
    ].filter(Boolean).join(' ').slice(0, 2000)
    try {
      const r = await call('ai:writeEncounter', { encounterId: e.id, ask })
      const cs = r?.story.checks ?? []
      const c = cs.find((x) => x.skill.toLowerCase() === check.skill.toLowerCase()) ?? cs[0]
      if (c?.tiers.length) setGot({ tiers: c.tiers, source: r!.source })
      else setError('The AI sent no results for this check. Try again.')
    } catch (err) { setError((err as Error).message) }
    setBusy(false)
  }
  return (
    <>
      <button className="ink-button ai-button" disabled={busy} onClick={() => void run()} title={`The AI writes what each DC of the ${check.skill} check finds`}>
        {busy ? 'Writing…' : '✦ Build with AI'}
      </button>
      {(error || got) && (
        <div className="story-check-ai">
          {error && <p className="field-error" role="alert">{error} {/service/i.test(error) && <button className="link-button" onClick={() => setAiSettingsOpen(true)}>Choose one…</button>}</p>}
          {got && (
            <div className="ai-suggestion" role="region" aria-label={`AI ${check.skill} check`}>
              <span className="ai-badge">AI suggestion · {got.source}</span>
              <ul>{got.tiers.map((t, i) => <li key={i}><strong>{t.dc}:</strong> {t.text}</li>)}</ul>
              <div className="row tight wrap">
                <button className="ink-button primary-ink" onClick={() => { onKeep(got.tiers); setGot(null) }}>Keep (replaces the results)</button>
                <button className="ink-button" disabled={busy} onClick={() => void run()}>Try again</button>
                <button className="ink-button" onClick={() => setGot(null)}>Discard</button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}

/** Write it up with AI: name, scene, NPCs, items, checks and rewards around the creatures; Keep fills the empty parts or replaces everything. */
function WriteItUp({ e }: { e: EncounterView }) {
  const { act, setAiSettingsOpen } = useBoard()
  const [ask, setAsk] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [got, setGot] = useState<Awaited<ReturnType<typeof call<'ai:writeEncounter'>>> | null>(null)
  const run = async () => {
    setBusy(true); setError(null)
    try { setGot(await call('ai:writeEncounter', { encounterId: e.id, ask })) } catch (err) { setError((err as Error).message) }
    setBusy(false)
  }
  const keep = (all: boolean) => {
    if (!got) return
    const s = e.story
    const blankChecks = s.checks.every((c) => c.tiers.every((t) => !t.text.trim()))
    const story: EncounterStory = all ? got.story : {
      npcs: s.npcs.length ? s.npcs : got.story.npcs,
      items: s.items.length ? s.items : got.story.items,
      checks: blankChecks ? got.story.checks : s.checks,
      rewards: {
        gold: s.rewards.gold || got.story.rewards.gold, items: s.rewards.items || got.story.rewards.items,
        secretIds: s.rewards.secretIds.length ? s.rewards.secretIds : got.story.rewards.secretIds
      }
    }
    void act('encounter:update', { id: e.id, patch: {
      story, ...(got.scene && (all || !e.scene.trim()) ? { scene: got.scene } : {}),
      ...(got.name && (all || /^encounter\b/i.test(e.name)) ? { name: got.name } : {})
    } })
    setGot(null)
  }
  const s = got?.story ?? emptyStory()
  return (
    <div className="enc-write">
      <div className="row tight">
        <input aria-label="What the AI should know" value={ask} maxLength={2000} placeholder="Optional: they took the miller's daughter; one goblin should flee to warn the camp" onChange={(ev) => setAsk(ev.target.value)} />
        <button className="ink-button primary-ink" disabled={busy} onClick={() => void run()}>{busy ? 'Writing…' : '✦ Write it up with AI'}</button>
      </div>
      <p className="ink-muted">Fills Name, Scene, NPCs, Items, Checks and Rewards from the creatures, the place and your campaign's secrets.</p>
      {error && <p className="field-error" role="alert">{error} {/service/i.test(error) && <button className="link-button" onClick={() => setAiSettingsOpen(true)}>Choose one…</button>}</p>}
      {got && (
        <div className="ai-suggestion" role="region" aria-label="AI encounter write-up">
          <span className="ai-badge">AI suggestion · {got.source}</span>
          <h4>{got.name || e.name}</h4>
          {got.scene && <p><i>{got.scene}</i></p>}
          {s.npcs.length > 0 && <p><strong>NPCs:</strong> {s.npcs.map((n) => `${n.name}${n.notes ? ` (${n.notes})` : ''}`).join('; ')}</p>}
          {s.items.length > 0 && <p><strong>On the ground:</strong> {itemTree(s.items).map((x) => `${'→ '.repeat(x.depth)}${x.item.name}${x.item.count > 1 ? ` ×${x.item.count}` : ''}`).join(', ')}</p>}
          {s.checks.map((c) => <div key={c.id}><strong>{c.skill}</strong><ul>{c.tiers.map((t, i) => <li key={i}>{t.dc}: {t.text}</li>)}</ul></div>)}
          <p><strong>Rewards:</strong> {[s.rewards.gold, s.rewards.items, s.rewards.secretIds.length ? `${s.rewards.secretIds.length} campaign secret${s.rewards.secretIds.length > 1 ? 's' : ''}` : ''].filter(Boolean).join('; ') || 'none'}</p>
          <div className="row tight wrap">
            <button className="ink-button primary-ink" onClick={() => keep(false)}>Keep (fills the empty boxes)</button>
            <button className="ink-button" onClick={() => keep(true)}>Keep and replace everything</button>
            <button className="ink-button" disabled={busy} onClick={() => void run()}>Try again</button>
            <button className="ink-button" onClick={() => setGot(null)}>Discard</button>
          </div>
        </div>
      )}
    </div>
  )
}
