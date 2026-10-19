import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { noteDoc, entity, knowledge, partyPosition,   relationship, relationshipKnown, session, sessionPrep, prepItem, type EntityRow } from '../db/schema'
import type { EntityType,   RowStatus } from '../../shared/schemas'
import { formatClock } from '../../shared/time'
import { readStatBlock, statLine } from '../../shared/statblock'
import type { PlayersView,   NoteDocView, NotesScreenView, NoteMeta } from '../../shared/types'
import { skyAt } from '../../shared/sky'
import { part } from './part'
import { ASSETS_DIR, STYLE_EXTENSIONS, storedExt, noteKind, SettingKey } from './common'

export const notesPart = part({
  // ---- Notes screen: notes files (imported or written here) and session notes

  notesScreen(): NotesScreenView {
    const open = this.openSession()
    return {
      // A note whose file is gone (Delete file for good, then an undo past it) is not shown.
      docs: this.db.select().from(noteDoc).where(eq(noteDoc.status, 'active')).all().filter((r) => existsSync(join(this.folder, ASSETS_DIR, r.file)))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((r) => ({ id: r.id, title: r.title, kind: r.kind as NoteDocView['kind'], originalName: r.originalName, updatedAt: r.updatedAt, versions: r.versions, folder: r.folder, meta: this.noteMetas()[r.id] ?? {} })),
      sessions: (() => {
        const preps = new Map(this.db.select().from(sessionPrep).where(eq(sessionPrep.status, 'active')).all().map((p) => [p.number, p]))
        return this.db.select().from(session).where(eq(session.status, 'active')).all()
          .sort((a, b) => b.number - a.number)
          .map((r) => ({ id: r.id, number: r.number, startedAt: r.startedAt, running: r.id === open?.id, dmNotes: r.dmNotes, recap: r.recap, title: preps.get(r.number)?.title ?? '', playDate: preps.get(r.number)?.playDate ?? null }))
      })(),
      dmNotes: String(this.setting('dm_notes') ?? ''),
      starred: this.starredNotes(),
      folders: this.allNoteFolders(),
      folderLinks: this.folderLinks()
    }
  },

  /** Folders the DM made (paths "A/B/C"; 2.8.0), kept even when empty. */
  madeFolders(): string[] {
    const v = this.setting('notes_folders')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  },

  folderLinks(): Record<string, string> {
    const v = this.setting('note_folder_links')
    return v && typeof v === 'object' ? v as Record<string, string> : {}
  },

  /** Every folder: the ones made, and every folder (and parent) a note sits in. */
  allNoteFolders(): string[] {
    const out = new Set<string>()
    const add = (p: string) => { const parts = p.split('/'); for (let i = 1; i <= parts.length; i++) out.add(parts.slice(0, i).join('/')) }
    for (const f of this.madeFolders()) if (f) add(f)
    for (const r of this.db.select().from(noteDoc).where(eq(noteDoc.status, 'active')).all()) if (r.folder) add(r.folder)
    return [...out]
  },

  /**
   * Notes folders (2.8.0, owner): make, rename or move (a new path; notes and folders inside go along), delete (its notes
   * go to History), link to a card. One undo step each.
   */
  noteFolder(a: { action: 'create'; path: string } | { action: 'rename'; from: string; to: string } | { action: 'delete'; path: string } | { action: 'link'; path: string; card: string | null }): void {
    const within = (f: string, p: string) => f === p || f.startsWith(`${p}/`)
    const set = (w: Parameters<Parameters<typeof this.log.run>[1]>[0], key: SettingKey, value: unknown) => {
      if (w.get('campaign_settings', key)) w.update('campaign_settings', key, { value }); else w.insert('campaign_settings', { key, value })
    }
    const made = this.madeFolders(), links = this.folderLinks()
    const docs = this.db.select().from(noteDoc).where(eq(noteDoc.status, 'active')).all()
    const name = (p: string) => p.split('/').pop()
    if (a.action === 'create') {
      if (this.allNoteFolders().includes(a.path)) return
      this.log.run(`New notes folder ${name(a.path)}`, (w) => set(w, 'notes_folders', [...made, a.path]))
    } else if (a.action === 'rename') {
      if (a.from === a.to || within(a.to, a.from)) return
      const move = (f: string) => (within(f, a.from) ? a.to + f.slice(a.from.length) : f)
      this.log.run(name(a.from) === name(a.to) ? `Moved the folder ${name(a.from)}` : `Renamed the folder ${name(a.from)} to ${name(a.to)}`, (w) => {
        for (const r of docs) if (r.folder && within(r.folder, a.from)) w.update('note_doc', r.id, { folder: move(r.folder) })
        set(w, 'notes_folders', [...new Set([...made.map(move), a.to])])
        set(w, 'note_folder_links', Object.fromEntries(Object.entries(links).map(([k, v]) => [move(k), v])))
      })
    } else if (a.action === 'delete') {
      const gone = docs.filter((r) => r.folder && within(r.folder, a.path))
      this.log.run(`Deleted the folder ${name(a.path)}${gone.length ? ` (${gone.length} notes to History)` : ''}`, (w) => {
        for (const r of gone) w.update('note_doc', r.id, { status: 'defunct' })
        set(w, 'notes_folders', made.filter((f) => !within(f, a.path)))
        set(w, 'note_folder_links', Object.fromEntries(Object.entries(links).filter(([k]) => !within(k, a.path))))
      })
    } else {
      const next = { ...links }
      if (a.card) next[a.path] = a.card; else delete next[a.path]
      this.log.run(a.card ? `Linked the folder ${name(a.path)} to a card` : `Unlinked the folder ${name(a.path)}`, (w) => set(w, 'note_folder_links', next))
    }
  },

  /** Notes linked to this card: by the note itself, or by a folder it sits in. */
  notesLinkedTo(entityId: string): string[] {
    const folders = Object.entries(this.folderLinks()).filter(([, v]) => v === entityId).map(([k]) => k)
    const metas = this.noteMetas()
    return this.db.select().from(noteDoc).where(eq(noteDoc.status, 'active')).all()
      .filter((r) => metas[r.id]?.card === entityId || folders.some((f) => r.folder === f || r.folder.startsWith(`${f}/`))).map((r) => r.id)
  },

  /** The folder linked to this card ('' = none): where its new notes go. */
  folderOfCard(entityId: string): string {
    return Object.entries(this.folderLinks()).find(([, v]) => v === entityId)?.[0] ?? ''
  },

  noteMetas(): Record<string, NoteMeta> {
    const v = this.setting('note_meta')
    return v && typeof v === 'object' ? v as Record<string, NoteMeta> : {}
  },

  /** Notes book view (2.8.0): banner, pictures taken out or moved, names not offered as cards; undoable. */
  setNoteMeta(id: string, meta: NoteMeta): void {
    const r = this.noteRow(id)
    this.setSetting('note_meta', { ...this.noteMetas(), [id]: meta }, `Changed the pictures of the note ${r.title}`)
  },

  starredNotes(): string[] {
    const v = this.setting('notes_starred')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  },

  starNote(id: string, on: boolean): void {
    const r = this.noteRow(id)
    const rest = this.starredNotes().filter((x) => x !== id)
    this.setSetting('notes_starred', on ? [...rest, id] : rest, `${on ? 'Starred' : 'Unstarred'} the note ${r.title}`)
  },

  /** A picture the DM chose for a note (copied into the campaign). */
  addNotePicture(sourceFile: string): string {
    const ext = extname(sourceFile).toLowerCase()
    if (!STYLE_EXTENSIONS.includes(ext)) throw new Error(`A picture must be PNG, JPEG or WebP (got ${ext || 'no extension'})`)
    const rel = `notes/pictures/${randomUUID()}${storedExt(ext)}`
    mkdirSync(join(this.folder, ASSETS_DIR, 'notes', 'pictures'), { recursive: true })
    copyFileSync(sourceFile, join(this.folder, ASSETS_DIR, rel))
    return rel
  },

  /** Session prep sheets saved as this note. */
  prepsOfNote(id: string): Array<{ number: number; title: string }> {
    return this.db.select().from(sessionPrep).where(eq(sessionPrep.status, 'active')).all().filter((p) => p.noteDocId === id)
      .map((p) => ({ number: p.number, title: p.title }))
  },

  setSessionNotes(id: string, text: string): void {
    const r = this.sessionRow(id)
    this.log.run(`Edited the notes of session ${r.number}`, (w) => { w.update('session', id, { dmNotes: text }) })
  },

  noteRow(id: string) {
    const r = this.db.select().from(noteDoc).where(eq(noteDoc.id, id)).get()
    if (!r) throw new Error('That note is gone')
    return r
  },

  /** The note's current file on disk. */
  noteFile(id: string): string {
    return join(this.folder, ASSETS_DIR, this.noteRow(id).file)
  },

  /** Copies a file into the notes folder (never changed after; a save writes a new one). */
  storeNoteFile(from: { file: string } | { bytes: Buffer; ext: string }): string {
    const ext = 'file' in from ? extname(from.file).toLowerCase() : from.ext
    const rel = `notes/${randomUUID()}${storedExt(ext)}`
    mkdirSync(join(this.folder, ASSETS_DIR, 'notes'), { recursive: true })
    if ('file' in from) copyFileSync(from.file, join(this.folder, ASSETS_DIR, rel))
    else writeFileSync(join(this.folder, ASSETS_DIR, rel), from.bytes)
    return rel
  },

  /** Keeps a notes file (from an import or Word). With `replaceId`, it becomes that note's new version. */
  addNoteDoc(sourceFile: string, replaceId?: string): string {
    const ext = extname(sourceFile).toLowerCase()
    const kind = noteKind(ext)
    const rel = this.storeNoteFile({ file: sourceFile })
    const now = new Date().toISOString()
    if (replaceId) {
      const r = this.noteRow(replaceId)
      this.log.run(`Replaced the note ${r.title}`, (w) => {
        w.update('note_doc', r.id, { file: rel, kind, updatedAt: now, versions: [{ file: r.file, at: r.updatedAt }, ...r.versions].slice(0, 50) })
      })
      return r.id
    }
    const id = randomUUID()
    const title = basename(sourceFile, extname(sourceFile))
    this.log.run(`Kept the notes file ${basename(sourceFile)}`, (w) => {
      w.insert('note_doc', { id, title, kind, file: rel, originalName: basename(sourceFile), versions: [], status: 'active', createdAt: now, updatedAt: now })
    })
    return id
  },

  createNoteDoc(title: string, bytes: Buffer, folder = '', card?: string): string {
    const rel = this.storeNoteFile({ bytes, ext: '.docx' })
    const id = randomUUID()
    const now = new Date().toISOString()
    this.log.run(`New note ${title}`, (w) => {
      w.insert('note_doc', { id, title, kind: 'word', file: rel, originalName: `${title}.docx`, versions: [], folder, status: 'active', createdAt: now, updatedAt: now })
      if (card) {
        const value = { ...this.noteMetas(), [id]: { card } }
        if (w.get('campaign_settings', 'note_meta')) w.update('campaign_settings', 'note_meta', { value }); else w.insert('campaign_settings', { key: 'note_meta', value })
      }
    })
    return id
  },

  /** Saves a new version of a note as a Word file (one undo step; the old version stays listed). */
  saveNoteVersion(id: string, bytes: Buffer, label = 'Saved the note'): void {
    const r = this.noteRow(id)
    const rel = this.storeNoteFile({ bytes, ext: '.docx' })
    this.log.run(`${label} ${r.title}`, (w) => {
      w.update('note_doc', id, { file: rel, kind: 'word', updatedAt: new Date().toISOString(), versions: [{ file: r.file, at: r.updatedAt }, ...r.versions].slice(0, 50) })
    })
  },

  /** Brings an earlier version back (the current one joins the earlier versions). */
  restoreNoteVersion(id: string, file: string): void {
    const r = this.noteRow(id)
    const v = r.versions.find((x) => x.file === file)
    if (!v) throw new Error('That version is gone')
    this.log.run(`Brought back an earlier version of ${r.title}`, (w) => {
      w.update('note_doc', id, {
        file: v.file, kind: noteKind(extname(v.file)), updatedAt: new Date().toISOString(),
        versions: [{ file: r.file, at: r.updatedAt }, ...r.versions.filter((x) => x.file !== file)]
      })
    })
  },

  renameNoteDoc(id: string, title: string): void {
    const r = this.noteRow(id)
    this.log.run(`Renamed note ${r.title} to ${title}`, (w) => { w.update('note_doc', id, { title }) })
  },

  setNoteDocStatus(id: string, status: RowStatus): void {
    const r = this.noteRow(id)
    this.log.run(status === 'defunct' ? `Moved note ${r.title} to History` : `Restored note ${r.title}`, (w) => { w.update('note_doc', id, { status }) })
  },

  /** Puts notes files in a folder of the Notes list ('' = no folder). One undo step. */
  setNoteFolder(ids: string[], folder: string): void {
    const rows = ids.map((id) => this.noteRow(id))
    this.log.run(folder ? `Moved ${rows.length === 1 ? rows[0].title : `${rows.length} notes`} to the folder ${folder}` : 'Took notes out of their folder', (w) => {
      for (const r of rows) w.update('note_doc', r.id, { folder })
    })
  },

  /** A copy of a notes file (its current version) as a new note. */
  duplicateNoteDoc(id: string): string {
    const r = this.noteRow(id)
    const rel = this.storeNoteFile({ file: join(this.folder, ASSETS_DIR, r.file) })
    const nid = randomUUID()
    const now = new Date().toISOString()
    this.log.run(`Copied the note ${r.title}`, (w) => {
      w.insert('note_doc', { ...r, id: nid, title: `${r.title} (copy)`, file: rel, versions: [], createdAt: now, updatedAt: now })
    })
    return nid
  },

  /** Combine: a new note (Word) from several; the originals stay or go to History. One undo step. */
  combineNoteDocs(title: string, bytes: Buffer, ids: string[], removeOriginals: boolean): string {
    const rows = ids.map((id) => this.noteRow(id))
    const rel = this.storeNoteFile({ bytes, ext: '.docx' })
    const id = randomUUID()
    const now = new Date().toISOString()
    this.log.run(`Combined ${rows.length} notes into ${title}`, (w) => {
      w.insert('note_doc', { id, title, kind: 'word', file: rel, originalName: `${title}.docx`, versions: [], folder: rows[0]?.folder ?? '', status: 'active', createdAt: now, updatedAt: now })
      if (removeOriginals) for (const r of rows) w.update('note_doc', r.id, { status: 'defunct' })
    })
    return id
  },

  /**
   * History › Delete file for good (owner, 1.7.0): forgets a note that is in History and returns its files
   * (every version) for the Recycle Bin. Not undoable on purpose; the DM confirmed first.
   */
  forgetNoteDoc(id: string): string[] {
    const r = this.noteRow(id)
    if (r.status !== 'defunct') throw new Error('Move the note to History first')
    this.db.delete(noteDoc).where(eq(noteDoc.id, id)).run()
    return [r.file, ...r.versions.map((v) => v.file)].map((f) => join(this.folder, ASSETS_DIR, f))
  },

  /** Notes whose original file has the same name (asked before an import: replace or keep both). */
  noteDocsNamed(names: string[]): Array<{ id: string; title: string; originalName: string }> {
    const want = new Set(names.map((n) => n.toLowerCase()))
    return this.db.select().from(noteDoc).where(eq(noteDoc.status, 'active')).all()
      .filter((r) => want.has(r.originalName.toLowerCase())).map((r) => ({ id: r.id, title: r.title, originalName: r.originalName }))
  },

  // Open in Word: a copy with the note's name in notes-edit/ (Word changes it there, not the kept versions).
  editState(): Record<string, { path: string; mtime: number }> {
    try { return JSON.parse(readFileSync(join(this.folder, 'notes-edit', 'state.json'), 'utf8')) } catch { return {} }
  },
  saveEditState(st: Record<string, { path: string; mtime: number }>): void {
    mkdirSync(join(this.folder, 'notes-edit'), { recursive: true })
    writeFileSync(join(this.folder, 'notes-edit', 'state.json'), JSON.stringify(st))
  },

  /** The Word copy to open (made fresh from the current version unless Word has unsaved-here changes). */
  editCopy(id: string): string {
    const r = this.noteRow(id)
    const st = this.editState()
    const known = st[id]
    if (known && existsSync(known.path) && statSync(known.path).mtimeMs > known.mtime) return known.path
    const safe = r.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 80) || 'Note'
    const path = join(this.folder, 'notes-edit', `${safe}${extname(r.file)}`)
    mkdirSync(join(this.folder, 'notes-edit'), { recursive: true })
    copyFileSync(join(this.folder, ASSETS_DIR, r.file), path)
    st[id] = { path, mtime: statSync(path).mtimeMs }
    this.saveEditState(st)
    return path
  },

  /** Notes changed in Word since they were opened from here. */
  editedInWord(): Array<{ id: string; title: string }> {
    const st = this.editState()
    return Object.entries(st).flatMap(([id, e]) => {
      if (!existsSync(e.path) || statSync(e.path).mtimeMs <= e.mtime) return []
      const r = this.db.select().from(noteDoc).where(eq(noteDoc.id, id)).get()
      return r && r.status === 'active' ? [{ id, title: r.title }] : []
    })
  },

  /** Brings Word's changes in as a new version. */
  takeWordEdit(id: string): void {
    const st = this.editState()
    const e = st[id]
    if (!e || !existsSync(e.path)) throw new Error('The Word copy is gone')
    this.saveNoteVersion(id, readFileSync(e.path), 'Brought in Word changes to')
    st[id] = { ...e, mtime: statSync(e.path).mtimeMs }
    this.saveEditState(st)
  },

  /** Player preview: what the party has seen and learned, nothing else. */
  playersView(): PlayersView {
    const nowMin = this.info().clockMin
    const all = this.db.select().from(entity).all()
    const byId = new Map(all.map((e) => [e.id, e]))
    const text = (e: EntityRow | undefined, k: string) => (e && typeof e.attributes[k] === 'string' ? (e.attributes[k] as string).trim() : '')
    const where = this.liveWhere()
    const placeRow = where.place ? byId.get(where.place.locationId) : undefined

    // Recap: the latest player-safe recap written for a session.
    const recapRow = this.db.select().from(session).where(eq(session.status, 'active')).all()
      .filter((x) => x.playerRecap.trim()).sort((a, b) => b.number - a.number)[0]

    // People: met in play, or with a known field; only the known fields are shown.
    const known = new Map<string, Set<string>>()
    for (const k of this.db.select().from(knowledge).where(eq(knowledge.status, 'active')).all()) {
      if (k.knownFromMin > nowMin) continue
      if (!known.has(k.entityId)) known.set(k.entityId, new Set())
      known.get(k.entityId)!.add(k.field)
    }
    const met = this.metIds()
    const people = [...new Set([...met, ...known.keys()])]
      .map((id) => byId.get(id)).filter((e): e is EntityRow => !!e && e.status !== 'defunct' && ['NPC', 'FACTION', 'MONSTER'].includes(e.type))
      .map((e) => {
        const f = known.get(e.id) ?? new Set<string>()
        const facts: Array<{ label: string; value: string }> = []
        if (f.has('location') && text(e, 'location')) facts.push({ label: 'Where', value: text(e, 'location') })
        if (f.has('motivation') && text(e, 'motivation')) facts.push({ label: 'Wants', value: text(e, 'motivation') })
        if (f.has('statblock')) { const sb = readStatBlock(e.attributes.statblock); if (sb) facts.push({ label: 'Seen in a fight', value: statLine(sb) }) }
        if (f.has('bio') && text(e, 'bio')) facts.push({ label: 'About', value: text(e, 'bio') })
        if (text(e, 'player_notes')) facts.push({ label: 'Note', value: text(e, 'player_notes') })
        // Met but the name was never learned: they are "a stranger" (same rule as the player recap).
        const name = f.has('name') ? e.name : 'A stranger'
        return { id: e.id, name, type: e.type as EntityType, facts }
      })
      .sort((a, b) => a.name.localeCompare(b.name))

    const preps = new Map(this.db.select().from(sessionPrep).where(eq(sessionPrep.status, 'active')).all().map((p) => [p.id, p.number]))
    const discoveries = this.db.select().from(prepItem).where(and(eq(prepItem.kind, 'discovery'), eq(prepItem.status, 'active'), eq(prepItem.done, true))).all()
      .filter((i) => preps.has(i.prepId) && (i.doneAtMin ?? 0) <= nowMin)
      .sort((a, b) => (a.doneAtMin ?? 0) - (b.doneAtMin ?? 0))
      .map((i) => ({ id: i.id, title: i.title, text: i.body, session: preps.get(i.prepId)! }))

    const knownStrings = new Set(this.db.select().from(relationshipKnown).where(eq(relationshipKnown.status, 'active')).all()
      .filter((k) => k.knownFromMin <= nowMin).map((k) => k.relationshipId))
    const connections = this.db.select().from(relationship).where(eq(relationship.status, 'active')).all()
      .filter((r) => knownStrings.has(r.id))
      .map((r) => `${byId.get(r.sourceId)?.name ?? '?'} ${r.type.toLowerCase().replace(/_/g, ' ')} ${byId.get(r.targetId)?.name ?? '?'}`)

    // The map: only regions of places they have been.
    let map: PlayersView['map'] = null
    if (where.place) {
      const full = this.mapScreen(where.place.mapId)
      const visited = new Set(this.db.select().from(partyPosition).where(and(eq(partyPosition.status, 'active'), eq(partyPosition.mapId, where.place.mapId))).all()
        .filter((p) => p.atMin <= nowMin).map((p) => p.locationId).filter((x): x is string => !!x))
      const regions = full.regions.filter((r) => visited.has(r.locationId))
      const notes: Record<string, string> = {}
      for (const r of regions) notes[r.id] = text(byId.get(r.locationId), 'player_notes')
      map = { view: { ...full, regions, unplacedLocations: [] }, notes }
    }
    return {
      campaignName: this.info().name,
      when: formatClock(nowMin),
      light: skyAt(nowMin).light,
      recap: recapRow ? { number: recapRow.number, text: recapRow.playerRecap } : null,
      place: placeRow ? { name: placeRow.name, inside: where.place!.inside, notes: text(placeRow, 'player_notes') } : null,
      cameFrom: where.cameFrom?.name ?? null,
      headingTo: where.headingTo?.name ?? null,
      people, discoveries, connections, map
    }
  },

  setHeading(locationId: string | null): void {
    this.setSetting('heading_location_id', locationId, locationId ? `Party heading to ${this.nameOf(locationId)}` : 'Cleared where the party is heading')
  },

})
