import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { Suspense } from 'react'
import { lazyWithReload } from '../../../src/utils/lazyWithReload'
import { whenIdle } from '../../../src/utils/whenIdle'

// A stale deploy's chunks 404: the first card tap must reload the page,
// not land on "Something went wrong" (critic finding on the lazy PlaceDetail)
describe('lazyWithReload', () => {
  let reload
  beforeEach(() => {
    sessionStorage.clear()
    reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('retries a failed chunk once and renders if the retry works', async () => {
    const loader = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module'))
      .mockResolvedValueOnce({ default: () => <p>detail</p> })
    const C = lazyWithReload(loader)
    render(<Suspense fallback={null}><C /></Suspense>)
    expect(await screen.findByText('detail')).toBeInTheDocument()
    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads the page when the chunk keeps failing', async () => {
    const loader = vi.fn().mockRejectedValue(new TypeError('Failed to fetch dynamically imported module'))
    const C = lazyWithReload(loader)
    render(<Suspense fallback={null}><C /></Suspense>)
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
  })
})

describe('whenIdle', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  it('waits 2s on Safari (no requestIdleCallback) instead of running at once', () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestIdleCallback', undefined)
    const cb = vi.fn()
    whenIdle(cb)
    vi.advanceTimersByTime(1000)
    expect(cb).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(cb).toHaveBeenCalled()
  })
})
