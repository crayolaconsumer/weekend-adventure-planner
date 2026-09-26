import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

const env = { reduced: false }
const track = vi.fn()
const injectAdSenseScript = vi.fn()
const pushAdSlot = vi.fn()
const showNativeAd = vi.fn()
const hideNativeAd = vi.fn()
const setAdCardActive = vi.fn()
const destroyNativeAd = vi.fn()
vi.mock('framer-motion', async (orig) => ({ ...(await orig()), useReducedMotion: () => env.reduced }))
vi.mock('../../../src/utils/analytics', () => ({ track: (...a) => track(...a) }))
vi.mock('../../../src/utils/haptics', () => ({ tap: () => Promise.resolve() }))
vi.mock('../../../src/utils/nativeBridge', () => ({ getPlatform: () => 'web' }))
vi.mock('../../../src/utils/adSense', () => ({
  getAdSenseClientId: () => 'ca-pub-1',
  ADSENSE_SLOT_CARD: '999',
  ADSENSE_CARD_LAYOUT_KEY: '-fb+5w+4e-db+86',
  injectAdSenseScript: () => injectAdSenseScript(),
  pushAdSlot: () => pushAdSlot(),
}))
vi.mock('../../../src/utils/nativeAd', () => ({
  showNativeAd: (...a) => showNativeAd(...a),
  hideNativeAd: (...a) => hideNativeAd(...a),
  setAdCardActive: (...a) => setAdCardActive(...a),
  destroyNativeAd: (...a) => destroyNativeAd(...a),
  onNativeAdDismissed: () => Promise.resolve({ remove: () => {} }),
}))

const { default: AdCard } = await import('../../../src/components/AdCard')

beforeEach(() => {
  env.reduced = false
  for (const f of [track, injectAdSenseScript, pushAdSlot, showNativeAd, hideNativeAd, setAdCardActive, destroyNativeAd]) f.mockReset()
  destroyNativeAd.mockResolvedValue()
  showNativeAd.mockResolvedValue()
  hideNativeAd.mockResolvedValue()
})
afterEach(() => vi.useRealTimers())

describe('AdCard (web)', () => {
  it('labels the web card "Sponsored links" (an AdSense-allowed label)', () => {
    render(<AdCard slot="ad-0" isTop onStatus={() => {}} />)
    expect(screen.getAllByText('Sponsored links').length).toBeGreaterThan(0)
    expect(screen.queryByText('Sponsored')).toBeNull()
  })

  it('never loads the unit while behind the top card', () => {
    const { container } = render(<AdCard slot="ad-1" onStatus={() => {}} />)
    const ins = container.querySelector('ins.adsbygoogle')
    expect(ins).toHaveAttribute('data-ad-format', 'fluid')
    expect(ins).toHaveAttribute('data-ad-slot', '999')
    expect(ins).toHaveAttribute('data-ad-client', 'ca-pub-1')
    expect(ins).toHaveAttribute('data-ad-layout-key', '-fb+5w+4e-db+86')
    expect(injectAdSenseScript).not.toHaveBeenCalled()
    expect(pushAdSlot).not.toHaveBeenCalled()
  })

  it('loads the unit once it is on top, once, with the branded skeleton until filled', async () => {
    const onStatus = vi.fn()
    const { container, rerender } = render(<AdCard slot="ad-1" onStatus={onStatus} />)
    rerender(<AdCard slot="ad-1" isTop onStatus={onStatus} />)
    rerender(<AdCard slot="ad-1" isTop onStatus={onStatus} />)
    expect(injectAdSenseScript).toHaveBeenCalled()
    expect(pushAdSlot).toHaveBeenCalledTimes(1)
    expect(container.querySelector('.ad-card-filling')).not.toBeNull()
    expect(track).not.toHaveBeenCalledWith('ad_card_shown', expect.anything())

    container.querySelector('ins').setAttribute('data-ad-status', 'filled')
    await waitFor(() => expect(onStatus).toHaveBeenCalledWith('ad-1', 'filled'))
    expect(container.querySelector('.ad-card-filling')).toBeNull()
    await waitFor(() => expect(track).toHaveBeenCalledWith('ad_card_shown', { platform: 'web', fillMs: expect.any(Number) }))
  })

  it('reports unfilled when AdSense marks the unit unfilled', async () => {
    const onStatus = vi.fn()
    const { container } = render(<AdCard slot="ad-2" isTop onStatus={onStatus} />)
    container.querySelector('ins').setAttribute('data-ad-status', 'unfilled')
    await waitFor(() => expect(onStatus).toHaveBeenCalledWith('ad-2', 'unfilled', { waitedMs: expect.any(Number) }))
    expect(onStatus).not.toHaveBeenCalledWith('ad-2', 'filled')
  })

  it('collapses after 2500ms without a fill; tracks unfilled itself once the late window closes', () => {
    vi.useFakeTimers()
    const onStatus = vi.fn()
    const { unmount } = render(<AdCard slot="ad-3" isTop onStatus={onStatus} />)
    act(() => { vi.advanceTimersByTime(2450) })
    expect(onStatus).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(100) })
    expect(onStatus).toHaveBeenCalledWith('ad-3', 'unfilled', { waitedMs: expect.any(Number), reportedByCard: true })
    expect(onStatus.mock.calls[0][2].waitedMs).toBeGreaterThanOrEqual(2500)
    unmount()
    expect(track).not.toHaveBeenCalledWith('ad_card_unfilled', expect.anything())
    act(() => { vi.advanceTimersByTime(10000) })
    expect(track).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledWith('ad_card_unfilled', { platform: 'web', waitedMs: 2500 })
  })

  it('a fill that lands after the collapse (card gone) is recorded as lateFillMs, never pushed again', async () => {
    vi.useFakeTimers()
    const { container, unmount } = render(<AdCard slot="ad-3b" isTop onStatus={() => {}} />)
    const ins = container.querySelector('ins')
    act(() => { vi.advanceTimersByTime(2600) })
    unmount()
    await act(async () => { ins.setAttribute('data-ad-status', 'filled') })
    expect(track).toHaveBeenCalledWith('ad_card_unfilled', { platform: 'web', waitedMs: 2500, lateFillMs: expect.any(Number) })
    act(() => { vi.advanceTimersByTime(20000) })
    expect(track.mock.calls.filter(c => c[0] === 'ad_card_unfilled')).toHaveLength(1)
    expect(pushAdSlot).toHaveBeenCalledTimes(1)
  })

  it('Skip advances as a skip, once', async () => {
    vi.useFakeTimers()
    const onSwipe = vi.fn()
    const { container } = render(<AdCard slot="ad-4" isTop onSwipe={onSwipe} onStatus={() => {}} />)
    await act(async () => { container.querySelector('ins').setAttribute('data-ad-status', 'filled') })
    fireEvent.click(screen.getByRole('button', { name: 'Skip ad' }))
    fireEvent.click(screen.getByRole('button', { name: 'Skip ad' }))
    act(() => { vi.advanceTimersByTime(250) })
    expect(onSwipe).toHaveBeenCalledTimes(1)
    expect(onSwipe).toHaveBeenCalledWith('nope')
    expect(track).toHaveBeenCalledWith('ad_card_skipped', { platform: 'web', direction: 'left' })
  })

  it('Skip before any ad filled is not an ad skip (no event, flagged unfilled)', () => {
    vi.useFakeTimers()
    const onSwipe = vi.fn()
    render(<AdCard slot="ad-4b" isTop onSwipe={onSwipe} onStatus={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Skip ad' }))
    act(() => { vi.advanceTimersByTime(250) })
    expect(onSwipe).toHaveBeenCalledWith('nope', { unfilled: true })
    expect(track).not.toHaveBeenCalledWith('ad_card_skipped', expect.anything())
  })

  it('a Skip still in flight does nothing after unmount', () => {
    vi.useFakeTimers()
    const onSwipe = vi.fn()
    const { unmount } = render(<AdCard slot="ad-5" isTop onSwipe={onSwipe} onStatus={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Skip ad' }))
    unmount()
    act(() => { vi.advanceTimersByTime(500) })
    expect(onSwipe).not.toHaveBeenCalled()
  })

  it('reduced motion: fades out in place instead of flying off', async () => {
    env.reduced = true
    const onSwipe = vi.fn()
    const { container } = render(<AdCard slot="ad-6" isTop onSwipe={onSwipe} onStatus={() => {}} />)
    const card = container.querySelector('.ad-card')
    fireEvent.click(screen.getByRole('button', { name: 'Skip ad' }))
    await waitFor(() => expect(onSwipe).toHaveBeenCalled())
    await waitFor(() => expect(Number(card.style.opacity)).toBeLessThan(0.5))
    expect(card.style.transform).not.toMatch(/-\d{2,}px/)
  })
})

describe('AdCard (native)', () => {
  const rect = { left: 0, top: 0, width: 300, height: 400, right: 300, bottom: 400, x: 0, y: 0 }
  let blocker = null
  let origFromPoint
  let origRect

  beforeEach(() => {
    blocker = null
    origFromPoint = document.elementFromPoint
    origRect = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect })
    document.elementFromPoint = (x, y) => {
      if (blocker && x === blocker.x && y === blocker.y) return blocker.el
      return document.querySelector('.ad-card .ad-card-body') || null
    }
  })
  afterEach(() => {
    document.elementFromPoint = origFromPoint
    Element.prototype.getBoundingClientRect = origRect
  })

  it('shows the native card over the placeholder, and announces it so the banner steps aside', async () => {
    render(<AdCard slot="ad-7" native isTop onSwipe={() => {}} />)
    await waitFor(() => expect(showNativeAd).toHaveBeenCalledWith(expect.objectContaining({ slot: 'ad-7', width: 300, height: 400 })))
    await waitFor(() => expect(setAdCardActive).toHaveBeenCalledWith(true))
    expect(track).toHaveBeenCalledWith('ad_card_shown', { platform: 'web' })
  })

  it('native: ad_card_shown waits for the real card to be on screen', async () => {
    let resolveShow
    showNativeAd.mockImplementation(() => new Promise(r => { resolveShow = r }))
    render(<AdCard slot="ad-7b" native isTop onSwipe={() => {}} />)
    await waitFor(() => expect(showNativeAd).toHaveBeenCalled())
    expect(track).not.toHaveBeenCalledWith('ad_card_shown', expect.anything())
    await act(async () => { resolveShow() })
    expect(track).toHaveBeenCalledWith('ad_card_shown', { platform: 'web' })
  })

  it('hides when something covers a point only a 5x5 grid samples', async () => {
    render(<AdCard slot="ad-8b" native isTop onSwipe={() => {}} />)
    await waitFor(() => expect(setAdCardActive).toHaveBeenCalledWith(true))
    const menu = document.createElement('div')
    blocker = { x: 89, y: 114, el: menu }
    document.body.appendChild(menu)
    await waitFor(() => expect(hideNativeAd).toHaveBeenCalledWith('ad-8b'), { timeout: 200 })
    menu.remove()
  })

  it('hides while a toast overlaps the card (toasts are invisible to elementFromPoint)', async () => {
    render(<AdCard slot="ad-8c" native isTop onSwipe={() => {}} />)
    await waitFor(() => expect(setAdCardActive).toHaveBeenCalledWith(true))
    const container = document.createElement('div')
    container.className = 'toast-container'
    const toast = document.createElement('div')
    container.appendChild(toast)
    document.body.appendChild(container)
    await waitFor(() => expect(hideNativeAd).toHaveBeenCalledWith('ad-8c'), { timeout: 200 })
    container.remove()
  })

  it('placeholder Skip before the native ad was ever shown: released, not an ad skip', () => {
    vi.useFakeTimers()
    showNativeAd.mockImplementation(() => new Promise(() => {}))
    const onSwipe = vi.fn()
    render(<AdCard slot="ad-10" native isTop onSwipe={onSwipe} />)
    fireEvent.click(screen.getByRole('button', { name: 'Skip ad' }))
    act(() => { vi.advanceTimersByTime(250) })
    expect(destroyNativeAd).toHaveBeenCalledWith('ad-10')
    expect(onSwipe).toHaveBeenCalledWith('nope', { unfilled: true })
    expect(track).not.toHaveBeenCalledWith('ad_card_skipped', expect.anything())
  })

  it('placeholder Skip after the native ad was shown is a normal skip', async () => {
    const onSwipe = vi.fn()
    render(<AdCard slot="ad-11" native isTop onSwipe={onSwipe} />)
    await waitFor(() => expect(setAdCardActive).toHaveBeenCalledWith(true))
    fireEvent.click(screen.getByRole('button', { name: 'Skip ad' }))
    await waitFor(() => expect(onSwipe).toHaveBeenCalledWith('nope'))
    expect(track).toHaveBeenCalledWith('ad_card_skipped', { platform: 'web', direction: 'left' })
  })

  it('does not re-check on style-only writes (Framer writes style every frame)', async () => {
    // take the 300ms poll out so only the MutationObserver can re-check
    const poll = vi.spyOn(window, 'setInterval').mockImplementation(() => 0)
    render(<AdCard slot="ad-12" native isTop onSwipe={() => {}} />)
    poll.mockRestore()
    await waitFor(() => expect(setAdCardActive).toHaveBeenCalledWith(true))
    const spy = vi.spyOn(document, 'elementFromPoint')
    const other = document.createElement('div')
    document.body.appendChild(other)
    await new Promise(r => setTimeout(r, 30)) // childList change: one re-check
    spy.mockClear()
    for (let i = 0; i < 5; i++) other.style.transform = `translateX(${i}px)`
    await new Promise(r => setTimeout(r, 50))
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
    other.remove()
  })

  it('hides within a frame when something new covers an edge midpoint', async () => {
    render(<AdCard slot="ad-8" native isTop onSwipe={() => {}} />)
    await waitFor(() => expect(setAdCardActive).toHaveBeenCalledWith(true))
    // top edge midpoint: not one of the old 3 sample points
    const sheet = document.createElement('div')
    blocker = { x: 150, y: 28, el: sheet }
    document.body.appendChild(sheet)
    await waitFor(() => expect(hideNativeAd).toHaveBeenCalledWith('ad-8'), { timeout: 200 })
    expect(setAdCardActive).toHaveBeenLastCalledWith(false)
    sheet.remove()
  })

  it('hides and releases the banner when the card stops being top', async () => {
    const { rerender } = render(<AdCard slot="ad-9" native isTop onSwipe={() => {}} />)
    await waitFor(() => expect(setAdCardActive).toHaveBeenCalledWith(true))
    rerender(<AdCard slot="ad-9" native isTop={false} />)
    expect(hideNativeAd).toHaveBeenCalledWith('ad-9')
    expect(setAdCardActive).toHaveBeenLastCalledWith(false)
  })
})
