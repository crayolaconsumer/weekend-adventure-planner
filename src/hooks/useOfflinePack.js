/**
 * React-friendly view of the offline pack status. Subscribes to
 * roam-pack-ready / roam-pack-cleared / roam-pack-expired events
 * dispatched by offlinePack.js so any component re-renders on change.
 */

import { useCallback, useEffect, useState } from 'react'
import { getStatus } from '../utils/offlinePack'

export function useOfflinePack(currentLocation = null) {
  const [status, setStatus] = useState({ state: 'none' })
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const next = await getStatus(currentLocation)
      setStatus(next)
    } finally {
      setLoading(false)
    }
  }, [currentLocation])

  useEffect(() => {
    refresh()
    const onChanged = () => refresh()
    window.addEventListener('roam-pack-ready', onChanged)
    window.addEventListener('roam-pack-cleared', onChanged)
    window.addEventListener('roam-pack-expired', onChanged)
    return () => {
      window.removeEventListener('roam-pack-ready', onChanged)
      window.removeEventListener('roam-pack-cleared', onChanged)
      window.removeEventListener('roam-pack-expired', onChanged)
    }
  }, [refresh])

  return { status, loading, refresh }
}

export default useOfflinePack
