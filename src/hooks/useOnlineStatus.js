/**
 * Tracks navigator.onLine. Returns boolean; updates on online/offline events.
 * Treats SSR / pre-mount as "online" so server-rendered content doesn't show
 * the offline pill before hydration.
 */

import { useEffect, useState } from 'react'

export function useOnlineStatus() {
  const [online, setOnline] = useState(() => {
    if (typeof navigator === 'undefined') return true
    return navigator.onLine !== false
  })

  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  return online
}

export default useOnlineStatus
