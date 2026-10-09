import { useState } from 'react'
import { call } from '../api'
import { useBoard } from '../store'
import { CharSheetDialog } from './CharSheetDialog'
import { ContextMenu } from './ContextMenu'
import type { NoteDocView } from '../../shared/types'

/**
 * Import a character sheet (PDF, pictures, Word or text): the files are copied into the campaign's
 * notes, then the AI reads them into a new PC card (or one you have) after you review it.
 */
export function ImportCharSheet({ className = 'ink-button', label = 'Import a character sheet…', targetId }: { className?: string; label?: string; targetId?: string }) {
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
      {open && first && <CharSheetDialog doc={first} docs={open.docs} ids={open.ids} targetId={targetId} onClose={() => setOpen(null)} />}
    </>
  )
}

/** On a character's sheet: re-import its sheet file, or read the notes files again with AI, onto this card. */
export function SheetFileMenu({ entityId, name }: { entityId: string; name: string }) {
  const act = useBoard((s) => s.act)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [open, setOpen] = useState<{ ids?: string[]; docs: NoteDocView[] } | null>(null)
  const reread = async () => {
    const { docs } = await call('notes:screen', undefined)
    if (!docs.length) return void act('charsheet:importDialog', undefined).then(async (ids) => { if (ids?.length) setOpen({ ids, docs: (await call('notes:screen', undefined)).docs }) })
    setOpen({ docs })
  }
  const reimport = async () => {
    const ids = await act('charsheet:importDialog', undefined)
    if (ids?.length) setOpen({ ids, docs: (await call('notes:screen', undefined)).docs })
  }
  // The file that matches the card's name opens ticked (else the newest).
  const first = open && (open.docs.find((d) => d.id === open.ids?.[0]) ?? open.docs.find((d) => d.title.toLowerCase().includes(name.toLowerCase().split(' ')[0])) ?? open.docs[0])
  return (
    <>
      <button aria-haspopup="menu" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4 }) }}>Character sheet file ▾</button>
      {menu && <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[
        { label: 'Re-import the character sheet…', hint: 'PDF, picture, Word or text: the AI reads it onto this card', onClick: () => void reimport() },
        { label: 'Read the files again with AI…', hint: 'Choose notes files already in the campaign', onClick: () => void reread() }
      ]} />}
      {open && first && <CharSheetDialog doc={first} docs={open.docs} ids={open.ids} targetId={entityId} onClose={() => setOpen(null)} />}
    </>
  )
}
