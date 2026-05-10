import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'leaflet/dist/leaflet.css'
import './index.css'
import App from './App.jsx'
import { initObservability } from './utils/errorReporting'

// Initialize Sentry before React renders so early errors get captured.
// No-op if VITE_SENTRY_DSN isn't set.
initObservability()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
