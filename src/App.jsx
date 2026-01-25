import { useState, useEffect, lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'

// Lazy load page components for code splitting
const Discover = lazy(() => import('./pages/Discover'))
const Plan = lazy(() => import('./pages/Plan'))
const Events = lazy(() => import('./pages/Events'))
const Wishlist = lazy(() => import('./pages/Wishlist'))
const Collections = lazy(() => import('./pages/Collections'))
const UnifiedProfile = lazy(() => import('./pages/UnifiedProfile'))
const Activity = lazy(() => import('./pages/Activity'))
const Place = lazy(() => import('./pages/Place'))
const SharedPlan = lazy(() => import('./pages/SharedPlan'))
const Pricing = lazy(() => import('./pages/Pricing'))

import Onboarding from './components/Onboarding'
import ErrorBoundary from './components/ErrorBoundary'
import LoadingState from './components/LoadingState'
import AuthModal from './components/AuthModal'
import SubscriptionSuccessModal from './components/SubscriptionSuccessModal'
import InstallBanner from './components/InstallBanner'
import NotificationBell from './components/NotificationBell'
import { ToastProvider } from './components/Toast'
import { AuthProvider, useAuth } from './contexts/AuthContext'

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

const CalendarIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/>
    <line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
)

// 404 Not Found component (M17)
const NotFound = () => (
  <div style={{
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '60vh',
    padding: '2rem',
    textAlign: 'center'
  }}>
    <h1 style={{ fontSize: '4rem', margin: '0 0 1rem', opacity: 0.3 }}>404</h1>
    <p style={{ fontSize: '1.1rem', marginBottom: '1.5rem', opacity: 0.7 }}>Page not found</p>
    <a href="/" style={{
      padding: '0.75rem 1.5rem',
      background: 'var(--color-primary, #007AFF)',
      color: 'white',
      borderRadius: '8px',
      textDecoration: 'none',
      fontWeight: '500'
    }}>Back to Discover</a>
  </div>
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
      <button onClick={onRetry} className="location-banner-btn">
        Allow Location
      </button>
      <button onClick={() => setDismissed(true)} className="location-banner-close" aria-label="Dismiss location banner">
        &times;
      </button>
    </motion.div>
  )
}

// App header with notification bell (for authenticated users)
function AppHeader() {
  const { isAuthenticated } = useAuth()

  if (!isAuthenticated) return null

  return (
    <header className="app-header">
      <div className="app-header-content">
        <span className="app-header-logo">ROAM</span>
        <NotificationBell />
      </div>
    </header>
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
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '48px',
        marginBottom: '24px'
      }}>
        👤
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

  // Get user location only after onboarding is complete
  useEffect(() => {
    // Don't request location while onboarding is showing
    if (showOnboarding) return

    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          })
        },
        (error) => {
          setLocationError(error.message)
          // Default to London as fallback
          setLocation({ lat: 51.5074, lng: -0.1278 })
        },
        { enableHighAccuracy: true, timeout: 10000 }
      )
    } else {
      // Geolocation not available, use London as fallback
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Initial state setup, runs once
      setLocationError('Geolocation not supported')
      setLocation({ lat: 51.5074, lng: -0.1278 })
    }
  }, [showOnboarding])

  // Retry location permission
  const retryLocation = () => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          })
          setLocationError(null)
        },
        (error) => {
          setLocationError(error.message)
        },
        { enableHighAccuracy: true, timeout: 10000 }
      )
    }
  }

  return (
    <AuthProvider>
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

              {/* App Header with Notification Bell */}
              {!showOnboarding && <AppHeader />}

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

              <main id="main-content">
                <Suspense fallback={<LoadingState variant="spinner" message="Loading..." size="large" />}>
                  <AnimatePresence mode="wait">
                    <Routes>
                      <Route path="/" element={<Discover location={location} />} />
                      <Route path="/events" element={<Events location={location} />} />
                      <Route path="/plan" element={<Plan location={location} />} />
                      <Route path="/wishlist" element={<Wishlist />} />
                      <Route path="/collections" element={<Collections />} />
                      <Route path="/profile" element={<ProfileRedirect onOpenAuth={openAuthModal} />} />
                      <Route path="/user/:username" element={<UnifiedProfile />} />
                      <Route path="/activity" element={<Activity />} />
                      <Route path="/place/:id" element={<Place />} />
                      <Route path="/plan/share/:code" element={<SharedPlan />} />
                      <Route path="/pricing" element={<Pricing />} />
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
                <NavLink to="/profile" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                  <UserIcon />
                  <span>Profile</span>
                </NavLink>
              </nav>
            </div>
          </ErrorBoundary>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  )
}

export default App
