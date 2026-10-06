import { useState } from 'react'
import { BackButton } from '../components/BackButton'
import { useBoard } from '../store'
import { DeskFrame } from '../components/DeskFrame'
import { TopBar } from '../components/TopBar'
import { Dialog } from '../components/Dialog'
import { formatClock } from '../../shared/time'
import type { EncounterFeedback, KnowledgeField } from '../../shared/schemas'
import type { ReviewConflict, ReviewProposal, ReviewView, WhatIfView } from '../../shared/types'

const FEEDBACK: Array<[EncounterFeedback, string]> = [
  ['too_easy', 'Too easy'], ['about_right', 'About right'], ['hard', 'Hard'], ['nearly_deadly', 'Nearly deadly']
]
const DECISION_LABELS = { approved: 'Approved', rejected: 'Rejected', flagged: 'Flagged', explained: 'Explained', resolved: 'Resolved' } as const

export function ReviewScreen() {
  const review = useBoard((s) => s.review)
  return (
    <DeskFrame>
      <TopBar />
      {review ? <Review r={review} /> : <p className="desk-loading">Gathering the session…</p>}
    </DeskFrame>
  )
}

function Review({ r }: { r: ReviewView }) {
  const { act, say } = useBoard()
  const [confirmUndo, setConfirmUndo] = useState(false)
  const open = r.proposals.filter((p) => !p.decision && (p.kind !== 'act' || p.outcomeId)).length
  return (
    <>
      <div className="page-head">
        <BackButton />
        <div className="page-title">
          <h1>Session {r.session.number} review</h1>
          <span className="source-tag">{formatClock(r.during.startMin)} to {formatClock(r.during.endMin)} · {r.during.entries} log entr{r.during.entries === 1 ? 'y' : 'ies'}</span>
        </div>
        <button onClick={() => setConfirmUndo(true)}>Undo whole session</button>
        <button className="brass" disabled={open === 0} onClick={async () => {
          const n = await act('review:approveAll', { sessionId: r.session.id })
          if (n) say(`Approved ${n} change${n === 1 ? '' : 's'}`)
        }}>Approve all unflagged{open ? ` (${open})` : ''}</button>
      </div>
      <div className="review-layout">
        <div className="review-main">
          {r.conflicts.map((c, i) => <ConflictCard key={c.key} c={c} n={i + 1} total={r.conflicts.length} sessionId={r.session.id} />)}

          <section className="panel">
            <h2 className="panel-heading">Proposed changes</h2>
            {r.proposals.length === 0 ? <p className="hint">Nothing to approve: no storyline acts ended and nobody new was met.</p> : (
              <div className="table-wrap">
                <table className="proposals">
                  <thead><tr><th scope="col">What</th><th scope="col">Before</th><th scope="col">After</th><th scope="col">Decision</th></tr></thead>
                  <tbody>{r.proposals.map((p) => <ProposalRows key={p.key} p={p} sessionId={r.session.id} />)}</tbody>
                </table>
              </div>
            )}
            <p className="hint">Nothing here has changed your campaign yet. Approve makes it real; every decision can be undone.</p>
          </section>

          <section className="panel">
            <h2 className="panel-heading">Encounter feedback</h2>
            {r.fights.length === 0 ? <p className="hint">No fights were logged this session.</p> : (
              <ul className="fights">
                {r.fights.map((f) => (
                  <li key={f.logId}>
                    <span><strong>{f.text || 'Fight'}</strong> <span className="mono muted">{formatClock(f.atMin)}</span>: how did the party find it?</span>
                    <span className="segmented" role="group" aria-label="Difficulty felt">
                      {FEEDBACK.map(([k, label]) => (
                        <button key={k} aria-pressed={f.feedback === k}
                          onClick={() => void act('review:feedback', { logId: f.logId, feedback: f.feedback === k ? null : k })}>{label}</button>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="hint">The encounter planner will use these ratings to tune future difficulty.</p>
          </section>
        </div>
        <aside className="review-side">
          <Recap r={r} />
        </aside>
      </div>
      {confirmUndo && (
        <Dialog title={`Undo session ${r.session.number}?`} open onClose={() => setConfirmUndo(false)}>
          <div className="dz-form">
            <p>This undoes everything since the session started: the log, hit points, the clock, cards made during play, and the session itself.</p>
            <p className="hint">Redo (Ctrl+Y) brings it all back.</p>
            <div className="dz-actions">
              <button onClick={() => setConfirmUndo(false)}>Keep it</button>
              <button className="primary" onClick={async () => {
                const n = await act('review:undoSession', { sessionId: r.session.id })
                setConfirmUndo(false)
                if (n) say(`Undid ${n} changes`)
              }}>Undo whole session</button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  )
}

function ConflictCard({ c, n, total, sessionId }: { c: ReviewConflict; n: number; total: number; sessionId: string }) {
  const act = useBoard((s) => s.act)
  const [explaining, setExplaining] = useState(false)
  const [note, setNote] = useState(c.decision?.note ?? '')
  const decide = (action: 'revive' | 'remove_entry' | 'flag' | 'explain' | 'reopen', extra: { note?: string } = {}) =>
    void act('review:decide', { sessionId, key: c.key, action, ...extra })
  return (
    <section className={`panel conflict${c.decision ? ' is-decided' : ''}`} aria-label={`Conflict ${n} of ${total}`}>
      <span className="eyebrow-ink conflict-tag">Conflict · {n} of {total}{c.decision ? ` · ${DECISION_LABELS[c.decision.decision]}` : ''}</span>
      <p className="conflict-text">{c.text}</p>
      {c.quote && <blockquote>From your log: “{c.quote}”</blockquote>}
      {c.decision?.note && <p className="hint">Your explanation: {c.decision.note}</p>}
      <div className="row tight wrap">
        {c.options.map((o) => <button key={o.action} className={o.action === 'revive' ? 'primary' : undefined} onClick={() => decide(o.action)}>{o.label}</button>)}
        <button onClick={() => setExplaining((x) => !x)}>Something else: explain</button>
        {c.decision ? <button onClick={() => decide('reopen')}>Reopen</button> : <button onClick={() => decide('flag')}>Leave flagged</button>}
      </div>
      {explaining && (
        <form className="row tight" onSubmit={(e) => { e.preventDefault(); decide('explain', { note }); setExplaining(false) }}>
          <label htmlFor={`exp-${c.key}`} className="visually-hidden">Explanation</label>
          <input id={`exp-${c.key}`} autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="What really happened" />
          <button type="submit" className="primary" disabled={!note.trim()}>Save</button>
        </form>
      )}
    </section>
  )
}

function ProposalRows({ p, sessionId }: { p: ReviewProposal; sessionId: string }) {
  const act = useBoard((s) => s.act)
  const [editing, setEditing] = useState(false)
  const [outcome, setOutcome] = useState(p.kind === 'act' ? p.outcomeId ?? p.outcomes[0]?.id ?? '' : '')
  const [fields, setFields] = useState<KnowledgeField[]>(p.kind === 'knowledge' ? p.fields : [])
  const [preview, setPreview] = useState<WhatIfView | null>(null)
  const d = p.decision
  const approve = (extra: { outcomeId?: string; fields?: KnowledgeField[] } = {}) =>
    void act('review:decide', { sessionId, key: p.key, action: 'approve', ...extra }).then(() => setEditing(false))
  const needsChoice = p.kind === 'act' && !p.outcomeId
  return (
    <>
      <tr className={d ? `is-${d.decision}` : undefined}>
        <th scope="row"><span className="prop-what">{p.what}</span><span className="prop-sub">{p.sub}</span></th>
        <td><s className="prop-before">{p.before}</s></td>
        <td><span className="prop-after">{p.after}</span></td>
        <td>
          {d ? (
            <span className="row tight wrap">
              <span className={`decision-tag d-${d.decision}`}>{DECISION_LABELS[d.decision]}</span>
              {d.decision !== 'approved' && <button onClick={() => void act('review:decide', { sessionId, key: p.key, action: 'reopen' })}>Reopen</button>}
            </span>
          ) : (
            <span className="row tight wrap">
              {!needsChoice && <button className="primary" onClick={() => approve()}>Approve</button>}
              <button onClick={() => setEditing((x) => !x)}>{needsChoice ? 'Choose…' : 'Edit'}</button>
              <button onClick={() => void act('review:decide', { sessionId, key: p.key, action: 'reject' })}>Reject</button>
              <button onClick={() => void act('review:decide', { sessionId, key: p.key, action: 'flag' })}>Flag</button>
            </span>
          )}
        </td>
      </tr>
      {p.kind === 'act' && p.ripples.map((rip) => (
        <tr key={rip} className="ripple"><th scope="row" colSpan={3}><span className="ripple-text">↳ Ripple from the change above · {rip}</span></th><td className="hint">Follows the decision above</td></tr>
      ))}
      {editing && !d && (
        <tr className="edit-row">
          <td colSpan={4}>
            {p.kind === 'act' ? (
              <div className="row tight wrap">
                <label htmlFor={`pick-${p.key}`}>It ended with</label>
                <select id={`pick-${p.key}`} value={outcome} onChange={(e) => { setOutcome(e.target.value); setPreview(null) }}>
                  {p.outcomes.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
                <button className="primary" disabled={!outcome} onClick={() => approve({ outcomeId: outcome })}>Approve this outcome</button>
                <button disabled={!outcome} onClick={async () => { const w = await act('timeline:whatIf', { actId: p.actId, outcomeId: outcome }); if (w) setPreview(w) }}>Preview what-if</button>
              </div>
            ) : (
              <div className="row tight wrap">
                <span>The party now knows:</span>
                {(['name', 'location', 'motivation'] as const).map((f) => (
                  <span key={f} className="field checkbox">
                    <input id={`kf-${p.key}-${f}`} type="checkbox" checked={fields.includes(f)}
                      onChange={(e) => setFields((xs) => e.target.checked ? [...xs, f] : xs.filter((x) => x !== f))} />
                    <label htmlFor={`kf-${p.key}-${f}`}>{f[0].toUpperCase() + f.slice(1)}</label>
                  </span>
                ))}
                <button className="primary" disabled={fields.length === 0} onClick={() => approve({ fields })}>Approve</button>
              </div>
            )}
            {preview && (
              <div className="whatif">
                <strong>What if it ended “{p.kind === 'act' ? p.outcomes.find((o) => o.id === preview.outcomeId)?.label : ''}”</strong>
                {preview.lines.length === 0 ? <p className="hint">Nothing else would change.</p> : <ul>{preview.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

function Recap({ r }: { r: ReviewView }) {
  const { act, say } = useBoard()
  const [playerSafe, setPlayerSafe] = useState(false)
  const s = r.session
  const stored = playerSafe ? s.playerRecap : s.recap
  const [draft, setDraft] = useState(stored)
  const [shown, setShown] = useState({ playerSafe, stored })
  if (shown.playerSafe !== playerSafe || shown.stored !== stored) { setShown({ playerSafe, stored }); setDraft(stored) }
  const save = (text: string) => void act('session:update', { id: s.id, patch: playerSafe ? { playerRecap: text } : { recap: text } })
  return (
    <section className="panel recap">
      <h2 className="panel-heading">Session recap</h2>
      <div className="field checkbox">
        <input id="recap-safe" type="checkbox" checked={playerSafe} onChange={(e) => setPlayerSafe(e.target.checked)} />
        <label htmlFor="recap-safe">Player-safe version (only what the party knows)</label>
      </div>
      <label htmlFor="recap-text" className="visually-hidden">{playerSafe ? 'Player-safe recap' : 'Recap'}</label>
      <textarea id="recap-text" rows={14} value={draft} onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft !== stored) save(draft) }}
        placeholder={playerSafe ? 'Draft one from the log below, then edit it.' : 'What happened this session.'} />
      <div className="row tight wrap">
        {playerSafe && (
          <button onClick={async () => {
            const text = await act('review:draftPlayerRecap', { sessionId: s.id })
            if (text !== undefined) { setDraft(text); save(text) }
          }}>Draft from the log</button>
        )}
        <button onClick={async () => {
          try { await navigator.clipboard.writeText(draft); say('Copied the recap') } catch { say('Could not copy: select the text and copy it instead', true) }
        }}>Copy</button>
        <button onClick={async () => {
          const desk = await act('desk:view', undefined)
          if (!desk) return
          const add = `Session ${s.number} recap\n${draft}`
          await act('notes:set', { text: desk.dmNotes ? `${desk.dmNotes}\n\n${add}` : add })
          say('Added to your DM notes on the desk')
        }}>Save to DM notes</button>
      </div>
      <p className="hint">{playerSafe
        ? 'The draft names only people whose name the party knows; everyone else is "a stranger". Check it before you share it.'
        : 'Started from your log when you ended the session. PDF export comes with the exports.'}</p>
    </section>
  )
}
