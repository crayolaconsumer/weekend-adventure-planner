import { describe, it, expect, vi, afterEach } from 'vitest'
import { featureToElement, mergeDogPlaces, fetchGeoApifyDogPlaces, dogCacheKey } from '../../../api/lib/geoapify.js'

const feat = (categories, name = 'Test Place') => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-0.12, 51.5] },
  properties: { name, place_id: 'p1', categories },
})

describe('featureToElement', () => {
  it('maps a catering category to an amenity tag with the matched dog condition', () => {
    expect(featureToElement(feat(['catering.restaurant', 'dogs.yes']))).toEqual({
      type: 'node',
      id: 'ga-p1',
      lat: 51.5,
      lon: -0.12,
      tags: { name: 'Test Place', amenity: 'restaurant', dog: 'yes' },
    })
  })

  it('only dogs.yes counts: leashed-only is not dog=yes', () => {
    expect(featureToElement(feat(['catering.pub', 'dogs.leashed']))).toBeNull()
  })

  it('flattens deep categories to the underscore subkey the client reads', () => {
    expect(featureToElement(feat(['natural.mountain.peak', 'dogs.yes'])).tags.natural).toBe('mountain_peak')
    expect(featureToElement(feat(['leisure.park', 'dogs.yes'])).tags.leisure).toBe('park')
  })

  it('skips generic leading keys (building, internet_access) and uses the most specific mappable category', () => {
    // The live API leads the list with non-deck keys; "first non-dog key"
    // used to drop every real feature because 'building' has no tag mapping.
    const el = featureToElement(feat(['building', 'building.catering', 'catering', 'catering.pub', 'dogs', 'dogs.yes', 'internet_access', 'wheelchair']))
    expect(el.tags).toEqual({ name: 'Test Place', amenity: 'pub', dog: 'yes' })
  })

  it('drops non-deck groups, nameless places, and undogged features', () => {
    expect(featureToElement(feat(['highway.path', 'dogs.yes']))).toBeNull()
    expect(featureToElement(feat(['catering.restaurant'], null))).toBeNull()
    expect(featureToElement(feat(['catering.restaurant']))).toBeNull()
  })
})

describe('mergeDogPlaces', () => {
  it('appends dog places and dedupes by ~11 m quantization (the Overpass element wins)', () => {
    const base = [{ type: 'node', id: 1, lat: 51.5, lon: -0.12, tags: { name: 'Cafe', dog: 'yes' } }]
    const dogs = [
      { type: 'node', id: 'ga-dup', lat: 51.50004, lon: -0.12001, tags: { name: 'Dup', dog: 'yes' } },
      { type: 'node', id: 'ga-new', lat: 51.501, lon: -0.121, tags: { name: 'Park', dog: 'leashed' } },
    ]
    const merged = mergeDogPlaces(base, dogs)
    expect(merged).toHaveLength(2)
    expect(merged[0]).toBe(base[0])
    expect(merged[1].id).toBe('ga-new')
  })

  it('returns the base array untouched when there are no dog places', () => {
    const base = [{ a: 1 }]
    expect(mergeDogPlaces(base, [])).toBe(base)
  })
})

describe('dogCacheKey', () => {
  it('quantizes coordinates to ~11 m and radius to 100 m', () => {
    expect(dogCacheKey(51.50004, -0.12001, 5032, 'food')).toBe('geoapify:dogs:51.5:-0.12:5000:food')
    expect(dogCacheKey(51.500049, -0.120014, 5049, 'food')).toBe('geoapify:dogs:51.5:-0.12:5000:food')
    expect(dogCacheKey(51.5, -0.12, 5000, null)).toBe('geoapify:dogs:51.5:-0.12:5000:all')
  })
})

describe('fetchGeoApifyDogPlaces', () => {
  afterEach(() => vi.unstubAllGlobals())

  const ok = body => ({ ok: true, json: async () => body })

  it('sends the dog conditions, circle filter and proximity bias', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ features: [feat(['catering.restaurant', 'dogs.yes'])] }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await fetchGeoApifyDogPlaces({ lat: 51.5, lng: -0.12, radius: 5000, category: 'food', apiKey: 'k' })
    expect(out).toHaveLength(1)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.geoapify.com/v2/places')
    expect(opts.headers['x-api-key']).toBe('k')
    const body = JSON.parse(opts.body)
    expect(body.categories).toEqual(['catering'])
    // ONE condition per request: the array is AND-ed server-side, so a
    // dogs.yes + dogs.leashed body returns 0 (verified live).
    expect(body.conditions).toEqual(['dogs.yes'])
    expect(body.filter).toEqual({ type: 'circle', lon: -0.12, lat: 51.5, radius: 5000 })
    expect(body.limit).toBe(50)
    // No bias: server-side proximity sorting tripled query time (measured),
    // and the client sorts by distance in enhancePlace.
    expect(body.bias).toBeUndefined()
  })

  it('uses the broad category set when no category is given (only dog-condition-indexed keys)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ features: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await fetchGeoApifyDogPlaces({ lat: 51.5, lng: -0.12, radius: 5000, apiKey: 'k' })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.categories).toEqual(['catering', 'commercial', 'leisure', 'natural', 'entertainment', 'man_made', 'pet'])
    // An unindexed key (tourism, national_park, ...) would zero the whole
    // query, so none of those may appear.
    expect(body.categories).not.toContain('tourism')
    expect(body.categories).not.toContain('national_park')
  })

  it('returns [] for a genuine empty answer (cacheable) and [] without a key (no fetch)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ features: [] }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchGeoApifyDogPlaces({ lat: 1, lng: 1, radius: 1000, apiKey: 'k' })).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.stubGlobal('fetch', vi.fn())
    expect(await fetchGeoApifyDogPlaces({ lat: 1, lng: 1, radius: 1000, apiKey: null })).toEqual([])
  })

  it('returns null on HTTP failure, bad shape, and timeout (never throws, never a cacheable [])', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) }))
    expect(await fetchGeoApifyDogPlaces({ lat: 1, lng: 1, radius: 1000, apiKey: 'k' })).toBeNull()

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ no: 'features' })))
    expect(await fetchGeoApifyDogPlaces({ lat: 1, lng: 1, radius: 1000, apiKey: 'k' })).toBeNull()

    vi.stubGlobal('fetch', () => new Promise((_, reject) => setTimeout(() => reject(new Error('AbortError')), 100)))
    expect(await fetchGeoApifyDogPlaces({ lat: 1, lng: 1, radius: 1000, apiKey: 'k', timeoutMs: 30 })).toBeNull()
  })
})
