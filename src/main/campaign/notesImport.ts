import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { entity,   relationship } from '../db/schema'
import { MINUTES_PER_DAY } from '../../shared/time'
import { ImportDraft as ImportDraftSchema, type ImportDraft, type ImportDraftSummary } from '../../shared/notesImport'
import { part } from './part'


export const notesImportPart = part({
  // ---- notes import (Phase 5): drafts live in imports/ and are not campaign data until committed

  importsDir(): string {
    const dir = join(this.folder, 'imports')
    mkdirSync(dir, { recursive: true })
    return dir
  },

  /** Cards an import can match or link to. */
  importTargets(): Array<{ id: string; name: string; type: string; status: string }> {
    return this.db.select().from(entity).all()
      .filter((e) => e.status === 'active' || e.status === 'resolved' || e.status === 'stashed')
      .map((e) => ({ id: e.id, name: e.name, type: e.type, status: e.status }))
  },

  importDrafts(): ImportDraftSummary[] {
    return readdirSync(this.importsDir()).filter((f) => f.endsWith('.json'))
      .flatMap((f) => { try { return [this.importDraft(f.slice(0, -5))] } catch { return [] } })
      .filter((d) => d.status !== 'discarded')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((d) => ({
        id: d.id, title: d.title, createdAt: d.createdAt, status: d.status,
        cards: d.cards.length, openQuestions: d.questions.filter((q) => q.status === 'open').length
      }))
  },

  importDraft(id: string): ImportDraft {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Not an import draft')
    const file = join(this.importsDir(), `${id}.json`)
    if (!existsSync(file)) throw new Error('That import is gone')
    return ImportDraftSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
  },

  saveImportDraft(d: ImportDraft): void {
    const draft = ImportDraftSchema.parse(d)
    if (!/^[0-9a-f-]{36}$/.test(draft.id)) throw new Error('Not an import draft')
    writeFileSync(join(this.importsDir(), `${draft.id}.json`), JSON.stringify(draft, null, 1))
  },

  /**
   * Creates everything the DM kept from an import as ONE undo step: new cards, merges into
   * existing cards (only empty fields are filled), storylines with acts, strings, and
   * answered questions as DM notes. Every card records where it came from.
   */
  commitImport(id: string): { created: number; merged: number; storylines: number; links: number } {
    const d = this.importDraft(id)
    if (d.status !== 'open') throw new Error('This import was already used')
    const g = this.globalBoard().id
    const ids = new Map<string, string>()
    const counts = { created: 0, merged: 0, storylines: 0, links: 0 }
    const nowMin = this.info().clockMin
    const provenanceOf = (sources: ImportDraft['cards'][number]['sources']) => sources.map((x) => ({ ...x, import: d.title, ai: d.source }))
    const target = (pid: string): string | null => (pid.startsWith('entity:') ? pid.slice(7) : ids.get(pid) ?? null)
    this.log.run(`Imported notes: ${d.title}`, (w) => {
      for (const c of d.cards) {
        if (c.decision === 'skip') continue
        if (c.decision === 'merge' && c.duplicateOf) {
          const e = this.db.select().from(entity).where(eq(entity.id, c.duplicateOf.id)).get()
          if (e && e.status !== 'defunct') {
            const attrs: Record<string, unknown> = { ...e.attributes }
            const fill = (k: string, v: string) => { if (v && (c.overwrite?.includes(k) || !(typeof attrs[k] === 'string' && (attrs[k] as string).trim()))) attrs[k] = v }
            fill('summary', c.summary)
            for (const [k, v] of Object.entries(c.details)) fill(k, v)
            attrs.provenance = [...(Array.isArray(attrs.provenance) ? attrs.provenance : []), ...provenanceOf(c.sources)]
            w.update('entity', e.id, { attributes: attrs, tags: [...new Set([...e.tags, ...c.tags])] })
            ids.set(c.id, e.id)
            counts.merged++
            continue
          }
        }
        const eid = this.insertEntity(w, {
          boardId: g, type: c.type, name: c.name.trim() || 'Unnamed', position: this.freeGlobalSpot(), tags: c.tags,
          attributes: { summary: c.summary, ...c.details, provenance: provenanceOf(c.sources), imported: { ai: d.source, basis: c.basis, import: d.title } }
        })
        ids.set(c.id, eid)
        counts.created++
      }
      d.storylines.filter((x) => x.decision === 'create').forEach((sl, k) => {
        const storylineId = randomUUID()
        const boardId = randomUUID()
        w.insert('storyline', { id: storylineId, title: sl.title || 'Imported storyline', isMajor: false, status: 'inactive', bbegEntityId: null, emblem: null, removed: false })
        w.insert('board', { id: boardId, name: sl.title || 'Imported storyline', storylineId })
        if (sl.summary.trim()) {
          w.insert('board_item', {
            id: randomUUID(), boardId, kind: 'note', entityId: null, x: 40, y: 40, w: 260, h: 140,
            content: { text: `${sl.summary.trim()}\n\n(From notes: ${sl.sources.map((x) => `${x.file}, ${x.locator}`).join('; ')}; read by ${d.source})` }, status: 'active'
          })
        }
        sl.cardIds.map(target).filter((x): x is string => !!x).forEach((eid, n) => {
          this.linkToStoryline(w, eid, storylineId, boardId, { x: 340 + (n % 4) * 260, y: 40 + Math.floor(n / 4) * 200 })
        })
        sl.acts.forEach((a, n) => {
          const actId = randomUUID()
          const start = nowMin + (k + n) * MINUTES_PER_DAY
          w.insert('act', { id: actId, storylineId, title: a.title, summary: a.summary, startMin: start, endMin: start + 12 * 60, chosenOutcomeId: null, status: 'active' })
          w.insert('act_outcome', { id: randomUUID(), actId, label: 'If nobody intervenes', description: '', isDefault: true, sort: 0, status: 'active' })
        })
        counts.storylines++
      })
      const existingLinks = this.db.select().from(relationship).where(eq(relationship.status, 'active')).all()
      for (const l of d.links) {
        if (l.decision === 'skip') continue
        const a = target(l.fromId)
        const b = target(l.toId)
        if (!a || !b || a === b) continue
        if (existingLinks.some((r) => r.sourceId === a && r.targetId === b && r.type === l.type)) continue
        w.insert('relationship', { id: randomUUID(), sourceId: a, targetId: b, type: l.type, isSecret: l.secret, status: 'active' })
        counts.links++
      }
      // Answered questions go into the DM notes of the card they are about, or the campaign journal.
      for (const q of d.questions.filter((x) => x.status === 'answered' && x.answer.trim())) {
        const line = `Q (notes import): ${q.text}\nA: ${q.answer.trim()}`
        const about = q.aboutId ? target(q.aboutId) : null
        const e = about ? this.db.select().from(entity).where(eq(entity.id, about)).get() : undefined
        if (e) {
          const cur = typeof e.attributes.notes === 'string' ? e.attributes.notes.trim() : ''
          w.update('entity', e.id, { attributes: { ...e.attributes, notes: cur ? `${cur}\n\n${line}` : line } })
        } else {
          const cur = String(this.setting('dm_notes') ?? '').trim()
          const value = cur ? `${cur}\n\n${line}` : line
          if (w.get('campaign_settings', 'dm_notes')) w.update('campaign_settings', 'dm_notes', { value })
          else w.insert('campaign_settings', { key: 'dm_notes', value })
        }
      }
    })
    this.saveImportDraft({ ...d, status: 'committed' })
    return counts
  },

  /** Puts a draft aside (kept on disk, out of the list) or back to open after an undo. */
  setImportStatus(id: string, status: 'open' | 'discarded'): void {
    this.saveImportDraft({ ...this.importDraft(id), status })
  },

})
