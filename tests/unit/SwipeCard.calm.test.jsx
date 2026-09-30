import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Motion values need .get()/.on()/.off(): SwipeCard subscribes to 'change'
// and reads the values for the forced-3D transform write.
function makeMotionValue(v = 0) {
  return { get: () => v, on: () => () => {}, off: () => {}, set: () => {} }
}

vi.mock('framer-motion', async () => {
  const React = await import('react')
  const strip = ({ initial: _i, animate: _a, exit: _e, transition: _t, whileHover: _h, whileTap: _w, ...rest }) => rest
  // Cache the component per tag so motion.div is a STABLE type across
  // renders — a fresh forwardRef each render makes React remount the DOM
  // node, which detaches any node a test captured before a re-render.
  const cache = {}
  const motion = new Proxy({}, {
    get(_, tag) {
      if (!cache[tag]) {
        cache[tag] = React.forwardRef((props, ref) => React.createElement(tag, { ...strip(props), ref }))
      }
      return cache[tag]
    },
  })
  return {
    motion,
    AnimatePresence: ({ children }) => children,
    useMotionValue: makeMotionValue,
    useTransform: () => ({ get: () => 0, on: () => () => {}, off: () => {} }),
    animate: () => () => {},
    useReducedMotion: () => false,
  }
})
vi.mock('@use-gesture/react', () => ({ useDrag: () => () => ({}) }))

const mockState = vi.hoisted(() => ({
  socialProof: () => ({ count: 0, recommendRate: 0, hasUserRating: false, userRecommended: null }),
  openingState: () => ({ state: 'unknown', stateLabel: '' }),
  blurb: () => null,
}))
vi.mock('../../src/utils/ratingsStorage', () => ({
  getPlaceSocialProof: (id) => mockState.socialProof(id),
}))
vi.mock('../../src/utils/openingHours', () => ({
  getOpeningState: (hours, place) => mockState.openingState(hours, place),
}))
vi.mock('../../src/utils/placeBlurb', () => ({
  composeBlurb: (place) => mockState.blurb(place),
}))
vi.mock('../../src/contexts/DistanceContext', () => ({
  useFormatDistance: () => (m) => `${(m / 1000).toFixed(1)} km`,
}))
vi.mock('../../src/utils/haptics', () => ({ tap: vi.fn(), success: vi.fn() }))
vi.mock('../../src/utils/imageCache', () => ({
  fetchAndCacheImage: vi.fn(),
  getCachedImage: vi.fn(),
  invalidateCachedImage: vi.fn(),
}))
vi.mock('../../src/utils/placeImage', () => ({
  resolvePlaceImageSync: () => null,
  resolvePlaceImageWithMeta: () => Promise.resolve(null),
}))

const { default: SwipeCard } = await import('../../src/components/SwipeCard')

const basePlace = { id: 'p1', name: 'The Old Well' }

function renderCard(props = {}) {
  const place = props.place || basePlace
  const onExpand = props.onExpand || vi.fn()
  const ui = (
    <MemoryRouter>
      <SwipeCard
        place={place}
        isTop
        onSwipe={props.onSwipe || vi.fn()}
        onExpand={onExpand}
        topContribution={null}
        friendActivity={null}
        saveCapNudge={false}
        lifted={false}
        {...props}
      />
    </MemoryRouter>
  )
  return render(ui)
}

beforeEach(() => {
  mockState.socialProof = () => ({ count: 0, recommendRate: 0, hasUserRating: false, userRecommended: null })
  mockState.openingState = () => ({ state: 'unknown', stateLabel: '' })
  mockState.blurb = () => null
})

describe('SwipeCard calm layout', () => {
  it('renders chip, name and a single meta line', () => {
    renderCard({
      place: {
        ...basePlace,
        type: 'cafe',
        distance: 1200,
        category: { key: 'cafe', label: 'Café' },
      },
    })
    expect(screen.getByRole('heading', { name: 'The Old Well' })).toBeInTheDocument()
    expect(screen.getByText('Café')).toHaveClass('swipe-card-chip')
    expect(screen.getByText('cafe · 1.2 km')).toHaveClass('swipe-card-line')
  })

  it('meta line omits absent segments and joins with ·', () => {
    mockState.openingState = () => ({ state: 'open', stateLabel: 'Open' })
    renderCard({ place: { ...basePlace, distance: 500 } })
    // no type, no category label -> line is "0.5 km · Open"
    expect(screen.getByText('0.5 km · Open')).toHaveClass('swipe-card-line')
  })

  it('meta line is empty when nothing is known', () => {
    const { container } = renderCard({ place: basePlace })
    expect(container.querySelector('.swipe-card-line')).toHaveTextContent('')
  })

  describe('social line', () => {
    it('user rating wins over friends and community', () => {
      mockState.socialProof = () => ({ count: 5, recommendRate: 80, hasUserRating: true, userRecommended: true })
      renderCard({ place: basePlace, friendActivity: { friendCount: 3 } })
      expect(screen.getByText('You loved this')).toHaveClass('swipe-card-social')
    })

    it('user visit shows "You visited"', () => {
      mockState.socialProof = () => ({ count: 1, recommendRate: 0, hasUserRating: true, userRecommended: false })
      renderCard({ place: basePlace })
      expect(screen.getByText('You visited')).toHaveClass('swipe-card-social')
    })

    it('friends beat community counts', () => {
      renderCard({ place: basePlace, friendActivity: { friendCount: 1 } })
      expect(screen.getByText('1 friend here')).toHaveClass('swipe-card-social')
    })

    it('pluralises friends', () => {
      renderCard({ place: basePlace, friendActivity: { friendCount: 4 } })
      expect(screen.getByText('4 friends here')).toHaveClass('swipe-card-social')
    })

    it('falls back to community count', () => {
      mockState.socialProof = () => ({ count: 3, recommendRate: 90, hasUserRating: false, userRecommended: null })
      renderCard({ place: basePlace })
      expect(screen.getByText('3 explorers loved this')).toHaveClass('swipe-card-social')
    })

    it('singular community count', () => {
      mockState.socialProof = () => ({ count: 1, recommendRate: 100, hasUserRating: false, userRecommended: null })
      renderCard({ place: basePlace })
      expect(screen.getByText('1 explorer loved this')).toHaveClass('swipe-card-social')
    })

    it('omits the line entirely when no signal exists', () => {
      const { container } = renderCard({ place: basePlace })
      expect(container.querySelector('.swipe-card-social')).toBeNull()
    })
  })

  describe('quote line', () => {
    it('prefers the top tip with attribution', () => {
      renderCard({
        place: { ...basePlace, description: 'A quiet spot' },
        topContribution: { content: 'Best cake in town', user: { username: 'sam' } },
      })
      const quote = screen.getByText(/Best cake in town/)
      expect(quote).toHaveClass('swipe-card-quote')
      expect(quote).toHaveTextContent('@sam')
    })

    it('falls back to the description quote', () => {
      renderCard({ place: { ...basePlace, description: 'A quiet spot' } })
      expect(screen.getByText(/A quiet spot/)).toHaveClass('swipe-card-quote')
    })

    it('falls back to the plain blurb', () => {
      mockState.blurb = () => 'Honest, specific fallback'
      renderCard({ place: basePlace })
      expect(screen.getByText('Honest, specific fallback')).toHaveClass('swipe-card-blurb')
    })

    it('renders nothing when no tip, description or blurb exists', () => {
      const { container } = renderCard({ place: basePlace })
      expect(container.querySelector('.swipe-card-quote')).toBeNull()
      expect(container.querySelector('.swipe-card-blurb')).toBeNull()
    })
  })

  describe('dog badge', () => {
    it('shows "Usually dog-friendly" for an inferred place', () => {
      renderCard({ place: { ...basePlace, type: 'park', dogFriendly: true, dogInferred: true } })
      expect(screen.getByText('Usually dog-friendly')).toHaveClass('swipe-card-dog')
    })

    it('shows "Dog friendly" for a confirmed place', () => {
      renderCard({ place: { ...basePlace, type: 'cafe', dog: 'yes', dogFriendly: true, dogInferred: false } })
      expect(screen.getByText('Dog friendly')).toHaveClass('swipe-card-dog')
    })

    it('omits the badge when the place is not dog-friendly', () => {
      const { container } = renderCard({ place: basePlace })
      expect(container.querySelector('.swipe-card-dog')).toBeNull()
    })
  })

  describe('card tap', () => {
    it('card tap opens PlaceDetail via onExpand', () => {
      const onExpand = vi.fn()
      const { container } = renderCard({ onExpand })
      fireEvent.click(container.querySelector('.swipe-card'))
      expect(onExpand).toHaveBeenCalledWith(basePlace)
    })

    it('tapping an action button does not call onExpand', () => {
      const onExpand = vi.fn()
      const { container } = renderCard({ onExpand })
      fireEvent.click(container.querySelector('.swipe-card-btn.nope'))
      expect(onExpand).not.toHaveBeenCalled()
    })

    it('Enter and Space on the card open details', () => {
      const onExpand = vi.fn()
      const { container } = renderCard({ onExpand })
      const card = container.querySelector('.swipe-card')
      fireEvent.keyDown(card, { key: 'Enter' })
      expect(onExpand).toHaveBeenCalledTimes(1)
      fireEvent.keyDown(card, { key: ' ' })
      expect(onExpand).toHaveBeenCalledTimes(2)
    })
  })

  describe('lift transform', () => {
    afterEach(() => vi.useRealTimers())

    it('resting card writes a neutral forced-3D transform', () => {
      vi.useFakeTimers()
      const { container } = renderCard()
      act(() => { vi.advanceTimersByTime(32) })
      const card = container.querySelector('.swipe-card')
      expect(card.style.transform).toBe('translate3d(0px, 0px, 0) rotate(0deg) scale(1)')
    })

    it('tap does not lift the card (no reveal state to compose in)', () => {
      vi.useFakeTimers()
      const { container } = renderCard()
      const card = container.querySelector('.swipe-card')
      fireEvent.click(card)
      act(() => { vi.advanceTimersByTime(32) })
      expect(card.style.transform).toBe('translate3d(0px, 0px, 0) rotate(0deg) scale(1)')
    })

    it('lifted prop (PlaceDetail open) lifts without a tap', () => {
      vi.useFakeTimers()
      const { container } = renderCard({ lifted: true })
      act(() => { vi.advanceTimersByTime(32) })
      const card = container.querySelector('.swipe-card')
      expect(card.style.transform).toBe('translate3d(0px, -12px, 0) rotate(0deg) scale(1.02)')
    })
  })
})
