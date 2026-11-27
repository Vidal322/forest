import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted fonts (OFL, licences in the packages), bundled by Vite and precached by the service worker: they work
// offline and nothing is asked of Google Fonts. Latin subsets only (Portuguese and the names people type).
import '@fontsource/atkinson-hyperlegible-next/latin-400.css'
import '@fontsource/atkinson-hyperlegible-next/latin-ext-400.css'
import '@fontsource/atkinson-hyperlegible-next/latin-500.css'
import '@fontsource/atkinson-hyperlegible-next/latin-ext-500.css'
import '@fontsource/atkinson-hyperlegible-next/latin-700.css'
import '@fontsource/atkinson-hyperlegible-next/latin-ext-700.css'
import '@fontsource/alegreya/latin-400-italic.css'
import '@fontsource/alegreya/latin-ext-400-italic.css'
import '@fontsource/alegreya/latin-500-italic.css'
import '@fontsource/alegreya/latin-ext-500-italic.css'
import '@fontsource/alegreya/latin-700-italic.css'
import '@fontsource/alegreya/latin-ext-700-italic.css'
import './styles.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
