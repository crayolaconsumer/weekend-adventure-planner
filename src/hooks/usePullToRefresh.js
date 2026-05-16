/**
 * usePullToRefresh — native-feeling pull-to-refresh for scrollable lists.
 *
 * Detects a finger drag down past a threshold *while the scroll
 * container is already at the top*. Standard mobile pattern (Twitter,
 * Mail, etc.) — gives the user a familiar refresh affordance without
 * needing a visible "Refresh" button.
 *
 * Behaviour:
 *   - Activates only when scrollTop === 0 and the first touch moves
 *     downward (so an in-list scroll-down never trips it).
 *   - Tracks distance with a square-root easing so the pull resists
 *     beyond the threshold rather than tracking 1:1 (matches iOS feel).
 *   - Calls onRefresh() once when released past threshold and reports
 *     `refreshing` so the page can show a spinner during the async work.
 *   - Triggers a light haptic when the user crosses the threshold so
 *     they know the gesture has armed, and a success haptic on commit.
 *
 * Wiring:
 *   const ref = useRef(null)
 *   const { pullDistance, refreshing, isPulling } = usePullToRefresh(
 *     handleRefresh,
 *     ref,
 *   )
 *   <div ref={ref} className="scroll-container">...</div>
 *   <PullIndicator distance={pullDistance} active={isPulling} refreshing={refreshing} />
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { tap as hapticTap, success as hapticSuccess } from '../utils/haptics'

const THRESHOLD = 70 // px past which release triggers refresh
const MAX_PULL = 140 // visual ceiling so card can't drag forever
const RESISTANCE = 2.2 // pull-distance damping: bigger → stiffer

/**
 * @param {Function} onRefresh - called when user releases past threshold.
 *   May return a promise — `refreshing` stays true until it resolves.
 * @param {React.RefObject<HTMLElement> | null} scrollRef - the scroll
 *   container. Pass `null` to attach to the document (window scroll),
 *   which is what most mobile apps use since the body is the scroller.
 * @param {object} [options]
 * @param {boolean} [options.enabled=true] - turn the gesture off (e.g.
 *   while a modal is open and the page underneath shouldn't react).
 */
export function usePullToRefresh(onRefresh, scrollRef, options = {}) {
  const { enabled = true } = options
  const [pullDistance, setPullDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [isPulling, setIsPulling] = useState(false)

  const startYRef = useRef(null)
  const armedRef = useRef(false) // has crossed threshold (for haptic latch)
  // Latest values mirrored to refs so the touch listeners (registered
  // ONCE per mount) always see current state without re-running the
  // effect — re-attaching listeners mid-gesture would drop in-flight
  // touchmove events and the pull would stall partway down.
  const refreshingRef = useRef(false)
  const isPullingRef = useRef(false)
  useEffect(() => { refreshingRef.current = refreshing }, [refreshing])
  useEffect(() => { isPullingRef.current = isPulling }, [isPulling])

  // Stable ref to the latest onRefresh — keeps the touchend listener
  // working even when the parent re-renders with a new callback identity.
  const onRefreshRef = useRef(onRefresh)
  useEffect(() => {
    onRefreshRef.current = onRefresh
  }, [onRefresh])

  const reset = useCallback(() => {
    startYRef.current = null
    armedRef.current = false
    isPullingRef.current = false
    setIsPulling(false)
    setPullDistance(0)
  }, [])

  useEffect(() => {
    if (!enabled) return
    // Pass `null` for window-scroll mode (most mobile apps).
    const useWindowScroll = scrollRef == null
    const el = useWindowScroll ? document : (scrollRef?.current || null)
    if (!el) return

    const getScrollTop = () =>
      useWindowScroll
        ? (window.scrollY || document.documentElement.scrollTop || 0)
        : (scrollRef.current?.scrollTop ?? 0)

    const handleTouchStart = (e) => {
      // If the gesture started inside an open modal / bottom sheet,
      // defer to that overlay's own drag handler (Framer Motion's
      // swipe-down-to-dismiss). Otherwise PTR fights the dismiss
      // gesture: both fire on the same vertical drag and the user
      // sees the refresh spinner appear over a modal that's trying
      // to close. Caught via the [role="dialog"] / [aria-modal] hooks
      // every bottom sheet in the app already advertises.
      const target = e.target
      if (target instanceof Element && target.closest('[role="dialog"], [aria-modal="true"], [data-no-ptr]')) {
        return
      }
      // Only arm if we're at the very top — otherwise this is a normal
      // scroll gesture and we leave it alone.
      if (getScrollTop() > 0) return
      if (refreshingRef.current) return
      const touch = e.touches[0]
      if (!touch) return
      startYRef.current = touch.clientY
      armedRef.current = false
    }

    const handleTouchMove = (e) => {
      if (startYRef.current == null) return
      if (refreshingRef.current) return
      const touch = e.touches[0]
      if (!touch) return
      const deltaY = touch.clientY - startYRef.current
      if (deltaY <= 0) {
        // user scrolled up — cancel pull
        if (isPullingRef.current) reset()
        return
      }
      // We're pulling down at scrollTop=0. Suppress the native
      // overscroll/refresh so the browser doesn't fight us.
      if (e.cancelable) e.preventDefault()
      const damped = Math.min(Math.sqrt(deltaY) * RESISTANCE * 2, MAX_PULL)
      isPullingRef.current = true
      setIsPulling(true)
      setPullDistance(damped)
      if (!armedRef.current && damped >= THRESHOLD) {
        armedRef.current = true
        hapticTap('light')
      } else if (armedRef.current && damped < THRESHOLD) {
        armedRef.current = false
      }
    }

    const handleTouchEnd = async () => {
      if (startYRef.current == null) return
      const armed = armedRef.current
      reset()
      if (!armed) return
      // Fire the refresh.
      refreshingRef.current = true
      setRefreshing(true)
      hapticSuccess()
      try {
        await onRefreshRef.current?.()
      } finally {
        // Keep the spinner on screen for at least 500ms even if the
        // refresh resolves instantly — without this, a fast cache-hit
        // refresh flashes the spinner for one frame and feels like
        // the gesture did nothing.
        await new Promise((res) => setTimeout(res, 400))
        refreshingRef.current = false
        setRefreshing(false)
      }
    }

    // passive: false on touchmove so preventDefault() works.
    el.addEventListener('touchstart', handleTouchStart, { passive: true })
    el.addEventListener('touchmove', handleTouchMove, { passive: false })
    el.addEventListener('touchend', handleTouchEnd)
    el.addEventListener('touchcancel', reset)
    return () => {
      el.removeEventListener('touchstart', handleTouchStart)
      el.removeEventListener('touchmove', handleTouchMove)
      el.removeEventListener('touchend', handleTouchEnd)
      el.removeEventListener('touchcancel', reset)
    }
    // Intentionally only re-attach when toggling enabled or swapping
    // the scroll target. Other state lives in refs (see comment above)
    // so mid-gesture re-renders don't drop touchmove events.
  }, [enabled, scrollRef, reset])

  return { pullDistance, refreshing, isPulling, threshold: THRESHOLD }
}
