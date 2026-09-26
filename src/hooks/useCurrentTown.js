import { useState, useEffect } from 'react'

// One lookup per ~1km cell per session (the server caches it too)
const cache = new Map()

function lookup(key) {
  if (!cache.has(key)) {
    cache.set(key, fetch(`/api/town?near=${key}&format=json`)
      .then(res => (res.ok ? res.json() : null))
      .then(data => (data?.town ? { slug: data.town.slug, name: data.town.name } : null))
      .catch(() => { cache.delete(key); return null }))
  }
  return cache.get(key)
}

/**
 * The town the user is in ({ slug, name }), or null until known.
 * Skips the London fallback location so we never claim "Explore Westminster"
 * for someone who denied location.
 */
export function useCurrentTown(location) {
  const key = location && !location.isFallback
    ? `${location.lat.toFixed(2)},${location.lng.toFixed(2)}`
    : null
  const [found, setFound] = useState(null) // { key, town }

  useEffect(() => {
    if (!key) return
    let cancelled = false
    lookup(key).then(town => { if (!cancelled) setFound({ key, town }) })
    return () => { cancelled = true }
  }, [key])

  return found?.key === key ? found.town : null
}
