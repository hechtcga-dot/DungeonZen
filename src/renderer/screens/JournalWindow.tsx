import { useCallback, useEffect, useRef, useState } from 'react'
import { call } from '../api'

/**
 * The DM notes in a window of their own (Desk › Pop out): drag it to another screen. It writes the
 * same notes as the desk journal (the running session's, else between sessions); both stay in step.
 */
export function JournalWindow() {
  const [text, setText] = useState<string | null>(null)
  const [session, setSession] = useState<number | null>(null)
  const [saved, setSaved] = useState('')
  const typing = useRef(false)
  const load = useCallback(() => {
    if (typing.current) return
    call('desk:view', undefined).then((d) => { setText(d.dmNotes); setSaved(d.dmNotes); setSession(d.dmNotesSession) }).catch(() => setText(null))
  }, [])
  useEffect(() => { load(); return window.dungeonzen.onChanged(load) }, [load])
  useEffect(() => { document.title = `DM notes${session ? ` · Session ${session}` : ''} · Dungeon Zen` }, [session])
  const save = () => {
    typing.current = false
    if (text !== null && text !== saved) void call('notes:set', { text }).then(() => setSaved(text)).catch(() => undefined)
  }
  // Saves a moment after typing stops, as well as when the window loses focus.
  useEffect(() => {
    if (text === null || text === saved) return
    const t = setTimeout(save, 1200)
    return () => clearTimeout(t)
  })
  if (text === null) return <main className="journal-window"><p>Open a campaign in Dungeon Zen first.</p></main>
  return (
    <main className="journal-window">
      <label htmlFor="pop-journal" className="journal-title">DM notes{session ? ` · Session ${session}` : ''}</label>
      <textarea id="pop-journal" value={text} placeholder="Plans, reminders, names you made up on the spot…"
        onChange={(e) => { typing.current = true; setText(e.target.value) }} onBlur={save} />
      <span className="journal-hint">{text === saved ? 'Saved. ' : 'Saving… '}The desk shows the same notes; Ctrl+Z in the main window undoes.</span>
    </main>
  )
}
