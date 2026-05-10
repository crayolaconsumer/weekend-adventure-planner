import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'leaflet/dist/leaflet.css'
import './index.css'
import App from './App.jsx'
import { initObservability } from './utils/errorReporting'
import { initAnalytics } from './utils/analytics'
import { installFetchInterceptor } from './utils/nativeBridge'

// Native bridge first — rewrites relative /api/ fetches to absolute
// origin when running inside Capacitor. No-op on web. Must run before
// any module makes a fetch call (which means before observability +
// analytics, even though those don't fetch directly during init).
installFetchInterceptor()

// Init observability + analytics before React renders. Both are silent
// no-ops when their env vars are absent.
initObservability()
initAnalytics()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
