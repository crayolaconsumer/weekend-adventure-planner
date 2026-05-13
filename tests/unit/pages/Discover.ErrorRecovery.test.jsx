import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ErrorRecovery, { classifyLoadError } from '../../../src/pages/Discover/ErrorRecovery'

describe('Discover/ErrorRecovery.classifyLoadError', () => {
  it("classifies network errors", () => {
    expect(classifyLoadError('Failed to fetch').kind).toBe('network')
    expect(classifyLoadError('A network problem occurred').kind).toBe('network')
  })

  it("classifies timeout errors", () => {
    expect(classifyLoadError('Request timeout after 30s').kind).toBe('timeout')
    expect(classifyLoadError('Timeout exceeded').kind).toBe('timeout')
  })

  it("classifies rate-limit errors (429 + text variants)", () => {
    expect(classifyLoadError('429 Too Many Requests').kind).toBe('rate_limit')
    expect(classifyLoadError('You hit the rate limit').kind).toBe('rate_limit')
  })

  it("classifies server errors (500/502/503)", () => {
    expect(classifyLoadError('500 Internal Server Error').kind).toBe('server')
    expect(classifyLoadError('502 Bad Gateway').kind).toBe('server')
    expect(classifyLoadError('503 Service Unavailable').kind).toBe('server')
  })

  it("falls back to generic", () => {
    expect(classifyLoadError('Something weird happened').kind).toBe('generic')
    expect(classifyLoadError(null).kind).toBe('generic')
    expect(classifyLoadError(undefined).kind).toBe('generic')
    expect(classifyLoadError('').kind).toBe('generic')
  })

  it('every classification has title + message', () => {
    for (const err of ['Failed to fetch', 'Timeout', '429', '500', 'random']) {
      const c = classifyLoadError(err)
      expect(c.title).toBeTruthy()
      expect(c.message).toBeTruthy()
    }
  })
})

describe('Discover/ErrorRecovery component', () => {
  it('renders network-error title for network errors', () => {
    render(<ErrorRecovery loadError="Failed to fetch" onRetry={() => {}} onOpenFilters={() => {}} />)
    expect(screen.getByText(/Connection issue/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Retry Connection/i })).toBeInTheDocument()
  })

  it('renders generic title + offers Check Filters secondary action', () => {
    render(<ErrorRecovery loadError="bzzt" onRetry={() => {}} onOpenFilters={() => {}} />)
    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Check Filters/i })).toBeInTheDocument()
  })

  it("shows 'Reduce Radius' secondary action on timeout", () => {
    render(<ErrorRecovery loadError="Request timeout" onRetry={() => {}} onOpenFilters={() => {}} />)
    expect(screen.getByRole('button', { name: /Reduce Radius/i })).toBeInTheDocument()
  })

  it('does NOT render secondary action on rate-limit / server / network', () => {
    for (const err of ['429 limit', '500 server', 'fetch failed']) {
      const { unmount } = render(<ErrorRecovery loadError={err} onRetry={() => {}} onOpenFilters={() => {}} />)
      expect(screen.queryByRole('button', { name: /Check Filters|Reduce Radius/i })).toBeNull()
      unmount()
    }
  })

  it('primary button fires onRetry', async () => {
    const onRetry = vi.fn()
    const user = userEvent.setup()
    render(<ErrorRecovery loadError="server fell over" onRetry={onRetry} onOpenFilters={() => {}} />)
    await user.click(screen.getByRole('button', { name: /Try Again/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it("secondary 'Check Filters' fires onOpenFilters", async () => {
    const onOpenFilters = vi.fn()
    const user = userEvent.setup()
    render(<ErrorRecovery loadError="bzzt" onRetry={() => {}} onOpenFilters={onOpenFilters} />)
    await user.click(screen.getByRole('button', { name: /Check Filters/i }))
    expect(onOpenFilters).toHaveBeenCalledTimes(1)
  })
})
