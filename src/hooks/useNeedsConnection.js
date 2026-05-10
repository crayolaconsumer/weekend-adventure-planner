/**
 * Returns a function that returns true (and shows a toast) if the user
 * is currently offline. Use to short-circuit write actions from
 * components without manually checking navigator.onLine each time.
 */

import { useCallback } from 'react'
import { useToast } from './useToast'

export function useNeedsConnection() {
  const toast = useToast()
  return useCallback(() => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      toast.error("You're offline. Reconnect to save changes.")
      return true
    }
    return false
  }, [toast])
}

export default useNeedsConnection
