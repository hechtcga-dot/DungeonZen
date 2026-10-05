import { z } from 'zod'
import {
  AbilityKind, EntityAttributes, EntityStatus, EntityType, Id, KnowledgeField, RelationshipType, RowStatus, Tags
} from './schemas'
import type {
  AbilityView, BoardItemView, BoardSummary, BoardView, CampaignInfo, DeskView, EntityView, MapView, HistoryView, LibrarySearch,
  RecentCampaign, RelationshipView, SheetView, SrdSearch
} from './types'

// The typed contract between the renderer (UI) and the main process.
// Every input is checked with Zod in the main process before it is used.

const Position = z.object({ x: z.number().finite(), y: z.number().finite() })
const Name = z.string().trim().min(1).max(200)
const AbilityFields = z.object({
  name: Name,
  kind: AbilityKind,
  description: z.string().max(10000),
  macroText: z.string().max(10000),
  showTokenAction: z.boolean(),
  showMacroBar: z.boolean()
})
const OptionalNumber = z.number().finite().optional()

export const ipcInputs = {
  'profile:recent': z.void(),
  'campaign:create': z.object({ name: Name }),
  'campaign:openDialog': z.void(),
  'campaign:openRecent': z.object({ folder: z.string().min(1) }),
  'campaign:close': z.void(),
  'campaign:info': z.void(),
  'board:view': z.object({ boardId: Id }),
  'entity:create': z.object({ boardId: Id, type: EntityType, name: Name, position: Position.optional() }),
  'entity:duplicate': z.object({ id: Id }),
  'sheet:view': z.object({ entityId: Id }),
  'ability:add': z.object({ entityId: Id, ability: AbilityFields.partial().extend({ name: Name }) }),
  'ability:update': z.object({ id: Id, patch: AbilityFields.partial() }),
  'ability:setStatus': z.object({ id: Id, status: RowStatus }),
  'knowledge:set': z.object({ entityId: Id, field: KnowledgeField, known: z.boolean() }),
  'knowledge:setString': z.object({ relationshipId: Id, known: z.boolean() }),
  'library:search': z.object({
    query: z.string().max(200), type: EntityType.optional(), tag: z.string().max(40).optional(),
    crMin: OptionalNumber, crMax: OptionalNumber, hpMin: OptionalNumber, hpMax: OptionalNumber
  }),
  'srd:search': z.object({
    query: z.string().max(200), kind: z.enum(['monsters', 'items', 'both']), crMin: OptionalNumber, crMax: OptionalNumber
  }),
  'srd:addCopy': z.object({ key: z.string().min(1).max(200), boardId: Id }),
  'desk:view': z.void(),
  'map:importDialog': z.void(),
  'map:setActive': z.object({ mapId: Id }),
  'notes:set': z.object({ text: z.string().max(100000) }),
  'clock:shift': z.object({ minutes: z.number().int().min(-525600).max(525600) }),
  'entity:update': z.object({
    id: Id,
    patch: z.object({
      name: Name.optional(), type: EntityType.optional(), tags: Tags.optional(),
      attributes: EntityAttributes.optional()
    })
  }),
  'entity:setStatus': z.object({ id: Id, status: EntityStatus }),
  'entity:addToStoryline': z.object({ entityId: Id, storylineId: Id, position: Position }),
  'entity:removeFromStoryline': z.object({ entityId: Id, storylineId: Id }),
  'relationship:create': z.object({ sourceId: Id, targetId: Id, type: RelationshipType, isSecret: z.boolean() }),
  'relationship:update': z.object({
    id: Id, patch: z.object({ type: RelationshipType.optional(), isSecret: z.boolean().optional() })
  }),
  'relationship:setStatus': z.object({ id: Id, status: RowStatus }),
  'note:create': z.object({ boardId: Id, position: Position, text: z.string().max(5000) }),
  'note:update': z.object({ itemId: Id, text: z.string().max(5000) }),
  'note:setStatus': z.object({ itemId: Id, status: RowStatus }),
  'items:move': z.object({ moves: z.array(Position.extend({ itemId: Id })).max(500) }),
  'storyline:create': z.object({ title: Name }),
  'history:view': z.void(),
  'history:undo': z.void(),
  'history:redo': z.void(),
  'history:undoTo': z.object({ commandId: Id })
} as const

export interface IpcOutputs {
  'profile:recent': RecentCampaign[]
  'campaign:create': CampaignInfo | null // null = dialog cancelled
  'campaign:openDialog': CampaignInfo | null
  'campaign:openRecent': CampaignInfo
  'campaign:close': void
  'campaign:info': CampaignInfo | null
  'board:view': BoardView
  'entity:create': EntityView
  'entity:duplicate': EntityView
  'sheet:view': SheetView
  'ability:add': AbilityView
  'ability:update': void
  'ability:setStatus': void
  'knowledge:set': void
  'knowledge:setString': void
  'library:search': LibrarySearch
  'srd:search': SrdSearch
  'srd:addCopy': EntityView
  'desk:view': DeskView
  'map:importDialog': MapView | null
  'map:setActive': void
  'notes:set': void
  'clock:shift': number
  'entity:update': void
  'entity:setStatus': void
  'entity:addToStoryline': void
  'entity:removeFromStoryline': void
  'relationship:create': RelationshipView
  'relationship:update': void
  'relationship:setStatus': void
  'note:create': BoardItemView
  'note:update': void
  'note:setStatus': void
  'items:move': void
  'storyline:create': BoardSummary
  'history:view': HistoryView
  'history:undo': string | null
  'history:redo': string | null
  'history:undoTo': number
}

export type IpcChannel = keyof typeof ipcInputs
export type IpcInput<C extends IpcChannel> = z.input<(typeof ipcInputs)[C]>

/** Errors cross IPC as plain data so the UI can show the message. */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string }

export interface DungeonZenApi {
  invoke<C extends IpcChannel>(channel: C, input: IpcInput<C>): Promise<IpcResult<IpcOutputs[C]>>
}

export { IPC_PREFIX } from './ipcPrefix'
