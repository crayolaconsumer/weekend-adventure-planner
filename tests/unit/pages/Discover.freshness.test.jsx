/**
 * Discover deck freshness, end to end through the real Discover page and its
 * real swipe handler (rubric points 1 and 8): like, go, a like the free save
 * limit blocks, and nope. After a remount (a reload) none of them is dealt
 * again; like and go stay out for good, the other two as 60-day skips.
 * Only the edges are stubbed: network, other hooks, and CardStack (a stand-in
 * that deals Discover's `places` and calls Discover's onSwipe).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { useState, useEffect } from 'react'

const auth = { isAuthenticated: false, loading: false, user: null }
vi.mock('../../../src/contexts/AuthContext', () => ({ useAuth: () => auth }))
let token = null
vi.mock('../../../src/utils/authToken', () => ({ getAuthToken: () => token }))
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))

const saved = [] // the saved list, read by the handler's save-limit check
let saveWorks = true
const savePlace = vi.fn(async (place) => {
  if (!saveWorks) return { success: false }
  saved.push(place)
  return { success: true }
})
let savedLoading = false
vi.mock('../../../src/hooks/useSavedPlaces', () => ({ useSavedPlaces: () => ({ savePlace, places: saved, loading: savedLoading }) }))
const visited = []
vi.mock('../../../src/hooks/useVisitedPlaces', () => ({ useVisitedPlaces: () => ({ visitedPlaces: visited, loading: false }) }))
const tracked = vi.hoisted(() => [])
vi.mock('../../../src/utils/analytics', () => ({ track: (event, props) => tracked.push({ event, props }) }))
vi.mock('../../../src/hooks/useTasteProfile', () => ({ useTasteProfile: () => ({ profile: null }) }))
vi.mock('../../../src/hooks/useSponsoredPlaces', () => ({ useSponsoredPlaces: () => ({ sponsoredPlaces: [] }) }))
let premium = false
vi.mock('../../../src/hooks/useSubscription', () => ({ useSubscription: () => ({ isPremium: premium }) }))
vi.mock('../../../src/hooks/useUserStats', () => ({ useUserStats: () => ({ stats: {}, incrementStat: () => {}, updateStats: () => {} }) }))
const NO_FRIENDS = { activityMap: {} } // stable, like the real hook's state
vi.mock('../../../src/hooks/useFriendActivity', () => ({ useFriendPlaceActivity: () => NO_FRIENDS }))
vi.mock('../../../src/hooks/useAdMob', () => ({ useAdMob: () => ({ trackSwipe: () => {} }), shouldShowBanner: () => false }))
vi.mock('../../../src/hooks/useCurrentTown', () => ({ useCurrentTown: () => null }))
vi.mock('../../../src/hooks/useToast', () => ({ useToast: () => ({ success: () => {}, error: () => {}, info: () => {} }) }))
vi.mock('../../../src/hooks/useRouteLine', async (orig) => ({ ...(await orig()), useRouteLine: () => ({ route: null, request: () => {}, clear: () => {} }), routeForPlaces: () => null }))
vi.mock('../../../src/utils/geoCache', () => ({ hasCacheSync: () => ({ exists: false }), makeCacheKey: () => 'k' }))

const HOME = { lat: 53.96, lng: -1.08 }
const TYPES = ['museum', 'park', 'castle', 'viewpoint', 'gallery', 'monument', 'garden', 'artwork']
// 120 good places 1.5 to 3 km out (the default walking band)
const POOL = Array.from({ length: 120 }, (_, i) => ({
  id: 90000 + i, name: `Spot ${i}`, type: TYPES[i % TYPES.length],
  lat: HOME.lat + 0.018 + (i % 10) * 0.0009, lng: HOME.lng + Math.floor(i / 10) * 0.0005,
  wikipedia: 'en:Spot', website: 'https://example.org', tourism: 'attraction',
}))
const fetchMore = vi.fn(async () => [])
const fetchSWR = vi.fn(async () => ({ data: POOL.map(p => ({ ...p })) }))
vi.mock('../../../src/utils/apiClient', () => ({
  fetchPlacesWithSWR: (...args) => fetchSWR(...args),
  fetchEnrichedPlaces: (...args) => fetchMore(...args),
  fetchWeather: async () => null,
  fetchPlaceById: async () => null,
  enrichPlace: async (p) => p,
}))

// Stand-in deck: shows the top card, swipes call Discover's handler, and
// exposes the loading flag + load-more so freshness regressions can drive
// a pending fetch.
vi.mock('../../../src/components/CardStack', () => ({
  default: function FakeStack({ places, onSwipe, loading, onLoadMore }) {
    const [i, setI] = useState(0)
    // Like the real CardStack: a new deck starts from its first card
    useEffect(() => { setI(0) }, [places])
    const top = places[i]
    return (
      <div>
        <output data-testid="dealt">{places.map(p => p.id).join(',')}</output>
        <output data-testid="top">{top ? String(top.id) : ''}</output>
        <output data-testid="loading">{String(loading)}</output>
        <button onClick={onLoadMore}>more</button>
        {['like', 'go', 'nope'].map(a => (
          <button key={a} onClick={async () => { await onSwipe(a, top); setI(n => n + 1) }}>{a}</button>
        ))}
      </div>
    )
  },
}))
// Stub filter sheet: the freshness regressions drive the page's toggles
// through it.
vi.mock('../../../src/components/FilterModal', () => ({
  default: p => <div>
    <button onClick={p.onToggleFreeOnly}>free</button>
    <button onClick={p.onToggleAccessibility}>access</button>
    <button onClick={p.onToggleLocalsPicks}>locals</button>
    <button onClick={p.onToggleOffPeak}>peak</button>
    <button onClick={p.onToggleDogs}>dogs</button>
    <button onClick={() => p.onToggleCategory('nature')}>nature</button>
    <button onClick={() => p.onBandChange('long')}>long</button>
    <button onClick={p.onClearAll}>clear</button>
    <output data-testid="selection">{p.selectedCategories.join(',')}</output>
    <output data-testid="mode">{p.travelMode}</output>
  </div>
}))
for (const c of ['VisitedPrompt', 'PlanPrompt', 'UpgradePrompt', 'JustGoModal', 'AdBanner']) {
  vi.doMock(`../../../src/components/${c}`, () => ({ default: () => null }))
}
vi.mock('../../../src/pages/Discover/DiscoverHeader', () => ({ default: () => null }))

const { default: Discover } = await import('../../../src/pages/Discover.jsx')
const { excludeSeen, resetSeenCache, recordSeen } = await import('../../../src/utils/seenPlaces')
const { resetServerSeenForTests } = await import('../../../src/hooks/useSwipedPlaces')

const DAY = 86400000
const dealt = () => screen.getByTestId('dealt').textContent.split(',').filter(Boolean).map(Number)
const top = () => Number(screen.getByTestId('top').textContent)
async function swipe(action) {
  const id = top()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: action })) })
  await waitFor(() => expect(top()).not.toBe(id))
  return id
}

beforeEach(() => {
  premium = false
  fetchMore.mockReset().mockResolvedValue([])
  fetchSWR.mockReset().mockResolvedValue({ data: POOL.map(p => ({ ...p })) })
  localStorage.clear()
  localStorage.setItem('roam_travel_mode', 'walking')
  resetSeenCache()
  resetServerSeenForTests()
  Object.assign(auth, { isAuthenticated: false, user: null })
  token = null
  saveWorks = true
  saved.length = 0
  savedLoading = false
  visited.length = 0
  tracked.length = 0
  savePlace.mockClear()
  vi.unstubAllGlobals()
})

describe('Discover: swiped cards are never dealt again after a reload', () => {
  it('like, go, over-limit like and nope all leave the deck', async () => {
    const view = render(<Discover location={HOME} />)
    await waitFor(() => expect(dealt().length).toBeGreaterThan(10))

    for (let n = 0; n < 9; n++) saved.push({ id: `s${n}` }) // 9 saved: one like left
    const liked = await swipe('like')
    expect(savePlace).toHaveBeenCalledTimes(1)
    const went = await swipe('go')
    const blocked = await swipe('like') // 10 saved now: the save limit blocks it
    expect(savePlace).toHaveBeenCalledTimes(1)
    const noped = await swipe('nope')
    const swiped = [liked, went, blocked, noped]
    expect(new Set(swiped).size).toBe(4)
    // funnel step "first swipe": every regular swipe is tracked with its action
    expect(tracked.filter(t => t.event === 'card-swiped').map(t => t.props.action)).toEqual(['like', 'go', 'like', 'nope'])

    // Reload: the store is re-read from storage and the deck rebuilt
    view.unmount()
    resetSeenCache({ keepOwner: true })
    render(<Discover location={HOME} />)
    await waitFor(() => expect(dealt().length).toBeGreaterThan(10))
    expect(dealt().filter(id => swiped.includes(id))).toEqual([])
    expect(top()).not.toBe(liked)

    // Like and go stay out for good; the blocked like and the nope are
    // 60-day skips (nothing was saved), so they may return after that
    const later = excludeSeen(swiped.map(id => ({ id })), Date.now() + 61 * DAY).map(p => p.id)
    expect(later).toEqual([blocked, noped])
  })

  it('running dry with a wider band on offer: says so, and does not recycle old skips', async () => {
    // Everything but 5 places was skipped 5 days ago
    POOL.slice(5).forEach(p => recordSeen(p.id, 'skip', Date.now() - 5 * DAY))
    render(<Discover location={HOME} />)
    // The notice can paint a tick before the deck syncs: wait for both
    await waitFor(() => {
      expect(screen.getByTestId('deck-running-dry')).toBeInTheDocument()
      expect(dealt().sort()).toEqual(POOL.slice(0, 5).map(p => p.id).sort())
    })
    expect(screen.getByTestId('deck-running-dry')).toHaveTextContent('Only 5 new places left in this range')
    expect(screen.getByRole('button', { name: 'Look further: 3 km to 5 km' })).toBeInTheDocument()
  })

  it('the notice counts down as the new cards are swiped', async () => {
    POOL.slice(5).forEach(p => recordSeen(p.id, 'skip', Date.now() - 5 * DAY))
    render(<Discover location={HOME} />)
    await waitFor(() => {
      expect(screen.getByTestId('deck-running-dry')).toHaveTextContent('Only 5 new places left in this range')
      expect(dealt()).toHaveLength(5)
    })
    await swipe('nope')
    await swipe('nope')
    expect(screen.getByTestId('deck-running-dry')).toHaveTextContent('Only 3 new places left in this range')
    await swipe('nope')
    await swipe('nope')
    expect(screen.getByTestId('deck-running-dry')).toHaveTextContent('Only 1 new place left in this range')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'nope' })) })
    await waitFor(() => expect(screen.getByTestId('deck-running-dry')).toHaveTextContent("You've swiped every place in this range"))
  })

  it('a like whose save fails is a 60-day skip, not hidden for good', async () => {
    const view = render(<Discover location={HOME} />)
    await waitFor(() => expect(dealt().length).toBeGreaterThan(10))
    saveWorks = false
    const failed = await swipe('like')
    expect(savePlace).toHaveBeenCalledTimes(1)
    saveWorks = true
    const liked = await swipe('like')
    view.unmount()
    resetSeenCache({ keepOwner: true })
    render(<Discover location={HOME} />)
    await waitFor(() => expect(dealt().length).toBeGreaterThan(10))
    expect(dealt().filter(id => id === failed || id === liked)).toEqual([])
    expect(excludeSeen([{ id: failed }, { id: liked }], Date.now() + 61 * DAY).map(p => p.id)).toEqual([failed])
  })
})

describe('Discover: server swipes that arrive after the deck is on screen', () => {
  it('drop out of the deck, even when the length and the first card stay the same', async () => {
    let answer
    const gate = new Promise(r => { answer = r })
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      if (opts.method === 'POST') return new Response('{}')
      await gate
      return new Response(JSON.stringify(answer.body), { status: 200 })
    }))
    Object.assign(auth, { isAuthenticated: true, user: { id: 42 } })
    token = 'tok'
    render(<Discover location={HOME} />)
    await waitFor(() => expect(dealt()).toHaveLength(50))
    const before = dealt()
    // Swiped on the phone: cards 2 to 6 of this deck (not the first one)
    const phone = before.slice(1, 6)
    answer.body = { likes: [], skips: phone.map(id => ({ placeId: String(id), swipedAt: Date.now() - DAY })) }
    await act(async () => { answer() })
    await waitFor(() => expect(dealt().filter(id => phone.includes(id))).toEqual([]))
    expect(dealt()).toHaveLength(50)
    expect(dealt()[0]).toBe(before[0])
  })
})

// Regression suite for the stuck-spinner bugs: a filter toggle during a
// pending fetch used to invalidate the in-flight result (the filter key
// changed) and strand the spinner. A result is now stale only when a
// NEWER REQUEST was issued, and client-side toggles re-filter the applied
// result via the memo.
describe('Discover: filter toggles during a pending fetch', () => {
  it.each(['free', 'access', 'locals', 'peak', 'dogs'])('a %s toggle mid-fetch applies the result and clears the spinner', async button => {
    premium = true
    let answer
    fetchSWR.mockImplementationOnce(() => new Promise(r => { answer = r }))
    render(<Discover location={HOME} />)
    expect(screen.getByTestId('loading')).toHaveTextContent('true')
    fireEvent.click(screen.getByText(button, { selector: 'button' }))
    await act(async () => { answer({ data: POOL }); await Promise.resolve() })
    // Client-side toggles never refetch: the in-flight result is applied
    // and the memo re-filters it.
    expect(fetchSWR).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('loading')).toHaveTextContent('false')
  })

  it('accessibility re-filters the applied result to an empty deck', async () => {
    premium = true
    let answer
    fetchSWR.mockImplementationOnce(() => new Promise(r => { answer = r }))
    render(<Discover location={HOME} />)
    fireEvent.click(screen.getByText('access', { selector: 'button' }))
    await act(async () => { answer({ data: POOL }); await Promise.resolve() })
    expect(screen.getByTestId('loading')).toHaveTextContent('false')
    expect(dealt()).toEqual([]) // no POOL place carries a wheelchair tag
  })

  it('category removal refetches the unscoped pool', async () => {
    localStorage.setItem('roam_interests', JSON.stringify(['nature']))
    const { getCategoryForType } = await import('../../../src/utils/categories')
    fetchSWR.mockImplementation(async (_a, _b, _r, cat) => ({ data: POOL.filter(p => !cat || getCategoryForType(p.type)?.key === cat) }))
    render(<Discover location={HOME} />)
    await waitFor(() => expect(dealt().length).toBeGreaterThan(0))
    expect(screen.getByTestId('selection').textContent).toBe('nature')
    fireEvent.click(screen.getByText('nature', { selector: 'button' }))
    await waitFor(() => expect(fetchSWR).toHaveBeenCalledTimes(2))
    // The debounced refetch carries the NEW selection (none), not the
    // pre-toggle category.
    expect(fetchSWR.mock.calls[1][3]).toBeNull()
    await waitFor(() => expect(dealt().some(id => getCategoryForType(POOL.find(p => p.id === id).type)?.key !== 'nature')).toBe(true))
  })

  it('clear-all after a category-scoped load refetches the unscoped pool', async () => {
    localStorage.setItem('roam_interests', JSON.stringify(['nature']))
    const { getCategoryForType } = await import('../../../src/utils/categories')
    fetchSWR.mockImplementation(async (_a, _b, _r, cat) => ({ data: POOL.filter(p => !cat || getCategoryForType(p.type)?.key === cat) }))
    render(<Discover location={HOME} />)
    await waitFor(() => expect(dealt().length).toBeGreaterThan(0))
    expect(screen.getByTestId('selection').textContent).toBe('nature')
    fireEvent.click(screen.getByText('clear', { selector: 'button' }))
    await waitFor(() => expect(fetchSWR).toHaveBeenCalledTimes(2))
    expect(fetchSWR.mock.calls[1][3]).toBeNull()
    await waitFor(() => expect(dealt().some(id => getCategoryForType(POOL.find(p => p.id === id).type)?.key !== 'nature')).toBe(true))
  })

  it('band changes do not discard the pending fetch', async () => {
    let answer
    fetchSWR.mockImplementationOnce(() => new Promise(r => { answer = r }))
    render(<Discover location={HOME} />)
    // Bands are client-side only (not in the filter key): no refetch, the
    // in-flight result lands.
    fireEvent.click(screen.getByText('long', { selector: 'button' }))
    await act(async () => { answer({ data: POOL }); await Promise.resolve() })
    expect(fetchSWR).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('loading')).toHaveTextContent('false')
  })

  it('a saved premium mode fetches the walking radius for a free user', async () => {
    localStorage.setItem('roam_travel_mode', 'explorer')
    render(<Discover location={HOME} />)
    await waitFor(() => expect(fetchSWR).toHaveBeenCalled())
    // The state keeps the saved mode, but the fetch is clamped to walking.
    expect(screen.getByTestId('mode').textContent).toBe('explorer')
    expect(fetchSWR.mock.calls[0][2]).toBe(5000)
  })

  it('a load-more started from an old location is discarded', async () => {
    let answer
    fetchMore.mockImplementationOnce(() => new Promise(r => { answer = r }))
    const newHome = { lat: 51.5, lng: -0.1 }
    const newPool = POOL.slice(0, 12).map((p, i) => ({ ...p, id: 80000 + i, lat: newHome.lat + 0.019, lng: newHome.lng + 0.001 * i }))
    fetchSWR.mockResolvedValueOnce({ data: POOL }).mockResolvedValueOnce({ data: newPool })
    const view = render(<Discover location={HOME} />)
    await waitFor(() => expect(dealt().length).toBeGreaterThan(0))
    fireEvent.click(screen.getByText('more', { selector: 'button' }))
    view.rerender(<Discover location={newHome} />)
    await waitFor(() => expect(dealt().every(id => id >= 80000 && id < 80100)).toBe(true))
    // The pending load-more resolves from the OLD location: its places
    // carry distances from there, so they must not merge into the new deck.
    const oldPlace = { ...POOL[0], id: 777777, name: 'The Old Location Museum', openingHours: '24/7', heritage: '1', image: 'photo', description: 'A detailed description of the old location museum' }
    await act(async () => { answer([oldPlace]); await Promise.resolve() })
    await new Promise(r => setTimeout(r, 50))
    expect(dealt()).not.toContain(777777)
  })
})

describe('Discover: a dry deck tops itself up (dryDeck)', () => {
  // 30 good places 3.5 to 4.5 km out: past the default walking band (1.5-3 km)
  const FAR = Array.from({ length: 30 }, (_, i) => ({
    id: 95000 + i, name: `Far ${i}`, type: TYPES[i % TYPES.length],
    lat: HOME.lat + 0.032 + (i % 10) * 0.0009, lng: HOME.lng + Math.floor(i / 10) * 0.0005,
    wikipedia: 'en:Far', website: 'https://example.org', tourism: 'attraction',
  }))
  const skipAllButFive = () => POOL.slice(5).forEach(p => recordSeen(p.id, 'skip', Date.now() - 5 * DAY))

  it('places past the band are dealt after the new ones, and the notice stays away', async () => {
    fetchSWR.mockResolvedValue({ data: [...POOL, ...FAR].map(p => ({ ...p })) })
    skipAllButFive()
    render(<Discover location={HOME} />)
    await waitFor(() => expect(dealt().filter(id => id >= 95000).length).toBeGreaterThan(0))
    const ids = dealt()
    expect(ids.slice(0, 5).sort()).toEqual(POOL.slice(0, 5).map(p => p.id).sort()) // new ones first
    expect(screen.queryByTestId('deck-running-dry')).toBeNull()
  })

  it('nothing past the band yet: fetches the wider ring once, unprompted, and tops up from it', async () => {
    fetchMore.mockResolvedValue(FAR.map(p => ({ ...p })))
    skipAllButFive()
    render(<Discover location={HOME} />)
    await waitFor(() => expect(dealt().filter(id => id >= 95000).length).toBeGreaterThan(0))
    expect(fetchMore).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByTestId('deck-running-dry')).toBeNull())
  })

  it('a saved place comes back as Ready to go: a right swipe never saves it again or marks it seen', async () => {
    fetchSWR.mockResolvedValue({ data: [...POOL, ...FAR].map(p => ({ ...p })) })
    skipAllButFive()
    const fav = { id: 'fav1', name: 'The Shambles', lat: HOME.lat + 0.002, lng: HOME.lng }
    saved.push(fav)
    render(<Discover location={HOME} />)
    await waitFor(() => expect(screen.getByTestId('dealt').textContent.split(',')).toContain('fav1'))
    const order = screen.getByTestId('dealt').textContent.split(',')
    const at = order.indexOf('fav1')
    expect(at).toBe(4) // after four regular cards, never first
    for (let n = 0; n < at; n++) await swipe('nope')
    expect(screen.getByTestId('top').textContent).toBe('fav1')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'like' })) })
    expect(savePlace).not.toHaveBeenCalled()
    expect(excludeSeen([{ id: 'fav1' }])).toHaveLength(1) // not in the seen store at all
  })
})

describe('Discover top-up: critic round 1 regressions', () => {
  const FAR = Array.from({ length: 30 }, (_, i) => ({
    id: 95000 + i, name: `Far ${i}`, type: TYPES[i % TYPES.length],
    lat: HOME.lat + 0.032 + (i % 10) * 0.0009, lng: HOME.lng + Math.floor(i / 10) * 0.0005,
    wikipedia: 'en:Far', website: 'https://example.org', tourism: 'attraction',
  }))
  const skipAllButFive = () => POOL.slice(5).forEach(p => recordSeen(p.id, 'skip', Date.now() - 5 * DAY))
  const ids = () => screen.getByTestId('dealt').textContent.split(',').filter(Boolean)
  const topS = () => screen.getByTestId('top').textContent
  const swipeS = async action => {
    const id = topS()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: action })) })
    return id
  }
  const rebuild = async () => {
    // a load-more merge; a GPS move or the 60 s clock tick rebuild the deck the same way
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'more' })) })
    await new Promise(r => setTimeout(r, 50))
  }
  const FAV = { id: 'fav1', name: 'The Shambles', lat: HOME.lat + 0.002, lng: HOME.lng }
  const withFar = () => fetchSWR.mockResolvedValue({ data: [...POOL, ...FAR].map(p => ({ ...p })) })

  for (const action of ['like', 'go', 'nope']) {
    it(`a ready card swiped (${action}) is not dealt again when the deck rebuilds`, async () => {
      withFar()
      skipAllButFive()
      saved.push(FAV)
      render(<Discover location={HOME} />)
      await waitFor(() => expect(ids()).toContain('fav1'))
      const at = ids().indexOf('fav1')
      for (let n = 0; n < at; n++) await swipeS('nope')
      expect(topS()).toBe('fav1')
      await swipeS(action)
      await rebuild()
      expect(ids()).not.toContain('fav1')
    })
  }

  it('saved places that load after the first swipe never re-deal a swiped card', async () => {
    withFar()
    skipAllButFive()
    savedLoading = true
    const view = render(<Discover location={HOME} />)
    await waitFor(() => expect(ids().length).toBeGreaterThan(6))
    const swiped = [await swipeS('nope'), await swipeS('nope')]
    savedLoading = false
    saved.push(FAV)
    view.rerender(<Discover location={HOME} />)
    swiped.push(await swipeS('nope'))
    await new Promise(r => setTimeout(r, 50))
    expect(swiped).not.toContain(topS())
    expect(ids()).not.toContain('fav1') // picked up at the next rebuild, not mid-deck
  })

  it('a place saved by a right swipe this session is not dealt straight back as Ready to go', async () => {
    withFar()
    skipAllButFive()
    render(<Discover location={HOME} />)
    await waitFor(() => expect(ids().length).toBeGreaterThan(6))
    const liked = await swipeS('like')
    expect(savePlace).toHaveBeenCalledTimes(1)
    saved.push(savePlace.mock.calls[0][0])
    await rebuild()
    expect(ids()).not.toContain(liked)
  })

  it('a saved further card is stored without the deck label', async () => {
    withFar()
    POOL.forEach(p => recordSeen(p.id, 'skip', Date.now() - 5 * DAY)) // nothing new in the band: further cards first
    render(<Discover location={HOME} />)
    await waitFor(() => expect(Number(topS())).toBeGreaterThanOrEqual(95000))
    await swipeS('like')
    expect(savePlace.mock.calls[0][0].further).toBeUndefined()
  })

  it('the switch-mode notice is never shown while the unprompted wider fetch is in flight', async () => {
    let release
    fetchMore.mockImplementation(() => new Promise(r => { release = () => r(FAR.map(p => ({ ...p }))) }))
    skipAllButFive()
    render(<Discover location={HOME} />)
    await waitFor(() => expect(fetchMore).toHaveBeenCalledTimes(1))
    expect(screen.queryByTestId('deck-running-dry')).toBeNull()
    await act(async () => { release() })
    await waitFor(() => expect(ids().some(id => Number(id) >= 95000)).toBe(true))
    expect(screen.queryByTestId('deck-running-dry')).toBeNull()
  })

  it('the wider ring is empty: fetched once (no loop), then the notice offers to widen', async () => {
    fetchMore.mockResolvedValue([])
    skipAllButFive()
    render(<Discover location={HOME} />)
    await waitFor(() => expect(screen.getByTestId('deck-running-dry')).toBeInTheDocument())
    await new Promise(r => setTimeout(r, 300))
    expect(fetchMore).toHaveBeenCalledTimes(1)
  })

  it('a free driver past the outer band gets no Day trip (30 km+) places as A bit further', async () => {
    localStorage.setItem('roam_travel_mode', 'driving')
    localStorage.setItem('roam_distance_band:driving', 'long') // 18-30 km, driving's outer band
    const at = (km, i) => ({ lat: HOME.lat + km / 111, lng: HOME.lng + (i % 7) * 0.001 })
    const spot = (id, km, i) => ({ id, name: `P${id}`, type: TYPES[i % 8], ...at(km, i), wikipedia: 'en:P', website: 'https://example.org', tourism: 'attraction' })
    const BAND = Array.from({ length: 60 }, (_, i) => spot(96000 + i, 19 + (i % 10), i)) // all swiped
    const REMOTE = Array.from({ length: 20 }, (_, i) => spot(97000 + i, 32 + (i % 10), i)) // Day trip range
    BAND.forEach(p => recordSeen(p.id, 'skip', Date.now() - 5 * DAY))
    fetchSWR.mockResolvedValue({ data: BAND.map(p => ({ ...p })) })
    fetchMore.mockResolvedValue(REMOTE.map(p => ({ ...p })))
    render(<Discover location={HOME} />)
    await waitFor(() => expect(fetchMore).toHaveBeenCalledTimes(1))
    await new Promise(r => setTimeout(r, 100))
    expect(ids().filter(id => Number(id) >= 97000)).toEqual([])
    // nothing reachable past the band: the notice offers Day trip instead
    await waitFor(() => expect(screen.getByTestId('deck-running-dry')).toBeInTheDocument())
  })

  it('ready cards wait while a filter is on, and visited places never come back', async () => {
    withFar()
    skipAllButFive()
    saved.push(FAV, { id: 'been', name: 'Been there', lat: HOME.lat + 0.003, lng: HOME.lng })
    visited.push({ placeId: 'been' })
    render(<Discover location={HOME} />)
    await waitFor(() => expect(ids()).toContain('fav1'))
    expect(ids()).not.toContain('been')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'free' })) })
    await waitFor(() => expect(ids()).not.toContain('fav1'))
  })

  it('analytics: one top-up event per deck build that tops up, and the ready swipe outcome', async () => {
    withFar()
    skipAllButFive()
    saved.push(FAV)
    render(<Discover location={HOME} />)
    await waitFor(() => expect(ids()).toContain('fav1'))
    const topUps = () => tracked.filter(t => t.event === 'discover-deck-topped-up')
    await waitFor(() => expect(topUps().length).toBe(1)) // one event, not one per in-between deck
    const last = topUps().at(-1).props
    expect(last.fresh).toBe(5)
    expect(last.further).toBeGreaterThan(0)
    expect(last.ready).toBe(1)
    const before = topUps().length
    await rebuild() // the merge adds nothing: an identical deck, no new event
    await new Promise(r => setTimeout(r, 1200)) // well past the 400 ms settle, even under load
    expect(topUps().length).toBe(before)
    const at = ids().indexOf('fav1')
    for (let n = 0; n < at; n++) await swipeS('nope')
    await swipeS('nope')
    expect(tracked.filter(t => t.event === 'ready-card-swiped').map(t => t.props.outcome)).toEqual(['snoozed'])
  })
})

describe('Discover top-up: critic round 2 regressions', () => {
  const FAR = Array.from({ length: 6 }, (_, i) => ({
    id: 95500 + i, name: `Edge ${i}`, type: TYPES[i % TYPES.length],
    lat: HOME.lat + 0.032 + i * 0.0009, lng: HOME.lng,
    wikipedia: 'en:Far', website: 'https://example.org', tourism: 'attraction',
  }))
  it('when the further cards run out too, the notice appears without waiting for a rebuild', async () => {
    // The wider ring is fetched once (unprompted) and dealt; nothing rebuilds the deck after that
    fetchMore.mockResolvedValue(FAR.map(p => ({ ...p })))
    POOL.slice(2).forEach(p => recordSeen(p.id, 'skip', Date.now() - 5 * DAY))
    render(<Discover location={HOME} />)
    await waitFor(() => expect(screen.getByTestId('dealt').textContent).toContain('95500'))
    expect(fetchMore).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('deck-running-dry')).toBeNull()
    const total = screen.getByTestId('dealt').textContent.split(',').filter(Boolean).length
    for (let n = 0; n < total; n++) {
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'nope' })) })
    }
    await waitFor(() => expect(screen.getByTestId('deck-running-dry')).toBeInTheDocument())
    expect(fetchMore).toHaveBeenCalledTimes(1) // already fetched for this search: no second fetch
  })
})

describe('Discover top-up: critic round 3 regressions', () => {
  const FAR4 = Array.from({ length: 4 }, (_, i) => ({
    id: 96000 + i, name: `Edge ${i}`, type: TYPES[i % TYPES.length],
    lat: HOME.lat + 0.032 + i * 0.0009, lng: HOME.lng,
    wikipedia: 'en:Far', website: 'https://example.org', tourism: 'attraction',
  }))
  const NEWFAR = Array.from({ length: 6 }, (_, i) => ({
    id: 97000 + i, name: `New ${i}`, type: TYPES[i % TYPES.length],
    lat: HOME.lat + 0.036 + i * 0.0009, lng: HOME.lng,
    wikipedia: 'en:Far', website: 'https://example.org', tourism: 'attraction',
  }))
  const ids = () => (screen.queryByTestId('dealt')?.textContent || '').split(',').filter(Boolean)
  const topS = () => screen.queryByTestId('top')?.textContent || ''
  const swipeS = async action => { await act(async () => { fireEvent.click(screen.getByRole('button', { name: action })) }) }
  const wait = ms => act(async () => { await new Promise(r => setTimeout(r, ms)) })
  const FAV = { id: 'fav1', name: 'The Shambles', lat: HOME.lat + 0.002, lng: HOME.lng }
  const FAV2 = { id: 'fav2', name: 'Minster', lat: HOME.lat + 0.003, lng: HOME.lng }
  const topUps = () => tracked.filter(t => t.event === 'discover-deck-topped-up')

  for (const more of ['nothing', 'new places']) {
    it(`a Ready card left last stays in hand when the further cards run out (wider ring: ${more})`, async () => {
      fetchSWR.mockResolvedValue({ data: [...POOL, ...FAR4].map(p => ({ ...p })) })
      POOL.slice(4).forEach(p => recordSeen(p.id, 'skip', Date.now() - 5 * DAY))
      saved.push(FAV, FAV2)
      fetchMore.mockResolvedValue(more === 'nothing' ? [] : NEWFAR.map(p => ({ ...p })))
      render(<Discover location={HOME} />)
      await waitFor(() => expect(ids()).toContain('fav2'))
      while (topS() !== 'fav2' && topS()) await swipeS('nope')
      expect(topS()).toBe('fav2')
      await wait(400)
      expect(topS()).toBe('fav2') // no rebuild pulled it away
      expect(fetchMore).not.toHaveBeenCalled() // not mid-hand: only once every card is swiped
      await swipeS('nope')
      await waitFor(() => expect(fetchMore).toHaveBeenCalledTimes(1))
    })
  }

  it('swiping and rebuilds that deal nothing new send no top-up event', async () => {
    fetchSWR.mockResolvedValue({ data: [...POOL, ...FAR4].map(p => ({ ...p })) })
    POOL.slice(4).forEach(p => recordSeen(p.id, 'skip', Date.now() - 5 * DAY))
    saved.push(FAV)
    render(<Discover location={HOME} />)
    await waitFor(() => expect(ids()).toContain('fav1'))
    await wait(600)
    const before = topUps().length
    expect(before).toBe(1)
    await swipeS('nope')
    await swipeS('nope')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'more' })) }) // a rebuild that drops the swiped cards
    await wait(1200)
    expect(topUps().length).toBe(before)
  })
})

// The deck ranks by time of day (morning scores differ), so the slot must hold at every hour
for (const T of ['2026-10-27T02:00:00Z', '2026-10-27T06:00:00Z', '2026-10-27T10:45:00Z', '2026-10-27T15:00:00Z', '2026-10-27T20:00:00Z']) describe(`Discover top-up: critic round 4 regressions (a ready card keeps its place) at ${T.slice(11, 16)}Z`, () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'], now: new Date(T) }) })
  afterEach(() => { vi.useRealTimers() })
  const ids = () => (screen.queryByTestId('dealt')?.textContent || '').split(',').filter(Boolean)
  const topS = () => screen.queryByTestId('top')?.textContent || ''
  const swipeS = async action => { await act(async () => { fireEvent.click(screen.getByRole('button', { name: action })) }) }
  const wait = ms => act(async () => { await new Promise(r => setTimeout(r, ms)) })
  const FAV = { id: 'fav1', name: 'The Shambles', lat: HOME.lat + 0.002, lng: HOME.lng }
  const skipAllButFive = () => POOL.slice(5).forEach(p => recordSeen(p.id, 'skip', Date.now() - 5 * DAY))
  let ticks = []
  const realSetInterval = globalThis.setInterval
  beforeEach(() => {
    ticks = []
    globalThis.setInterval = (fn, ms, ...a) => { if (ms === 60000) ticks.push(fn); return realSetInterval(fn, ms, ...a) }
  })
  afterEach(() => { globalThis.setInterval = realSetInterval })
  const tick = () => act(async () => { ticks.forEach(f => f()); await new Promise(r => setTimeout(r, 30)) })

  for (const trig of ['clock tick', 'late empty wider fetch']) {
    for (const k of [1, 2, 3]) {
      it(`${k} swipes then a ${trig}: the ready card is still dealt, still after the same cards`, async () => {
        skipAllButFive(); saved.push(FAV)
        let resolve
        if (trig === 'clock tick') fetchMore.mockResolvedValue([])
        else fetchMore.mockImplementation(() => new Promise(r => { resolve = r }))
        render(<Discover location={HOME} />)
        await waitFor(() => expect(ids()).toContain('fav1'))
        await wait(50)
        const before = ids()
        const dueAfter = before.slice(0, before.indexOf('fav1')).filter(Boolean)
        for (let n = 0; n < k; n++) await swipeS('nope')
        if (trig === 'clock tick') await tick(); else resolve([])
        await wait(300)
        const after = ids()
        expect(after).toContain('fav1')
        // the same regular cards are still ahead of it (the deck may re-rank them, as it always has)
        const ahead = after.slice(0, after.indexOf('fav1'))
        expect([...ahead].sort()).toEqual(dueAfter.slice(k).sort())
      })
    }
  }

  it('the user is on the ready card when the first wider fetch lands empty: it stays under the thumb', async () => {
    skipAllButFive(); saved.push(FAV)
    let resolve
    fetchMore.mockImplementation(() => new Promise(r => { resolve = r }))
    render(<Discover location={HOME} />)
    await waitFor(() => expect(ids()).toContain('fav1'))
    while (topS() !== 'fav1' && topS()) await swipeS('nope')
    expect(topS()).toBe('fav1')
    resolve([])
    await wait(300)
    expect(topS()).toBe('fav1')
  })
})

describe('Discover top-up: a full deck', () => {
  it('sends no top-up event (nothing was topped up)', async () => {
    render(<Discover location={HOME} />)
    await waitFor(() => expect(screen.getByTestId('dealt').textContent.split(',').length).toBeGreaterThan(10))
    await act(async () => { await new Promise(r => setTimeout(r, 700)) })
    expect(tracked.filter(t => t.event === 'discover-deck-topped-up')).toEqual([])
  })
})

describe('Discover top-up: critic round 5 (never two ready cards in a row across a rebuild)', () => {
  const FAR = Array.from({ length: 30 }, (_, i) => ({
    id: 95000 + i, name: `Far ${i}`, type: TYPES[i % TYPES.length],
    lat: HOME.lat + 0.032 + (i % 10) * 0.0009, lng: HOME.lng + Math.floor(i / 10) * 0.0005,
    wikipedia: 'en:Far', website: 'https://example.org', tourism: 'attraction',
  }))
  const ids = () => (screen.queryByTestId('dealt')?.textContent || '').split(',').filter(Boolean)
  const topS = () => screen.queryByTestId('top')?.textContent || ''
  const swipeS = async action => { await act(async () => { fireEvent.click(screen.getByRole('button', { name: action })) }) }
  const wait = ms => act(async () => { await new Promise(r => setTimeout(r, ms)) })
  const isReady = id => /^fav/.test(id)
  let ticks = []
  const realSetInterval = globalThis.setInterval
  beforeEach(() => {
    ticks = []
    globalThis.setInterval = (fn, ms, ...a) => { if (ms === 60000) ticks.push(fn); return realSetInterval(fn, ms, ...a) }
  })
  afterEach(() => { globalThis.setInterval = realSetInterval })
  const tick = () => act(async () => { ticks.forEach(f => f()); await new Promise(r => setTimeout(r, 30)) })

  it('swipe a ready card, then the deck rebuilds: the next ready card is a full gap away', async () => {
    fetchSWR.mockResolvedValue({ data: [...POOL, ...FAR].map(p => ({ ...p })) })
    POOL.slice(5).forEach(p => recordSeen(p.id, 'skip', Date.now() - 5 * DAY))
    saved.push(
      { id: 'fav1', name: 'The Shambles', lat: HOME.lat + 0.002, lng: HOME.lng },
      { id: 'fav2', name: 'Minster', lat: HOME.lat + 0.003, lng: HOME.lng },
      { id: 'fav3', name: 'Walls', lat: HOME.lat + 0.004, lng: HOME.lng },
    )
    render(<Discover location={HOME} />)
    await waitFor(() => expect(ids()).toContain('fav1'))
    await wait(600)
    while (topS() !== 'fav1' && topS()) await swipeS('nope')
    await swipeS('nope') // the ready card
    for (const trig of ['tick', 'more']) {
      if (trig === 'tick') await tick()
      else await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'more' })) })
      await wait(300)
      const d = ids()
      const firstReady = d.findIndex(isReady)
      expect(isReady(topS())).toBe(false)
      expect(firstReady === -1 || firstReady >= 4).toBe(true)
    }
  })
})
