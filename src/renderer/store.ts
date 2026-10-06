import { create } from 'zustand'
import { call } from './api'
import type { IpcChannel, IpcInput, IpcOutputs } from '../shared/ipc'
import type { BoardView, CampaignInfo, DeskView, HistoryView, LiveView, MapScreenView, PrepScreenView, PrepView, ReviewView, WhereView, PlayersView, SheetView, TimelineView } from '../shared/types'

export type Selection =
  | { kind: 'entity'; id: string }
  | { kind: 'string'; id: string }
  | { kind: 'note'; id: string }
  | null

export type Screen = 'desk' | 'board' | 'map' | 'timeline' | 'live' | 'review' | 'sheet' | 'library' | 'prep' | 'players'
/** DM Prep has every screen; Live is trimmed to the table; Players is safe to show the players. */
export type Mode = 'prep' | 'live' | 'players'
export const MODE_HOME: Record<Mode, Screen> = { prep: 'desk', live: 'live', players: 'players' }

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
  prep: PrepView | null
  /** The session number shown on the Prep screen (null: the running or next session). */
  prepNumber: number | null
  setPrepNumber(n: number | null): void
  reviewSessionId: string | null
  openReview(sessionId: string): Promise<void>
  sheetId: string | null
  /** A card to bring into view the next time the board shows. */
  focusEntityId: string | null
  panel: 'inspector' | 'history'
  selection: Selection
  search: string
  message: { text: string; isError: boolean } | null
  /** Settings › AI services is open. */
  aiSettingsOpen: boolean
  setAiSettingsOpen(open: boolean): void
  /** The battle map dialog is open. */
  battleMapOpen: boolean
  setBattleMapOpen(open: boolean): void

  openCampaign(info: CampaignInfo): Promise<void>
  closeCampaign(): Promise<void>
  showBoard(boardId: string): Promise<void>
  goTo(screen: 'desk' | 'board' | 'map' | 'timeline' | 'live' | 'library' | 'prep' | 'players'): void
  openSheet(entityId: string): Promise<void>
  showOnBoard(entityId: string): Promise<void>
  refresh(): Promise<void>
  /** Runs a change in the main process, then reloads what is on screen. */
  act<C extends IpcChannel>(channel: C, input: IpcInput<C>): Promise<IpcOutputs[C] | undefined>
  /** A read that changes nothing: no refresh afterwards (refreshing would re-run effects that read). */
  query<C extends IpcChannel>(channel: C, input: IpcInput<C>): Promise<IpcOutputs[C] | undefined>
  undo(): Promise<void>
  redo(): Promise<void>
  setPanel(panel: 'inspector' | 'history'): void
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
  setMode(mode) { set({ mode, screen: MODE_HOME[mode] }); void get().refresh() },
  prepScreen: null,
  where: null,
  players: null,
  prep: null,
  prepNumber: null,
  setPrepNumber(n) { set({ prepNumber: n }); void get().refresh() },
  aiSettingsOpen: false,
  setAiSettingsOpen(open) { set({ aiSettingsOpen: open }) },
  battleMapOpen: false,
  setBattleMapOpen(open) { set({ battleMapOpen: open }) },
  reviewSessionId: null,
  sheetId: null,
  focusEntityId: null,
  panel: 'inspector',
  selection: null,
  search: '',
  message: null,

  async openCampaign(info) {
    set({
      info, screen: 'desk', mode: 'prep', prepNumber: null, boardId: info.globalBoardId, desk: null, selection: null, view: null, history: null,
      sheet: null, sheetId: null, search: ''
    })
    await get().refresh()
  },

  async closeCampaign() {
    await call('campaign:close', undefined)
    set({ info: null, boardId: null, view: null, history: null, sheet: null, desk: null, sheetId: null, selection: null })
  },

  async showBoard(boardId) {
    set({ boardId, selection: null, screen: 'board', mode: 'prep' })
    await get().refresh()
  },

  goTo(screen) {
    // The map belongs to every mode; other screens belong to one.
    const mode: Mode = screen === 'map' ? get().mode : screen === 'live' ? 'live' : screen === 'players' ? 'players' : 'prep'
    set({ screen, mode })
    void get().refresh()
  },

  async openReview(sessionId) {
    set({ screen: 'review', reviewSessionId: sessionId, review: null })
    await get().refresh()
  },

  async openSheet(entityId) {
    set({ screen: 'sheet', sheetId: entityId, sheet: null })
    await get().refresh()
  },

  async showOnBoard(entityId) {
    const { info } = get()
    if (!info) return
    set({ boardId: info.globalBoardId, screen: 'board', focusEntityId: entityId, selection: { kind: 'entity', id: entityId } })
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
      set({ view, history, sheet, desk, timeline, live, review, mapScreen, prepScreen, prep, where, players, info: info ?? get().info })
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
export function useView(): BoardView {
  const view = useBoard((s) => s.view)
  if (!view) throw new Error('Board view not loaded')
  return view
}
