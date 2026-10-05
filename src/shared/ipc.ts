import { z } from 'zod'
import { EntityAttributes, EntityStatus, EntityType, Id, RelationshipType, RowStatus, Tags } from './schemas'
import type {
  BoardItemView, BoardSummary, BoardView, CampaignInfo, EntityView, HistoryView, RecentCampaign, RelationshipView
} from './types'

// The typed contract between the renderer (UI) and the main process.
// Every input is checked with Zod in the main process before it is used.

const Position = z.object({ x: z.number().finite(), y: z.number().finite() })
const Name = z.string().trim().min(1).max(200)

export const ipcInputs = {
  'profile:recent': z.void(),
  'campaign:create': z.object({ name: Name }),
  'campaign:openDialog': z.void(),
  'campaign:openRecent': z.object({ folder: z.string().min(1) }),
  'campaign:close': z.void(),
  'campaign:info': z.void(),
  'board:view': z.object({ boardId: Id }),
  'entity:create': z.object({ boardId: Id, type: EntityType, name: Name, position: Position }),
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

export interface ChronosApi {
  invoke<C extends IpcChannel>(channel: C, input: IpcInput<C>): Promise<IpcResult<IpcOutputs[C]>>
}

export { IPC_PREFIX } from './ipcPrefix'
