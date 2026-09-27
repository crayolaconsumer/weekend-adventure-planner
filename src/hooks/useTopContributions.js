/**
 * useTopContributions Hook
 *
 * Fetches and caches top contributions for multiple places.
 * Used to show community tips on swipe cards efficiently.
 */

import { useState, useEffect } from 'react'

// Module-level cache: placeId -> { timestamp, promise<contribution|null> }.
// Storing the promise (not the result) means an id already in flight is never
// requested twice, whether by a re-render or another mounted hook.
const contributionCache = new Map()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

/**
 * Resolve top contributions for placeIds, requesting only ids not already
 * cached or in flight. Never throws: failures resolve to null (and are cached
 * so a broken API is not hammered).
 */
export async function fetchBatchContributions(placeIds) {
  if (!placeIds || placeIds.length === 0) return {}

  const now = Date.now()
  const missing = [...new Set(placeIds)].filter(id => {
    const cached = contributionCache.get(id)
    return !cached || now - cached.timestamp > CACHE_TTL
  })

  if (missing.length > 0) {
    const request = fetch(`/api/contributions/batch?placeIds=${missing.join(',')}`)
      .then(response => (response.ok ? response.json() : null))
      .then(body => body?.contributions || {})
      .catch(() => ({})) // Silently fail - API might not be configured in development
    for (const id of missing) {
      contributionCache.set(id, { timestamp: now, promise: request.then(c => c[id] || null) })
    }
  }

  const values = await Promise.all(placeIds.map(id => contributionCache.get(id).promise))
  return Object.fromEntries(placeIds.map((id, i) => [id, values[i]]))
}

const TIP_PREFETCH_CHUNK = 12

/**
 * Place ids whose tips the swipe deck should hold. The window moves in fixed
 * chunks of 12, so it changes once per 12 swipes (one request for the next 12
 * ids) instead of on every swipe, and always covers 12+ cards ahead.
 */
export function tipPrefetchIds(items, currentIndex) {
  const start = Math.floor(currentIndex / TIP_PREFETCH_CHUNK) * TIP_PREFETCH_CHUNK
  return items
    .slice(start, start + 2 * TIP_PREFETCH_CHUNK)
    .map(item => item.place?.id)
    .filter(Boolean)
}

/**
 * Hook to get top contributions for a list of places.
 * Refetches only when the set of ids changes (not on every render), and then
 * only for ids it has not seen. Callers should pass a list that moves in
 * chunks (see CardStack) so a swipe does not change it.
 *
 * @param {string[]} placeIds - Array of place IDs to fetch contributions for
 * @returns {{ contributions: Object, loading: boolean, error: string|null }}
 */
export function useTopContributions(placeIds) {
  const [contributions, setContributions] = useState({})
  const [loadedKey, setLoadedKey] = useState('')
  const key = (placeIds || []).join(',')

  useEffect(() => {
    if (!key) return
    let cancelled = false
    fetchBatchContributions(key.split(',')).then(result => {
      if (cancelled) return
      setContributions(prev => ({ ...prev, ...result }))
      setLoadedKey(key)
    })
    return () => { cancelled = true }
  }, [key])

  return { contributions, loading: Boolean(key) && key !== loadedKey, error: null }
}

/**
 * Hook to get top contribution for a single place
 * Convenience wrapper around useTopContributions
 *
 * @param {string} placeId - Place ID to fetch contribution for
 * @returns {{ contribution: Object|null, loading: boolean, error: string|null }}
 */
export function useTopContribution(placeId) {
  const { contributions, loading, error } = useTopContributions(
    placeId ? [placeId] : []
  )

  return {
    contribution: contributions[placeId] || null,
    loading,
    error
  }
}

/**
 * Clear the contribution cache
 * Useful after user creates a new contribution
 */
export function clearContributionCache(placeId) {
  if (placeId) {
    contributionCache.delete(placeId)
  } else {
    contributionCache.clear()
  }
}

export default useTopContributions
