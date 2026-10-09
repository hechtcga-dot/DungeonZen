import { create } from 'zustand'

// How the DM likes to see the board (this computer only; not campaign data).
export interface BoardPrefs {
  showHidden: boolean
  pictures: boolean
  tint: boolean
  actMarks: boolean
  greyCards: boolean
  greyNotes: boolean
  /** What a drag moves: the cards, or the background pictures under them. */
  layer: 'cards' | 'background'
}
const KEY = 'dz-board-prefs'
const DEFAULTS: BoardPrefs = { showHidden: false, pictures: true, tint: true, actMarks: true, greyCards: true, greyNotes: true, layer: 'cards' }

function load(): BoardPrefs {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') } } catch { return DEFAULTS }
}

export const useBoardPrefs = create<BoardPrefs & { set(patch: Partial<BoardPrefs>): void }>((set, get) => ({
  ...load(),
  set(patch) {
    set(patch)
    const { set: _s, ...prefs } = { ...get() }
    try { localStorage.setItem(KEY, JSON.stringify(prefs)) } catch { /* not kept */ }
  }
}))
