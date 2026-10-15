/** The one pop-out button everywhere (⧉): opens something in a window of its own (owner, 2026-10-15). */
export function PopOut({ title, onClick }: { title: string; onClick(): void }) {
  return <button type="button" className="ink-button icon pop-out" title={title} aria-label={title} onClick={onClick}>⧉</button>
}
