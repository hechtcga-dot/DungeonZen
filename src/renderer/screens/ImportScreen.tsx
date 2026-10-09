import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { useBoard } from '../store'
import { call } from '../api'
import { DeskFrame } from '../components/DeskFrame'
import { Candle } from '../art/props'
import { useLightingPref } from '../art/TableLighting'
import { lightingAt } from '../../shared/sky'
import { ENTITY_COLOURS, ENTITY_LABELS } from '../entityStyle'
import { providerById } from '../../shared/aiProviders'
import { RELATIONSHIP_TYPES, type EntityType } from '../../shared/schemas'
import { IMPORT_CARD_TYPES, type CardProposal, type ImportDraft, type ImportDraftSummary, type Source } from '../../shared/notesImport'
import type { ImportProgress } from '../../shared/ipc'
import { useSidePanel } from '../components/Splitter'
import { Dialog } from '../components/Dialog'
import { NotesLibrary } from '../components/NotesLibrary'

type Preview = Awaited<ReturnType<typeof call<'import:preview'>>>

const GROUPS: Array<[string, EntityType[]]> = [
  ['People and creatures', ['NPC', 'MONSTER']], ['Places', ['LOCATION']], ['Factions', ['FACTION']],
  ['Quests and clues', ['QUEST', 'CLUE']], ['Items and handouts', ['ITEM', 'HANDOUT']], ['Scenes', ['SCENE']]
]
const LINK_WORDS: Record<string, string> = {
  KNOWS: 'knows', HOSTILE_TO: 'is hostile to', ALLIED_WITH: 'is allied with', LOCATED_AT: 'is at', TIED_TO_QUEST: 'is tied to quest', MEMBER_OF: 'is a member of'
}

/**
 * DM Prep › Notes: every note kept in the campaign (imported files, notes written here, DM notes per
 * session), and Import: the AI reads notes and proposes cards; you choose what to keep (rule 2).
 */
export function ImportScreen() {
  const info = useBoard((s) => s.info)
  const [lighting] = useLightingPref()
  const [draft, setDraft] = useState<ImportDraft | null>(null)
  const [tab, setTab] = useState<'notes' | 'import'>(() => {
    const first = useBoard.getState().notesTab
    useBoard.setState({ notesTab: 'notes' })
    return first
  })
  return (
    <DeskFrame>
      <main className="desk import-screen" aria-label="Notes">
        <header className="desk-head">
          <Candle className="desk-candle" lit={!lighting || lightingAt(info?.clockMin ?? 0).candlesLit} />
          <div className="desk-title">
            <span className="desk-eyebrow">DM prep · your notes; the AI reads, you decide</span>
            <h1>{draft ? `Import: ${draft.title}` : 'Notes'}</h1>
          </div>
          {draft
            ? <div className="desk-head-actions"><button className="brass" onClick={() => setDraft(null)}>Back to notes</button></div>
            : (
              <div className="desk-head-actions segmented" role="tablist" aria-label="Notes">
                <button role="tab" aria-selected={tab === 'notes'} aria-pressed={tab === 'notes'} onClick={() => setTab('notes')}>Your notes</button>
                <button role="tab" aria-selected={tab === 'import'} aria-pressed={tab === 'import'} onClick={() => setTab('import')}>Import notes</button>
              </div>
            )}
        </header>
        {draft ? <Review key={draft.id} initial={draft} onDone={() => setDraft(null)} />
          : tab === 'notes' ? <NotesLibrary onOpen={setDraft} onImport={() => setTab('import')} /> : <Start onOpen={setDraft} />}
      </main>
    </DeskFrame>
  )
}

function Start({ onOpen }: { onOpen(d: ImportDraft): void }) {
  const side = useSidePanel('import-side', 'right', 340)
  const { say, setAiSettingsOpen, aiSettingsOpen } = useBoard()
  const [files, setFiles] = useState<Preview>([])
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [service, setService] = useState<{ name: string; local: boolean } | null | undefined>(undefined)
  const [drafts, setDrafts] = useState<ImportDraftSummary[]>([])
  const [over, setOver] = useState(false)

  const loadDrafts = () => call('import:drafts', undefined).then(setDrafts).catch(() => setDrafts([]))
  useEffect(() => { void loadDrafts() }, [])
  useEffect(() => {
    if (aiSettingsOpen) return
    call('ai:settings', undefined).then((st) => {
      const p = st.text.provider ? providerById(st.text.provider) : undefined
      setService(p ? { name: `${p.name} (${st.text.model})`, local: !!p.local } : null)
    }).catch(() => setService(null))
  }, [aiSettingsOpen])
  useEffect(() => window.dungeonzen.onImportProgress(setProgress), [])

  const add = async (paths: string[]) => {
    const fresh = paths.filter((p) => !files.some((f) => f.path === p))
    if (!fresh.length) return
    const more = await call('import:preview', { paths: fresh }).catch((e) => { say((e as Error).message, true); return [] as Preview })
    setFiles((cur) => [...cur, ...more])
  }
  const drop = (e: DragEvent) => {
    e.preventDefault(); setOver(false)
    const paths = [...e.dataTransfer.files].map((f) => window.dungeonzen.pathForFile(f)).filter(Boolean)
    void add(paths)
  }
  const usable = files.filter((f) => !f.error)
  const requests = usable.reduce((n, f) => n + f.parts, 0)
  const [clash, setClash] = useState<Array<{ id: string; title: string; originalName: string }> | null>(null)
  const read = async (replace?: Record<string, string>) => {
    setClash(null)
    if (!replace) {
      // A note with the same file name: ask whether to replace it or keep both.
      const same = await call('notedoc:named', { names: usable.map((f) => f.name) }).catch(() => [])
      if (same.length) { setClash(same); return }
    }
    setBusy(true); setError(null); setProgress(null)
    try { onOpen(await call('import:read', { paths: usable.map((f) => f.path), title: title || undefined, replace })) } catch (e) { setError((e as Error).message) }
    setBusy(false)
  }
  const replaceAll = () => Object.fromEntries((clash ?? []).flatMap((n) => {
    const f = usable.find((x) => x.name.toLowerCase() === n.originalName.toLowerCase())
    return f ? [[f.path, n.id]] : []
  }))

  return (
    <div className="import-start" style={side.style}>
      <section className={`parchment-sheet import-drop${over ? ' is-over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={drop}>
        <h2 className="panel-title">Drop your notes here</h2>
        <p>Word (.docx), PDF, text or Markdown, and photos or scans of handwritten notes or hand-drawn maps (PNG, JPEG, WebP).
          The files are read on this computer; their text (or the picture) is then sent to your writing AI, part by part.</p>
        <div className="row tight wrap">
          <button className="ink-button primary-ink" onClick={async () => void add(await call('import:chooseFiles', undefined))}>Choose files…</button>
        </div>
        {files.length > 0 && (
          <ul className="import-files">
            {files.map((f) => (
              <li key={f.path} className={f.error ? 'has-error' : undefined}>
                <strong>{f.name}</strong>
                <span className="ink-muted">{f.error ? f.error : `${f.kind}, ${f.parts} part${f.parts === 1 ? '' : 's'}${f.chars ? `, ${f.chars < 1000 ? f.chars : `${Math.round(f.chars / 1000)}k`} characters` : ''}`}</span>
                {f.warnings.map((w) => <span key={w} className="field-error">{w}</span>)}
                <button className="link-button" onClick={() => setFiles((cur) => cur.filter((x) => x.path !== f.path))}>Remove</button>
              </li>
            ))}
          </ul>
        )}
        {usable.length > 0 && (
          <div className="import-go">
            <div className="field"><label htmlFor="imp-title">Name this import</label>
              <input id="imp-title" value={title} maxLength={200} placeholder={usable.length === 1 ? usable[0].name : `${usable.length} files`} onChange={(e) => setTitle(e.target.value)} /></div>
            {service === null ? (
              <p>Reading notes needs a writing AI. <button className="link-button" onClick={() => setAiSettingsOpen(true)}>Choose an AI service…</button></p>
            ) : (
              <>
                <p className="ink-muted">{service?.name ?? '…'} will be asked {requests} time{requests === 1 ? '' : 's'} (one per part).
                  {service && !service.local ? ' Online services charge per use.' : ''}
                  {usable.some((f) => f.kind === 'picture') ? ' Pictures need a model that can see images.' : ''}</p>
                <div className="row tight wrap">
                  <button className="primary" disabled={busy} onClick={() => void read()}>{busy ? 'Reading…' : 'Read and propose cards'}</button>
                  {busy && <button onClick={() => void call('import:cancel', undefined)}>Stop after this part</button>}
                </div>
              </>
            )}
            {busy && progress && <p className="import-progress" role="status">{progress.message}{progress.parts > 1 && <span className="progress-bar"><span style={{ width: `${(progress.part / progress.parts) * 100}%` }} /></span>}</p>}
            {error && <p className="field-error" role="alert">{error}</p>}
          </div>
        )}
        <Dialog title="These notes are already here" open={!!clash} onClose={() => setClash(null)}>
          <p>{clash?.map((n) => n.title).join(', ')} {clash?.length === 1 ? 'is' : 'are'} already in your notes.</p>
          <p className="hint">Replace: the new file becomes the note and the old one stays under Earlier versions (bring it back any time). Keep both: the new file is a separate note.</p>
          <div className="dz-actions">
            <button onClick={() => setClash(null)}>Cancel</button>
            <button onClick={() => void read({})}>Keep both</button>
            <button className="primary" onClick={() => void read(replaceAll())}>Replace</button>
          </div>
        </Dialog>
      </section>
      <aside className="parchment-note import-drafts">
        {side.grip}
        <h2 className="panel-title">Earlier imports</h2>
        {drafts.length === 0 ? <p className="ink-muted">None yet. Each import is kept here until you create the cards or put it aside.</p> : (
          <ul className="here-list">
            {drafts.map((d) => (
              <li key={d.id} className="draft-row">
                <button className="ledger-name" onClick={async () => onOpen(await call('import:draft', { id: d.id }))}>{d.title}</button>
                <span className="ink-muted">{new Date(d.createdAt).toLocaleDateString()} · {d.cards} cards{d.openQuestions ? ` · ${d.openQuestions} open questions` : ''}{d.status === 'committed' ? ' · created' : ''}</span>
                {d.status === 'committed'
                  ? <button className="link-button" title="If you undid the import, open it again to change and create it" onClick={async () => { await call('import:setStatus', { id: d.id, status: 'open' }); void loadDrafts() }}>Open again</button>
                  : <button className="link-button" onClick={async () => { await call('import:setStatus', { id: d.id, status: 'discarded' }); void loadDrafts() }}>Put aside</button>}
              </li>
            ))}
          </ul>
        )}
        <h3 className="side-h">How it works</h3>
        <ul className="ink-list">
          <li>The AI proposes people, places, factions, quests, clues, items, storylines, strings and questions, each with the words it read.</li>
          <li><span className="basis-badge is-guess">AI guess</span> marks anything the notes did not say outright.</li>
          <li>Cards that look like ones you already have can be merged: empty fields are filled, and you tick Replace to change what a card already says.</li>
          <li>Nothing changes until you press Create selected, and one Ctrl+Z takes it all back.</li>
        </ul>
      </aside>
    </div>
  )
}

function Review({ initial, onDone }: { initial: ImportDraft; onDone(): void }) {
  const { say, act, goTo } = useBoard()
  const [d, setD] = useState(initial)
  const [onlyGuesses, setOnlyGuesses] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const readOnly = d.status !== 'open'
  // Every change is saved to the draft (after a short pause).
  const change = (next: ImportDraft) => {
    setD(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void call('import:save', { draft: next }).catch((e) => say((e as Error).message, true)) }, 500)
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const card = (id: string, patch: Partial<CardProposal>) => change({ ...d, cards: d.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)) })
  const nameOf = (id: string) => (id.startsWith('entity:') ? `${d.cards.find((c) => c.duplicateOf?.id === id.slice(7))?.duplicateOf?.name ?? 'a card you have'}` : d.cards.find((c) => c.id === id)?.name ?? '?')
  const skipped = (id: string) => !id.startsWith('entity:') && d.cards.find((c) => c.id === id)?.decision === 'skip'
  const counts = useMemo(() => ({
    create: d.cards.filter((c) => c.decision === 'create').length,
    merge: d.cards.filter((c) => c.decision === 'merge').length,
    stories: d.storylines.filter((s) => s.decision === 'create').length,
    links: d.links.filter((l) => l.decision === 'create' && !skipped(l.fromId) && !skipped(l.toId)).length,
    answered: d.questions.filter((q) => q.status === 'answered').length
  }), [d]) // eslint-disable-line react-hooks/exhaustive-deps

  const commit = async () => {
    if (timer.current) { clearTimeout(timer.current); await call('import:save', { draft: d }) }
    const r = await act('import:commit', { id: d.id })
    if (r) { const n = (k: number, one: string) => `${k} ${one}${k === 1 ? '' : 's'}`
      say(`Created ${n(r.created, 'card')}, merged ${r.merged}, ${n(r.storylines, 'storyline')}, ${n(r.links, 'string')}. Ctrl+Z undoes it all.`); onDone(); goTo('board') }
  }

  const visible = (c: CardProposal) => !onlyGuesses || c.basis === 'inferred'
  return (
    <div className="import-review">
      <div className="parchment-note review-bar">
        <span className="ai-badge">Read by AI · {d.source}</span>
        <span>{d.files.map((f) => `${f.name}${f.error ? ' (failed)' : ''}`).join(', ')}</span>
        {d.files.flatMap((f) => [...f.warnings, ...(f.error ? [f.error] : [])].map((w) => <span key={f.name + w} className="field-error">{f.name}: {w}</span>))}
        {d.dropped > 0 && <span className="ink-muted">{d.dropped} item{d.dropped === 1 ? '' : 's'} the AI sent could not be read and were left out.</span>}
        <label className="field checkbox"><input type="checkbox" checked={onlyGuesses} onChange={(e) => setOnlyGuesses(e.target.checked)} /> Only show AI guesses</label>
        {readOnly && <strong>These cards were created. Open it again from the list only if you undid the import.</strong>}
      </div>

      {GROUPS.map(([title, types]) => {
        const list = d.cards.filter((c) => types.includes(c.type) && visible(c))
        if (!list.length) return null
        return (
          <Section key={title} title={title} count={list.length}>
            {list.map((c) => (
              <article key={c.id} className={`proposal decision-${c.decision}${c.basis === 'inferred' ? ' is-guess' : ''}`}>
                <div className="proposal-head">
                  <select aria-label={`What to do with ${c.name}`} value={c.decision} disabled={readOnly} onChange={(e) => card(c.id, { decision: e.target.value as CardProposal['decision'] })}>
                    <option value="create">Create new card</option>
                    {c.duplicateOf && <option value="merge">Merge into “{c.duplicateOf.name}”</option>}
                    <option value="skip">Skip</option>
                  </select>
                  <select aria-label="Card type" value={c.type} disabled={readOnly} onChange={(e) => card(c.id, { type: e.target.value as EntityType })}
                    style={{ borderLeft: `6px solid ${ENTITY_COLOURS[c.type]}` }}>
                    {IMPORT_CARD_TYPES.map((t) => <option key={t} value={t}>{ENTITY_LABELS[t]}</option>)}
                  </select>
                  <input aria-label="Name" className="proposal-name" value={c.name} disabled={readOnly} onChange={(e) => card(c.id, { name: e.target.value })} />
                  <Basis basis={c.basis} />
                </div>
                {c.duplicateOf && (
                  <p className="dup-note">{c.duplicateOf.exact ? 'Already in the campaign' : 'Looks like'} “{c.duplicateOf.name}” ({c.duplicateOf.type.toLowerCase()}).
                    {c.decision === 'merge' ? ' Merging fills its empty fields and adds the quotes; tick Replace below to change what it already says.' : ''}</p>
                )}
                <input aria-label="Summary" className="proposal-summary" value={c.summary} placeholder="One line" disabled={readOnly} onChange={(e) => card(c.id, { summary: e.target.value })} />
                {c.decision === 'merge' && c.duplicateOf && <Compare c={c} readOnly={readOnly} onChange={(overwrite) => card(c.id, { overwrite })} />}
                <div className="proposal-details">
                  {Object.entries(c.details).map(([k, v]) => (
                    <label key={k}>
                      <span>{k}</span>
                      <input value={v} disabled={readOnly} onChange={(e) => card(c.id, { details: { ...c.details, [k]: e.target.value } })} />
                      <button className="link-button" disabled={readOnly} aria-label={`Remove ${k}`} onClick={() => { const n = { ...c.details }; delete n[k]; card(c.id, { details: n }) }}>×</button>
                    </label>
                  ))}
                </div>
                <Sources sources={c.sources} />
              </article>
            ))}
          </Section>
        )
      })}

      {d.storylines.length > 0 && (
        <Section title="Storylines" count={d.storylines.length}>
          {d.storylines.map((s) => (
            <article key={s.id} className={`proposal decision-${s.decision}${s.basis === 'inferred' ? ' is-guess' : ''}`}>
              <div className="proposal-head">
                <label className="field checkbox"><input type="checkbox" checked={s.decision === 'create'} disabled={readOnly}
                  onChange={(e) => change({ ...d, storylines: d.storylines.map((x) => (x.id === s.id ? { ...x, decision: e.target.checked ? 'create' : 'skip' } : x)) })} /> Create</label>
                <input aria-label="Storyline title" className="proposal-name" value={s.title} disabled={readOnly}
                  onChange={(e) => change({ ...d, storylines: d.storylines.map((x) => (x.id === s.id ? { ...x, title: e.target.value } : x)) })} />
                <Basis basis={s.basis} />
              </div>
              {s.summary && <p className="ink-muted">{s.summary}</p>}
              {s.acts.length > 0 && <ol className="acts-list">{s.acts.map((a, i) => <li key={i}><strong>{a.title}</strong>{a.summary ? `: ${a.summary}` : ''}</li>)}</ol>}
              {s.cardIds.length > 0 && <p className="ink-muted">Cards: {s.cardIds.map(nameOf).join(', ')}</p>}
              <Sources sources={s.sources} />
            </article>
          ))}
          <p className="hint">Acts are placed one day apart from now on the Timeline; move them there.</p>
        </Section>
      )}

      {d.links.length > 0 && (
        <Section title="Strings between cards" count={d.links.length}>
          {d.links.map((l) => {
            const off = skipped(l.fromId) || skipped(l.toId)
            return (
              <article key={l.id} className={`proposal link-row decision-${off ? 'skip' : l.decision}${l.basis === 'inferred' ? ' is-guess' : ''}`}>
                <div className="proposal-head">
                  <input type="checkbox" aria-label="Create this string" checked={l.decision === 'create' && !off} disabled={readOnly || off}
                    onChange={(e) => change({ ...d, links: d.links.map((x) => (x.id === l.id ? { ...x, decision: e.target.checked ? 'create' : 'skip' } : x)) })} />
                  <strong>{nameOf(l.fromId)}</strong>
                  <select aria-label="String type" value={l.type} disabled={readOnly} onChange={(e) => change({ ...d, links: d.links.map((x) => (x.id === l.id ? { ...x, type: e.target.value } : x)) })}>
                    {RELATIONSHIP_TYPES.filter((t) => t !== 'BOARD_LINK').map((t) => <option key={t} value={t}>{LINK_WORDS[t] ?? t}</option>)}
                  </select>
                  <strong>{nameOf(l.toId)}</strong>
                  <label className="field checkbox"><input type="checkbox" checked={l.secret} disabled={readOnly}
                    onChange={(e) => change({ ...d, links: d.links.map((x) => (x.id === l.id ? { ...x, secret: e.target.checked } : x)) })} /> Secret</label>
                  <Basis basis={l.basis} />
                </div>
                {off && <p className="ink-muted">Left out: one end is skipped.</p>}
                <Sources sources={l.sources} />
              </article>
            )
          })}
        </Section>
      )}

      {d.questions.length > 0 && (
        <Section title="Questions for you" count={d.questions.filter((q) => q.status === 'open').length}>
          {d.questions.map((q) => {
            const set = (patch: Partial<typeof q>) => change({ ...d, questions: d.questions.map((x) => (x.id === q.id ? { ...x, ...patch } : x)) })
            return (
              <article key={q.id} className={`proposal question q-${q.status}`}>
                <p><strong>{q.text}</strong>{q.aboutId ? <span className="ink-muted"> (about {nameOf(q.aboutId)})</span> : null}</p>
                {q.options.length > 0 && <div className="row tight wrap">{q.options.map((o) => <button key={o} className="ink-button" disabled={readOnly} onClick={() => set({ answer: o, status: 'answered' })}>{o}</button>)}</div>}
                <div className="row tight">
                  <input aria-label="Your answer" value={q.answer} placeholder="Your answer (saved in the DM notes of the card it is about)" disabled={readOnly}
                    onChange={(e) => set({ answer: e.target.value, status: e.target.value.trim() ? 'answered' : 'open' })} />
                  <button className="ink-button" disabled={readOnly} onClick={() => set({ status: q.status === 'deferred' ? 'open' : 'deferred' })}>{q.status === 'deferred' ? 'Undefer' : 'Later'}</button>
                </div>
              </article>
            )
          })}
        </Section>
      )}

      {d.cards.length === 0 && d.storylines.length === 0 && <p className="parchment-note">The AI found nothing to propose in these notes.</p>}

      {!readOnly && (
        <div className="commit-bar">
          <span>{counts.create} new card{counts.create === 1 ? '' : 's'}, {counts.merge} merge{counts.merge === 1 ? '' : 's'}, {counts.stories} storyline{counts.stories === 1 ? '' : 's'}, {counts.links} string{counts.links === 1 ? '' : 's'}{counts.answered ? `, ${counts.answered} answer${counts.answered === 1 ? '' : 's'} to notes` : ''}</span>
          <button onClick={onDone}>Save for later</button>
          <button className="primary" disabled={counts.create + counts.merge + counts.stories + counts.links === 0} onClick={() => void commit()}>Create selected</button>
        </div>
      )}
    </div>
  )
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="parchment-sheet import-section" aria-label={title}>
      <h2 className="panel-title">{title} <span className="ink-muted">({count})</span></h2>
      {children}
    </section>
  )
}

function Basis({ basis }: { basis: 'stated' | 'inferred' }) {
  return basis === 'stated'
    ? <span className="basis-badge" title="The notes say this outright">Stated</span>
    : <span className="basis-badge is-guess" title="The AI guessed this; the notes do not say it outright">AI guess</span>
}

function Sources({ sources }: { sources: Source[] }) {
  if (!sources.length) return null
  return (
    <div className="sources">
      {sources.slice(0, 4).map((s, i) => (
        <blockquote key={i} className={s.basis === 'inferred' ? 'is-guess' : undefined}>
          {s.quote ? `“${s.quote}”` : <em>No quote given</em>}
          <cite>{s.file}, {s.locator}</cite>
        </blockquote>
      ))}
      {sources.length > 4 && <p className="ink-muted">and {sources.length - 4} more places</p>}
    </div>
  )
}

/**
 * Merging into a card you have: what the card says now beside what the notes say. Fields the card
 * already has stay unless ticked "Replace" (for notes you changed); empty ones are filled.
 */
function Compare({ c, readOnly, onChange }: { c: CardProposal; readOnly: boolean; onChange(overwrite: string[]): void }) {
  const existing = useBoard((s) => (c.duplicateOf ? s.view?.entities[c.duplicateOf.id] : undefined))
  if (!existing) return null
  const now = (k: string) => (typeof existing.attributes[k] === 'string' ? (existing.attributes[k] as string).trim() : '')
  const differs = [['summary', c.summary], ...Object.entries(c.details)].filter(([k, v]) => v.trim() && now(k) && now(k) !== v.trim())
  if (!differs.length) return <p className="ink-muted compare-note">Every field it fills is empty on “{existing.name}” now.</p>
  const over = new Set(c.overwrite ?? [])
  return (
    <table className="compare">
      <thead><tr><th>Field</th><th>“{existing.name}” now</th><th>Your notes say</th><th>Replace</th></tr></thead>
      <tbody>
        {differs.map(([k, v]) => (
          <tr key={k}>
            <td>{k}</td><td>{now(k)}</td><td>{v}</td>
            <td><input type="checkbox" aria-label={`Replace ${k}`} checked={over.has(k)} disabled={readOnly}
              onChange={(e) => { const n = new Set(over); if (e.target.checked) n.add(k); else n.delete(k); onChange([...n]) }} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
