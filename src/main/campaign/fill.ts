import { copyFileSync, mkdirSync, readdirSync, renameSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { ability, storyline, storylineEntity } from '../db/schema'
import { readStatBlock, StatBlock } from '../../shared/statblock'
import { EntityAttributes } from '../../shared/schemas'
import { CHAR_ATTRS } from '../../shared/charsheet'
import { scaleToCr } from '../../shared/crscale'
import { part } from './part'
import { ASSETS_DIR, SrdCopy, MAP_EXTENSIONS, storedExt, NewAbility } from './common'

export const fillPart = part({
  // ---- fill blanks with AI

  /** Titles of the storylines a card is in (context for the AI). */
  storylinesOf(entityId: string): string[] {
    const links = this.db.select().from(storylineEntity).where(and(eq(storylineEntity.entityId, entityId), eq(storylineEntity.status, 'active'))).all()
    const titles = new Map(this.db.select().from(storyline).all().filter((x) => !x.removed).map((x) => [x.id, x.title]))
    return links.map((l) => titles.get(l.storylineId)).filter((x): x is string => !!x)
  },

  /**
   * Uses the AI suggestions the DM kept, as one undo step. Only fields that are still
   * empty are written (the DM may have typed one meanwhile); each is marked in
   * attributes.ai_filled. An SRD base gives a creature without one a stat block and abilities.
   */
  /** Raise or lower the challenge rating by the local rules (shared/crscale.ts). One undo step. */
  scaleCr(entityId: string, cr: string): void {
    const e = this.entityRow(entityId)
    const sb = readStatBlock(e.attributes.statblock)
    if (!sb) throw new Error(`${e.name} has no stat block yet`)
    const abilities = this.db.select().from(ability).where(and(eq(ability.entityId, entityId), eq(ability.status, 'active'))).all()
    const r = scaleToCr(sb, abilities, cr)
    this.log.run(`${e.name}: challenge rating ${sb.cr} → ${cr}`, (w) => {
      w.update('entity', entityId, { attributes: { ...e.attributes, statblock: r.statblock } })
      for (const a of r.abilities) {
        const old = abilities.find((x) => x.id === a.id)!
        if (old.description !== a.description || old.macroText !== a.macroText) w.update('ability', a.id, { description: a.description, macroText: a.macroText })
      }
    })
  },

  /**
   * Puts a whole stat block on a card (an approved AI proposal): the old actions go to History,
   * the new ones are added; the stat block is marked as written by AI (rule 10). One undo step.
   */
  applyStatBlock(entityId: string, statblock: StatBlock, actions: NewAbility[], source: string): void {
    const e = this.entityRow(entityId)
    const old = this.db.select().from(ability).where(and(eq(ability.entityId, entityId), eq(ability.status, 'active'))).all()
    this.log.run(`New stat block for ${e.name} (AI)`, (w) => {
      const filled = { ...(e.attributes.ai_filled && typeof e.attributes.ai_filled === 'object' ? e.attributes.ai_filled as Record<string, string> : {}), statblock: source }
      w.update('entity', entityId, { attributes: { ...e.attributes, statblock, ai_filled: filled } })
      for (const a of old) w.update('ability', a.id, { status: 'defunct' })
      actions.forEach((a, i) => this.insertAbility(w, entityId, a, i))
    })
  },

  /**
   * A character sheet read from the DM's notes files (an approved AI proposal): onto a card, or a new
   * PC card when `entityId` is null. Only the parts the DM kept are given (null = leave as is); new
   * attacks and spells send the card's old ones to History. One undo step; returns the card's id.
   */
  applyCharSheet(input: {
    entityId: string | null; name: string; source: string; statblock: StatBlock | null; actions: NewAbility[] | null
    level: string | null; currentHp: number | null; spellSlots: number[] | null; fields: Record<string, string>
    spellAbility?: string | null; prepared?: string[]; classes?: Array<{ name: string; subclass: string; level: number }> | null; saveNotes?: string | null
    /** More of the sheet (Heroic Inspiration, limited uses, own numbers): only the keys in CHAR_ATTRS. */
    attrs?: Record<string, unknown>
  }): string {
    const more = EntityAttributes.parse(Object.fromEntries(Object.entries(input.attrs ?? {}).filter(([k]) => k in CHAR_ATTRS)))
    const e = input.entityId ? this.entityRow(input.entityId) : null
    let id = input.entityId ?? ''
    this.log.run(`${e ? 'Filled' : 'Made'} ${e?.name ?? input.name} from a character sheet (AI)`, (w) => {
      const attrs: Record<string, unknown> = { ...(e?.attributes ?? {}) }
      const filled = { ...(attrs.ai_filled && typeof attrs.ai_filled === 'object' ? attrs.ai_filled as Record<string, string> : {}) }
      for (const [k, v] of Object.entries(input.fields)) {
        if (['statblock', 'custom', 'provenance', 'imported', 'ai_filled', 'source'].includes(k)) continue
        attrs[k] = v.trim()
        filled[k] = input.source
      }
      if (input.statblock) { attrs.statblock = input.statblock; filled.statblock = input.source }
      if (input.level !== null) attrs.level = input.level
      if (input.currentHp !== null) attrs.current_hp = input.currentHp
      if (input.spellSlots) attrs.spell_slots = input.spellSlots
      if (input.spellAbility) attrs.spell_ability = input.spellAbility
      if (input.classes?.length) attrs.classes = input.classes
      if (input.saveNotes) attrs.save_notes = input.saveNotes
      Object.assign(attrs, more)
      attrs.ai_filled = filled
      if (!e) {
        id = this.insertEntity(w, { boardId: this.globalBoard().id, type: 'PC', name: input.name, position: this.freeGlobalSpot(), attributes: attrs })
        this.joinFights(w, id)
      } else {
        w.update('entity', id, { attributes: attrs })
        if (input.actions) {
          const old = this.db.select().from(ability).where(and(eq(ability.entityId, id), eq(ability.status, 'active'))).all()
          for (const a of old) w.update('ability', a.id, { status: 'defunct' })
        }
      }
      if (!input.actions) return
      // Prepared spells (by name) become ticks on the new spell rows.
      const want = new Set((input.prepared ?? []).map((n) => n.toLowerCase()))
      const ids = input.actions.map((a, i) => ({ id: this.insertAbility(w, id, a, i), a }))
      const prepared = ids.filter(({ a }) => a.kind === 'SPELL' && want.has(a.name.toLowerCase())).map((x) => x.id)
      if (prepared.length) w.update('entity', id, { attributes: { ...attrs, prepared } })
    })
    return id
  },

  /** A picture for a card's sheet: a file the DM chose, or a kept AI drawing (pending). One undo step. */
  setPicture(entityId: string, from: { file: string } | { pendingId: string; source: string } | { path: string } | null): void {
    const e = this.entityRow(entityId)
    if (!from) {
      this.log.run(`Removed the picture of ${e.name}`, (w) => { w.update('entity', entityId, { attributes: { ...e.attributes, picture: null, picture_source: null } }) })
      return
    }
    if ('path' in from) {
      // Chosen from the Library: the card shows the same file.
      if (!this.assetFile(from.path) || !MAP_EXTENSIONS.includes(extname(from.path).toLowerCase())) throw new Error('That picture is not in this campaign')
      this.log.run(`New picture for ${e.name}`, (w) => { w.update('entity', entityId, { attributes: { ...e.attributes, picture: from.path, picture_source: null } }) })
      return
    }
    const src = 'file' in from ? from.file : this.pendingFile(from.pendingId)
    const ext = extname(src).toLowerCase()
    if (!MAP_EXTENSIONS.includes(ext)) throw new Error(`Pictures must be PNG, JPEG, WebP or GIF images (got ${ext || 'no extension'})`)
    mkdirSync(join(this.folder, ASSETS_DIR, 'pictures'), { recursive: true })
    const rel = this.pictureName(e, storedExt(ext))
    if ('file' in from) copyFileSync(src, join(this.folder, ASSETS_DIR, rel))
    else renameSync(src, join(this.folder, ASSETS_DIR, rel))
    this.log.run(`New picture for ${e.name}`, (w) => {
      w.update('entity', entityId, { attributes: { ...e.attributes, picture: rel, picture_source: 'source' in from ? from.source : null } })
    })
  },

  /** Card picture file name: the card's name and a picture number (Ottoman_1.png, Old_Mill_2.jpg; owner, 2026-10-14). */
  pictureName(e: { name: string; type: string }, ext: string): string {
    const safe = e.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().replace(/\s+/g, '_').replace(/[.\s]+$/, '').slice(0, 60)
    const stem = `${safe || e.type[0] + e.type.slice(1).toLowerCase()}_`
    const taken = new Set(readdirSync(join(this.folder, ASSETS_DIR, 'pictures')).map((f) => basename(f, extname(f)).toLowerCase()))
    let n = 1
    while (taken.has(`${stem}${n}`.toLowerCase())) n++
    return `pictures/${stem}${n}${ext}`
  },

  applyFill(entityId: string, fields: Record<string, string>, source: string, srd?: SrdCopy | null): string[] {
    const e = this.entityRow(entityId)
    const used: string[] = []
    this.log.run(`Filled blanks on ${e.name} with AI`, (w) => {
      const attrs: Record<string, unknown> = { ...e.attributes }
      const filled = { ...(attrs.ai_filled && typeof attrs.ai_filled === 'object' ? attrs.ai_filled as Record<string, string> : {}) }
      for (const [k, v] of Object.entries(fields)) {
        if (!v.trim() || ['statblock', 'custom', 'provenance', 'imported', 'ai_filled', 'source'].includes(k)) continue
        if (typeof attrs[k] === 'string' && (attrs[k] as string).trim()) continue
        attrs[k] = v.trim()
        filled[k] = source
        used.push(k)
      }
      if (srd && !readStatBlock(attrs.statblock)) {
        attrs.statblock = srd.attributes.statblock
        filled.statblock = `${source}, based on the SRD ${srd.name}`
        used.push('statblock')
        const has = this.db.select().from(ability).where(eq(ability.entityId, entityId)).all().some((a) => a.status === 'active')
        if (!has) srd.abilities.forEach((a, i) => this.insertAbility(w, entityId, a, i))
      }
      attrs.ai_filled = filled
      w.update('entity', entityId, { attributes: attrs })
    })
    return used
  },

})
