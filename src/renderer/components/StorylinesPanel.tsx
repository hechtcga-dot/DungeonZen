import { useState, type FormEvent } from 'react'
import { useBoard, useView } from '../store'
import { useBoardPrefs } from '../boardPrefs'
import { roman } from './CardNode'
import { StorylineDialog } from './EditDialogs'
import { MINUTES_PER_DAY } from '../../shared/time'
import type { BoardSummary } from '../../shared/types'

const STORY_STATUS: Record<string, string> = { inactive: 'Not started', autonomous: 'Runs on its own', player_active: 'Players involved', concluded: 'Concluded' }

/**
 * Board › Story: storylines with their colours and acts (the Timeline's acts), which act marks
 * a selected card has, and how storylines show on the cards.
 */
export function StorylinesPanel() {
  const view = useView()
  const { act, showBoard, goTo, selection } = useBoard()
  const prefs = useBoardPrefs()
  const [edit, setEdit] = useState<BoardSummary | null>(null)
  const [title, setTitle] = useState('')
  const [newAct, setNewAct] = useState<{ storylineId: string; title: string } | null>(null)
  const stories = view.boards.filter((b) => b.storylineId && b.storyline)
  const card = selection?.kind === 'entity' ? view.entities[selection.id] : undefined
  const nowMin = useBoard((s) => s.info?.clockMin ?? 0)
  const inStory = (storylineId: string) => Object.values(view.entities).filter((e) => e.storylineIds.includes(storylineId)).length

  const create = async (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    await act('storyline:create', { title: title.trim() })
    setTitle('')
  }
  const addAct = async (e: FormEvent) => {
    e.preventDefault()
    if (!newAct?.title.trim()) return
    // After the storyline's last act, one day long (move it on the Timeline).
    const t = await useBoard.getState().query('timeline:view', undefined)
    const ends = t?.acts.filter((a) => a.storylineId === newAct.storylineId).map((a) => a.plannedEndMin) ?? []
    const after = Math.max(Math.floor(nowMin / MINUTES_PER_DAY) * MINUTES_PER_DAY, ...ends)
    await act('act:create', { storylineId: newAct.storylineId, title: newAct.title.trim(), startMin: after, endMin: after + MINUTES_PER_DAY })
    setNewAct(null)
  }

  return (
    <div className="inspector story-panel">
      <h2 className="panel-heading">Storylines</h2>
      <div className="field checkbox"><input id="st-tint" type="checkbox" checked={prefs.tint} onChange={(e) => prefs.set({ tint: e.target.checked })} />
        <label htmlFor="st-tint">Tint cards with their storyline's colour</label></div>
      <div className="field checkbox"><input id="st-marks" type="checkbox" checked={prefs.actMarks} onChange={(e) => prefs.set({ actMarks: e.target.checked })} />
        <label htmlFor="st-marks">Show act marks (I, II, III) on cards</label></div>
      <p className="hint">A card in several storylines is split diagonally. Cards in no storyline stay plain.</p>

      {card && (
        <section className="story-card">
          <h3 className="panel-subheading">{card.name}: acts</h3>
          {stories.length === 0 && <p className="hint">Make a storyline first.</p>}
          {stories.map((b) => {
            const acts = view.acts.filter((a) => a.storylineId === b.storylineId)
            return (
              <div key={b.id} className="story-card-row">
                <span className="story-dot" style={{ background: b.storyline!.colour ?? 'transparent' }} />
                <strong>{b.name}</strong>
                {acts.length === 0 ? <span className="hint">no acts yet</span> : acts.map((a) => {
                  const on = card.acts.some((m) => m.actId === a.id)
                  return (
                    <label key={a.id} className="act-tick" title={a.title}>
                      <input type="checkbox" checked={on} onChange={() => void act('act:mark', { entityId: card.id, actId: a.id, on: !on })} />
                      {roman(a.number)}
                    </label>
                  )
                })}
              </div>
            )
          })}
        </section>
      )}

      <ul className="story-list">
        {stories.map((b) => {
          const s = b.storyline!
          const acts = view.acts.filter((a) => a.storylineId === b.storylineId)
          return (
            <li key={b.id}>
              <div className="row tight story-head">
                <input type="color" value={s.colour ?? '#8a6a12'} aria-label={`Colour for ${b.name}`}
                  onChange={(e) => void act('storyline:update', { storylineId: b.storylineId!, patch: { colour: e.target.value } })} />
                <button className="link-button story-title" onClick={() => void showBoard(b.id)} title="Open its board">{b.name}</button>
                <button className="link-button" onClick={() => setEdit(b)}>Edit</button>
              </div>
              <div className="hint">{s.isMajor ? 'Major' : 'Minor'} · {STORY_STATUS[s.status]} · {inStory(b.storylineId!)} cards
                {s.colour && <> · <button className="link-button" onClick={() => void act('storyline:update', { storylineId: b.storylineId!, patch: { colour: null } })}>no colour</button></>}</div>
              <ol className="story-acts">
                {acts.map((a) => <li key={a.id}><span className="act-mark" style={{ borderColor: s.colour ?? '#5a4a32', color: s.colour ?? '#5a4a32' }}>{roman(a.number)}</span> {a.title}
                  <span className="hint"> ({Object.values(view.entities).filter((e) => e.acts.some((m) => m.actId === a.id)).length} cards)</span></li>)}
              </ol>
              {newAct?.storylineId === b.storylineId ? (
                <form className="row tight" onSubmit={addAct}>
                  <input autoFocus value={newAct.title} maxLength={200} placeholder="Act title" aria-label="Act title" onChange={(e) => setNewAct({ ...newAct, title: e.target.value })} />
                  <button type="submit" disabled={!newAct.title.trim()}>Add</button>
                  <button type="button" onClick={() => setNewAct(null)}>Cancel</button>
                </form>
              ) : <button className="link-button" onClick={() => setNewAct({ storylineId: b.storylineId!, title: '' })}>+ Act</button>}
            </li>
          )
        })}
      </ul>
      <form className="row tight" onSubmit={create}>
        <input value={title} maxLength={200} placeholder="New storyline" aria-label="New storyline title" onChange={(e) => setTitle(e.target.value)} />
        <button type="submit" disabled={!title.trim()}>Add</button>
      </form>
      <p className="hint">Acts are the Timeline's acts: times, outcomes and triggers are set there. <button className="link-button" onClick={() => goTo('timeline')}>Open the Timeline</button></p>
      {edit && edit.storyline && <StorylineDialog open onClose={() => setEdit(null)} storylineId={edit.storylineId!} detail={edit.storyline} />}
    </div>
  )
}
