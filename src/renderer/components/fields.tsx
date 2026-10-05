import { useEffect, useState, type KeyboardEvent } from 'react'

/** A text field that saves when you leave it or press Enter (one undo step per edit, not per key). */
export function CommitField(props: {
  id: string
  label: string
  value: string
  onCommit(value: string): void
  multiline?: boolean
  placeholder?: string
  hint?: string
  list?: string
  required?: boolean
  rows?: number
  mono?: boolean
  className?: string
}) {
  const [draft, setDraft] = useState(props.value)
  useEffect(() => setDraft(props.value), [props.value])
  const commit = () => {
    const next = draft.trim()
    if (props.required && !next) { setDraft(props.value); return }
    if (next !== props.value) props.onCommit(next)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (!props.multiline || e.ctrlKey)) { e.preventDefault(); (e.target as HTMLElement).blur() }
    if (e.key === 'Escape') { setDraft(props.value); (e.target as HTMLElement).blur() }
  }
  return (
    <div className={`field${props.className ? ` ${props.className}` : ''}`}>
      <label htmlFor={props.id}>{props.label}</label>
      {props.multiline ? (
        <textarea id={props.id} value={draft} rows={props.rows ?? 5} placeholder={props.placeholder}
          className={props.mono ? 'mono' : undefined}
          onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={onKey} />
      ) : (
        <input id={props.id} value={draft} placeholder={props.placeholder} list={props.list}
          onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={onKey} />
      )}
      {props.hint && <div className="hint">{props.hint}</div>}
    </div>
  )
}

/** A whole-number field (for ability scores) that saves on leaving it; out-of-range input snaps back. */
export function ScoreField(props: {
  id: string
  label: string
  value: number
  min: number
  max: number
  note?: string
  onCommit(value: number): void
}) {
  const [draft, setDraft] = useState(String(props.value))
  useEffect(() => setDraft(String(props.value)), [props.value])
  const commit = () => {
    const n = Number(draft)
    if (!Number.isInteger(n) || n < props.min || n > props.max) { setDraft(String(props.value)); return }
    if (n !== props.value) props.onCommit(n)
  }
  return (
    <div className="score">
      <label htmlFor={props.id}>{props.label}</label>
      <input id={props.id} inputMode="numeric" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLElement).blur() }} />
      {props.note && <span className="score-note">{props.note}</span>}
    </div>
  )
}
