/**
 * LocationSync — opportunistically persists the signed-in user's COARSE
 * location so the promoted-event push jobs ("events near you") can target them.
 *
 * Renders nothing. Only fires when we already have the user's location (we
 * never request it just for this) and at most once per 12h. The server rounds
 * the coordinates again before storing.
 */

import { useEffect, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'

const LAST_SENT_KEY = 'roam_loc_sent_at'
const MIN_INTERVAL_MS = 12 * 60 * 60 * 1000

export default function LocationSync({ location }) {
  const { user } = useAuth()
  const sentRef = useRef(false)

  useEffect(() => {
    if (!user || typeof location?.lat !== 'number' || typeof location?.lng !== 'number') return
    // Only persist a GENUINE device fix — never the app's London fallback, which
    // would make failed/denied users falsely appear near London events.
    if (!location.fromDeviceFix) return
    if (sentRef.current) return

    try {
      const last = Number(localStorage.getItem(LAST_SENT_KEY) || 0)
      if (Date.now() - last < MIN_INTERVAL_MS) return
    } catch { /* ignore storage errors */ }

    sentRef.current = true
    const token = localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
    fetch('/api/users/location', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ lat: location.lat, lng: location.lng })
    })
      .then((r) => {
        if (r.ok) { try { localStorage.setItem(LAST_SENT_KEY, String(Date.now())) } catch { /* ignore */ } }
      })
      .catch(() => { /* best-effort */ })
  }, [user, location?.lat, location?.lng, location?.fromDeviceFix])

  return null
}
