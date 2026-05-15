/**
 * useBottomSheetDismiss
 *
 * Returns the framer-motion drag props for a swipe-down-to-dismiss
 * bottom sheet. Drop these onto the inner sheet motion.div and the
 * sheet gains the standard iOS/Material gesture: drag down past a
 * threshold (or flick with enough velocity) closes the sheet;
 * shorter drags snap back to the resting position.
 *
 * Why a hook instead of inlining drag props on every modal: we
 * have a dozen bottom-sheet-shaped components (FilterModal,
 * PlanPrompt, JustGoModal, EditReviewModal, ShareModal,
 * VisitedPrompt, ContributionPrompt, FollowersModal, etc.) and
 * users expect them ALL to dismiss with swipe. Without a shared
 * hook, the gesture is implemented (inconsistently) on a couple
 * and missing on most.
 *
 * Composable: returns ONLY drag props, not style overrides, so the
 * sheet can keep its own initial/animate/exit entrance animation.
 * The drag system reads framer-motion's internal y value and snaps
 * back to 0 on release if the threshold isn't crossed.
 *
 * Usage:
 *   const drag = useBottomSheetDismiss(onClose)
 *   <motion.div
 *     className="my-sheet"
 *     initial={{ y: 100, opacity: 0 }}
 *     animate={{ y: 0, opacity: 1 }}
 *     exit={{ y: 100, opacity: 0 }}
 *     {...drag}
 *   >
 *     ...
 *   </motion.div>
 *
 * To disable the gesture (e.g. on desktop), pass `enabled: false`.
 */

import { useCallback } from 'react'

const DISMISS_THRESHOLD_PX = 120
const DISMISS_VELOCITY = 500

export function useBottomSheetDismiss(onClose, options = {}) {
  const { enabled = true } = options

  const handleDragEnd = useCallback((_, info) => {
    if (!onClose) return
    if (info.offset.y > DISMISS_THRESHOLD_PX || info.velocity.y > DISMISS_VELOCITY) {
      onClose()
    }
  }, [onClose])

  if (!enabled) return {}

  return {
    drag: 'y',
    dragDirectionLock: true,
    // Down-only. Negative values clamp to 0 with elastic snap-back
    // so users can't yank the sheet up off the screen.
    dragConstraints: { top: 0, bottom: 0 },
    dragElastic: { top: 0, bottom: 0.5 },
    dragMomentum: false,
    onDragEnd: handleDragEnd,
  }
}

export default useBottomSheetDismiss
