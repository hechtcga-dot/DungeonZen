import { Dialog } from './Dialog'

/** Asks which boards win when linking them again: the global board or the storyline boards. */
export function WinnerDialog({ title, text, onChoose, onClose }: { title: string; text: string; onChoose(w: 'global' | 'storyline'): void; onClose(): void }) {
  return (
    <Dialog title={title} open onClose={onClose}>
      <div className="dz-form">
        <p>{text}</p>
        <div className="dz-actions">
          <button onClick={onClose}>Cancel</button>
          <button onClick={() => onChoose('storyline')}>Storyline boards win</button>
          <button className="primary" onClick={() => onChoose('global')}>Global board wins</button>
        </div>
        <p className="hint">Undo puts everything back as it was.</p>
      </div>
    </Dialog>
  )
}
