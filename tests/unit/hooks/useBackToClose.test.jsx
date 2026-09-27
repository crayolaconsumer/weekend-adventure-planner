import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBackToClose } from '../../../src/hooks/useBackToClose'

// Drive history like a browser: back() pops our entry and fires popstate
function fakeHistory() {
  const stack = [{ usr: null, key: 'k0', idx: 0 }]
  vi.spyOn(window.history, 'state', 'get').mockImplementation(() => stack[stack.length - 1])
  vi.spyOn(window.history, 'pushState').mockImplementation(s => { stack.push(s) })
  const back = vi.spyOn(window.history, 'back').mockImplementation(() => {
    stack.pop()
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  return { stack, back }
}

describe('useBackToClose', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('Back closes the modal and pops exactly one entry', () => {
    const h = fakeHistory()
    const onClose = vi.fn()
    const { unmount } = renderHook(() => useBackToClose(onClose))
    expect(h.stack).toHaveLength(2)
    expect(h.stack[1]).toMatchObject({ key: 'k0', roamModal: true })

    act(() => window.history.back()) // hardware / browser back
    expect(onClose).toHaveBeenCalledTimes(1)
    unmount() // parent closes the modal in response
    expect(h.back).toHaveBeenCalledTimes(1) // no second pop
    expect(h.stack).toHaveLength(1)
  })

  it('closing with X removes the history entry so Back still goes to the previous page', () => {
    const h = fakeHistory()
    const onClose = vi.fn()
    const { unmount } = renderHook(() => useBackToClose(onClose))
    unmount()
    expect(h.back).toHaveBeenCalledTimes(1)
    expect(h.stack).toHaveLength(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not pop when a route change replaced the modal entry', () => {
    const h = fakeHistory()
    const { unmount } = renderHook(() => useBackToClose(vi.fn()))
    h.stack.push({ usr: null, key: 'k1', idx: 1 }) // router navigated from inside the modal
    unmount()
    expect(h.back).not.toHaveBeenCalled()
  })
})

describe('useBackToClose on a full page', () => {
  it('adds no history entry when disabled (regression: dead Back presses on /place/:id)', async () => {
    const { renderHook } = await import('@testing-library/react')
    const { useBackToClose } = await import('../../../src/hooks/useBackToClose')
    const before = window.history.length
    const { unmount } = renderHook(() => useBackToClose(() => {}, false))
    expect(window.history.length).toBe(before)
    unmount()
  })
})
