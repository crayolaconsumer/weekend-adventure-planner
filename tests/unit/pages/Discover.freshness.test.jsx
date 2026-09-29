/**
 * Discover deck freshness, end to end through the real Discover page and its
 * real swipe handler (rubric points 1 and 8): like, go, a like the free save
 * limit blocks, and nope. After a remount (a reload) none of them is dealt
 * again; like and go stay out for good, the other two as 60-day skips.
 * Only the edges are stubbed: network, other hooks, and CardStack (a stand-in
 * that deals Discover's `places` and calls Discover's onSwipe).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
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
vi.mock('../../../src/hooks/useSavedPlaces', () => ({ useSavedPlaces: () => ({ savePlace, places: saved }) }))
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
