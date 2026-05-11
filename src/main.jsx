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

// Auto-reload on chunk-load failure after a deploy.
//
// Vite emits hashed chunk URLs at build time. When we deploy, those
// hashes change. Any tab that was open during the deploy still has
// the OLD URLs in memory — the moment the user navigates to a route
// whose chunk hadn't loaded yet, the dynamic import 404s on the CDN
// and React throws "Failed to fetch dynamically imported module",
// dropping the user on the error boundary. Confirmed in QA: every
// in-app navigation after a deploy hits this.
//
// Fix: one-time auto-reload when a chunk-load error is observed.
// sessionStorage flag prevents an infinite reload loop if the
// problem is something else (e.g. user offline). On a successful
// reload the flag is cleared so a future deploy gets one more
// auto-recovery.
{
  const RELOAD_KEY = 'roam_chunk_reload_at'
  const isChunkLoadError = (msg) => {
    const s = String(msg || '').toLowerCase()
    return s.includes('failed to fetch dynamically imported module') ||
           s.includes('importing a module script failed') ||
           s.includes('loading chunk') && s.includes('failed')
  }
  const tryReload = () => {
    try {
      const last = Number(sessionStorage.getItem(RELOAD_KEY) || '0')
      // Don't reload more than once every 30s — if it's still failing
      // after a reload, something else is wrong and we should let the
      // error boundary handle it.
      if (Date.now() - last < 30_000) return
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
      window.location.reload()
    } catch {
      // sessionStorage might throw in private mode — just reload.
      window.location.reload()
    }
  }
  window.addEventListener('error', (event) => {
    if (isChunkLoadError(event?.message)) tryReload()
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event?.reason
    const msg = reason?.message || reason
    if (isChunkLoadError(msg)) tryReload()
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
