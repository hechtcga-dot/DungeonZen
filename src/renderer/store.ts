import { create } from 'zustand'
import { call } from './api'
import type { IpcChannel, IpcInput, IpcOutputs } from '../shared/ipc'
import type { BoardView, CampaignInfo, HistoryView, SheetView } from '../shared/types'

export type Selection =
  | { kind: 'entity'; id: string }
  | { kind: 'string'; id: string }
  | { kind: 'note'; id: string }
  | null

export type Screen = 'board' | 'sheet' | 'library'

interface BoardState {
  info: CampaignInfo | null
  screen: Screen
  boardId: string | null
  view: BoardView | null
  history: HistoryView | null
  sheet: SheetView | null
  sheetId: string | null
  /** A card to bring into view the next time the board shows. */
  focusEntityId: string | null
  panel: 'inspector' | 'history'
  selection: Selection
  search: string
  message: { text: string; isError: boolean } | null

  openCampaign(info: CampaignInfo): Promise<void>
  closeCampaign(): Promise<void>
  showBoard(boardId: string): Promise<void>
  goTo(screen: 'board' | 'library'): void
  openSheet(entityId: string): Promise<void>
  showOnBoard(entityId: string): Promise<void>
  refresh(): Promise<void>
  /** Runs a change in the main process, then reloads what is on screen. */
  act<C extends IpcChannel>(channel: C, input: IpcInput<C>): Promise<IpcOutputs[C] | undefined>
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
  sheetId: null,
  focusEntityId: null,
  panel: 'inspector',
  selection: null,
  search: '',
  message: null,

  async openCampaign(info) {
    set({
      info, screen: 'board', boardId: info.globalBoardId, selection: null, view: null, history: null,
      sheet: null, sheetId: null, search: ''
    })
    await get().refresh()
  },

  async closeCampaign() {
    await call('campaign:close', undefined)
    set({ info: null, boardId: null, view: null, history: null, sheet: null, sheetId: null, selection: null })
  },

  async showBoard(boardId) {
    set({ boardId, selection: null, screen: 'board' })
    await get().refresh()
  },

  goTo(screen) {
    set({ screen })
    void get().refresh()
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
    const { boardId, panel, screen, sheetId } = get()
    if (!boardId) return
    try {
      const [view, history, sheet] = await Promise.all([
        call('board:view', { boardId }),
        panel === 'history' ? call('history:view', undefined) : Promise.resolve(get().history),
        screen === 'sheet' && sheetId ? call('sheet:view', { entityId: sheetId }).catch(() => null) : Promise.resolve(null)
      ])
      if (screen === 'sheet' && !sheet) {
        // The entity is gone, for example its creation was just undone.
        set({ view, history, sheet: null, sheetId: null, screen: 'board' })
        return
      }
      set({ view, history, sheet })
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
