import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

export type MenuItem =
  | { label: string; onClick?(): void; items?: MenuItem[]; checked?: boolean; danger?: boolean; disabled?: boolean; hint?: string }
  | 'separator'

/** A right-click menu at the mouse. Escape, a click elsewhere or choosing an item closes it. */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  useLayoutEffect(() => {
    // Keep the menu on screen.
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    setPos({ x: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)), y: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) })
  }, [x, y])
  useEffect(() => {
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    // Capture phase: the board's pan and zoom stop mouse events before they bubble up to the window.
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key) }
  }, [onClose])
  useEffect(() => { ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus() }, [])
  return (
    <div ref={ref} className="ctx-menu" role="menu" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      <MenuList items={items} onClose={onClose} />
    </div>
  )
}

function MenuList({ items, onClose }: { items: MenuItem[]; onClose(): void }) {
  const [open, setOpen] = useState<number | null>(null)
  return (
    <>
      {items.map((it, i) => it === 'separator' ? <hr key={i} /> : (
        <div key={i} className="ctx-row" onMouseEnter={() => setOpen(it.items ? i : null)}>
          <button role="menuitem" disabled={it.disabled} className={it.danger ? 'is-danger' : undefined} title={it.hint}
            aria-haspopup={it.items ? 'menu' : undefined} aria-expanded={it.items ? open === i : undefined}
            onClick={() => { if (it.items) { setOpen(open === i ? null : i); return } it.onClick?.(); onClose() }}
            onKeyDown={(e) => { if (it.items && e.key === 'ArrowRight') setOpen(i) }}>
            <span className="ctx-check" aria-hidden="true">{it.checked === undefined ? '' : it.checked ? '✓' : ''}</span>
            {it.label}
            {it.items && <span className="ctx-more" aria-hidden="true">▸</span>}
          </button>
          {it.items && open === i && <SubMenu items={it.items} onClose={onClose} />}
        </div>
      ))}
    </>
  )
}

/** A submenu beside its row; opens to the left or moves up when it would leave the window. */
function SubMenu({ items, onClose }: { items: MenuItem[]; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties>({})
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const next: CSSProperties = {}
    if (r.right > window.innerWidth - 4) { next.left = 'auto'; next.right = 'calc(100% - 4px)' }
    if (r.bottom > window.innerHeight - 4) next.top = -6 - (r.bottom - window.innerHeight + 4)
    setStyle(next)
  }, [])
  return (
    <div ref={ref} className="ctx-menu ctx-sub" role="menu" style={style}>
      {items.length ? <MenuList items={items} onClose={onClose} /> : <span className="ctx-empty">Nothing here</span>}
    </div>
  )
}
