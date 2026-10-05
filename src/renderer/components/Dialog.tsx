import { useEffect, useRef, type ReactNode } from 'react'

/** A modal parchment dialog (native <dialog>: Escape closes it, focus stays inside). */
export function Dialog(props: { title: string; open: boolean; onClose(): void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (props.open && !d.open) d.showModal()
    if (!props.open && d.open) d.close()
  }, [props.open])
  return (
    <dialog ref={ref} className={`dz-dialog${props.wide ? ' wide' : ''}`} onClose={props.onClose}
      onCancel={(e) => { e.preventDefault(); props.onClose() }} aria-labelledby="dz-dialog-title">
      {props.open && (
        <>
          <div className="dz-dialog-head">
            <h2 id="dz-dialog-title">{props.title}</h2>
            <button className="dz-dialog-close" aria-label="Close" onClick={props.onClose}>×</button>
          </div>
          <div className="dz-dialog-body">{props.children}</div>
        </>
      )}
    </dialog>
  )
}
