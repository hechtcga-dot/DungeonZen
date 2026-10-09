import { useState } from 'react'
import { call } from '../api'
import { useBoard } from '../store'
import { CharSheetDialog } from './CharSheetDialog'
import type { NoteDocView } from '../../shared/types'

/**
 * Import a character sheet (PDF, pictures, Word or text): the files are copied into the campaign's
 * notes, then the AI reads them into a new PC card (or one you have) after you review it.
 */
export function ImportCharSheet({ className = 'ink-button', label = 'Import a character sheet…' }: { className?: string; label?: string }) {
  const act = useBoard((s) => s.act)
  const [open, setOpen] = useState<{ ids: string[]; docs: NoteDocView[] } | null>(null)
  const pick = async () => {
    const ids = await act('charsheet:importDialog', undefined)
    if (!ids?.length) return
    const { docs } = await call('notes:screen', undefined)
    setOpen({ ids, docs })
  }
  const first = open?.docs.find((d) => d.id === open.ids[0])
  return (
    <>
      <button className={className} title="PDF (also fillable D&D sheets), pictures, Word or text: the AI makes a character card you check first" onClick={() => void pick()}>{label}</button>
      {open && first && <CharSheetDialog doc={first} docs={open.docs} ids={open.ids} onClose={() => setOpen(null)} />}
    </>
  )
}
