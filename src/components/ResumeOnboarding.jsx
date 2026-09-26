import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { keepDeferring } from '../utils/sharedLink'
import { track } from '../utils/analytics'

/**
 * Ends the onboarding deferral for a shared-link visitor once they move into
 * the app: shows the intro, or skips it if they signed in meanwhile (the intro
 * would only offer them "Sign in" again).
 */
export default function ResumeOnboarding({ onResume }) {
  const { pathname } = useLocation()
  const { isAuthenticated } = useAuth()
  useEffect(() => {
    if (keepDeferring(pathname)) return
    if (isAuthenticated) localStorage.setItem('roam_onboarded', 'true')
    track('onboarding_resumed', { path: pathname, signedIn: isAuthenticated })
    onResume(!isAuthenticated)
  }, [pathname, onResume, isAuthenticated])
  return null
}
