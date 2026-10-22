import { useEffect, useState } from 'react'

// Look of the app on this computer (3.1): Adventure UI (the default since 3.8.0, owner) or Desk UI, and whether box controls always show.
// Kept like the lighting switch: localStorage, shared by every window of the app.
export type Skin = 'desk' | 'adventure'
const SKIN = 'dz.skin'
const ARRANGE = 'dz.arrange'

const read = (key: string) => { try { return localStorage.getItem(key) } catch { return null } }
const write = (key: string, value: string) => { try { localStorage.setItem(key, value) } catch { /* not kept */ } }

export const readSkin = (): Skin => (read(SKIN) === 'desk' ? 'desk' : 'adventure')
const readArrange = () => read(ARRANGE) === 'on'

/** Puts the look on <html> (data-skin, data-arrange); every window, and again when another window changes it. */
export function applyLook() {
  document.documentElement.dataset.skin = readSkin()
  document.documentElement.toggleAttribute('data-arrange', readArrange())
}
window.addEventListener('storage', (e) => { if (e.key === SKIN || e.key === ARRANGE) { applyLook(); window.dispatchEvent(new Event('dz-look')) } })

function useLook<T>(get: () => T, set: (v: T) => void): [T, (v: T) => void] {
  const [v, setV] = useState(get)
  useEffect(() => {
    const sync = () => setV(get())
    window.addEventListener('dz-look', sync)
    return () => window.removeEventListener('dz-look', sync)
  }, [get])
  return [v, (next) => { set(next); applyLook(); window.dispatchEvent(new Event('dz-look')) }]
}

export const useSkin = () => useLook(readSkin, (s: Skin) => write(SKIN, s))
/** Box controls (− ↑ ↓) show on hover; Setup › Arrange boxes shows them always. */
export const useArrange = () => useLook(readArrange, (on: boolean) => write(ARRANGE, on ? 'on' : 'off'))
