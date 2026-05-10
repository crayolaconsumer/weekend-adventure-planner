import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'leaflet/dist/leaflet.css'
import './index.css'
import App from './App.jsx'
import { initObservability } from './utils/errorReporting'
import { initAnalytics } from './utils/analytics'

// Init observability + analytics before React renders. Both are silent
// no-ops when their env vars are absent.
initObservability()
initAnalytics()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
