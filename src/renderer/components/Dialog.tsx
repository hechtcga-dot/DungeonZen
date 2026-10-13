import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * A modal parchment dialog (native <dialog>: Escape closes it, focus stays inside). The title bar stays
 * at the top while the body scrolls. With `busy` (waiting for an AI service) it can be minimized to a
 * chip in the corner; it pops back up by itself when the wait ends (answer or error).
 */
export function Dialog(props: { title: string; open: boolean; onClose(): void; children: ReactNode; wide?: boolean; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [minimized, setMinimized] = useState(false)
  const hiding = useRef(false)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (props.open && !d.open && !minimized) d.showModal()
    if (!props.open && d.open) d.close()
    if (!props.open) setMinimized(false)
  }, [props.open]) // eslint-disable-line react-hooks/exhaustive-deps
  const minimize = () => { hiding.current = true; setMinimized(true); ref.current?.close() }
  const restore = () => { setMinimized(false); if (props.open && ref.current && !ref.current.open) ref.current.showModal() }
  // The answer (or an error) is in: show the window again.
  useEffect(() => { if (!props.busy && minimized) restore() }, [props.busy]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <dialog ref={ref} className={`dz-dialog${props.wide ? ' wide' : ''}`}
        onClose={() => { if (hiding.current) { hiding.current = false; return } props.onClose() }}
        onCancel={(e) => { e.preventDefault(); props.onClose() }} aria-labelledby="dz-dialog-title">
        {props.open && (
          <>
            <div className="dz-dialog-head">
              <h2 id="dz-dialog-title">{props.title}</h2>
              <span className="row tight">
                {props.busy && <button className="dz-dialog-min" onClick={minimize} title="Keep working; this window comes back when the answer arrives">Minimize</button>}
                <button className="dz-dialog-close" aria-label="Close" onClick={props.onClose}>×</button>
              </span>
            </div>
            <div className="dz-dialog-body">{props.children}</div>
          </>
        )}
      </dialog>
      {props.open && minimized && (
        <button className="dz-dialog-chip" onClick={restore} title="Show the window">
          <span className="dz-dialog-spin" aria-hidden="true">✦</span> {props.title}: waiting for the AI… · Show
        </button>
      )}
    </>
  )
}
