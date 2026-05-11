/**
 * UniversalLinkHandler
 *
 * Routes incoming Universal Links into react-router. Sits inside the
 * <BrowserRouter> so it has access to useNavigate.
 *
 * Flow:
 *   1. Recipient taps a share URL like
 *      https://www.go-roam.uk/plan/share/abc123 in iMessage.
 *   2. iOS checks the apple-app-site-association file we host at
 *      /.well-known/apple-app-site-association — if the path matches
 *      a "components" entry, iOS opens our app instead of Safari.
 *   3. Capacitor's @capacitor/app fires the 'appUrlOpen' event with the
 *      full URL.
 *   4. nativeAppLifecycle.js dispatches a 'roam-app-url-open' window
 *      event with the parsed path.
 *   5. This handler picks it up and navigates react-router to that
 *      path, so the SharedPlan / Place / UserProfile route renders.
 *
 * Doesn't handle anything else — query-string intents are
 * IntentHandler's job, the custom roam:// scheme (if we ever use it)
 * would go through this same event so callers don't need to know
 * which scheme produced the link.
 */

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export default function UniversalLinkHandler() {
  const navigate = useNavigate()

  useEffect(() => {
    const handler = (event) => {
      const path = event.detail?.path
      if (!path || typeof path !== 'string') return
      // Only handle in-app paths — never let an attacker route to
      // an external URL by stuffing one into a custom URL scheme.
      if (!path.startsWith('/')) return
      navigate(path)
    }
    window.addEventListener('roam-app-url-open', handler)
    return () => window.removeEventListener('roam-app-url-open', handler)
  }, [navigate])

  return null
}
