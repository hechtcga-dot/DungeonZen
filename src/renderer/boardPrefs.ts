import { create } from 'zustand'

// How the DM likes to see the board (this computer only; not campaign data).
export interface BoardPrefs {
  showHidden: boolean
  pictures: boolean
  tint: boolean
  actMarks: boolean
  greyCards: boolean
  greyNotes: boolean
  /** Region outlines drawn over map pictures under the cards (off by default; names always show). */
  regionLines: boolean
  /** Card types not shown on the board (Display › Card types). */
  hiddenTypes: string[]
  /** What a drag moves: the cards, or the background pictures under them. */
  layer: 'cards' | 'background'
  /** "Don't show this again" on the no-world-map reminder (Display › World map reminder brings it back). */
  mapHintOff: boolean
}
const KEY = 'dz-board-prefs'
const DEFAULTS: BoardPrefs = { showHidden: false, pictures: true, tint: true, actMarks: true, greyCards: true, greyNotes: true, regionLines: false, hiddenTypes: [], layer: 'cards', mapHintOff: false }

function load(): BoardPrefs {
  // The board always opens moving cards; moving the background is a short job.
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}'), layer: 'cards' } } catch { return DEFAULTS }
}

export const useBoardPrefs = create<BoardPrefs & { set(patch: Partial<BoardPrefs>): void }>((set, get) => ({
  ...load(),
  set(patch) {
    set(patch)
    const { set: _s, ...prefs } = { ...get() }
    try { localStorage.setItem(KEY, JSON.stringify(prefs)) } catch { /* not kept */ }
  }
}))
