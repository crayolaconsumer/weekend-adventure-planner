import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'leaflet/dist/leaflet.css'
import './index.css'
import App from './App.jsx'
import { initObservability } from './utils/errorReporting'
import { initAnalytics } from './utils/analytics'
import { installFetchInterceptor } from './utils/nativeBridge'
import { initNativeAppLifecycle } from './utils/nativeAppLifecycle'

// Native bridge first — rewrites relative /api/ fetches to absolute
// origin when running inside Capacitor. No-op on web. Must run before
// any module makes a fetch call (which means before observability +
// analytics, even though those don't fetch directly during init).
installFetchInterceptor()

// Capacitor App lifecycle listeners — fire-and-forget. No-op on web.
// Module dynamically imports @capacitor/app, so the web bundle stays
// thin (Vite tree-shakes the import chain when isNative() is false).
void initNativeAppLifecycle()

// Init observability + analytics before React renders. Both are silent
// no-ops when their env vars are absent.
initObservability()
initAnalytics()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
