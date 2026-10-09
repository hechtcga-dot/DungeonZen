import { create } from 'zustand'
import { call } from './api'
import type { IpcChannel, IpcInput, IpcOutputs } from '../shared/ipc'
import type { CombatView, BoardView, CampaignInfo, DeskView, HistoryView, LiveView, MapScreenView, PrepScreenView, PrepView, ReviewView, WhereView, PlayersView, EncountersView, SheetView, TimelineView } from '../shared/types'
import type { Units } from '../shared/units'

export type Selection =
  | { kind: 'entity'; id: string }
  | { kind: 'string'; id: string }
  | { kind: 'note'; id: string }
  | null

export type BoardPanel = 'inspector' | 'history' | 'connections' | 'storylines'
export type Screen = 'desk' | 'board' | 'map' | 'timeline' | 'live' | 'review' | 'sheet' | 'library' | 'prep' | 'players' | 'encounters' | 'import' | 'guide' | 'combat'
/** DM Prep has every screen; Live is trimmed to the table; Players is safe to show the players. */
export type Mode = 'prep' | 'live' | 'players'
export const SCREEN_NAMES: Record<Screen, string> = {
  desk: 'the desk', board: 'the board', map: 'the map', timeline: 'the timeline', live: 'the live desk', review: 'the review',
  sheet: 'the previous card', library: 'the library', prep: 'session prep', players: 'player preview', encounters: 'encounters',
  import: 'notes', guide: 'getting started', combat: 'the fight'
}
export const MODE_HOME: Record<Mode, Screen> = { prep: 'desk', live: 'live', players: 'players' }
/** The map belongs to every mode; other screens belong to one. */
const modeFor = (screen: Screen, current: Mode): Mode =>
  screen === 'map' ? current : screen === 'live' || screen === 'review' ? 'live' : screen === 'players' ? 'players' : 'prep'

interface BoardState {
  info: CampaignInfo | null
  screen: Screen
  boardId: string | null
  view: BoardView | null
  history: HistoryView | null
  sheet: SheetView | null
  desk: DeskView | null
  timeline: TimelineView | null
  live: LiveView | null
  review: ReviewView | null
  mapScreen: MapScreenView | null
  mode: Mode
  setMode(mode: Mode): void
  prepScreen: PrepScreenView | null
  /** Live desk: where the party is and what is around them. */
  where: WhereView | null
  players: PlayersView | null
  encounters: EncountersView | null
  /** The encounter open on the Encounters screen. */
  encounterId: string | null
  openEncounter(id: string | null): void
  /** Run encounter: the fight on the combat screen. */
  combatId: string | null
  combat: CombatView | null
  openCombat(id: string): Promise<void>
  prep: PrepView | null
  /** The session number shown on the Prep screen (null: the running or next session). */
  prepNumber: number | null
  setPrepNumber(n: number | null): void
  reviewSessionId: string | null
  openReview(sessionId: string): Promise<void>
  sheetId: string | null
  /** Where Back (and the Backspace key) goes: the screens the DM came from. */
  backStack: Array<{ screen: Screen; sheetId: string | null }>
  goBack(): Promise<void>
  /** A card to bring into view the next time the board shows. */
  focusEntityId: string | null
  panel: BoardPanel
  selection: Selection
  search: string
  message: { text: string; isError: boolean } | null
  /** Settings › AI services is open. */
  aiSettingsOpen: boolean
  setAiSettingsOpen(open: boolean): void
  /** Notes screen: open on Import (the getting started guide) instead of Your notes. */
  notesTab: 'notes' | 'import'
  /** Getting started: the step on show (kept so Back returns to it). */
  guideStep: 'map' | 'regions' | 'notes'
  /** The battle map dialog is open. */
  battleMapOpen: boolean
  setBattleMapOpen(open: boolean): void

  openCampaign(info: CampaignInfo): Promise<void>
  closeCampaign(): Promise<void>
  showBoard(boardId: string): Promise<void>
  goTo(screen: 'desk' | 'board' | 'map' | 'timeline' | 'live' | 'library' | 'prep' | 'players' | 'encounters' | 'import' | 'guide'): void
  openSheet(entityId: string): Promise<void>
  showOnBoard(entityId: string): Promise<void>
  refresh(): Promise<void>
  /** Runs a change in the main process, then reloads what is on screen. */
  act<C extends IpcChannel>(channel: C, input: IpcInput<C>): Promise<IpcOutputs[C] | undefined>
  /** A read that changes nothing: no refresh afterwards (refreshing would re-run effects that read). */
  query<C extends IpcChannel>(channel: C, input: IpcInput<C>): Promise<IpcOutputs[C] | undefined>
  undo(): Promise<void>
  redo(): Promise<void>
  setPanel(panel: BoardPanel): void
  select(selection: Selection): void
  setSearch(text: string): void
  say(text: string, isError?: boolean): void
}

export const useBoard = create<BoardState>((set, get) => ({
  info: null,
  screen: 'board',
  boardId: null,
  view: null,
  history: null,
  sheet: null,
  desk: null,
  timeline: null,
  live: null,
  review: null,
  mapScreen: null,
  mode: 'prep',
  setMode(mode) { set({ mode, screen: MODE_HOME[mode], backStack: pushed(get(), MODE_HOME[mode]) }); void get().refresh() },
  prepScreen: null,
  where: null,
  players: null,
  encounters: null,
  encounterId: null,
  combatId: null,
  combat: null,
  async openCombat(id) {
    const { screen, sheetId, backStack } = get()
    set({ screen: 'combat', combatId: id, combat: null, backStack: screen === 'combat' ? backStack : [...backStack, { screen, sheetId }].slice(-20) })
    await get().refresh()
  },
  openEncounter(id) { set({ encounterId: id, screen: 'encounters', mode: 'prep', backStack: pushed(get(), 'encounters') }); void get().refresh() },
  prep: null,
  prepNumber: null,
  setPrepNumber(n) { set({ prepNumber: n }); void get().refresh() },
  aiSettingsOpen: false,
  setAiSettingsOpen(open) { set({ aiSettingsOpen: open }) },
  notesTab: 'notes',
  guideStep: 'map',
  battleMapOpen: false,
  setBattleMapOpen(open) { set({ battleMapOpen: open }) },
  reviewSessionId: null,
  sheetId: null,
  backStack: [],
  async goBack() {
    const stack = get().backStack
    const prev = stack.at(-1) ?? { screen: 'board' as Screen, sheetId: null }
    set({ backStack: stack.slice(0, -1), screen: prev.screen, sheetId: prev.sheetId, sheet: null, mode: modeFor(prev.screen, get().mode) })
    await get().refresh()
  },
  focusEntityId: null,
  panel: 'inspector',
  selection: null,
  search: '',
  message: null,

  async openCampaign(info) {
    set({
      info, screen: info.gettingStarted ? 'guide' : 'desk', mode: 'prep', prepNumber: null, boardId: info.globalBoardId, desk: null, selection: null, view: null, history: null,
      sheet: null, sheetId: null, search: '', backStack: [], guideStep: 'map'
    })
    await get().refresh()
  },

  async closeCampaign() {
    await call('campaign:close', undefined)
    set({ info: null, boardId: null, view: null, history: null, sheet: null, desk: null, sheetId: null, selection: null })
  },

  async showBoard(boardId) {
    set({ boardId, selection: null, screen: 'board', mode: 'prep', backStack: pushed(get(), 'board') })
    await get().refresh()
  },

  goTo(screen) {
    set({ screen, mode: modeFor(screen, get().mode), backStack: pushed(get(), screen), ...(screen === 'guide' ? { guideStep: 'map' as const } : {}) })
    void get().refresh()
  },

  async openReview(sessionId) {
    set({ screen: 'review', reviewSessionId: sessionId, review: null, backStack: pushed(get(), 'review') })
    await get().refresh()
  },

  async openSheet(entityId) {
    const { screen, sheetId, backStack } = get()
    if (screen === 'sheet' && sheetId === entityId) return
    set({ screen: 'sheet', sheetId: entityId, sheet: null, backStack: [...backStack, { screen, sheetId }].slice(-20) })
    await get().refresh()
  },

  async showOnBoard(entityId) {
    const { info } = get()
    if (!info) return
    set({ boardId: info.globalBoardId, screen: 'board', backStack: pushed(get(), 'board'), focusEntityId: entityId, selection: { kind: 'entity', id: entityId } })
    await get().refresh()
  },

  async refresh() {
    const { boardId, panel, screen, sheetId, reviewSessionId, prepNumber } = get()
    if (!boardId) return
    try {
      const [view, history, sheet, desk, info, timeline, live, review] = await Promise.all([
        call('board:view', { boardId }),
        panel === 'history' ? call('history:view', undefined) : Promise.resolve(get().history),
        screen === 'sheet' && sheetId ? call('sheet:view', { entityId: sheetId }).catch(() => null) : Promise.resolve(null),
        screen === 'desk' || screen === 'map' ? call('desk:view', undefined) : Promise.resolve(get().desk),
        call('campaign:info', undefined),
        screen === 'timeline' ? call('timeline:view', undefined) : Promise.resolve(get().timeline),
        screen === 'live' ? call('live:view', undefined) : Promise.resolve(get().live),
        screen === 'review' && reviewSessionId ? call('review:view', { sessionId: reviewSessionId }).catch(() => null) : Promise.resolve(null)
      ])
      if (screen === 'review' && !review) {
        // The session is gone, for example the whole session was undone.
        set({ view, history, desk, timeline, info: info ?? get().info, review: null, reviewSessionId: null, screen: 'live' })
        await get().refresh()
        return
      }
      if (screen === 'sheet' && !sheet) {
        // The entity is gone, for example its creation was just undone.
        set({ view, history, desk, info: info ?? get().info, sheet: null, sheetId: null, screen: 'board' })
        return
      }
      const mapId = screen === 'live' ? live?.map?.id : screen === 'desk' || screen === 'map' ? desk?.map?.id : undefined
      const mapScreen = mapId ? await call('mapscreen:view', { mapId }).catch(() => null) : get().mapScreen
      const [prepScreen, prep] = screen === 'prep'
        ? await Promise.all([call('prep:screen', undefined), call('prep:view', prepNumber ? { number: prepNumber } : {})])
        : [get().prepScreen, get().prep]
      const where = screen === 'live' ? await call('live:where', undefined).catch(() => null) : get().where
      const players = screen === 'players' ? await call('players:view', undefined).catch(() => null) : get().players
      const encounters = screen === 'encounters' ? await call('encounters:view', undefined).catch(() => null) : get().encounters
      const combatId = get().combatId
      const combat = screen === 'combat' && combatId ? await call('combat:view', { id: combatId }).catch(() => null) : get().combat
      if (screen === 'combat' && !combat) {
        // The fight is gone (its start was undone): back to the encounters.
        set({ screen: 'encounters', combatId: null, combat: null })
        await get().refresh()
        return
      }
      set({ view, history, sheet, desk, timeline, live, review, mapScreen, prepScreen, prep, where, players, encounters, combat, info: info ?? get().info })
    } catch (err) {
      get().say((err as Error).message, true)
    }
  },

  async act(channel, input) {
    try {
      const value = await call(channel, input)
      await get().refresh()
      return value
    } catch (err) {
      get().say((err as Error).message, true)
      return undefined
    }
  },

  async query(channel, input) {
    try {
      return await call(channel, input)
    } catch (err) {
      get().say((err as Error).message, true)
      return undefined
    }
  },

  async undo() {
    const label = await get().act('history:undo', undefined)
    get().say(label ? `Undid: ${label}` : 'Nothing to undo')
  },

  async redo() {
    const label = await get().act('history:redo', undefined)
    get().say(label ? `Redid: ${label}` : 'Nothing to redo')
  },

  setPanel(panel) {
    set({ panel })
    if (panel === 'history') void get().refresh()
  },

  select(selection) {
    set({ selection })
  },

  setSearch(search) {
    set({ search })
  },

  say(text, isError = false) {
    set({ message: { text, isError } })
  }
}))

/** Current board view; components below the board screen can rely on it being loaded. */
/** What the screens show: metric (default) or imperial (Campaign settings). */
export const useUnits = (): Units => useBoard((s) => s.info?.units ?? 'metric')

export function useView(): BoardView {
  const view = useBoard((s) => s.view)
  if (!view) throw new Error('Board view not loaded')
  return view
}

/** The back stack with the screen on show added, when going to another screen. */
function pushed({ screen, sheetId, backStack }: Pick<BoardState, 'screen' | 'sheetId' | 'backStack'>, to: Screen): BoardState['backStack'] {
  if (to === screen) return backStack
  return [...backStack, { screen, sheetId }].slice(-20)
}
