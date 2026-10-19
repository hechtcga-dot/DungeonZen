import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { board, boardItem, entity,   relationship, type BoardItemRow, type BoardRow, type EntityRow, type RelationshipRow } from '../db/schema'
import { buildingAttrs, newId, readBuilding, type BSecret } from '../../shared/building'
import { part } from './part'


export const buildingsPart = part({
  // ---- buildings ----------------------------------------------------------------

  /** A patron or keeper becomes an NPC or PC card tied to the building with a string; one undo step. */
  buildingPatronCard(buildingId: string, patronId: string, type: 'NPC' | 'PC'): string {
    const b = this.entityRow(buildingId)
    const data = readBuilding(b.attributes)
    const p = data.patrons.find((x) => x.id === patronId)
    if (!p) throw new Error('That patron is no longer in the building')
    if (p.entityId && this.db.select().from(entity).where(eq(entity.id, p.entityId)).get()?.status !== undefined && this.entityRow(p.entityId).status !== 'defunct') throw new Error(`${p.name} already has a card`)
    const secrets = data.secrets.filter((x) => x.patronId === p.id).sort((a, c) => a.score - c.score).map((x) => `${x.score}: ${x.text}`)
    let id = ''
    this.log.run(`Made a card for ${p.name}`, (w) => {
      id = this.insertEntity(w, {
        boardId: this.globalBoard().id, type, name: p.name, position: this.freeGlobalSpot(),
        attributes: {
          summary: p.role, location: b.name, ...(type === 'NPC' ? { occupation: p.role, appearance: p.desc } : { appearance: p.desc }),
          ...(p.knows ? { notes: `Knows: ${p.knows}` } : {}), ...(secrets.length ? { secret: secrets.join('\n') } : {})
        }
      })
      w.insert('relationship', { id: randomUUID(), sourceId: id, targetId: buildingId, type: 'LOCATED_AT', isSecret: false, status: 'active' })
      w.update('entity', buildingId, { attributes: { ...b.attributes, ...buildingAttrs({ patrons: data.patrons.map((x) => (x.id === p.id ? { ...x, entityId: id } : x)) }) } })
    })
    return id
  },

  campaignSecrets(): BSecret[] {
    const v = this.setting('campaign_secrets')
    return readBuilding({ secrets: v }).secrets
  },

  /** "All campaign secrets": the campaign's own list, Clue cards, and every other building's secrets. */
  secretPool(buildingId: string): { own: BSecret[]; clueCards: Array<{ id: string; name: string; text: string }>; elsewhere: Array<{ buildingId: string; buildingName: string; secret: BSecret }> } {
    const live = this.db.select().from(entity).all().filter((e) => e.status === 'active' || e.status === 'resolved')
    return {
      own: this.campaignSecrets(),
      clueCards: live.filter((e) => e.type === 'CLUE').map((e) => ({
        id: e.id, name: e.name, text: [e.attributes.summary, e.attributes.description].find((x) => typeof x === 'string' && x.trim()) as string ?? ''
      })).sort((a, c) => a.name.localeCompare(c.name)),
      elsewhere: live.filter((e) => e.type === 'BUILDING' && e.id !== buildingId)
        .flatMap((e) => readBuilding(e.attributes).secrets.map((secret) => ({ buildingId: e.id, buildingName: e.name, secret })))
    }
  },

  /**
   * Moves a secret between "In this building" and "All campaign secrets" (the campaign's own
   * list or another building), one undo step. Its patron is dropped when it leaves a building.
   */
  moveSecret(input: { secretId: string; from: string | null; to: string | null }): void {
    if (input.from === input.to) return
    const read = (id: string | null) => (id ? readBuilding(this.entityRow(id).attributes).secrets : this.campaignSecrets())
    const fromList = read(input.from)
    const sec = fromList.find((x) => x.id === input.secretId)
    if (!sec) throw new Error('That secret has moved or is in History')
    const moved: BSecret = { ...sec, patronId: undefined }
    const toName = input.to ? this.entityRow(input.to).name : 'All campaign secrets'
    this.log.run(`Moved a ${sec.kind} to ${toName}`, (w) => {
      const write = (id: string | null, list: BSecret[]) => {
        if (!id) {
          if (w.get('campaign_settings', 'campaign_secrets')) w.update('campaign_settings', 'campaign_secrets', { value: list })
          else w.insert('campaign_settings', { key: 'campaign_secrets', value: list })
        } else {
          const row = this.entityRow(id)
          w.update('entity', id, { attributes: { ...row.attributes, ...buildingAttrs({ secrets: list }) } })
        }
      }
      write(input.from, fromList.filter((x) => x.id !== sec.id))
      write(input.to, [...read(input.to).filter((x) => x.id !== sec.id), moved])
    })
  },

  /** Adds or edits secrets on the campaign's own list (All campaign secrets). */
  setCampaignSecrets(list: BSecret[], label: string): void {
    this.setSetting('campaign_secrets', list.map((x) => ({ ...x, id: x.id || newId() })), label)
  },

  nameOf(entityId: string): string {
    return this.db.select({ name: entity.name }).from(entity).where(eq(entity.id, entityId)).get()?.name ?? '?'
  },

  entityRow(id: string): EntityRow {
    const row = this.db.select().from(entity).where(eq(entity.id, id)).get()
    if (!row) throw new Error(`No entity with id ${id}`)
    return row
  },

  relationshipRow(id: string): RelationshipRow {
    const row = this.db.select().from(relationship).where(eq(relationship.id, id)).get()
    if (!row) throw new Error(`No link with id ${id}`)
    return row
  },

  itemRow(id: string): BoardItemRow {
    const row = this.db.select().from(boardItem).where(eq(boardItem.id, id)).get()
    if (!row) throw new Error(`No board item with id ${id}`)
    return row
  },

  boardRow(id: string): BoardRow {
    const row = this.db.select().from(board).where(eq(board.id, id)).get()
    if (!row) throw new Error(`No board with id ${id}`)
    return row
  },
})
