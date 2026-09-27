import { useEffect, useRef } from 'react'

/**
 * Makes Back (browser back, Android hardware back via nativeAppLifecycle)
 * close a modal instead of leaving the page or the app.
 *
 * On open it pushes a same-URL history entry marked { roamModal: true }.
 * Back pops that entry and calls onClose. Closing any other way (X, Escape,
 * backdrop) pops the entry itself so it doesn't linger as a dead Back step.
 *
 * ponytail: one marker for all modals, so it assumes one back-closable modal
 * open at a time (true today: only PlaceDetail uses it).
 */
export function useBackToClose(onClose, enabled = true) {
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  useEffect(() => {
    // A full page (not a modal) is the history entry itself: nothing to add
    if (!enabled) return
    let popped = false
    window.history.pushState({ ...window.history.state, roamModal: true }, '')

    const handlePop = () => {
      // Still on a modal entry (e.g. StrictMode's remount left two): wait
      if (window.history.state?.roamModal) return
      popped = true
      onCloseRef.current?.()
    }
    window.addEventListener('popstate', handlePop)

    return () => {
      window.removeEventListener('popstate', handlePop)
      if (!popped && window.history.state?.roamModal) window.history.back()
    }
  }, [enabled])
}

export default useBackToClose
