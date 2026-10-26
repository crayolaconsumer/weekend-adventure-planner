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

// ── Worldwide places fallback ────────────────────────────────────────────────
import { placeToElement, requestedTags, geoapifyCategories, geoapifyCanAnswer, fetchGeoapifyPlaces, queryBbox, reserveGeoapifyCredits, reserveGeoapifyForIp, settleGeoapifyCredits, geoapifyPlacesWorstCase, allowanceBucket } from '../../../api/lib/geoapify.js'
import { buildDiscoverOverpassQuery } from '../../../shared/overpassQuery.js'
import { townOverpassQuery } from '../../../api/lib/towns.js'
import { parseOverpassResponse } from '../../../src/utils/apiClient.js'

const rawFeature = (raw, props = {}) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [raw.lon ?? 151.2, raw.lat ?? -33.87] },
  properties: { name: raw.name, lat: raw.lat ?? -33.87, lon: raw.lon ?? 151.2, datasource: { sourcename: 'openstreetmap', raw }, ...props },
})
const DEFAULT_DECK = buildDiscoverOverpassQuery(-33.8688, 151.2093, 5000, null).query

describe('placeToElement (worldwide fallback)', () => {
  const tags = requestedTags(DEFAULT_DECK)

  it('keeps the OSM id and type: nodes with lat/lon, ways and relations with a center', () => {
    expect(placeToElement(rawFeature({ osm_type: 'n', osm_id: 7, name: 'A', amenity: 'cafe' }), tags))
      .toEqual({ type: 'node', id: 7, lat: -33.87, lon: 151.2, tags: { name: 'A', amenity: 'cafe' } })
    expect(placeToElement(rawFeature({ osm_type: 'w', osm_id: 8, name: 'B', leisure: 'park' }), tags))
      .toEqual({ type: 'way', id: 8, center: { lat: -33.87, lon: 151.2 }, tags: { name: 'B', leisure: 'park' } })
    // osm2pgsql writes relations negative: the OSM id is the absolute value
    expect(placeToElement(rawFeature({ osm_type: 'r', osm_id: -9, name: 'C', tourism: 'museum' }), tags).id).toBe(9)
  })

  it('drops places without a usable OSM id, unnamed places, and tags the query did not ask for', () => {
    expect(placeToElement(rawFeature({ name: 'No id', amenity: 'cafe' }), tags)).toBeNull()
    expect(placeToElement(rawFeature({ osm_type: 'n', osm_id: -5, name: 'Neg node', amenity: 'cafe' }), tags)).toBeNull()
    expect(placeToElement(rawFeature({ osm_type: 'x', osm_id: 5, name: 'Odd', amenity: 'cafe' }), tags)).toBeNull()
    expect(placeToElement(rawFeature({ osm_type: 'n', osm_id: 5, amenity: 'cafe' }), tags)).toBeNull()
    expect(placeToElement(rawFeature({ osm_type: 'n', osm_id: 5, name: 'Statue', tourism: 'artwork' }), tags)).toBeNull()
    expect(placeToElement({ properties: { name: 'No raw' } }, tags)).toBeNull()
  })

  it('mapped output parses with the client parseOverpassResponse into dealable places', () => {
    const elements = [
      rawFeature({ osm_type: 'n', osm_id: 7, name: 'Cafe A', amenity: 'cafe', wikidata: 'Q1', opening_hours: 'Mo 09:00-17:00' }),
      rawFeature({ osm_type: 'w', osm_id: 8, name: 'Park B', leisure: 'park' }),
      rawFeature({ osm_type: 'r', osm_id: 9, name: 'Museum C', tourism: 'museum' }),
    ].map(f => placeToElement(f, tags))
    const places = parseOverpassResponse({ elements })
    expect(places.map(p => [p.id, p.name, p.type, p.lat, p.lng])).toEqual([
      [7, 'Cafe A', 'cafe', -33.87, 151.2],
      [8, 'Park B', 'park', -33.87, 151.2],
      ['r9', 'Museum C', 'museum', -33.87, 151.2],
    ])
    expect(places[0].wikidata).toBe('Q1')
    expect(places[0].openingHours).toBe('Mo 09:00-17:00')
  })
})

describe('query parsing for the fallback', () => {
  it('reads the bbox and the requested tag values of a Discover query', () => {
    expect(queryBbox(DEFAULT_DECK)).toMatchObject({ s: expect.any(Number), n: expect.any(Number) })
    const tags = requestedTags(DEFAULT_DECK)
    expect(tags.amenity.has('cafe')).toBe(true)
    expect(tags.tourism.has('museum')).toBe(true)
  })

  it('splits categories into food+shops, outdoors and sights, and never asks for parent tourism.attraction on the default deck', () => {
    const groups = geoapifyCategories(requestedTags(DEFAULT_DECK))
    expect(groups).toHaveLength(3)
    expect(groups[0].every(c => /^(catering|commercial)/.test(c))).toBe(true)
    expect(groups[1]).toContain('leisure.park')
    expect(groups[2]).toContain('entertainment.museum')
    expect(groups.flat()).not.toContain('tourism.attraction')
    expect(geoapifyCategories(requestedTags(buildDiscoverOverpassQuery(0, 0, 5000, 'unique').query)).flat()).toContain('tourism.attraction')
  })

  it('answers Discover decks at every radius and category, and town-page queries, never id lookups', () => {
    for (const r of [5000, 15000, 30000, 35000, 60000]) expect(geoapifyCanAnswer(buildDiscoverOverpassQuery(35.68, 139.65, r, null).query)).toBe(true)
    for (const c of ['food', 'nature', 'culture', 'historic', 'entertainment', 'nightlife', 'active', 'unique', 'shopping']) {
      expect(geoapifyCanAnswer(buildDiscoverOverpassQuery(35.68, 139.65, 5000, c).query)).toBe(true)
    }
    expect(geoapifyCanAnswer(townOverpassQuery(35.68, 139.65))).toBe(true)
    expect(geoapifyCanAnswer('[out:json];node(123);out;')).toBe(false)
    expect(geoapifyCanAnswer('[out:json][bbox:35.6,139.6,35.7,139.7];node(123);out;')).toBe(false) // an id, even with a bbox
    expect(geoapifyCanAnswer('[out:json][bbox:35.6,139.6,35.7,139.7];nw["highway"~"^(bus_stop)$"];out tags center;')).toBe(false) // nothing mappable
  })

  it('town pages: exact filters map too (amenity=place_of_worship), and the worst case is 2 credits per group', () => {
    const q = townOverpassQuery(51.2093, 3.2247) // Bruges
    expect(requestedTags(q).amenity.has('place_of_worship')).toBe(true)
    expect(geoapifyCategories(requestedTags(q)).flat()).toContain('religion.place_of_worship')
    expect(geoapifyPlacesWorstCase(q)).toBe(6)
    expect(geoapifyPlacesWorstCase(buildDiscoverOverpassQuery(0, 0, 5000, 'food').query)).toBe(2)
    expect(geoapifyPlacesWorstCase('[out:json];node(1);out;')).toBe(0)
  })
})

describe('fetchGeoapifyPlaces', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends the bbox as a polygon, dedupes across groups, and bills 1 credit per 20 places per request', async () => {
    const feats = Array.from({ length: 21 }, (_, i) => rawFeature({ osm_type: 'n', osm_id: i + 1, name: `Cafe ${i}`, amenity: 'cafe' }))
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ features: feats }) }))
    vi.stubGlobal('fetch', fetchMock)
    const { data, credits } = await fetchGeoapifyPlaces(DEFAULT_DECK, { apiKey: 'k' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(credits).toBe(6) // 21 places = 2 credits, x3 requests
    expect(data.elements).toHaveLength(21) // same 21 OSM objects from each group, kept once
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.filter.type).toBe('polygon')
    expect(body.limit).toBe(40)
    expect(fetchMock.mock.calls[0][1].headers['x-api-key']).toBe('k')
  })

  it('no key or an id lookup: no call, nothing billed', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect(await fetchGeoapifyPlaces(DEFAULT_DECK, {})).toEqual({ data: null, credits: 0 })
    expect(await fetchGeoapifyPlaces('[out:json];node(1);out;', { apiKey: 'k' })).toEqual({ data: null, credits: 0 })
    expect(f).not.toHaveBeenCalled()
  })

  // Billing is counted on the safe side of the budget (critic F2 and M17)
  it('an answer with 0 places still costs 1 credit per request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ features: [] }) })))
    expect(await fetchGeoapifyPlaces(DEFAULT_DECK, { apiKey: 'k' })).toEqual({ data: null, credits: 3 })
  })

  it('a dropped connection or a 5xx is charged the worst case (2 per request); a 4xx refusal costs 0', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    expect((await fetchGeoapifyPlaces(DEFAULT_DECK, { apiKey: 'k' })).credits).toBe(6)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) })))
    expect((await fetchGeoapifyPlaces(DEFAULT_DECK, { apiKey: 'k' })).credits).toBe(6)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) })))
    expect((await fetchGeoapifyPlaces(DEFAULT_DECK, { apiKey: 'k' })).credits).toBe(0)
  })

  it('marks its body as a stand-in for town.js and trims tags like an Overpass answer', async () => {
    const f = rawFeature({ osm_type: 'n', osm_id: 3, name: 'Cafe', amenity: 'cafe', 'payment:cash': 'yes' })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ features: [f] }) })))
    const { data } = await fetchGeoapifyPlaces(DEFAULT_DECK, { apiKey: 'k' })
    expect(data.generator).toBe('geoapify')
    expect(data.elements[0].tags['payment:cash']).toBeUndefined()
    expect(data.elements[0].tags.amenity).toBe('cafe')
  })

  it('gives up at the timeout, and an aborted request is charged (assume GeoApify billed it)', async () => {
    vi.stubGlobal('fetch', vi.fn((_u, { signal }) => new Promise((_r, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))))
    const t = Date.now()
    const out = await fetchGeoapifyPlaces(DEFAULT_DECK, { apiKey: 'k', timeoutMs: 50 })
    expect(out).toEqual({ data: null, credits: 6 })
    expect(Date.now() - t).toBeLessThan(1000)
  })
})

describe('GeoApify credit reservation (hard ceiling)', () => {
  const counter = () => {
    const m = new Map()
    return {
      m,
      // Each call yields first, so concurrent reservations interleave like real KV round trips
      incrby: vi.fn(async (k, n) => { await Promise.resolve(); m.set(k, (m.get(k) || 0) + n); return m.get(k) }),
      decrby: vi.fn(async (k, n) => { await Promise.resolve(); m.set(k, (m.get(k) || 0) - n); return m.get(k) }),
      expire: vi.fn(async () => 1),
    }
  }

  it('concurrent reservations never take the day past the cap (regression: 20 cold tiles at 2,799 spent to 2,859)', async () => {
    const kv = counter()
    const key = `geoapify:credits:${new Date().toISOString().slice(0, 10)}`
    kv.m.set(key, 2380)
    const got = await Promise.all(Array.from({ length: 20 }, () => reserveGeoapifyCredits(kv, 6, 2400)))
    expect(got.filter(Boolean)).toHaveLength(3) // 2386, 2392, 2398; the 4th would be 2404
    expect(kv.m.get(key)).toBe(2398)
  })

  it('refunds only the unused part, to the day it was reserved on', async () => {
    const kv = counter()
    const r = await reserveGeoapifyCredits(kv, 6, 2400)
    expect(r).toMatchObject({ credits: 6, total: 6 })
    await settleGeoapifyCredits(kv, r, 4)
    expect(kv.m.get(r.key)).toBe(4)
    await settleGeoapifyCredits(kv, r, 6) // fully spent: nothing back
    expect(kv.decrby).toHaveBeenCalledTimes(1)
  })

  // Critic low #6: GeoApify answering past `limit` was never charged
  it('charges spend beyond the reservation', async () => {
    const kv = counter()
    const r = await reserveGeoapifyCredits(kv, 6, 2400)
    await settleGeoapifyCredits(kv, r, 15)
    expect(kv.m.get(r.key)).toBe(15)
  })

  it('per-IP allowance: 30 fallbacks per IP per day, atomic, rolled back past it', async () => {
    const kv = counter()
    const got = await Promise.all(Array.from({ length: 35 }, () => reserveGeoapifyForIp(kv, '203.0.113.7')))
    expect(got.filter(Boolean)).toHaveLength(30)
    expect(await reserveGeoapifyForIp(kv, '198.51.100.9')).not.toBeNull()
    expect(await reserveGeoapifyForIp(kv, '')).toBeNull()
    expect(await reserveGeoapifyForIp(null, '203.0.113.8')).toBeNull() // fails closed
  })

  it('dog mode has its own allowance: 40 calls per IP per day, separate from the 30 fallbacks', async () => {
    const kv = counter()
    const dogs = await Promise.all(Array.from({ length: 45 }, () => reserveGeoapifyForIp(kv, '203.0.113.7', 'dogs')))
    expect(dogs.filter(Boolean)).toHaveLength(40)
    expect(await reserveGeoapifyForIp(kv, '203.0.113.7')).not.toBeNull() // places allowance untouched
    expect([...kv.m.keys()].some(k => k.startsWith('geoapify:ipdogs:'))).toBe(true)
  })

  // Critic round 3 #3: a client rotating addresses inside its IPv6 /64 got a fresh allowance per address
  it('IPv6 addresses share one allowance per /64; IPv4 is unchanged', async () => {
    expect(allowanceBucket('203.0.113.7')).toBe('203.0.113.7')
    expect(allowanceBucket('2001:db8:abcd:12::1')).toBe('2001:db8:abcd:12::/64')
    expect(allowanceBucket('2001:0db8:abcd:0012:ffff:1:2:3')).toBe('2001:db8:abcd:12::/64')
    expect(allowanceBucket('[2001:db8::5]')).toBe('2001:db8:0:0::/64')
    expect(allowanceBucket('fe80::1%en0')).toBe('fe80:0:0:0::/64')
    expect(allowanceBucket('::ffff:198.51.100.2')).toBe('198.51.100.2')
    for (const bad of ['unknown', '', null, '1:2:3:4:5:6:7:8:9', '2001:db8::1::2', '2001:db8:zz::1']) expect(allowanceBucket(bad)).toBeNull()
    const kv = counter()
    const rotated = Array.from({ length: 35 }, (_, i) => `2001:db8:abcd:12:${i.toString(16)}::1`)
    const got = []
    for (const ip of rotated) got.push(await reserveGeoapifyForIp(kv, ip))
    expect(got.filter(Boolean)).toHaveLength(30)
    expect(await reserveGeoapifyForIp(kv, '2001:db8:abcd:13::1')).not.toBeNull() // the next /64 is someone else
  })

  // Critic round 4 #5: the TTL was fire-and-forget, so a dropped EXPIRE left a per-day key forever
  it('the counter TTL (2 days) is set and awaited on every reservation, before it resolves', async () => {
    const kv = counter()
    let ttlSet = 0
    kv.expire = vi.fn(async (_k, ttl) => { await new Promise(r => setTimeout(r, 20)); ttlSet = ttl; return 1 })
    await reserveGeoapifyCredits(kv, 6, 2400)
    expect(ttlSet).toBe(2 * 24 * 60 * 60) // landed before the reservation resolved
    await reserveGeoapifyForIp(kv, '203.0.113.7')
    await reserveGeoapifyCredits(kv, 6, 2400)
    expect(kv.expire).toHaveBeenCalledTimes(3) // every time, so a dropped one is repaired
  })

  it('an EXPIRE that fails does not fail the reservation', async () => {
    const kv = counter()
    kv.expire = vi.fn(async () => { throw new Error('KV blip') })
    expect(await reserveGeoapifyCredits(kv, 6, 2400)).toMatchObject({ credits: 6 })
  })

  it('fails closed: no client, or KV erroring, means no reservation', async () => {
    expect(await reserveGeoapifyCredits(null, 6, 2400)).toBeNull()
    expect(await reserveGeoapifyCredits({ incrby: async () => { throw new Error('down') } }, 6, 2400)).toBeNull()
    expect(await reserveGeoapifyCredits(counter(), 0, 2400)).toBeNull()
  })
})
