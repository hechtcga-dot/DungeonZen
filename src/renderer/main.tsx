import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/im-fell-english/400.css'
import '@fontsource/im-fell-english/400-italic.css'
import '@xyflow/react/dist/style.css'
import './styles.css'
import './desk.css'
import './theme.css'
import { App } from './App'
import './textKeys'

// Every one-line text box shows the start of its text again when the DM clicks out (owner, 2026-10-14).
document.addEventListener('focusout', (ev) => { if (ev.target instanceof HTMLInputElement) ev.target.scrollLeft = 0 })

// Every campaign picture drags out of the app as its real file, e.g. into Roll20 (owner, 2026-10-15).
document.addEventListener('dragstart', (ev) => {
  const t = ev.target
  if (t instanceof Element && t.closest('.mapview-frame')) { ev.preventDefault(); return } // dragging a map pans it
  const img = t instanceof HTMLImageElement ? t : t instanceof Element ? t.querySelector('img') : null
  if (!img?.src.startsWith('dz-asset://')) return
  ev.preventDefault()
  window.dungeonzen.dragOut(img.src)
}, true)
// A file dropped where nothing takes it must not open in the window (the app would be gone).
for (const type of ['dragover', 'drop'] as const) {
  document.addEventListener(type, (ev) => { if (ev.dataTransfer?.types.includes('Files')) ev.preventDefault() })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
