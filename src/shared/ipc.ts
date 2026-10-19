import { z } from 'zod'
import { Outline } from './outline'
import { StatBlock } from './statblock'
import { EncounterStory } from './encounterStory'
import type { SrdAttacks } from './attacks'
import type { BattlePlan } from './battleplan'
import { CombatState } from './combat'
import { GRID_MAX, GRID_MIN } from './battlemap'
import { ImportDraft, type ImportDraftSummary } from './notesImport'
import { BIOMES, PLACE_KINDS, WORLD_CLIMATES, WORLD_SIZES, type PlaceShape } from './places'
import {
  AbilityKind, EncounterFeedback, EntityAttributes, EntityStatus, EntityType, Id, KnowledgeField, LogKind, RelationshipType, RowStatus,
  RulesEdition, StorylineStatus, Tags, PrepKind, SceneType
} from './schemas'
import type { BuiltCreature, CombatView, SrdMonsterRow,
  AbilityView, BoardItemView, BoardSummary, BoardView, CampaignInfo, DeskView, EntityView, MapView, HistoryView, LibrarySearch,
  RecentCampaign, RelationshipView, SheetView, SrdSearch, TimelineView, WhatIfView, WordLinksView, LiveView, SessionView, LogView,
  GeneratedView, ReviewView, MapScreenView, RegionDetail, TravelEstimateView, AiSettingsView, AiSuggestion,
  StyleExampleView, PendingImageView, BattleMapContext, PrepScreenView, PrepView, WhereView, PlayersView, EncountersView, Roll20Export, PicturesView
} from './types'
import { STYLE_USES } from './types'

/** A drawing's outline as sent: the sketch as a picture (PNG, base64) or the DM's outline picture (asset path). */
const OutlineSend = z.object({ png: z.string().max(4_000_000).optional(), path: z.string().max(500).optional() })
import { PromptTemplateSchema, StyleTagsSchema, TEMPLATE_USES, type PromptTemplate, type StyleTags } from './styleTags'
import type { NotesScreenView } from './types'
import type { RollTable } from './rolltables'
import { Blocks, type Block } from './noteDoc'
import type { BSecret, BuildingProposal } from './building'

// The typed contract between the renderer (UI) and the main process.
// Every input is checked with Zod in the main process before it is used.

const Position = z.object({ x: z.number().finite(), y: z.number().finite() })
const Name = z.string().trim().min(1).max(200)
/** Screens that can open in a window of their own (rail right-click). */
export const POP_SCREENS = ['board', 'encounters', 'prep', 'library', 'import'] as const
const PopScreen = z.enum(POP_SCREENS)
/** A notes folder path "A/B/C" (2.8.0): no empty parts. */
const FolderPath = z.string().trim().min(1).max(300).refine((p) => p.split('/').every((x) => x.trim().length > 0), 'A folder name cannot be empty')
const IdList = z.array(z.string().max(80)).max(2000)
const NoteMetaInput = z.object({
  banner: z.object({ card: z.string().max(80).optional(), file: z.string().max(300).optional(), none: z.boolean().optional() }).optional(),
  hide: IdList.optional(), left: IdList.optional(), card: z.string().max(80).optional(), ignore: z.array(z.string().max(200)).max(2000).optional()
})
const AbilityFields = z.object({
  name: Name,
  kind: AbilityKind,
  description: z.string().max(10000),
  macroText: z.string().max(10000),
  showTokenAction: z.boolean(),
  showMacroBar: z.boolean()
})
const OptionalNumber = z.number().finite().optional()
/** Follow a picture (battle maps): a campaign map or an uploaded picture (assets path), the boxed part (fractions 0–1). */
const FollowInput = z.object({
  mapId: Id.optional(), path: z.string().min(1).max(500).optional(),
  crop: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0.001).max(1), h: z.number().min(0.001).max(1) }),
  buildings: z.enum(['inside', 'roofs']).optional(),
  cols: z.number().int().min(GRID_MIN).max(GRID_MAX).optional(), rows: z.number().int().min(GRID_MIN).max(GRID_MAX).optional()
})
const SketchInput = z.object({
  cols: z.number().int().min(4).max(60), rows: z.number().int().min(4).max(60), cells: z.string().max(3600),
  labels: z.array(z.object({ x: z.number().int().min(0).max(60), y: z.number().int().min(0).max(60), t: z.string().max(80) })).max(300)
})
const SecretInput = z.object({
  id: z.string().min(1).max(40), kind: z.enum(['rumour', 'secret', 'clue']), score: z.number().int().min(1).max(20), text: z.string().max(2000),
  patronId: z.string().max(40).optional(), cardId: Id.optional(), removed: z.boolean().optional()
})
const Minute = z.number().int().min(0).max(1_000_000_000)
const Short = z.string().max(300)
const Text = z.string().max(10000)
const PrepItemFields = z.object({
  title: z.string().trim().max(300), body: Text, sceneType: SceneType.nullable(),
  targetStart: z.number().int().min(0).max(1440).nullable(), targetEnd: z.number().int().min(0).max(1440).nullable(),
  entityId: Id.nullable(), locationId: Id.nullable(), discoveryId: Id.nullable(), relationshipId: Id.nullable(), secretId: Id.nullable(), description: Text,
  role: z.string().max(300), stats: z.string().max(1000), tactics: z.string().max(2000)
}).partial()
const PlayDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()
const Polygon = z.array(z.tuple([z.number().finite(), z.number().finite()])).min(3).max(500)
const PlaceShapeInput = z.object({
  name: Name, kind: z.enum(PLACE_KINDS), biome: z.enum(BIOMES).nullable(),
  polygon: z.array(z.tuple([z.number().finite(), z.number().finite()])).min(3).max(3000),
  parent: z.number().int().min(0).max(500).nullable(), summary: z.string().max(1000)
})
const GenPerson = z.object({
  name: Name, species: Short, occupation: Short, attitude: Short.min(1), quirk: Short, wants: Short, statblockName: Short, summary: Short
})
const GenTavern = z.object({ name: Name, keeper: GenPerson, patrons: z.array(GenPerson).max(20), rumour: Short, dish: Short, summary: Short })
const BuildAsk = z.object({
  difficulty: z.enum(['low', 'moderate', 'high']), creatureType: z.string().max(40).optional(),
  // null = where the party is; custom = a place the DM typed ("open field").
  place: z.union([z.object({ locationId: z.string().max(64).nullable() }), z.object({ custom: z.string().trim().min(1).max(200) })]),
  include: z.array(z.object({ entityId: z.string().max(64), count: z.number().int().min(1).max(100) })).max(20)
})
const DraftInput = z.object({
  name: Name, scene: z.string().max(5000), difficulty: z.enum(['low', 'moderate', 'high']), locationId: z.string().max(64).nullable(), placeName: z.string().max(200),
  groups: z.array(z.object({ key: z.string().min(1).max(200), name: Short, cr: z.string().max(10), count: z.number().int().min(1).max(100), xp: z.number(), notes: z.string().max(1000) })).max(50),
  include: z.array(z.object({ entityId: z.string().max(64), name: z.string().max(200), cr: z.string().max(10), count: z.number().int().min(1).max(100), xp: z.number() })).max(20),
  totalXp: z.number(), budget: z.number(), story: EncounterStory.nullable(), tactics: z.string().max(3000), source: z.string().max(200).nullable()
})
const GenEncounter = z.object({
  summary: Short,
  groups: z.array(z.object({ key: z.string().min(1).max(200), name: Short, count: z.number().int().min(1).max(100) })).min(1).max(50)
})
const TriggerEffect = z.discriminatedUnion('type', [
  z.object({ type: z.literal('shift_act'), actId: Id, minutes: z.number().int().min(-525600).max(525600) }),
  z.object({ type: z.literal('force_outcome'), actId: Id, outcomeId: Id }),
  z.object({ type: z.literal('set_status'), status: StorylineStatus })
])

// Board › several cards selected: the right-click changes all of them as one undoable step.
const ManyOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('status'), id: Id, status: EntityStatus }),
  z.object({ op: z.literal('colour'), id: Id, colour: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable() }),
  z.object({ op: z.literal('hidden'), id: Id, hidden: z.boolean() }),
  z.object({ op: z.literal('storyline'), entityId: Id, storylineId: Id, on: z.boolean(), position: Position }),
  z.object({ op: z.literal('act'), entityId: Id, actId: Id, on: z.boolean() }),
  z.object({ op: z.literal('takeOff'), itemId: Id })
])
export type ManyOp = z.infer<typeof ManyOp>

export const ipcInputs = {
  'board:many': z.object({ label: z.string().min(1).max(200), ops: z.array(ManyOp).min(1).max(1000) }),
  'profile:recent': z.void(),
  'campaign:create': z.object({ name: Name }),
  'campaign:openDialog': z.void(),
  'campaign:openRecent': z.object({ folder: z.string().min(1) }),
  'campaign:close': z.void(),
  'campaign:delete': z.void(),
  'export:vtt': z.object({ target: z.enum(['foundry', 'owlbear']), maps: z.boolean(), sheets: z.boolean(), handouts: z.boolean() }),
  'notes:master': z.void(),
  'notes:masterLink': z.object({ section: z.string().max(80), linked: z.boolean() }),
  'notes:masterSave': z.object({ section: z.string().max(80), blocks: Blocks }),
  'notes:masterDocx': z.void(),
  'tables:view': z.void(),
  'tables:save': z.object({ id: z.string().min(1).max(80), name: Name, group: z.string().trim().min(1).max(80), card: EntityType, entries: z.array(z.string().max(2000)).min(1).max(1000), hint: z.string().max(300).optional() }),
  'tables:setStatus': z.object({ id: z.string().max(80), status: z.enum(['active', 'defunct']) }),
  'generator:toBoard': z.object({ type: EntityType, name: Name, text: z.string().max(5000) }),
  'ai:recap': z.object({ sessionId: Id, playerSafe: z.boolean() }),
  'map:reimport': z.object({ mapId: Id }),
  'notedoc:reimport': z.object({ id: Id }),
  'notedoc:allLines': z.object({ id: Id }),
  'encounter:replacePicture': z.object({ id: Id, name: z.string().max(260) }),
  'backups:view': z.void(),
  'backups:now': z.void(),
  'backups:open': z.void(),
  'backups:chooseFolder': z.void(),
  'backups:resetFolder': z.void(),
  'charsheet:importDialog': z.void(),
  'campaign:openFolder': z.object({ sub: z.enum(['', 'assets', 'maps', 'styles', 'pictures', 'notes', 'board', 'encounters', 'exports', 'outlines']) }),
  'campaign:info': z.void(),
  'campaign:save': z.void(),
  'campaign:saveCopy': z.void(),
  'app:about': z.void(),
  'app:uninstall': z.void(),
  'app:openLog': z.void(),
  'board:view': z.object({ boardId: Id }),
  'entity:create': z.object({ boardId: Id, type: EntityType, name: Name, position: Position.optional() }),
  'blank:discard': z.object({ id: Id }),
  'entity:duplicate': z.object({ id: Id }),
  'sheet:view': z.object({ entityId: Id }),
  'places:list': z.void(),
  'prep:popout': z.object({ number: z.number().int().min(1).max(100000), part: z.string().regex(/^(opening|scene|discovery|npc|thread|recap|bible|npc:[0-9a-zA-Z-]{1,64})$/) }),
  'main:openSheet': z.object({ entityId: Id }),
  'window:popScreen': z.object({ screen: PopScreen }),
  'window:focusScreen': z.object({ screen: PopScreen }),
  'window:popped': z.void(),
  'ability:add': z.object({ entityId: Id, ability: AbilityFields.partial().extend({ name: Name }) }),
  'ability:update': z.object({ id: Id, patch: AbilityFields.partial() }),
  'ability:setStatus': z.object({ id: Id, status: RowStatus }),
  'ability:addMany': z.object({ entityId: Id, abilities: z.array(AbilityFields.partial().extend({ name: Name })).min(1).max(100) }),
  'srd:attacks': z.void(),
  'knowledge:set': z.object({ entityId: Id, field: KnowledgeField, known: z.boolean() }),
  'knowledge:setString': z.object({ relationshipId: Id, known: z.boolean() }),
  'library:search': z.object({
    query: z.string().max(200), type: EntityType.optional(), tag: z.string().max(40).optional(),
    crMin: OptionalNumber, crMax: OptionalNumber, hpMin: OptionalNumber, hpMax: OptionalNumber
  }),
  'srd:search': z.object({
    query: z.string().max(200), kind: z.enum(['monsters', 'items', 'both']), crMin: OptionalNumber, crMax: OptionalNumber
  }),
  'srd:monsters': z.void(),
  'entity:scaleCr': z.object({ entityId: Id, cr: z.string().min(1).max(10) }),
  'ai:statblock': z.object({ entityId: Id, description: z.string().max(4000), cr: z.string().max(10), size: z.string().max(40), creatureType: z.string().max(80), role: z.string().max(80) }),
  'entity:applyStatBlock': z.object({
    entityId: Id, statblock: StatBlock, source: z.string().max(200),
    actions: z.array(z.object({ name: Name, kind: AbilityKind, description: z.string().max(5000) })).max(30)
  }),
  'ai:charsheet': z.object({ docIds: z.array(Id).min(1).max(10) }),
  'entity:applyCharSheet': z.object({
    entityId: Id.nullable(), name: Name, source: z.string().max(200), statblock: StatBlock.nullable(),
    actions: z.array(z.object({ name: Name, kind: AbilityKind, description: z.string().max(5000) })).max(80).nullable(),
    level: z.string().max(10).nullable(), currentHp: z.number().int().min(0).max(100000).nullable(),
    spellSlots: z.array(z.number().int().min(0).max(9)).length(9).nullable(), fields: z.record(z.string().max(40), z.string().max(20000)),
    spellAbility: z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']).nullable(), prepared: z.array(z.string().max(120)).max(80),
    classes: z.array(z.object({ name: z.string().max(60), subclass: z.string().max(80), level: z.number().int().min(0).max(20) })).max(6).nullable(),
    saveNotes: z.string().max(500).nullable()
  }),
  'entity:pictureDialog': z.object({ entityId: Id }),
  'entity:picturePrompt': z.object({ entityId: Id }),
  'entity:drawPicture': z.object({ entityId: Id, prompt: z.string().trim().min(10).max(4000), styleIds: z.array(Id).max(16), smaller: z.boolean().optional(), outline: OutlineSend.optional() }),
  /** Update picture: the waiting picture changed by the DM's words, with the marks drawn on it (PNG, base64, transparent). */
  'image:update': z.object({
    pendingId: z.string().max(80), change: z.string().trim().min(3).max(2000), add: z.boolean().optional(),
    marks: z.object({ png: z.string().max(8_000_000), labels: z.array(z.object({ colour: z.string().max(20), label: z.string().max(200) })).max(10) }).optional()
  }),
  /** Add to picture: a copy of a kept picture put in the waiting area, so Update can work on it. */
  'image:pendingCopy': z.object({ path: z.string().min(1).max(500) }),
  'outline:upload': z.enum(['follow']).optional(),
  'entity:usePicture': z.object({ entityId: Id, path: z.string().min(1).max(500) }),
  'pictures:view': z.void(),
  'pictures:upload': z.object({ folder: z.string().trim().min(1).max(80) }),
  'pictures:update': z.object({
    key: z.string().min(3).max(120),
    patch: z.object({ name: Name.optional(), folder: z.string().trim().min(1).max(80).optional(), styleFor: z.array(z.enum(STYLE_USES)).max(3).optional(), tags: StyleTagsSchema.optional() })
  }),
  'pictures:readStyle': z.object({ key: z.string().min(3).max(120) }),
  'pictures:addFolder': z.object({ name: z.string().trim().min(1).max(80) }),
  'promptTemplates:list': z.enum(TEMPLATE_USES).optional(),
  'promptTemplates:save': PromptTemplateSchema,
  'promptTemplates:remove': z.object({ name: z.string().min(1).max(80), use: z.enum(TEMPLATE_USES).optional() }),
  'promptTemplates:rename': z.object({ name: z.string().min(1).max(80), next: z.string().trim().min(1).max(80), use: z.enum(TEMPLATE_USES).optional() }),
  'ai:imageInfo': z.void(),
  'entity:keepPicture': z.object({ entityId: Id, pendingId: z.string().max(80), source: z.string().max(200) }),
  'entity:removePicture': z.object({ entityId: Id }),
  'srd:addCopy': z.object({ key: z.string().min(1).max(200), boardId: Id }),
  'desk:view': z.void(),
  'map:importDialog': z.void(),
  'map:setActive': z.object({ mapId: Id }),
  'notes:set': z.object({ text: z.string().max(100000) }),
  'clock:shift': z.object({ minutes: z.number().int().min(-525600).max(525600) }),
  'clock:set': z.object({ minutes: z.number().int().min(0).max(1_000_000_000) }),
  'campaign:update': z.object({
    name: Name.optional(), rulesEdition: RulesEdition.optional(),
    moonOffsetDays: z.number().finite().min(-10000).max(10000).optional(),
    units: z.enum(['metric', 'imperial']).optional(),
    artStyle: z.string().trim().max(500).optional(),
    priceScale: z.number().int().min(1).max(10000).optional(),
    worldOutline: Outline.optional()
  }),
  'storyline:update': z.object({
    storylineId: Id,
    patch: z.object({
      title: Name.optional(), status: StorylineStatus.optional(), isMajor: z.boolean().optional(),
      emblem: z.string().max(40).nullable().optional(), colour: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional()
    })
  }),
  'storyline:setRemoved': z.object({ storylineId: Id, removed: z.boolean() }),
  'map:rename': z.object({ mapId: Id, name: Name }),
  'timeline:view': z.void(),
  'links:view': z.void(),
  'links:set': z.object({ own: z.array(z.object({ text: z.string().min(1).max(200), entityId: Id })), off: z.array(z.string().max(200)) }),
  'act:create': z.object({ storylineId: Id, title: Name, startMin: Minute, endMin: Minute }),
  'act:update': z.object({
    id: Id, patch: z.object({ title: Name.optional(), summary: z.string().max(20000).optional(), startMin: Minute.optional(), endMin: Minute.optional() })
  }),
  'act:setStatus': z.object({ id: Id, status: RowStatus }),
  'act:chooseOutcome': z.object({ actId: Id, outcomeId: Id.nullable() }),
  'outcome:add': z.object({ actId: Id, label: Name }),
  'outcome:update': z.object({
    id: Id, patch: z.object({ label: Name.optional(), description: z.string().max(20000).optional(), isDefault: z.boolean().optional() })
  }),
  'outcome:setStatus': z.object({ id: Id, status: RowStatus }),
  'trigger:add': z.object({ sourceActId: Id, outcomeId: Id, targetStorylineId: Id, effect: TriggerEffect, note: z.string().max(2000).optional() }),
  'trigger:update': z.object({
    id: Id, patch: z.object({ outcomeId: Id.optional(), targetStorylineId: Id.optional(), effect: TriggerEffect.optional(), note: z.string().max(2000).optional() })
  }),
  'trigger:setStatus': z.object({ id: Id, status: RowStatus }),
  'timeline:whatIf': z.object({ actId: Id, outcomeId: Id }),
  'live:view': z.void(),
  'review:view': z.object({ sessionId: Id }),
  'mapscreen:view': z.object({ mapId: Id }),
  'ai:settings': z.void(),
  'ai:choose': z.object({
    kind: z.enum(['text', 'image']), provider: z.string().max(60).nullable(),
    model: z.string().trim().max(200).optional(), baseUrl: z.string().trim().max(500).optional()
  }),
  'ai:setKey': z.object({ provider: z.string().max(60), key: z.string().trim().min(8).max(500) }),
  'ai:removeKey': z.object({ provider: z.string().max(60) }),
  'ai:models': z.object({ provider: z.string().max(60), baseUrl: z.string().trim().max(500).optional() }),
  'ai:test': z.object({ provider: z.string().max(60), model: z.string().trim().max(200), baseUrl: z.string().trim().max(500) }),
  'ai:sceneText': z.object({ ask: z.string().max(2000) }),
  'roll20:export': z.object({ entityIds: z.array(Id).min(1).max(200) }),
  'ai:fill': z.object({ entityId: Id, keys: z.array(z.string().max(40)).max(30), ask: z.string().max(2000), statblock: z.boolean() }),
  'card:applyFill': z.object({ entityId: Id, fields: z.record(z.string().max(40), z.string().max(5000)), source: z.string().max(300), srdKey: z.string().max(200).nullable() }),
  'import:chooseFiles': z.void(),
  'import:preview': z.object({ paths: z.array(z.string().max(2000)).min(1).max(50) }),
  'import:read': z.object({
    paths: z.array(z.string().max(2000)).min(1).max(50), title: z.string().trim().max(200).optional(),
    /** Notes to replace with a file of the same name (path → note id); the others are kept as new notes. */
    replace: z.record(z.string().max(2000), Id).optional()
  }),
  'notes:screen': z.void(),
  'notes:popout': z.void(),
  'session:notes': z.object({ id: Id, text: z.string().max(100000) }),
  'notedoc:content': z.object({ id: Id }),
  'notedoc:create': z.object({ title: Name, folder: FolderPath.or(z.literal('')).optional(), card: Id.optional(), forCard: Id.optional() }),
  'notedoc:save': z.object({ id: Id, blocks: Blocks }),
  'notedoc:setMeta': z.object({ id: Id, meta: NoteMetaInput }),
  'notes:star': z.object({ id: Id, on: z.boolean() }),
  'notedoc:pickPicture': z.void(),
  'notes:search': z.object({ q: z.string().trim().min(1).max(200) }),
  'notes:mentions': z.object({ entityId: Id }),
  'notes:linkedFrom': z.object({ id: Id }),
  'notes:popNote': z.object({ id: Id }),
  'notedoc:rename': z.object({ id: Id, title: Name }),
  'notedoc:setStatus': z.object({ id: Id, status: RowStatus }),
  'notedoc:restore': z.object({ id: Id, file: z.string().max(300) }),
  'notedoc:openInWord': z.object({ id: Id }),
  'notedoc:saveCopy': z.object({ id: Id }),
  'notedoc:edited': z.void(),
  'notedoc:takeEdit': z.object({ id: Id }),
  'notedoc:updateCards': z.object({ id: Id, lines: z.array(z.string().max(20000)).min(1).max(5000) }),
  'notedoc:named': z.object({ names: z.array(z.string().max(300)).max(50) }),
  'notes:outline': z.void(),
  'notedoc:setFolder': z.object({ ids: z.array(Id).min(1).max(1000), folder: FolderPath.or(z.literal('')) }),
  'notes:folder': z.discriminatedUnion('action', [
    z.object({ action: z.literal('create'), path: FolderPath }),
    z.object({ action: z.literal('rename'), from: FolderPath, to: FolderPath }),
    z.object({ action: z.literal('delete'), path: FolderPath }),
    z.object({ action: z.literal('link'), path: FolderPath, card: Id.nullable() })
  ]),
  'notedoc:showInFolder': z.object({ id: Id }),
  'notedoc:duplicate': z.object({ id: Id }),
  'notedoc:combine': z.object({ ids: z.array(Id).min(2).max(200), title: Name, removeOriginals: z.boolean() }),
  'notedoc:forget': z.object({ id: Id }),
  'file:saveDocx': z.object({ name: z.string().trim().min(1).max(120), text: z.string().max(1_000_000) }),
  'import:cancel': z.void(),
  'import:drafts': z.void(),
  'import:draft': z.object({ id: z.string().uuid() }),
  'import:save': z.object({ draft: ImportDraft }),
  'import:commit': z.object({ id: z.string().uuid() }),
  'import:setStatus': z.object({ id: z.string().uuid(), status: z.enum(['open', 'discarded']) }),
  'export:pages': z.object({
    kind: z.enum(['sheets', 'letters', 'board']), entityIds: z.array(Id).min(1).max(200),
    format: z.enum(['pdf', 'jpg']), size: z.enum(['A4', 'Letter']),
    playerSafe: z.boolean().optional(), includeNotes: z.boolean().optional(),
    hand: z.enum(['handwritten', 'printed']).optional(), seal: z.boolean().optional(), title: z.string().trim().max(200).optional()
  }),
  'file:saveText': z.object({ name: z.string().trim().min(1).max(120), content: z.string().max(5_000_000), ext: z.enum(['json', 'js', 'txt']) }),
  'map:saveImage': z.object({ mapId: Id }),
  'encounters:view': z.void(),
  'encounter:create': z.object({ name: Name, locationId: Id.nullable().optional() }),
  'encounter:toBoard': z.object({ id: Id }),
  'prep:addEncounter': z.object({ prepId: Id }),
  'encounter:update': z.object({
    id: Id,
    patch: z.object({
      name: Name, locationId: Id.nullable(), target: z.enum(['low', 'moderate', 'high']), tactics: z.string().max(5000),
      notes: z.string().max(5000), scene: z.string().max(5000), battleMapId: Id.nullable(), pcsOut: z.array(Id).max(100), sketch: SketchInput.nullable(),
      follow: FollowInput.nullable(), story: EncounterStory
    }).partial()
  }),
  'encounter:storyCard': z.object({ encounterId: Id, kind: z.enum(['npc', 'item']), rowId: z.string().min(1).max(64) }),
  'encounter:adjustCr': z.object({ encounterId: Id, entityIds: z.array(Id).min(1).max(50), step: z.union([z.literal(1), z.literal(-1)]) }),
  'encounter:roll': BuildAsk,
  'ai:draftEncounter': BuildAsk.extend({ description: z.string().max(4000) }),
  'ai:writeEncounter': z.object({ encounterId: Id, ask: z.string().max(2000) }),
  'encounter:keepDraft': z.object({ draft: DraftInput, stash: z.boolean() }),
  'encounter:pictures': z.object({ id: Id }),
  'encounter:plan': z.object({ id: Id }),
  'encounter:addPictures': z.object({ id: Id }),
  'encounter:openFolder': z.object({ id: Id, file: z.string().max(260).optional() }),
  'encounter:chooseFolder': z.object({ id: Id }),
  'encounter:resetFolder': z.object({ id: Id }),
  'encounter:removePicture': z.object({ id: Id, name: z.string().min(1).max(260) }),
  'encounter:addCreature': z.object({ encounterId: Id, entityId: Id, count: z.number().int().min(1).max(100) }),
  'encounter:addSrd': z.object({ encounterId: Id, groups: z.array(z.object({ key: z.string().min(1).max(200), count: z.number().int().min(1).max(100) })).min(1).max(50) }),
  'encounter:creature': z.object({ rowId: Id, patch: z.object({ count: z.number().int().min(0).max(100), notes: z.string().max(1000) }).partial() }),
  'encounter:removeCreature': z.object({ encounterId: Id, entityId: Id }),
  'encounter:suggest': z.object({ difficulty: z.enum(['low', 'moderate', 'high']), creatureType: z.string().max(40).optional(), locationId: Id.nullable().optional() }),
  'encounter:run': z.object({ encounterId: Id }),
  'ai:buildEncounter': z.object({ encounterId: Id, ask: z.string().max(2000) }),
  'encounter:addProposals': z.object({
    encounterId: Id, tactics: z.string().max(3000), source: z.string().max(200),
    items: z.array(z.object({
      srdKey: z.string().max(200).optional(), name: Name, count: z.number().int().min(1).max(30), notes: z.string().max(1000),
      statblock: StatBlock.optional(),
      actions: z.array(z.object({ name: Name, kind: AbilityKind, description: z.string().max(5000) })).max(30).optional()
    })).min(1).max(12)
  }),
  'combat:start': z.object({ encounterId: Id }),
  'combat:view': z.object({ id: Id }),
  'combat:update': z.object({ id: Id, state: CombatState, label: z.string().min(1).max(300) }),
  'combat:end': z.object({ id: Id, resolveIds: z.array(Id).max(200).optional(), summary: z.string().max(5000).optional(), xp: z.object({ each: z.number().int().min(0).max(1000000), pcIds: z.array(Id).max(50) }).optional() }),
  'ai:combatAdvice': z.object({ id: Id, ask: z.string().max(1000), focusId: z.string().max(80).optional() }),
  'encounter:houseRules': z.object({ text: z.string().max(20000) }),
  'ai:rateEncounter': z.object({ encounterId: Id }),
  'live:where': z.void(),
  'players:view': z.void(),
  'live:setHeading': z.object({ locationId: Id.nullable() }),
  'ai:ask': z.object({ preset: z.enum(['npc', 'scene', 'complication', 'rumours', 'loot', 'names']).nullable(), ask: z.string().max(2000) }),
  'notes:append': z.object({ text: z.string().trim().min(1).max(20000) }),
  'prep:screen': z.void(),
  'prep:view': z.object({ number: z.number().int().min(1).max(100000).optional() }),
  'prep:create': z.object({ number: z.number().int().min(1).max(100000) }),
  'prep:update': z.object({
    id: Id,
    patch: z.object({
      number: z.number().int().min(1).max(100000), title: z.string().trim().max(300), premise: Text,
      pacingMinutes: z.number().int().min(15).max(1440), backupNames: Text, notes: Text, wantNext: Text,
      links: z.array(z.object({ text: z.string().trim().min(1).max(300), entityId: Id })).max(500),
      playDate: PlayDate
    }).partial()
  }),
  'session:summaryDraft': z.object({ sessionId: Id }),
  'session:setDate': z.object({ number: z.number().int().min(1).max(100000), date: PlayDate }),
  'prep:setStatus': z.object({ id: Id, status: RowStatus }),
  'prep:spread': z.object({ prepId: Id }),
  'prep:rollNames': z.object({ count: z.number().int().min(1).max(20) }),
  'prep:bringThreads': z.object({ prepId: Id }),
  'prep:makeCard': z.object({ itemId: Id, type: EntityType }),
  'prep:saveNote': z.object({ id: Id }),
  'prepItem:add': z.object({ prepId: Id, kind: PrepKind, fields: PrepItemFields.optional() }),
  'prepItem:update': z.object({ id: Id, patch: PrepItemFields }),
  'prepItem:done': z.object({ id: Id, done: z.boolean() }),
  'prepItem:addSecret': z.object({ prepId: Id, kind: z.enum(['secret', 'clue', 'connection']) }),
  'secret:freeLinks': z.void(),
  'secret:save': z.object({
    id: Id.nullable(), kind: z.enum(['secret', 'clue', 'connection']), text: Text,
    connections: z.array(z.object({ id: Id.optional(), sourceId: Id, targetId: Id, type: RelationshipType })).max(50),
    prepItemId: Id.optional()
  }),
  'secret:setText': z.object({ id: Id, text: Text }),
  'secret:remove': z.object({ id: Id }),
  'secret:revive': z.object({ id: Id }),
  'prepItem:setStatus': z.object({ id: Id, status: RowStatus }),
  'prepItem:move': z.object({ id: Id, direction: z.union([z.literal(-1), z.literal(1)]) }),
  'style:list': z.object({ use: z.enum(STYLE_USES).optional() }),
  'style:addDialog': z.void(),
  'style:rename': z.object({ id: Id, name: Name }),
  'style:setStatus': z.object({ id: Id, status: RowStatus }),
  'battlemap:context': z.void(),
  'battlemap:draw': z.object({
    prompt: z.string().trim().min(10).max(4000), styleIds: z.array(Id).max(16), smaller: z.boolean().optional(),
    aspect: z.enum(['1:1', '3:2', '2:3', '16:9', '9:16']),
    /** The sketch as a plan picture (PNG, base64) and its blueprint text: the AI follows it as the layout. */
    blueprint: z.object({ png: z.string().max(4_000_000), text: z.string().max(12000) }).optional(),
    follow: FollowInput.optional()
  }),
  'building:patronCard': z.object({ buildingId: Id, patronId: z.string().min(1).max(40), type: z.enum(['NPC', 'PC']) }),
  'building:secretPool': z.object({ buildingId: Id }),
  'building:moveSecret': z.object({ secretId: z.string().min(1).max(40), from: Id.nullable(), to: Id.nullable() }),
  'building:setCampaignSecrets': z.object({ list: z.array(SecretInput).max(2000), label: z.string().max(120) }),
  'ai:building': z.object({ buildingId: Id, ask: z.string().max(2000) }),
  'battlemap:keep': z.object({
    pendingId: z.string().max(80), name: Name, cols: z.number().int().min(GRID_MIN).max(GRID_MAX),
    prompt: z.string().max(4000), source: z.string().max(300), gridShown: z.boolean().default(false)
  }),
  'battlemap:discard': z.object({ pendingId: z.string().max(80) }),
  'battlemap:importDialog': z.object({ cols: z.number().int().min(GRID_MIN).max(GRID_MAX), gridShown: z.boolean().default(false) }),
  'map:setGrid': z.object({ mapId: Id, cols: z.number().int().min(GRID_MIN).max(GRID_MAX).nullable() }),
  'map:setGridShown': z.object({ mapId: Id, shown: z.boolean() }),
  'world:generate': z.object({
    seed: z.number().int().min(0).max(2147483647), size: z.enum(WORLD_SIZES), land: z.number().min(0.3).max(0.75),
    climate: z.enum(WORLD_CLIMATES), settlements: z.number().int().min(0).max(30)
  }),
  'world:draw': z.object({ prompt: z.string().trim().min(10).max(4000), styleIds: z.array(Id).max(16).optional(), smaller: z.boolean().optional(), outline: OutlineSend.optional() }),
  'world:keep': z.object({ pendingId: z.string().max(80), name: Name, widthKm: z.number().positive().max(200000).nullable() }),
  'world:findRegions': z.object({ mapId: Id, ask: z.string().max(2000) }),
  'world:addRegions': z.object({ mapId: Id, regions: z.array(PlaceShapeInput).min(1).max(200), source: z.string().max(300) }),
  'guide:finish': z.void(),
  'region:detail': z.object({ regionId: Id }),
  'region:create': z.object({
    mapId: Id, polygon: Polygon, locationId: Id.optional(), newName: Name.optional(), parentLocationId: Id.nullable().optional()
  }),
  'region:update': z.object({ id: Id, patch: z.object({ polygon: Polygon.optional(), locationId: Id.optional(), parentLocationId: Id.nullable().optional() }) }),
  'region:setStatus': z.object({ id: Id, status: RowStatus }),
  'map:setScale': z.object({
    mapId: Id, widthKm: z.number().positive().max(200000).nullable(), travelKmh: z.number().positive().max(1000).optional(),
    bar: z.object({ len: z.number().min(1).max(999), unit: z.enum(['ft', 'mi', 'm', 'km']) }).optional()
  }),
  'map:setScaleKey': z.object({ mapId: Id, shown: z.boolean().optional(), x: z.number().finite().optional(), y: z.number().finite().optional() }),
  'pc:move': z.object({ entityId: Id, mapId: Id, x: z.number().finite().optional(), y: z.number().finite().optional(), joined: z.boolean().optional() }),
  'party:estimate': z.object({ mapId: Id, x: z.number().finite(), y: z.number().finite() }),
  'party:move': z.object({ mapId: Id, x: z.number().finite(), y: z.number().finite(), minutes: z.number().int().min(0).max(525600), rememberTime: z.boolean().optional() }),
  'review:decide': z.object({
    sessionId: Id, key: z.string().min(1).max(200),
    action: z.enum(['approve', 'reject', 'flag', 'explain', 'revive', 'remove_entry', 'reopen']),
    outcomeId: Id.optional(), fields: z.array(KnowledgeField).max(5).optional(), note: z.string().max(5000).optional()
  }),
  'review:approveAll': z.object({ sessionId: Id }),
  'review:feedback': z.object({ logId: Id, feedback: EncounterFeedback.nullable() }),
  'review:draftPlayerRecap': z.object({ sessionId: Id }),
  'review:undoSession': z.object({ sessionId: Id }),
  'session:start': z.void(),
  'session:end': z.object({ id: Id }),
  'session:update': z.object({
    id: Id, patch: z.object({
      number: z.number().int().min(1).max(100000).optional(), sceneText: z.string().max(20000).optional(),
      recap: z.string().max(50000).optional(), playerRecap: z.string().max(50000).optional()
    })
  }),
  'session:setStatus': z.object({ id: Id, status: RowStatus }),
  'log:add': z.object({ kind: LogKind, text: z.string().max(5000), entityId: Id.nullable().optional(), minutesTaken: z.number().int().min(0).max(525600).optional() }),
  'log:update': z.object({
    id: Id, patch: z.object({ text: z.string().max(5000).optional(), kind: LogKind.optional(), atMin: Minute.optional(), entityId: Id.nullable().optional() })
  }),
  'log:setStatus': z.object({ id: Id, status: RowStatus }),
  'party:setHp': z.object({ entityId: Id, hp: z.number().int().min(0).max(100000) }),
  'party:rest': z.object({ kind: z.enum(['short', 'long']) }),
  'party:setLevel': z.object({ level: z.number().int().min(1).max(20) }),
  'generate:character': z.void(),
  'generate:tavern': z.void(),
  'generate:encounter': z.object({ difficulty: z.enum(['low', 'moderate', 'high']), creatureType: z.string().max(40).optional() }),
  'generate:keep': z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('character'), payload: GenPerson, stash: z.boolean() }),
    z.object({ kind: z.literal('tavern'), payload: GenTavern, stash: z.boolean() }),
    z.object({ kind: z.literal('encounter'), payload: GenEncounter, stash: z.boolean() })
  ]),
  'map:setStatus': z.object({ mapId: Id, status: RowStatus }),
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
  'relationship:create': z.object({
    sourceId: Id, targetId: Id, type: RelationshipType, isSecret: z.boolean(), boardId: Id.optional(),
    /** Set for a new kind of link: it joins the list with this colour. */
    colour: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional()
  }),
  'relationship:update': z.object({
    id: Id, patch: z.object({ type: RelationshipType.optional(), isSecret: z.boolean().optional(), description: Text.optional() })
  }),
  'relationship:setStatus': z.object({ id: Id, status: RowStatus }),
  'note:create': z.object({ boardId: Id, position: Position, text: z.string().max(5000) }),
  'note:update': z.object({ itemId: Id, text: z.string().max(5000) }),
  'note:setStatus': z.object({ itemId: Id, status: RowStatus }),
  'items:move': z.object({ moves: z.array(Position.extend({ itemId: Id })).max(500) }),
  'item:resize': z.object({ itemId: Id, size: z.object({ w: z.number().min(40).max(20000), h: z.number().min(30).max(20000) }).nullable() }),
  'board:setHidden': z.object({ kind: z.enum(['entity', 'string', 'item']), id: Id, hidden: z.boolean() }),
  'act:mark': z.object({ entityId: Id, actId: Id, on: z.boolean() }),
  'stringTypes:set': z.object({ types: z.array(z.object({ type: RelationshipType, colour: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable() })).max(100) }),
  'entityType:setColour': z.object({ type: EntityType, colour: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable(), clearOwn: z.boolean() }),
  'stringTypes:rename': z.object({ from: z.string().min(1).max(40), to: RelationshipType }),
  'board:linkPositions': z.object({ on: z.boolean(), winner: z.enum(['global', 'storyline']) }),
  'board:sharedStrings': z.object({ on: z.boolean(), winner: z.enum(['global', 'storyline']) }),
  'boardImage:add': z.object({ boardId: Id, mapId: Id.nullable(), position: Position, file: z.string().optional() }),
  'boardImage:update': z.object({ itemId: Id, patch: z.object({ opacity: z.number().min(0.05).max(1).optional(), locked: z.boolean().optional(), name: Name.optional() }) }),
  'storyline:create': z.object({ title: Name }),
  'history:view': z.void(),
  'history:undo': z.void(),
  'history:redo': z.void(),
  'history:undoTo': z.object({ commandId: Id }),
  // Delete for good from History (owner, 2026-10-15): rows in one undo step; notes files to the Recycle Bin.
  'history:forget': z.object({
    items: z.array(z.object({ kind: z.enum(['entity', 'secret', 'string', 'note', 'storyline', 'act', 'outcome', 'trigger', 'map', 'region', 'style', 'prep', 'prepItem']), id: Id })),
    noteDocs: z.array(Id)
  })
} as const

export interface IpcOutputs {
  'profile:recent': RecentCampaign[]
  'campaign:create': CampaignInfo | null // null = dialog cancelled
  'campaign:openDialog': CampaignInfo | null
  'campaign:openRecent': CampaignInfo
  'campaign:close': void
  'campaign:delete': string
  'export:vtt': { folder: string; count: number }
  'notes:master': Array<{ id: string; title: string; kind: 'dm' | 'session' | 'doc'; blocks: Block[]; linked: boolean; picture: string | null }>
  'notes:masterLink': void
  'notes:masterSave': void
  'notes:masterDocx': string | null
  'tables:view': Array<RollTable & { status: 'active' | 'defunct' }>
  'tables:save': void
  'tables:setStatus': void
  'generator:toBoard': string
  'ai:recap': AiSuggestion
  'map:reimport': MapView | null
  'notedoc:reimport': { changed: string[] } | null
  'notedoc:allLines': string[]
  'encounter:replacePicture': boolean
  'backups:view': { folder: string; own: boolean; list: Array<{ name: string; at: string }> }
  'backups:now': string
  'backups:open': void
  'backups:chooseFolder': string | null
  'backups:resetFolder': void
  'charsheet:importDialog': string[]
  'campaign:openFolder': void
  'campaign:info': CampaignInfo | null
  'campaign:save': string
  'campaign:saveCopy': string | null
  'app:about': { version: string; campaignFolder: string | null; dataFolder: string; installed: boolean }
  'app:uninstall': void
  'app:openLog': void
  'board:view': BoardView
  'entity:create': EntityView
  'blank:discard': boolean
  'entity:duplicate': EntityView
  'sheet:view': SheetView
  'prep:popout': void
  'main:openSheet': void
  'window:popScreen': void
  'window:focusScreen': void
  'window:popped': string[]
  'places:list': Array<{ id: string; name: string; type: 'LOCATION' | 'BUILDING'; fromMap: boolean }>
  'ability:add': AbilityView
  'ability:update': void
  'ability:setStatus': void
  'ability:addMany': number
  'srd:attacks': SrdAttacks
  'knowledge:set': void
  'knowledge:setString': void
  'library:search': LibrarySearch
  'srd:search': SrdSearch
  'srd:monsters': SrdMonsterRow[]
  'entity:scaleCr': void
  'ai:statblock': { statblock: StatBlock; actions: Array<{ name: string; kind: z.infer<typeof AbilityKind>; description: string }>; source: string }
  'entity:applyStatBlock': void
  'ai:charsheet': {
    name: string; level: string; currentHp: number | null; spellSlots: number[] | null; fields: Record<string, string>
    spellAbility: string | null; prepared: string[]; classes: Array<{ name: string; subclass: string; level: number }>; saveNotes: string
    statblock: StatBlock; actions: Array<{ name: string; kind: z.infer<typeof AbilityKind>; description: string }>; source: string
    /** PC and NPC cards it could go on; `match` is the one whose name fits best. */
    targets: Array<{ id: string; name: string; type: string }>; match: string | null
  }
  'entity:applyCharSheet': string
  'entity:pictureDialog': boolean
  'entity:picturePrompt': { subject: string; description: string; figure: string }
  'entity:drawPicture': PendingImageView & { source: string; prompt: string }
  'image:update': PendingImageView & { source: string; prompt: string }
  'image:pendingCopy': PendingImageView
  'outline:upload': string | null
  'entity:usePicture': void
  'pictures:view': PicturesView
  'pictures:upload': number | null
  'pictures:update': void
  'pictures:readStyle': { tags: StyleTags; source: string }
  'pictures:addFolder': void
  'promptTemplates:list': PromptTemplate[]
  'promptTemplates:save': void
  'promptTemplates:remove': void
  'promptTemplates:rename': void
  'ai:imageInfo': { name: string | null; maxReferences: number }
  'entity:keepPicture': void
  'entity:removePicture': void
  'srd:addCopy': EntityView
  'desk:view': DeskView
  'map:importDialog': MapView | null
  'map:setActive': void
  'notes:set': void
  'clock:shift': number
  'clock:set': void
  'campaign:update': void
  'storyline:update': void
  'storyline:setRemoved': void
  'map:rename': void
  'timeline:view': TimelineView
  'links:view': WordLinksView
  'links:set': void
  'act:create': string
  'act:update': void
  'act:setStatus': void
  'act:chooseOutcome': void
  'outcome:add': string
  'outcome:update': void
  'outcome:setStatus': void
  'trigger:add': string
  'trigger:update': void
  'trigger:setStatus': void
  'timeline:whatIf': WhatIfView
  'live:view': LiveView
  'review:view': ReviewView
  'mapscreen:view': MapScreenView
  'ai:settings': AiSettingsView
  'ai:choose': void
  'ai:setKey': void
  'ai:removeKey': void
  'ai:models': string[]
  'ai:test': string
  'ai:sceneText': AiSuggestion
  'roll20:export': Roll20Export
  'ai:fill': { fields: Record<string, string>; srd: { key: string; name: string; cr: string } | null; source: string }
  'card:applyFill': string[]
  'import:chooseFiles': string[]
  'import:preview': Array<{ path: string; name: string; kind: string; parts: number; chars: number; warnings: string[]; error: string | null }>
  'import:read': ImportDraft
  'notes:screen': NotesScreenView
  'notes:popout': void
  'session:notes': void
  'notedoc:content': { blocks: Block[]; url: string | null }
  'notedoc:create': string
  'notedoc:save': { changed: string[] }
  'notedoc:setMeta': void
  'notes:star': void
  'notedoc:pickPicture': string | null
  'notes:search': Array<{ docId: string; title: string; heading: number; headingText: string; text: string }>
  'notes:mentions': import('./types').NoteMentionView[]
  'notes:linkedFrom': { preps: Array<{ number: number; title: string }>; notes: Array<{ id: string; title: string }> }
  'notes:popNote': void
  'notedoc:rename': void
  'notedoc:setStatus': void
  'notedoc:restore': void
  'notedoc:openInWord': void
  'notedoc:saveCopy': string | null
  'notedoc:edited': Array<{ id: string; title: string }>
  'notedoc:takeEdit': { changed: string[] }
  'notedoc:updateCards': ImportDraft
  'notedoc:named': Array<{ id: string; title: string; originalName: string }>
  /** Headings per note, keyed like the master notes sections: 'dm', 'session:<id>', 'doc:<id>'. */
  'notes:outline': Record<string, Array<{ level: 'h1' | 'h2' | 'h3'; text: string }>>
  'notedoc:setFolder': void
  'notes:folder': void
  'notedoc:showInFolder': void
  'notedoc:duplicate': string
  'notedoc:combine': string
  'notedoc:forget': void
  'file:saveDocx': string | null
  'import:cancel': void
  'import:drafts': ImportDraftSummary[]
  'import:draft': ImportDraft
  'import:save': void
  'import:commit': { created: number; merged: number; storylines: number; links: number }
  'import:setStatus': void
  'export:pages': string | null
  'file:saveText': string | null
  'map:saveImage': string | null
  'encounters:view': EncountersView
  'encounter:create': string
  'encounter:toBoard': void
  'prep:addEncounter': string
  'encounter:update': void
  'encounter:storyCard': string
  'encounter:adjustCr': void
  'encounter:roll': import('./types').EncounterDraft | null
  'ai:draftEncounter': import('./types').EncounterDraft
  'ai:writeEncounter': { name: string; scene: string; story: import('./encounterStory').EncounterStory; source: string }
  'encounter:keepDraft': string
  'ai:buildEncounter': { creatures: BuiltCreature[]; tactics: string; source: string }
  'encounter:addProposals': void
  'combat:start': string
  'combat:view': CombatView
  'combat:update': void
  'combat:end': void
  'ai:combatAdvice': AiSuggestion
  'encounter:plan': BattlePlan
  'encounter:pictures': { folder: string; own: boolean; files: Array<{ name: string; url: string; picture: boolean }>; removed: number }
  'encounter:addPictures': number
  'encounter:openFolder': void
  'encounter:chooseFolder': number | null
  'encounter:resetFolder': number
  'encounter:removePicture': void
  'encounter:addCreature': void
  'encounter:addSrd': void
  'encounter:creature': void
  'encounter:removeCreature': void
  'encounter:suggest': { groups: Array<{ key: string; name: string; cr: string; count: number; xp: number }>; totalXp: number; budget: number; creatureType: string; summary: string; note?: string } | null
  'encounter:run': LogView
  'encounter:houseRules': void
  'ai:rateEncounter': AiSuggestion
  'live:where': WhereView
  'players:view': PlayersView
  'live:setHeading': void
  'ai:ask': AiSuggestion
  'notes:append': void
  'prep:screen': PrepScreenView
  'prep:view': PrepView | null
  'prep:create': string
  'prep:update': void
  'session:setDate': void
  'session:summaryDraft': string
  'prep:setStatus': void
  'prep:spread': void
  'prep:bringThreads': number
  'prep:makeCard': string
  'prep:saveNote': string
  'prep:rollNames': string[]
  'prepItem:add': string
  'prepItem:update': void
  'prepItem:done': void
  'prepItem:addSecret': string
  'secret:save': string
  'secret:freeLinks': Array<{ id: string; sourceId: string; targetId: string; type: string }>
  'secret:setText': void
  'secret:remove': void
  'secret:revive': void
  'prepItem:setStatus': void
  'prepItem:move': void
  'style:list': StyleExampleView[]
  'style:addDialog': StyleExampleView[] | null
  'style:rename': void
  'style:setStatus': void
  'battlemap:context': BattleMapContext
  'battlemap:draw': PendingImageView & { source: string }
  'battlemap:keep': MapView
  'building:patronCard': string
  'building:secretPool': { own: BSecret[]; clueCards: Array<{ id: string; name: string; text: string }>; elsewhere: Array<{ buildingId: string; buildingName: string; secret: BSecret }> }
  'building:moveSecret': void
  'building:setCampaignSecrets': void
  'ai:building': { proposal: BuildingProposal; source: string }
  'battlemap:discard': void
  'battlemap:importDialog': MapView | null
  'map:setGrid': void
  'map:setGridShown': void
  'world:generate': PendingImageView & { regions: PlaceShape[]; source: string }
  'world:draw': PendingImageView & { source: string }
  'world:keep': MapView
  'world:findRegions': { regions: PlaceShape[]; dropped: number; source: string }
  'world:addRegions': string[]
  'guide:finish': void
  'region:detail': RegionDetail
  'region:create': string
  'region:update': void
  'region:setStatus': void
  'map:setScale': void
  'map:setScaleKey': void
  'pc:move': void
  'party:estimate': TravelEstimateView
  'party:move': void
  'review:decide': void
  'review:approveAll': number
  'review:feedback': void
  'review:draftPlayerRecap': string
  'review:undoSession': number
  'session:start': SessionView
  'session:end': void
  'session:update': void
  'session:setStatus': void
  'log:add': LogView
  'log:update': void
  'log:setStatus': void
  'party:setHp': void
  'party:rest': void
  'party:setLevel': void
  'generate:character': GeneratedView
  'generate:tavern': GeneratedView
  'generate:encounter': GeneratedView | null
  'generate:keep': string[]
  'map:setStatus': void
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
  'items:move': string[]
  'item:resize': void
  'board:setHidden': void
  'act:mark': void
  'board:many': void
  'stringTypes:set': void
  'entityType:setColour': void
  'stringTypes:rename': number
  'board:linkPositions': void
  'board:sharedStrings': void
  'boardImage:add': BoardItemView | null
  'boardImage:update': void
  'storyline:create': BoardSummary
  'history:view': HistoryView
  'history:undo': string | null
  'history:redo': string | null
  'history:undoTo': number
  'history:forget': void
}

export type IpcChannel = keyof typeof ipcInputs
export type IpcInput<C extends IpcChannel> = z.input<(typeof ipcInputs)[C]>

/** Errors cross IPC as plain data so the UI can show the message. */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** Progress while the AI reads notes (sent from main to the window). */
export interface ImportProgress { file: string; part: number; parts: number; message: string }

export interface DungeonZenApi {
  invoke<C extends IpcChannel>(channel: C, input: IpcInput<C>): Promise<IpcResult<IpcOutputs[C]>>
  /** The path of a file dropped from Explorer. */
  pathForFile(file: File): string
  /** Drag a dz-asset picture out of the app as its real file (Roll20, Explorer). */
  dragOut(url: string): void
  /** Notes import progress; returns a function that stops listening. */
  onImportProgress(fn: (p: ImportProgress) => void): () => void
  /** Another window (the popped-out DM notes) changed something; returns a function that stops listening. */
  onChanged(fn: () => void): () => void
  /** A pop-out window asked the main window to open this card's sheet. */
  onOpenSheet(fn: (entityId: string) => void): () => void
  /** The screens open in windows of their own changed (main window only). */
  onPopped(fn: (screens: string[]) => void): () => void
}

export { IPC_PREFIX } from './ipcPrefix'
