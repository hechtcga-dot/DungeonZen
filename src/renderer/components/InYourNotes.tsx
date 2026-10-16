import { useEffect, useState } from 'react'
import { call } from '../api'
import { useBoard } from '../store'
import type { NoteMentionView } from '../../shared/types'

/** Opens the Notes screen at a note's heading (from a sheet, the board panel, Encounters). */
export function openNoteAt(docId: string, heading: number) {
  useBoard.setState({ notesTab: 'notes', notesOpenId: docId, notesOpenHeading: heading })
  useBoard.getState().goTo('import')
}

/** Where this card shows up in the notes files (2.8.0): note › heading, a bit of the text; click opens it there. */
export function InYourNotes({ entityId, heading = 'In your notes' }: { entityId: string; heading?: string }) {
  const stamp = useBoard((s) => s.view?.undo)
  const [list, setList] = useState<NoteMentionView[] | null>(null)
  useEffect(() => { void call('notes:mentions', { entityId }).then(setList).catch(() => setList([])) }, [entityId, stamp])
  if (!list) return null
  return (
    <section className="in-notes" aria-label={heading}>
      <h3 className="side-h">{heading}</h3>
      {list.length === 0 ? <p className="hint">Not named in any notes file yet.</p> : (
        <ul className="ink-list">
          {list.slice(0, 12).map((m, i) => (
            <li key={i}><button className="link-button" onClick={() => openNoteAt(m.docId, m.heading)} title={m.text}>
              {m.title}{m.headingText ? ` › ${m.headingText}` : ''}</button>
              <div className="hint">{m.text}</div></li>
          ))}
          {list.length > 12 && <li className="hint">and {list.length - 12} more (Notes › search)</li>}
        </ul>
      )}
    </section>
  )
}
