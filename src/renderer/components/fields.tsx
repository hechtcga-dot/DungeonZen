import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { LinkField } from './LinkField'

/** A colour picker that saves once, when the picker closes (one undo step, not one per step of the drag). */
export function ColourInput({ id, value, onCommit, label }: { id?: string; value: string; onCommit(colour: string): void; label?: string }) {
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => setDraft(value), [value])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    // The native change event fires when the picker closes; React's onChange fires on every step.
    const done = () => { if (el.value.toLowerCase() !== value.toLowerCase()) onCommit(el.value) }
    el.addEventListener('change', done)
    return () => el.removeEventListener('change', done)
  }, [value, onCommit])
  return <input ref={ref} id={id} type="color" className="colour-input" aria-label={label} value={draft} onChange={(e) => setDraft(e.target.value)} />
}

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
  /** One line only (a plain input): same height and text position as the inputs beside it. */
  line?: boolean
  className?: string
}) {
  // Text boxes of several lines link card names (owner, 2026-10-15).
  if (props.multiline && !props.mono && !props.required) {
    return <LinkField id={props.id} label={props.label} value={props.value} onCommit={props.onCommit} multiline rows={props.rows}
      placeholder={props.placeholder} hint={props.hint} className={props.className} />
  }
  return <PlainField {...props} />
}

function PlainField(props: Parameters<typeof CommitField>[0]) {
  const [draft, setDraft] = useState(props.value)
  useEffect(() => setDraft(props.value), [props.value])
  const commit = () => {
    const next = draft.trim()
    if (props.required && !next) { setDraft(props.value); return }
    if (next !== props.value) props.onCommit(next)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || (!props.multiline && (props.list || props.line)))) { e.preventDefault(); (e.target as HTMLElement).blur() }
    if (e.key === 'Escape') { setDraft(props.value); (e.target as HTMLElement).blur() }
  }
  return (
    <div className={`field${props.className ? ` ${props.className}` : ''}`}>
      <label htmlFor={props.id}>{props.label}</label>
      {props.multiline ? (
        <textarea id={props.id} value={draft} rows={props.rows ?? 5} placeholder={props.placeholder}
          className={props.mono ? 'mono' : 'grow'} style={{ '--rows': props.rows ?? 5 } as CSSProperties}
          onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={onKey} />
      ) : !props.list && !props.line ? (
        // Starts as one line and grows as you type; Enter starts a new line (owner, 2026-10-14), Ctrl+Enter finishes.
        <textarea id={props.id} value={draft} rows={1} placeholder={props.placeholder} className="grow line"
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

/** A name shown as a title that is typed into directly: Enter or clicking away saves, Escape puts it back. */
export function TitleField({ value, onCommit, label, className }: { value: string; onCommit(value: string): void; label: string; className?: string }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => { const next = draft.trim(); if (!next) setDraft(value); else if (next !== value) onCommit(next) }
  return (
    <input className={`title-field${className ? ` ${className}` : ''}`} value={draft} aria-label={label} title="Click to rename" maxLength={200}
      size={Math.max(4, draft.length + 1)} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') { setDraft(value); setTimeout(() => (e.target as HTMLInputElement).blur()) }
      }} />
  )
}
