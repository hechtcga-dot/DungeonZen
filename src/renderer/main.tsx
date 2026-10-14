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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
