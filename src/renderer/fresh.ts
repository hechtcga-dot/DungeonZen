import { call } from './api'
import { useBoard } from './store'

// Things made empty by a New… / Add button (a card, a board note, a prep row) are dropped for good when the DM
// moves away without putting anything in them: no History, no change log (owner, 2026-10-16). The main side
// checks nothing touched them; this side says when "away" happens.
const fresh = new Map<string, { keep: (target?: Element) => boolean; what: string }>()

function drop(id: string) {
  const what = fresh.get(id)?.what ?? 'item'
  fresh.delete(id)
  // A little later, so a name typed and committed on the same click lands first (and keeps the thing).
  // The note's Undo puts it back as it was (3.0, owner: the DM never loses something by surprise).
  setTimeout(() => void call('blank:discard', { id }).then((gone) => {
    if (!gone) return
    void useBoard.getState().refresh()
    useBoard.getState().say(`Empty ${what} removed`, false, { label: 'Undo', run: () => void call('blank:restore', { id }).then(() => useBoard.getState().refresh()) })
  }).catch(() => undefined), 500)
}
function sweep(target?: Element) { for (const [id, f] of fresh) if (!f.keep(target)) drop(id) }

/** A new card: kept while its sheet is open or it is the selected card. */
export function freshCard(id: string) {
  fresh.set(id, { what: 'card', keep: () => { const s = useBoard.getState(); return (s.screen === 'sheet' && s.sheetId === id) || s.selection?.id === id } })
}
/** A new board note: kept while it is selected. */
export function freshNote(id: string) {
  fresh.set(id, { what: 'note', keep: () => useBoard.getState().selection?.id === id })
}
/** A new prep row (`data-row` on its element): kept until a click lands outside it or the screen changes. */
export function freshRow(id: string) {
  const screen = useBoard.getState().screen
  fresh.set(id, { what: 'row', keep: (target) => useBoard.getState().screen === screen &&
    (!target || !!target.closest(`[data-row="${id}"], dialog, .dz-dialog, .ctx-menu, [role="menu"]`)) })
}

useBoard.subscribe(() => sweep())
document.addEventListener('pointerdown', (e) => { if (fresh.size) sweep(e.target instanceof Element ? e.target : undefined) }, true)
