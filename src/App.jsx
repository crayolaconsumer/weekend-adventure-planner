import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'

// Lazy load page components for code splitting
const Discover = lazy(() => import('./pages/Discover'))
const Plan = lazy(() => import('./pages/Plan'))
const Events = lazy(() => import('./pages/Events'))
const Wishlist = lazy(() => import('./pages/Wishlist'))
const Collections = lazy(() => import('./pages/Collections'))
const UnifiedProfile = lazy(() => import('./pages/UnifiedProfile'))
const VisitedMapPage = lazy(() => import('./pages/VisitedMapPage'))
const Activity = lazy(() => import('./pages/Activity'))
const SocialHub = lazy(() => import('./pages/SocialHub'))
const Place = lazy(() => import('./pages/Place'))
const SharedPlan = lazy(() => import('./pages/SharedPlan'))
const Pricing = lazy(() => import('./pages/Pricing'))
const Privacy = lazy(() => import('./pages/Privacy'))
const Terms = lazy(() => import('./pages/Terms'))
const Support = lazy(() => import('./pages/Support'))
const AdminReports = lazy(() => import('./pages/AdminReports'))
import NotFound from './pages/NotFound'
import AdminRoute from './components/AdminRoute'

import Onboarding from './components/Onboarding'
import ErrorBoundary from './components/ErrorBoundary'
// DebugHud disabled — it was a triple-tap-anywhere overlay used to
// diagnose the WKWebView auth failure. Now that auth + the network
// stack are healthy, the triple-tap was firing accidentally during
// normal swipe/scroll interactions and was getting in the way.
// Keeping the file in tree (src/components/DebugHud.jsx + the fetch
// instrumentation in src/main.jsx) so we can re-enable when needed.
// import DebugHud from './components/DebugHud'
import LoadingState from './components/LoadingState'
import AuthModal from './components/AuthModal'
import SubscriptionSuccessModal from './components/SubscriptionSuccessModal'
import InstallBanner from './components/InstallBanner'
import NotificationBell from './components/NotificationBell'
import BadgeToastWatcher from './components/BadgeToastWatcher'
import IntentHandler from './components/IntentHandler'
import UniversalLinkHandler from './components/UniversalLinkHandler'
import DisplayNameNudge from './components/DisplayNameNudge'
import OfflineIndicator from './components/OfflineIndicator'
import { checkAndAutoExpire } from './utils/offlinePack'
import { ToastProvider } from './components/Toast'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { DistanceProvider } from './contexts/DistanceContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { getCurrentPosition as nativeGetCurrentPosition, geolocationPermissionState, openAppSettings } from './utils/nativePlugins'
import { usePushNotifications } from './hooks/usePushNotifications'
import { isNative } from './utils/nativeBridge'

/**
 * Wires the native (iOS / Android) "user tapped a push notification"
 * event to React Router navigation. Without this, the `url` carried
 * in every notify*() payload is ignored on native — the app opens,
 * but the user is dumped on whatever screen was last open instead of
 * the wishlist/profile/place the notification was actually about.
 * Web pushes route via the service worker (public/sw.js) and don't
 * need this; native pushes deliver via Capacitor's plugin and need
 * an explicit listener.
 */
function PushTapHandler() {
  const navigate = useNavigate()

  useEffect(() => {
    if (!isNative()) return

    let handle
    const setup = async () => {
      const { PushNotifications } = await import('@capacitor/push-notifications')
      handle = await PushNotifications.addListener(
        'pushNotificationActionPerformed',
        (event) => {
          const data = event?.notification?.data || {}
          // Server-side notify* helpers attach { url: '/...' } to data.
          // FCM/APNS may also stringify nested objects, so accept both
          // a top-level data.url and a JSON-encoded payload.url variant.
          let url = typeof data.url === 'string' ? data.url : null
          if (!url && typeof data.payload === 'string') {
            try { url = JSON.parse(data.payload)?.url || null } catch { /* ignore */ }
          }
          if (url && url.startsWith('/')) {
            navigate(url)
          }
        }
      )
    }
    setup().catch(() => {})

    return () => { handle?.remove?.() }
  }, [navigate])

  return null
}

/**
 * Invisible wrapper that auto-fires the push permission subscribe()
 * flow the moment a user signs in. The intent is "no manual toggling
 * needed" — by the time a user authenticates they've shown enough
 * intent to warrant the OS-level dialog.
 *
 * The subscribe() call is idempotent on the SDK side:
 *   - permission='granted' → re-registers the token to the now-
 *     authenticated user on the server. Quietly succeeds.
 *   - permission='default' → triggers the OS permission dialog. User
 *     grants or denies. On grant, the registration listener posts the
 *     token to the server with their auth.
 *   - permission='denied' → no dialog, returns early. User has to
 *     enable in OS Settings if they want to change their mind.
 *
 * `enrolledRef` tracks whether we've already fired for this auth so
 * we don't re-prompt on every render of every consumer of useAuth.
 */
function PushAuthSync() {
  const { isAuthenticated, user } = useAuth()
  const { subscribe, supported } = usePushNotifications()
  const enrolledForUserRef = useRef(null)

  useEffect(() => {
    if (!isAuthenticated || !user?.id) {
      enrolledForUserRef.current = null
      return
    }
    if (!supported) return
    if (enrolledForUserRef.current === user.id) return
    enrolledForUserRef.current = user.id
    subscribe().catch(() => {})
  }, [isAuthenticated, user?.id, supported, subscribe])

  return null
}

// Icons as components
const CompassIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <polygon points="16.24,7.76 14.12,14.12 7.76,16.24 9.88,9.88"/>
  </svg>
)

const MapIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="1,6 1,22 8,18 16,22 23,18 23,2 16,6 8,2"/>
    <line x1="8" y1="2" x2="8" y2="18"/>
    <line x1="16" y1="6" x2="16" y2="22"/>
  </svg>
)

const HeartIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.84,4.61a5.5,5.5,0,0,0-7.78,0L12,5.67,10.94,4.61a5.5,5.5,0,0,0-7.78,7.78l1.06,1.06L12,21.23l7.78-7.78,1.06-1.06a5.5,5.5,0,0,0,0-7.78Z"/>
  </svg>
)

const UserIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20,21V19a4,4,0,0,0-4-4H8a4,4,0,0,0-4,4v2"/>
    <circle cx="12" cy="7" r="4"/>
  </svg>
)

const UsersIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
    <circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
)

const CalendarIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/>
    <line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
)


const LocationIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21,10c0,7-9,13-9,13S3,17,3,10a9,9,0,0,1,18,0Z"/>
    <circle cx="12" cy="10" r="3"/>
  </svg>
)

// Location fallback banner
function LocationBanner({ error, onRetry }) {
  const [dismissed, setDismissed] = useState(false)
  const [permState, setPermState] = useState('prompt')
  const [busy, setBusy] = useState(false)

  // Tell the rest of the page to reserve space at the top when the
  // banner is visible. The banner itself is position:fixed (so it
  // hovers above scroll content), but without this body class the
  // banner covers the page header — wordmark and filter button on
  // Discover, search bar on Social, etc. Confirmed by Playwright QA:
  // before this class, clicking the filter button timed out with
  // "location-banner intercepts pointer events".
  useEffect(() => {
    const showing = error && !dismissed
    if (showing) {
      document.body.classList.add('has-location-banner')
      return () => document.body.classList.remove('has-location-banner')
    }
  }, [error, dismissed])

  // Read current permission state so the CTA reflects what tapping
  // will actually do. If the user previously denied at the iOS dialog,
  // iOS will NEVER re-prompt — we have to send them to Settings.
  // (This was the App Store rejection: button labelled "Allow Location"
  // appeared unresponsive because iOS silently rejected the retry.)
  useEffect(() => {
    let cancelled = false
    geolocationPermissionState().then((state) => {
      if (!cancelled) setPermState(state)
    })
    return () => { cancelled = true }
  }, [error])

  // Apple Review 5.1.1(iv) — "Use words like Continue or Next on the
  // button instead [of Allow]". The button doesn't itself grant
  // permission, so labelling it "Allow Location" misleads users.
  // "Enable Location" describes the goal without claiming an outcome
  // the button can't directly produce; "Open Settings" makes it
  // explicit when iOS has already denied and only Settings can flip
  // the switch.
  const isDenied = permState === 'denied'
  const buttonLabel = isDenied ? 'Open Settings' : 'Enable Location'

  const handleClick = async () => {
    if (busy) return
    setBusy(true)
    try {
      if (isDenied) {
        const opened = await openAppSettings()
        // On web (openAppSettings is a no-op), still retry — the browser
        // permission may be re-promptable from a user gesture.
        if (!opened) await onRetry()
      } else {
        await onRetry()
      }
    } finally {
      setBusy(false)
    }
  }

  if (dismissed || !error) return null

  return (
    <motion.div
      className="location-banner"
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <LocationIcon />
      <span>Using London as default location</span>
      <button onClick={handleClick} className="location-banner-btn" disabled={busy}>
        {busy ? 'Opening…' : buttonLabel}
      </button>
      <button onClick={() => setDismissed(true)} className="location-banner-close" aria-label="Dismiss location banner">
        &times;
      </button>
    </motion.div>
  )
}

// Profile redirect - sends authenticated users to their profile
function ProfileRedirect({ onOpenAuth }) {
  const { user, isAuthenticated, loading } = useAuth()

  if (loading) {
    return <LoadingState variant="spinner" message="Loading..." size="large" />
  }

  // If authenticated and has username, redirect to unified profile
  if (isAuthenticated && user?.username) {
    return <Navigate to={`/user/${user.username}`} replace />
  }

  // If not authenticated, show sign-in prompt
  return (
    <div className="page" style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '64px 24px',
      textAlign: 'center',
      minHeight: '60vh'
    }}>
      <div style={{
        width: '100px',
        height: '100px',
        borderRadius: '50%',
        background: 'var(--roam-parchment)',
        color: 'var(--roam-forest)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: '24px'
      }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      </div>
      <h2 style={{
        fontFamily: 'var(--font-display)',
        fontSize: '24px',
        color: 'var(--roam-forest)',
        margin: '0 0 8px'
      }}>
        Your Profile
      </h2>
      <p style={{
        fontSize: '14px',
        color: 'var(--roam-ink-muted)',
        margin: '0 0 24px',
        maxWidth: '280px'
      }}>
        Sign in to track your journey, earn badges, and connect with other explorers.
      </p>
      <div style={{ display: 'flex', gap: '12px' }}>
        <button
          onClick={() => onOpenAuth('login')}
          style={{
            padding: '12px 24px',
            background: 'var(--roam-forest)',
            color: 'white',
            border: 'none',
            borderRadius: '24px',
            fontWeight: '600',
            fontSize: '14px',
            cursor: 'pointer'
          }}
        >
          Sign In
        </button>
        <button
          onClick={() => onOpenAuth('register')}
          style={{
            padding: '12px 24px',
            background: 'transparent',
            color: 'var(--roam-forest)',
            border: '2px solid var(--roam-forest)',
            borderRadius: '24px',
            fontWeight: '600',
            fontSize: '14px',
            cursor: 'pointer'
          }}
        >
          Sign Up
        </button>
      </div>
    </div>
  )
}

function App() {
  const [location, setLocation] = useState(null)
  const [locationError, setLocationError] = useState(null)
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return !localStorage.getItem('roam_onboarded')
  })
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [authModalMode, setAuthModalMode] = useState('login')
  const [showSubscriptionSuccess, setShowSubscriptionSuccess] = useState(false)

  // Check for subscription success/cancelled URL param on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('subscription') === 'success') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Initial state setup from URL, runs once on mount
      setShowSubscriptionSuccess(true)
      // Clean up URL without triggering navigation
      window.history.replaceState({}, '', window.location.pathname)
    } else if (params.get('subscription') === 'cancelled') {
      // Clean up URL - user already knows they cancelled
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  // Helper to open auth modal
  const openAuthModal = (mode = 'login') => {
    setAuthModalMode(mode)
    setShowAuthModal(true)
  }

  // Listen for global openAuthModal events (from ContributionPrompt, ContributionDisplay, etc.)
  useEffect(() => {
    const handleOpenAuthModal = (event) => {
      const mode = event.detail?.mode || 'register'
      openAuthModal(mode)
    }

    window.addEventListener('openAuthModal', handleOpenAuthModal)
    return () => window.removeEventListener('openAuthModal', handleOpenAuthModal)
  }, [])

  // Set stable viewport height to prevent mobile resize jank
  useEffect(() => {
    const updateStableVh = () => {
      // Use visualViewport if available (more accurate on mobile)
      const vh = window.visualViewport?.height || window.innerHeight
      document.documentElement.style.setProperty('--stable-vh', `${vh}px`)
    }

    updateStableVh()

    // Listen to visualViewport resize (handles keyboard, address bar)
    window.visualViewport?.addEventListener('resize', updateStableVh)
    // Fallback for browsers without visualViewport
    window.addEventListener('resize', updateStableVh)

    return () => {
      window.visualViewport?.removeEventListener('resize', updateStableVh)
      window.removeEventListener('resize', updateStableVh)
    }
  }, [])

  // Hard-expire stale offline packs on app open. Uses cached browser
  // location only (no permission prompt) so the distance check happens
  // when possible without disturbing the user.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        let coords = null
        if (typeof navigator !== 'undefined' && navigator.geolocation && navigator.permissions) {
          try {
            const perm = await navigator.permissions.query({ name: 'geolocation' })
            if (perm.state === 'granted') {
              coords = await new Promise((resolve) => {
                navigator.geolocation.getCurrentPosition(
                  (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
                  () => resolve(null),
                  { maximumAge: 30 * 60 * 1000, timeout: 4000 }
                )
              })
            }
          } catch { /* no perm API; skip distance check */ }
        }
        if (cancelled) return
        await checkAndAutoExpire(coords)
      } catch (err) {
        console.warn('Pack auto-expire check failed', err)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Get user location only after onboarding is complete
  useEffect(() => {
    // Don't request location while onboarding is showing
    if (showOnboarding) return

    // Route via the native plugin on Capacitor — Android REQUIRES the
    // plugin to trigger the runtime permission dialog (the web
    // navigator.geolocation path in Capacitor's WebView won't ask for
    // ACCESS_FINE_LOCATION). On iOS native, the plugin also gives
    // better accuracy and uses the entitlement string we set in
    // Info.plist (NSLocationWhenInUseUsageDescription). On web,
    // nativeGetCurrentPosition falls through to navigator.geolocation.
    nativeGetCurrentPosition({ enableHighAccuracy: true, timeout: 10000 })
      .then((position) => {
        setLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        })
      })
      .catch((error) => {
        setLocationError(error?.message || 'Geolocation failed')
        // Default to London as fallback
        setLocation({ lat: 51.5074, lng: -0.1278 })
      })
  }, [showOnboarding])

  // Retry location permission
  const retryLocation = () => {
    nativeGetCurrentPosition({ enableHighAccuracy: true, timeout: 10000 })
      .then((position) => {
        setLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        })
        setLocationError(null)
      })
      .catch((error) => {
        setLocationError(error?.message || 'Geolocation failed')
      })
  }

  return (
    <ThemeProvider>
    <AuthProvider>
      <DistanceProvider>
        <ToastProvider>
          <BrowserRouter>
          <ErrorBoundary>
            {/* Skip link for keyboard users */}
            <a href="#main-content" className="skip-link">Skip to main content</a>
            <div className="app">
              {/* Onboarding for first-time users */}
              <AnimatePresence>
                {showOnboarding && (
                  <Onboarding onComplete={() => setShowOnboarding(false)} />
                )}
              </AnimatePresence>

              <AnimatePresence>
                {locationError && !showOnboarding && (
                  <LocationBanner error={locationError} onRetry={retryLocation} />
                )}
              </AnimatePresence>

              {/* Floating Notification Bell */}
              {!showOnboarding && <NotificationBell />}

              {/* Watches useUserBadges across the whole app — toasts
                  any newly-awarded badge regardless of which page the
                  user is on. Renders nothing; pure side-effect. */}
              {!showOnboarding && <BadgeToastWatcher />}

              {/* Auth Modal */}
              <AuthModal
                isOpen={showAuthModal}
                onClose={() => setShowAuthModal(false)}
                initialMode={authModalMode}
              />

              {/* Subscription Success Modal */}
              <SubscriptionSuccessModal
                isOpen={showSubscriptionSuccess}
                onClose={() => setShowSubscriptionSuccess(false)}
              />

              {/* PWA Install Banner */}
              <InstallBanner />

              <IntentHandler />
              <UniversalLinkHandler />
              <DisplayNameNudge />
              <OfflineIndicator />
              <PushAuthSync />
              <PushTapHandler />

              <main id="main-content">
                <Suspense fallback={<LoadingState variant="spinner" message="Loading..." size="large" />}>
                  <AnimatePresence mode="wait">
                    <Routes>
                      <Route path="/" element={<Discover location={location} />} />
                      <Route path="/events" element={<Events location={location} />} />
                      <Route path="/plan" element={<Plan location={location} />} />
                      <Route path="/wishlist" element={<Wishlist />} />
                      <Route path="/collections" element={<Collections />} />
                      <Route path="/social" element={<SocialHub location={location} />} />
                      <Route path="/profile" element={<Navigate to="/social" replace />} />
                      <Route path="/user/:username" element={<UnifiedProfile />} />
                      <Route path="/user/:username/map" element={<VisitedMapPage />} />
                      <Route path="/activity" element={<Activity />} />
                      <Route path="/place/:id" element={<Place />} />
                      <Route path="/plan/share/:code" element={<SharedPlan />} />
                      <Route path="/pricing" element={<Pricing />} />
                      <Route path="/privacy" element={<Privacy />} />
                      <Route path="/terms" element={<Terms />} />
                      <Route path="/support" element={<Support />} />
                      <Route path="/admin/reports" element={<AdminRoute><AdminReports /></AdminRoute>} />
                      {/* M17: 404 catch-all route */}
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </AnimatePresence>
                </Suspense>
              </main>

              <nav className="nav-bar">
                <NavLink to="/" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                  <CompassIcon />
                  <span>Discover</span>
                </NavLink>
                <NavLink to="/events" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                  <CalendarIcon />
                  <span>Events</span>
                </NavLink>
                <NavLink to="/plan" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                  <MapIcon />
                  <span>Plan</span>
                </NavLink>
                <NavLink to="/wishlist" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                  <HeartIcon />
                  <span>Saved</span>
                </NavLink>
                <NavLink to="/social" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                  <UsersIcon />
                  <span>Social</span>
                </NavLink>
              </nav>
            </div>
          </ErrorBoundary>
          </BrowserRouter>
          {/* <DebugHud /> — see import note above */}
        </ToastProvider>
      </DistanceProvider>
    </AuthProvider>
    </ThemeProvider>
  )
}

export default App
