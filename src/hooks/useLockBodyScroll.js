import { useEffect } from 'react'

/**
 * useLockBodyScroll — ref-counted body-overflow lock for modals.
 *
 * The previous pattern was each modal independently flipping
 * `document.body.style.overflow = 'hidden'` on open and `''` on close.
 * That broke when modals stacked: opening B while A was open
 * incremented the lock to 1 (already locked); closing A first restored
 * '' even though B was still showing. Then B's close handler ran and
 * tried to restore overflow with no idea what the page actually
 * expected, leaving the body scrollable when it shouldn't be — or, in
 * the worst race, leaving overflow:hidden stuck after all modals had
 * unmounted.
 *
 * Now: a single module-scope counter tracks how many modals are open.
 * The first mount locks; the last unmount restores. Stacked modals
 * Just Work.
 *
 * Usage:
 *   useLockBodyScroll(isOpen)
 *
 * isOpen is required so consumers can guard against "modal mounted
 * but not visible" cases (e.g. AnimatePresence keeping a node mounted
 * during exit animation).
 */

let lockCount = 0
let originalOverflow = ''

function applyLock() {
  if (lockCount === 0) {
    originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  lockCount++
}

function releaseLock() {
  if (lockCount <= 0) return
  lockCount--
  if (lockCount === 0) {
    document.body.style.overflow = originalOverflow
  }
}

export function useLockBodyScroll(isOpen) {
  useEffect(() => {
    if (!isOpen) return undefined
    applyLock()
    return releaseLock
  }, [isOpen])
}

export default useLockBodyScroll
