import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { useRef } from 'react'
import { useNearViewport } from '../../../src/hooks/useNearViewport'

function Probe({ ready = true }) {
  const ref = useRef(null)
  const near = useNearViewport(ref, ready)
  return <div ref={ref} data-testid="box">{near ? 'near' : 'far'}</div>
}

afterEach(() => { vi.unstubAllGlobals() })

function stubObserver() {
  const made = []
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb, opts) { this.cb = cb; this.opts = opts; this.observe = vi.fn(); this.disconnect = vi.fn(); made.push(this) }
  })
  return made
}

describe('useNearViewport', () => {
  it('stays false until the element nears the viewport, then latches true', () => {
    const made = stubObserver()
    const { getByTestId } = render(<Probe />)
    expect(getByTestId('box').textContent).toBe('far')
    const io = made[0]
    expect(io.observe).toHaveBeenCalledWith(getByTestId('box'))
    expect(io.opts.rootMargin).toBe('200px')

    act(() => io.cb([{ isIntersecting: false }]))
    expect(getByTestId('box').textContent).toBe('far')
    act(() => io.cb([{ isIntersecting: true }]))
    expect(getByTestId('box').textContent).toBe('near')
    expect(io.disconnect).toHaveBeenCalled()
    expect(made).toHaveLength(1)
  })

  it('waits for ready before observing', () => {
    const made = stubObserver()
    const { rerender } = render(<Probe ready={false} />)
    expect(made).toHaveLength(0)
    rerender(<Probe ready />)
    expect(made).toHaveLength(1)
  })

  it('is true at once without IntersectionObserver', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const { getByTestId } = render(<Probe />)
    expect(getByTestId('box').textContent).toBe('near')
  })
})
