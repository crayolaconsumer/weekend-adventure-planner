/**
 * IntentHandler
 *
 * Sits inside the router and reacts to one-shot URL intents.
 * Currently supports:
 *
 *   ?intent=follow:<username>&redirect=<encodedUrl>&authMode=register|login
 *
 * Used by TeaserLanding's "Sign up & follow X" button to convert a
 * blocked map share into an auto-follow + redirect after sign-up.
 *
 * Behaviour:
 *   - If already authenticated → resolve username → POST follow → navigate to redirect.
 *   - If not authenticated → dispatch openAuthModal (existing global event)
 *     then watch isAuthenticated; once it flips true, run the follow + redirect.
 *
 * Edge cases (silent — match spec):
 *   - target user not found → just navigate to redirect
 *   - target is self → skip follow, navigate
 *   - already following → no-op, navigate
 *   - blocked / private → server rejects, we still navigate so the
 *     redirected page surfaces the right state (404 / teaser)
 */

import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

function getAuthHeaders() {
  const token = localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function resolveUsernameToId(username) {
  try {
    const res = await fetch(`/api/users/${encodeURIComponent(username)}`, {
      headers: getAuthHeaders(),
      credentials: 'include'
    })
    if (!res.ok) return null
    const json = await res.json()
    return json?.user?.id ?? null
  } catch {
    return null
  }
}

async function postFollow(targetUserId) {
  try {
    await fetch('/api/social', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      credentials: 'include',
      body: JSON.stringify({ action: 'follow', userId: targetUserId })
    })
  } catch {
    // silent — auto-follow is best-effort
  }
}

export default function IntentHandler() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, isAuthenticated, loading: authLoading } = useAuth()

  const [pending, setPending] = useState(null) // { username, redirect }
  const handledRef = useRef(false)

  // Parse intent on mount (or when search changes from a teaser navigation)
  useEffect(() => {
    if (authLoading) return
    if (handledRef.current) return

    const params = new URLSearchParams(location.search)
    const intent = params.get('intent')
    if (!intent || !intent.startsWith('follow:')) return

    handledRef.current = true
    const username = intent.slice('follow:'.length)
    const redirect = params.get('redirect') || '/'
    const authMode = params.get('authMode') === 'login' ? 'login' : 'register'

    // Strip intent params from URL so refresh / back doesn't re-trigger
    const cleanParams = new URLSearchParams(location.search)
    cleanParams.delete('intent')
    cleanParams.delete('redirect')
    cleanParams.delete('authMode')
    const cleanSearch = cleanParams.toString()
    navigate(
      { pathname: location.pathname, search: cleanSearch ? `?${cleanSearch}` : '' },
      { replace: true }
    )

    // eslint-disable-next-line react-hooks/set-state-in-effect -- One-shot URL intent capture, runs once per intent presence
    setPending({ username, redirect })

    if (!isAuthenticated) {
      // Use the existing global event listener pattern to open AuthModal
      window.dispatchEvent(new CustomEvent('openAuthModal', { detail: { mode: authMode } }))
    }
  }, [authLoading, isAuthenticated, location, navigate])

  // When auth flips to true while we have a pending intent, do the follow + redirect
  useEffect(() => {
    if (!pending || !isAuthenticated || !user) return

    let cancelled = false
    async function run() {
      const targetId = await resolveUsernameToId(pending.username)
      if (cancelled) return
      if (targetId && targetId !== user.id) {
        await postFollow(targetId)
      }
      if (cancelled) return
      navigate(pending.redirect, { replace: true })
      setPending(null)
    }
    run()
    return () => { cancelled = true }
  }, [pending, isAuthenticated, user, navigate])

  return null
}
