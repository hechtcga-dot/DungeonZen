import type { StyleTags } from '../../shared/styleTags'
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { boardItem, entity, styleExample } from '../db/schema'
import type { EntityType,   RowStatus } from '../../shared/schemas'
import { imageSize } from '../imageSize'
import type { MapView, PendingImageView, StyleExampleView,   LibraryPictureView, PicturesView, StyleUse } from '../../shared/types'
import { STYLE_USES } from '../../shared/types'
import { part } from './part'
import { ASSETS_DIR, NewRegion, STYLE_EXTENSIONS, PENDING_ID, mimeOf, storedExt, ASSET_URL_PREFIX, DEFAULT_PICTURE_FOLDERS, PICTURE_FOLDER, toMapView } from './common'

export const picturesPart = part({
  // ---- battle maps and the DM's style examples

  /** Library pictures ticked as style examples for this kind of drawing (all of them without a kind). */
  styleExamples(use?: StyleUse): StyleExampleView[] {
    return this.db.select().from(styleExample).where(eq(styleExample.status, 'active')).all()
      .filter((r) => !use || r.styleFor.includes(use))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((r) => ({ id: r.id, name: r.name, url: ASSET_URL_PREFIX + r.imagePath, tags: r.tags ?? {} }))
  },

  /** Uploads a picture into the Library; new art is a style example for every kind of drawing until the DM unticks it. */
  addStyleExample(sourceFile: string, name?: string, folder = 'Art'): StyleExampleView {
    const ext = extname(sourceFile).toLowerCase()
    if (!STYLE_EXTENSIONS.includes(ext)) throw new Error(`Pictures for the Library must be PNG, JPEG or WebP images (got ${ext || 'no extension'})`)
    const id = randomUUID()
    const rel = `styles/${id}${storedExt(ext)}`
    mkdirSync(join(this.folder, ASSETS_DIR, 'styles'), { recursive: true })
    copyFileSync(sourceFile, join(this.folder, ASSETS_DIR, rel))
    const label = name?.trim() || basename(sourceFile, extname(sourceFile))
    this.log.run(`Added picture ${label} to the Library`, (w) => {
      w.insert('style_example', { id, name: label, imagePath: rel, createdAt: new Date().toISOString(), status: 'active', folder, styleFor: [...STYLE_USES] })
    })
    return this.styleExamples().find((x) => x.id === id)!
  },

  /**
   * Library › Pictures: the Library's own pictures plus every map, card picture and board picture not
   * filed yet (filing or ticking one makes it a Library picture that points at the same file).
   */
  pictures(): PicturesView {
    const own = this.db.select().from(styleExample).where(eq(styleExample.status, 'active')).all()
    const filed = new Set(own.map((r) => r.imagePath))
    const out: LibraryPictureView[] = own.map((r) => ({
      key: `lib:${r.id}`, name: r.name, folder: r.folder, path: r.imagePath, url: ASSET_URL_PREFIX + r.imagePath,
      styleFor: r.styleFor.filter((u): u is StyleUse => (STYLE_USES as readonly string[]).includes(u)), tags: r.tags ?? {}, from: null
    }))
    const add = (key: string, name: string, folder: string, path: string, from: LibraryPictureView['from']) => {
      if (filed.has(path)) return
      filed.add(path)
      out.push({ key, name, folder, path, url: ASSET_URL_PREFIX + path, styleFor: [], tags: {}, from })
    }
    for (const m of this.maps()) {
      const row = this.mapRow(m.id)
      add(`map:${m.id}`, m.name, m.kind === 'battle' ? 'Battle maps' : 'Maps', row.imagePath, { kind: 'map', id: m.id, name: m.name })
    }
    for (const e of this.db.select().from(entity).all()) {
      if (e.status === 'defunct' || typeof e.attributes.picture !== 'string') continue
      add(`card:${e.id}`, e.name, PICTURE_FOLDER[e.type as EntityType] ?? 'Card pictures', e.attributes.picture, { kind: 'card', id: e.id, name: e.name })
    }
    for (const item of this.db.select().from(boardItem).where(and(eq(boardItem.kind, 'image'), eq(boardItem.status, 'active'))).all()) {
      const c = item.content as { image?: string; name?: string } | null
      if (c?.image) add(`board:${item.id}`, c.name ?? 'Picture', 'Background pictures', c.image, { kind: 'board', id: item.id, name: c.name ?? 'Picture' })
    }
    const extra = this.setting('picture_folders')
    const folders = [...new Set([...DEFAULT_PICTURE_FOLDERS, ...(Array.isArray(extra) ? extra.map(String) : []), ...out.map((p) => p.folder)])]
    return { pictures: out, folders }
  },

  /** Renames, files or ticks a picture (one undo step). A map or card picture becomes a Library picture first. */
  updatePicture(key: string, patch: { name?: string; folder?: string; styleFor?: StyleUse[]; tags?: StyleTags }): void {
    const [kind, id] = key.split(':') as [string, string]
    if (kind === 'lib') {
      const r = this.styleRow(id)
      this.log.run(`Changed picture ${r.name}`, (w) => { w.update('style_example', id, patch) })
      return
    }
    const p = this.pictures().pictures.find((x) => x.key === key)
    if (!p) throw new Error('That picture is gone')
    this.log.run(`Filed picture ${p.name} in the Library`, (w) => {
      w.insert('style_example', {
        id: randomUUID(), name: patch.name ?? p.name, imagePath: p.path, createdAt: new Date().toISOString(), status: 'active',
        folder: patch.folder ?? p.folder, styleFor: patch.styleFor ?? [], tags: patch.tags ?? {}
      })
    })
  },

  addPictureFolder(name: string): void {
    const extra = this.setting('picture_folders')
    const list = Array.isArray(extra) ? extra.map(String) : []
    if (list.includes(name) || DEFAULT_PICTURE_FOLDERS.includes(name)) return
    this.setSetting('picture_folders', [...list, name], `Added picture folder ${name}`)
  },

  renameStyleExample(id: string, name: string): void {
    const r = this.styleRow(id)
    this.log.run(`Renamed example map ${r.name} to ${name}`, (w) => { w.update('style_example', id, { name }) })
  },

  setStyleExampleStatus(id: string, status: RowStatus): void {
    const r = this.styleRow(id)
    this.log.run(status === 'defunct' ? `Moved example map ${r.name} to History` : `Restored example map ${r.name}`, (w) => {
      w.update('style_example', id, { status })
    })
  },

  /** The example images to send with a drawing (active ones only, at most `max`). */
  styleImages(ids: string[], max = 4): Array<{ bytes: Buffer; mime: string }> {
    const rows = this.db.select().from(styleExample).where(eq(styleExample.status, 'active')).all().filter((r) => ids.includes(r.id)).slice(0, max)
    return rows.map((r) => ({ bytes: readFileSync(join(this.folder, ASSETS_DIR, r.imagePath)), mime: mimeOf(r.imagePath), key: r.imagePath }))
  },

  /** A picture waiting for the DM, to send back to the AI for Update picture. */
  pendingImage(pendingId: string): { bytes: Buffer; mime: string } {
    return { bytes: readFileSync(this.pendingFile(pendingId)), mime: mimeOf(pendingId) }
  },

  /** A picture the DM chose as a drawing's outline, copied into assets/outlines (the outline itself is saved by the caller, undoable). */
  addOutlinePicture(sourceFile: string): string {
    const ext = extname(sourceFile).toLowerCase()
    if (!STYLE_EXTENSIONS.includes(ext)) throw new Error(`An outline picture must be PNG, JPEG or WebP (got ${ext || 'no extension'})`)
    const rel = `outlines/${randomUUID()}${storedExt(ext)}`
    mkdirSync(join(this.folder, ASSETS_DIR, 'outlines'), { recursive: true })
    copyFileSync(sourceFile, join(this.folder, ASSETS_DIR, rel))
    return rel
  },

  /** The outline picture's bytes, or null when the file is gone. */
  outlinePicture(rel: string): { bytes: Buffer; mime: string; key: string } | null {
    const file = this.assetFile(rel)
    return file ? { bytes: readFileSync(file), mime: mimeOf(rel), key: rel } : null
  },

  styleRow(id: string) {
    const r = this.db.select().from(styleExample).where(eq(styleExample.id, id)).get()
    if (!r) throw new Error(`No example map with id ${id}`)
    return r
  },

  /**
   * An image an AI just drew, waiting for the DM. It sits in assets/pending and is not
   * campaign data until the DM keeps it (rule 2).
   */
  savePendingImage(bytes: Buffer, mime: string): PendingImageView {
    const ext = mime.includes('jpeg') ? '.jpg' : mime.includes('webp') ? '.webp' : '.png'
    const pendingId = `${randomUUID()}${ext}`
    mkdirSync(join(this.folder, ASSETS_DIR, 'pending'), { recursive: true })
    writeFileSync(join(this.folder, ASSETS_DIR, 'pending', pendingId), bytes)
    const size = imageSize(bytes)
    return { pendingId, url: `${ASSET_URL_PREFIX}pending/${pendingId}`, width: size?.width ?? null, height: size?.height ?? null }
  },

  /** A kept picture copied into assets/pending, for Add to picture (the kept file is not touched). */
  pendingCopy(path: string): PendingImageView {
    const file = this.assetFile(path)
    if (!file) throw new Error('That picture is not in this campaign')
    return this.savePendingImage(readFileSync(file), mimeOf(path))
  },

  pendingFile(pendingId: string): string {
    if (!PENDING_ID.test(pendingId)) throw new Error('Not a waiting image')
    const file = join(this.folder, ASSETS_DIR, 'pending', pendingId)
    if (!existsSync(file)) throw new Error('That image is gone; draw it again')
    return file
  },

  /** Keeps a drawn battle map: it becomes a map with a grid (one undo step). */
  keepBattleMap(input: { pendingId: string; name: string; cols: number; source: string; prompt: string; gridShown?: boolean }): MapView {
    const from = this.pendingFile(input.pendingId)
    const id = randomUUID()
    const rel = `maps/${id}${extname(input.pendingId)}`
    mkdirSync(join(this.folder, ASSETS_DIR, 'maps'), { recursive: true })
    renameSync(from, join(this.folder, ASSETS_DIR, rel))
    const size = imageSize(readFileSync(join(this.folder, ASSETS_DIR, rel)))
    this.log.run(`Kept battle map ${input.name}`, (w) => {
      w.insert('map', {
        id, name: input.name, imagePath: rel, width: size?.width ?? null, height: size?.height ?? null, gridSize: null,
        status: 'active', kind: 'battle', gridCols: input.cols, gridShown: !!input.gridShown, source: input.source, prompt: input.prompt
      })
    })
    return toMapView(this.mapRow(id))
  },

  /**
   * Keeps a world map that was made for the getting started guide (the map maker, or an AI
   * drawing): it becomes the desk map, with its regions and their Location cards. One undo step.
   */
  keepWorldMap(input: { pendingId: string; name: string; widthKm: number | null; source: string; prompt: string | null; regions: NewRegion[] }): MapView {
    const from = this.pendingFile(input.pendingId)
    const id = randomUUID()
    const rel = `maps/${id}${extname(input.pendingId)}`
    mkdirSync(join(this.folder, ASSETS_DIR, 'maps'), { recursive: true })
    renameSync(from, join(this.folder, ASSETS_DIR, rel))
    const size = imageSize(readFileSync(join(this.folder, ASSETS_DIR, rel)))
    this.log.run(`Kept world map ${input.name}`, (w) => {
      w.insert('map', {
        id, name: input.name, imagePath: rel, width: size?.width ?? null, height: size?.height ?? null, gridSize: null,
        status: 'active', kind: 'world', widthKm: input.widthKm, source: input.source, prompt: input.prompt
      })
      if (w.get('campaign_settings', 'active_map_id')) w.update('campaign_settings', 'active_map_id', { value: id })
      else w.insert('campaign_settings', { key: 'active_map_id', value: id })
      this.insertRegions(w, id, input.regions)
      this.worldMapOnBoard(w, { id, imagePath: rel, name: input.name, width: size?.width ?? null, height: size?.height ?? null })
    })
    return toMapView(this.mapRow(id))
  },

  /** The map's picture file and size (for an AI to look at). */
  mapImage(mapId: string): { file: string; width: number; height: number } {
    const m = this.mapRow(mapId)
    const file = join(this.folder, ASSETS_DIR, m.imagePath)
    const size = m.width && m.height ? { width: m.width, height: m.height } : imageSize(readFileSync(file))
    if (!size) throw new Error('Could not read the size of this map picture')
    return { file, width: size.width, height: size.height }
  },

  /** Throws away a drawn image the DM did not keep (it was never campaign data). */
  discardPending(pendingId: string): void {
    try { unlinkSync(this.pendingFile(pendingId)) } catch { /* already gone */ }
  },

})
