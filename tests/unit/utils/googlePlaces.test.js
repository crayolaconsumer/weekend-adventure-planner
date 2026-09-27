import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  boundsAround, canShowGoogleCard, cachedGooglePlaceId, rememberGooglePlaceId, findGooglePlaceId,
  forgetGooglePlaceId, searchRadiusFor, googleTypeFor, isAuthFailure,
} from '../../../src/utils/googlePlaces'

const DAY = 24 * 60 * 60 * 1000
const york = { id: 'osm-node-1', name: 'York Minster', lat: 53.9623, lng: -1.0819, type: 'place_of_worship' }

function fakeLibrary(places) {
  const searchByText = vi.fn().mockResolvedValue({ places })
  return { searchByText, loadLibrary: () => Promise.resolve({ Place: { searchByText } }) }
}

beforeEach(() => { localStorage.clear(); delete window.Capacitor })

describe('boundsAround', () => {
  it('boxes the given metres either side of the point', () => {
    const b = boundsAround(york.lat, york.lng, 200)
    expect((b.north - b.south) * 111320).toBeCloseTo(400, 0)
    const widthM = (b.east - b.west) * 111320 * Math.cos(york.lat * Math.PI / 180)
    expect(widthM).toBeCloseTo(400, 0)
  })
})

describe('search box and type', () => {
  it('is tight for small places and wider for big sites', () => {
    expect(searchRadiusFor('cafe')).toBe(75)
    expect(searchRadiusFor(undefined)).toBe(75)
    expect(searchRadiusFor('museum')).toBe(150)
    expect(searchRadiusFor('park')).toBe(300)
  })
  it('maps only clean types, never broad ones', () => {
    expect(googleTypeFor('place_of_worship')).toBe('church')
    expect(googleTypeFor('castle')).toBe('castle')
    expect(googleTypeFor('attraction')).toBeNull()
    expect(googleTypeFor('memorial')).toBeNull()
  })
})

describe('canShowGoogleCard', () => {
  it('accepts a named place with coordinates', () => {
    expect(canShowGoogleCard(york)).toBe(true)
  })
  it.each([
    ['no coordinates', { ...york, lat: null, lng: null }],
    ['missing lng', { ...york, lng: undefined }],
    ['an event', { ...york, datetime: { start: new Date() } }],
    ['an event by type', { ...york, type: 'event' }],
    ['no name', { ...york, name: '' }],
    ['no id', { ...york, id: undefined }],
  ])('rejects %s', (_, place) => {
    expect(canShowGoogleCard(place)).toBe(false)
  })
  it('is off in the native apps (unverified on device)', () => {
    window.Capacitor = { isNativePlatform: () => true }
    expect(canShowGoogleCard(york)).toBe(false)
  })
})

describe('isAuthFailure', () => {
  it.each(['RefererNotAllowedMapError', 'PERMISSION_DENIED: 403', 'REQUEST_DENIED'])('spots %s', (m) => {
    expect(isAuthFailure(new Error(m))).toBe(true)
  })
  it('ignores ordinary network failures', () => {
    expect(isAuthFailure(new Error('Failed to fetch'))).toBe(false)
  })
})

describe('findGooglePlaceId', () => {
  it('asks for ids only, strict Google type, box sized to the place (free IDs Only SKU)', async () => {
    const { searchByText, loadLibrary } = fakeLibrary([{ id: 'ChIJsUGD1aUxeUgRNQ2A91LK2pc' }])
    const id = await findGooglePlaceId(york, { loadLibrary })
    expect(id).toBe('ChIJsUGD1aUxeUgRNQ2A91LK2pc')
    const req = searchByText.mock.calls[0][0]
    expect(req.fields).toEqual(['id'])
    expect(req.maxResultCount).toBe(2)
    expect(req.textQuery).toBe('York Minster')
    expect(req.includedType).toBe('church')
    expect(req.useStrictTypeFiltering).toBe(true)
    expect(req.locationRestriction).toEqual(boundsAround(york.lat, york.lng, 150))
  })

  it('sends no type filter when our type has no clean Google match', async () => {
    const { searchByText, loadLibrary } = fakeLibrary([{ id: 'g' }])
    await findGooglePlaceId({ ...york, type: 'memorial' }, { loadLibrary })
    const req = searchByText.mock.calls[0][0]
    expect(req).not.toHaveProperty('includedType')
    expect(req).not.toHaveProperty('useStrictTypeFiltering')
    expect(req.locationRestriction).toEqual(boundsAround(york.lat, york.lng, 75))
  })

  // Live probe: "The Golden Fleece" untyped returned two Google places.
  // Two results means Google can't tell which we mean: show nothing.
  it('treats two results as no match, and remembers that', async () => {
    const { loadLibrary } = fakeLibrary([{ id: 'a' }, { id: 'b' }])
    expect(await findGooglePlaceId(york, { loadLibrary })).toBeNull()
    expect(cachedGooglePlaceId(york.id)).toBeNull()
  })

  it('searches by name only: the town would match every nearby address (regression)', async () => {
    const { searchByText, loadLibrary } = fakeLibrary([])
    await findGooglePlaceId({ ...york, town: 'York' }, { loadLibrary })
    expect(searchByText.mock.calls[0][0].textQuery).toBe('York Minster')
  })

  it('never looks up untyped generic places like playgrounds', () => {
    const base = { id: 'x', name: 'Playground', lat: 53.96, lng: -1.08 }
    for (const type of ['playground', 'picnic_site', 'artwork', 'memorial']) {
      expect(canShowGoogleCard({ ...base, type })).toBe(false)
    }
  })

  it('caches a match forever, so the second view makes no request', async () => {
    const first = fakeLibrary([{ id: 'g1' }])
    await findGooglePlaceId(york, { loadLibrary: first.loadLibrary })
    const second = fakeLibrary([{ id: 'other' }])
    expect(await findGooglePlaceId(york, { loadLibrary: second.loadLibrary })).toBe('g1')
    expect(second.searchByText).not.toHaveBeenCalled()
    expect(cachedGooglePlaceId(york.id, Date.now() + 360 * DAY)).toBe('g1')
  })

  it('re-checks a matched id after about a year', () => {
    rememberGooglePlaceId(york.id, 'g1')
    expect(cachedGooglePlaceId(york.id, Date.now() + 366 * DAY)).toBeUndefined()
  })

  it('forgets an id Google refused', () => {
    rememberGooglePlaceId(york.id, 'g1')
    forgetGooglePlaceId(york.id)
    expect(cachedGooglePlaceId(york.id)).toBeUndefined()
  })

  it('remembers "no match" for 30 days, then asks again', async () => {
    const { loadLibrary } = fakeLibrary([])
    expect(await findGooglePlaceId(york, { loadLibrary })).toBeNull()
    expect(cachedGooglePlaceId(york.id, Date.now() + 29 * DAY)).toBeNull()
    expect(cachedGooglePlaceId(york.id, Date.now() + 31 * DAY)).toBeUndefined()
  })

  it('does not cache a failure, so it retries next time', async () => {
    const loadLibrary = () => Promise.reject(new Error('offline'))
    await expect(findGooglePlaceId(york, { loadLibrary })).rejects.toThrow('offline')
    expect(cachedGooglePlaceId(york.id)).toBeUndefined()
  })
})

describe('place id cache', () => {
  it('keeps at most 500 entries, dropping the oldest', () => {
    for (let i = 0; i < 510; i++) rememberGooglePlaceId(`p${i}`, `g${i}`, Date.now() - 1000 + i)
    expect(Object.keys(JSON.parse(localStorage.getItem('roam_google_place_ids')))).toHaveLength(500)
    expect(cachedGooglePlaceId('p0')).toBeUndefined()
    expect(cachedGooglePlaceId('p509')).toBe('g509')
  })

  it('survives corrupt or blocked storage', () => {
    localStorage.setItem('roam_google_place_ids', '{not json')
    expect(cachedGooglePlaceId('x')).toBeUndefined()
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(() => rememberGooglePlaceId('x', 'g')).not.toThrow()
    spy.mockRestore()
  })
})
