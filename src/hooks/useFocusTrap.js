/**
 * Focus Trap Hook
 *
 * Traps focus within a container element for accessibility.
 * Used in modals and dialogs to prevent focus from escaping.
 */

import { useEffect, useRef, useCallback } from 'react'

const FOCUSABLE_SELECTORS = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

export function useFocusTrap(isActive = true) {
  const containerRef = useRef(null)
  const previousFocusRef = useRef(null)

  // Get all focusable elements within container
  const getFocusableElements = useCallback(() => {
    if (!containerRef.current) return []
    return Array.from(containerRef.current.querySelectorAll(FOCUSABLE_SELECTORS))
  }, [])

  // Handle keydown for tab trapping
  const handleKeyDown = useCallback((e) => {
    if (e.key !== 'Tab') return

    const focusableElements = getFocusableElements()
    if (focusableElements.length === 0) return

    const firstElement = focusableElements[0]
    const lastElement = focusableElements[focusableElements.length - 1]

    // Shift+Tab on first element -> go to last
    if (e.shiftKey && document.activeElement === firstElement) {
      e.preventDefault()
      lastElement.focus()
    }
    // Tab on last element -> go to first
    else if (!e.shiftKey && document.activeElement === lastElement) {
      e.preventDefault()
      firstElement.focus()
    }
  }, [getFocusableElements])

  useEffect(() => {
    if (!isActive) return

    // Store previously focused element
    previousFocusRef.current = document.activeElement

    // Add event listener for tab key
    const container = containerRef.current
    if (container) {
      container.addEventListener('keydown', handleKeyDown)
    }

    // Focus first focusable element or container itself
    const focusableElements = getFocusableElements()
    if (focusableElements.length > 0) {
      // Focus first focusable element after a small delay (for animations)
      setTimeout(() => {
        focusableElements[0].focus()
      }, 50)
    } else if (container) {
      container.focus()
    }

    // Cleanup
    return () => {
      if (container) {
        container.removeEventListener('keydown', handleKeyDown)
      }

      // Restore focus to previously focused element
      if (previousFocusRef.current && typeof previousFocusRef.current.focus === 'function') {
        previousFocusRef.current.focus()
      }
    }
  }, [isActive, handleKeyDown, getFocusableElements])

  return containerRef
}

export default useFocusTrap
