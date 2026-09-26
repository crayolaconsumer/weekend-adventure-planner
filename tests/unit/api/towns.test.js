import { describe, it, expect, vi } from 'vitest'
import {
  slugify, isValidSlug, pickDisplayName, localityFromAddress, distanceKm,
  townFromResult, resolveTown, resolveNear, townOverpassQuery, groupPlaces,
  placeScore, describeTown, renderTownPage, renderHub, escapeHtml, displayPlaceName, roundCount, nominatimGate, slugForQuery
} from '../../../api/lib/towns.js'
import { TOWNS } from '../../../shared/towns.mjs'

// Real Nominatim shapes, captured 2026-09-26
const HATFIELD = { name: 'Hatfield', lat: '51.7634675', lon: '-0.2258970', address: { town: 'Hatfield', county: 'Hertfordshire', state: 'England', country: 'United Kingdom', country_code: 'gb' } }
const HOUGHTON = { name: 'Houghton Regis', lat: '51.9047', lon: '-0.5198', address: { town: 'Houghton Regis', county: 'Central Bedfordshire', country: 'United Kingdom', country_code: 'gb' } }
const PARIS = { name: 'Paris', lat: '48.8589', lon: '2.3200', address: { city: 'Paris', state: 'Ile-de-France', country: 'France', country_code: 'fr' } }

const jsonResponse = body => ({ ok: true, status: 200, json: async () => body })
// Unit tests skip the real 1 req/s gate; it has its own tests below
const gate = async () => {}

describe('slugify / isValidSlug', () => {
  it.each([
    ['Hatfield', 'hatfield'],
    ['Houghton Regis', 'houghton-regis'],
    ['São Paulo', 'sao-paulo'],
    ['St. Albans', 'st-albans'],
    ['  Newcastle upon Tyne  ', 'newcastle-upon-tyne'],
    ['Brighton & Hove', 'brighton-and-hove'],
    ['Zürich', 'zurich'],
    // regression: letters NFD can't decompose were dropped (Łódź → "odz", a Syrian district)
    ['Łódź', 'lodz'],
    ['Ærøskøbing', 'aeroskobing'],
    ['Straße', 'strasse'],
    ['Đà Lạt', 'da-lat'],
    ['Þórshöfn', 'thorshofn']
  ])('%s → %s', (input, slug) => {
    expect(slugify(input)).toBe(slug)
    expect(isValidSlug(slug)).toBe(true)
  })

  it('rejects slugs that could be used to hammer the geocoder', () => {
    expect(isValidSlug('a')).toBe(false)
    expect(isValidSlug('x'.repeat(61))).toBe(false)
    expect(isValidSlug('one-two-three-four-five-six-seven')).toBe(false)
    expect(isValidSlug('Hatfield')).toBe(false)
    expect(isValidSlug('../etc')).toBe(false)
    expect(isValidSlug('near--me')).toBe(false)
  })

  it('every featured town has a canonical slug', () => {
    for (const t of TOWNS) expect(slugify(t.name)).toBe(t.slug)
  })
})

describe('pickDisplayName', () => {
  it('uses the geocoder name when it matches (keeps accents)', () => {
    expect(pickDisplayName('sao-paulo', 'São Paulo')).toBe('São Paulo')
    expect(pickDisplayName('hatfield-hertfordshire', 'Hatfield')).toBe('Hatfield')
  })
  it('uses the slug when the geocoder names the admin area', () => {
    expect(pickDisplayName('london', 'Greater London')).toBe('London')
    expect(pickDisplayName('luton', 'Borough of Luton')).toBe('Luton')
  })
  it('uses the geocoder name for typos so the URL can be corrected', () => {
    expect(pickDisplayName('hatfeild', 'Hatfield')).toBe('Hatfield')
  })
  it('only strips admin wrappers, not other towns containing the word (regression: leigh titled for Leigh-on-Sea)', () => {
    expect(pickDisplayName('leigh', 'Leigh-on-Sea')).toBe('Leigh-on-Sea')
    expect(pickDisplayName('york', 'City of York')).toBe('York')
    expect(pickDisplayName('westminster', 'City of Westminster')).toBe('Westminster')
    // regression: stacked suffixes titled the page "Belfast City District" and 301'd it
    expect(pickDisplayName('belfast', 'Belfast City District')).toBe('Belfast')
  })
})

describe('localityFromAddress', () => {
  it('prefers the town over the district-level city', () => {
    // Real zoom-14 reverse result for central Hatfield
    expect(localityFromAddress({ city: 'Welwyn Hatfield', town: 'Hatfield', county: 'Hertfordshire' })).toBe('Hatfield')
  })
  it('falls back through village and city', () => {
    expect(localityFromAddress({ village: 'Lidlington', county: 'Central Bedfordshire' })).toBe('Lidlington')
    expect(localityFromAddress({ city: 'New York', state: 'New York' })).toBe('New York')
    expect(localityFromAddress({})).toBe(null)
  })
})

describe('distanceKm', () => {
  it('matches known distances', () => {
    const london = { lat: 51.5074, lng: -0.1278 }
    const paris = { lat: 48.8566, lng: 2.3522 }
    expect(distanceKm(london, paris)).toBeGreaterThan(340)
    expect(distanceKm(london, paris)).toBeLessThan(345)
    expect(distanceKm(london, london)).toBe(0)
  })
})

describe('townFromResult', () => {
  it('uses the geocoded position, never a hand-typed one (regression: Hatfield pointed at Witney)', () => {
    const t = townFromResult('hatfield', HATFIELD)
    expect(t.lat).toBeCloseTo(51.7635, 3)
    expect(t.lng).toBeCloseTo(-0.2259, 3)
    // Witney, where the old hardcoded coordinates pointed, is ~70km away
    expect(distanceKm(t, { lat: 51.7834, lng: -1.5022 })).toBeGreaterThan(80)
  })
  it('featured towns keep their curated name and blurb (applied on read, not cached)', async () => {
    const t = await resolveTown('houghton-regis', { fetchImpl: async () => jsonResponse([HOUGHTON]), gate })
    expect(t.name).toBe('Houghton Regis')
    expect(t.blurb).toMatch(/Houghton Hall Park/)
    expect(t.region).toBe('Central Bedfordshire')
    // the raw record (what gets cached) carries no curated text
    expect(townFromResult('houghton-regis', HOUGHTON).blurb).toBe(null)
  })
  it('other towns have no blurb (one is generated from real counts)', () => {
    const t = townFromResult('paris', PARIS)
    expect(t).toMatchObject({ name: 'Paris', region: 'Ile-de-France', country: 'France', countryCode: 'fr', blurb: null })
  })
})

describe('resolveTown', () => {
  it('asks Nominatim for a settlement with the slug words', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([PARIS]))
    const town = await resolveTown('paris', { fetchImpl, gate })
    expect(town.name).toBe('Paris')
    const url = fetchImpl.mock.calls[0][0]
    expect(url).toContain('/search?q=paris')
    expect(url).toContain('featureType=settlement')
    expect(fetchImpl.mock.calls[0][1].headers['User-Agent']).toMatch(/ROAM/)
  })
  it('returns null when nothing matches', async () => {
    expect(await resolveTown('asdfqwer', { fetchImpl: async () => jsonResponse([]), gate })).toBe(null)
  })
  it('throws on geocoder errors so they are not cached as "not found"', async () => {
    await expect(resolveTown('paris', { fetchImpl: async () => ({ ok: false, status: 503 }), gate })).rejects.toThrow(/503/)
  })
})

describe('bad geocoder results', () => {
  it('rejects results without coordinates (regression: served {lat:null} and a NaN bbox)', () => {
    expect(townFromResult('x', { name: 'X' })).toBe(null)
    expect(townFromResult('x', { name: 'X', lat: 'abc', lon: '1' })).toBe(null)
  })
  it('rejects admin districts that aren\'t towns (regression: odz → "Ouj Subdistrict")', () => {
    for (const addresstype of ['province', 'state_district', 'subdistrict']) {
      expect(townFromResult('x', { name: 'X', lat: '1', lon: '1', addresstype })).toBe(null)
    }
  })

  it('rejects whole states and countries', () => {
    expect(townFromResult('england', { name: 'England', lat: '52', lon: '-1', addresstype: 'state' })).toBe(null)
    // York and Luton really come back as addresstype "county" and must still work
    expect(townFromResult('york', { name: 'York', lat: '53.96', lon: '-1.07', addresstype: 'county' })).not.toBe(null)
  })
  it('treats a non-array response as no match', async () => {
    expect(await resolveTown('paris', { fetchImpl: async () => jsonResponse({ error: 'x' }), gate })).toBe(null)
  })
})

describe('nominatimGate (1 req/s across all instances)', () => {
  it('takes the KV slot when free', async () => {
    const client = { set: vi.fn(async () => 'OK') }
    await nominatimGate({ client, wait: vi.fn() })
    expect(client.set).toHaveBeenCalledWith('nominatim:gate', '1', { nx: true, px: 1100 })
  })
  it('waits for the slot when another instance holds it', async () => {
    const answers = [null, null, 'OK']
    const client = { set: vi.fn(async () => answers.shift()) }
    const wait = vi.fn(async () => {})
    await nominatimGate({ client, wait })
    expect(wait).toHaveBeenCalledTimes(2)
  })
  it('gives up (→ 503, uncached) when saturated rather than queueing forever', async () => {
    const client = { set: vi.fn(async () => null) }
    await expect(nominatimGate({ client, wait: async () => {} })).rejects.toThrow('nominatim busy')
    expect(client.set).toHaveBeenCalledTimes(4)
  })
  it('spaces calls locally when KV is not configured', async () => {
    const waits = []
    const wait = async ms => { waits.push(ms) }
    await nominatimGate({ client: null, wait })
    await nominatimGate({ client: null, wait })
    expect(waits.length).toBeGreaterThan(0)
    expect(waits.at(-1)).toBeGreaterThan(1000)
  })
})

describe('resolveNear', () => {
  it('uses the bare town name when it resolves back near the user', async () => {
    const fetchImpl = vi.fn(async url => url.includes('/reverse')
      ? jsonResponse({ address: { city: 'Welwyn Hatfield', town: 'Hatfield', county: 'Hertfordshire' } })
      : jsonResponse([HATFIELD]))
    const town = await resolveNear(51.764, -0.226, { fetchImpl, gate })
    expect(town.slug).toBe('hatfield')
    expect(fetchImpl.mock.calls[0][0]).toContain('zoom=14')
  })

  it('qualifies with the county when the bare name is a different town', async () => {
    // Standing in Hatfield, South Yorkshire; "hatfield" alone resolves to Hertfordshire
    const yorks = { name: 'Hatfield', lat: '53.5800', lon: '-1.0000', address: { town: 'Hatfield', county: 'Doncaster', country: 'United Kingdom' } }
    const fetchImpl = vi.fn(async url => {
      if (url.includes('/reverse')) return jsonResponse({ address: { town: 'Hatfield', county: 'Doncaster' } })
      if (url.includes('q=hatfield%20doncaster')) return jsonResponse([yorks])
      return jsonResponse([HATFIELD])
    })
    const town = await resolveNear(53.58, -1.0, { fetchImpl, gate })
    expect(town.slug).toBe('hatfield-doncaster')
    expect(town.name).toBe('Hatfield')
  })

  it('qualifies with province/state_district where there is no county (regression: Kusatsu, Gunma)', async () => {
    const shiga = { name: 'Kusatsu', lat: '35.02', lon: '135.96', address: { city: 'Kusatsu' } }
    const gunma = { name: 'Kusatsu', lat: '36.62', lon: '138.60', address: { town: 'Kusatsu' } }
    const fetchImpl = vi.fn(async url => {
      if (url.includes('/reverse')) return jsonResponse({ address: { town: 'Kusatsu', province: 'Gunma Prefecture' } })
      return jsonResponse([url.includes('gunma') ? gunma : shiga])
    })
    const town = await resolveNear(36.62, 138.6, { fetchImpl, gate })
    expect(town.slug).toBe('kusatsu-gunma-prefecture')
  })

  it('returns null in the middle of nowhere', async () => {
    const fetchImpl = async () => jsonResponse({ address: {} })
    expect(await resolveNear(0, -30, { fetchImpl, gate })).toBe(null)
  })
})

describe('townOverpassQuery', () => {
  it('is a bounded, named-places query the proxy validator accepts', () => {
    const q = townOverpassQuery(51.7635, -0.2259)
    expect(q).toMatch(/^\[bbox:51\.7335,-0\.2649,51\.7935,-0\.1869\]\[out:json\]\[timeout:25\];/)
    expect(q).toContain('["name"]')
  })

  it('caps each category separately (regression: Paris cafés crowded out every park)', () => {
    const q = townOverpassQuery(48.8589, 2.32)
    const outs = q.match(/out tags bb \d+;/g)
    expect(outs.length).toBe(8)
    // notable parks and sights come first so the ID-order cap can't cut them (regression: Jardin du Luxembourg)
    expect(q).toContain('nwr["leisure"~"^(park|garden|nature_reserve)$"]["name"]["wikidata"];out tags bb 120;')
    expect(q).toContain('nwr["tourism"~"^(attraction|viewpoint|museum|gallery|zoo|theme_park)$"]["name"]["wikidata"];out tags bb 150;')
    // only notable places of worship
    expect(q).toContain('nwr["amenity"="place_of_worship"]["name"]["wikidata"]')
  })
})

describe('groupPlaces', () => {
  const el = (id, tags, extra = {}) => ({ type: 'node', id, lat: 51.76, lon: -0.22, tags, ...extra })

  it('groups by kind, dedupes names, ranks documented places over chains', () => {
    const { groups, total } = groupPlaces([
      el(1, { name: 'Starbucks', amenity: 'cafe', brand: 'Starbucks' }),
      el(2, { name: 'The Eight Bells', amenity: 'pub', website: 'x', opening_hours: 'y' }),
      el(3, { name: 'Hatfield House', tourism: 'attraction', wikidata: 'Q1', wikipedia: 'en:Hatfield House' }),
      el(4, { name: 'hatfield house', tourism: 'museum' }),
      { type: 'way', id: 5, center: { lat: 51.76, lon: -0.22 }, tags: { name: 'Hatfield Park', leisure: 'park' } },
      el(6, { name: 'No kind' }),
      el(7, { amenity: 'cafe' }),
      el(8, { name: 'Shop', shop: 'bakery' })
    ])
    expect(total).toBe(4)
    expect(groups.map(g => g.key)).toEqual(['sights', 'outdoors', 'food'])
    expect(groups[0].places.map(p => p.name)).toEqual(['Hatfield House'])
    expect(groups[1].places[0]).toMatchObject({ id: 'w5', name: 'Hatfield Park', lat: 51.76, lng: -0.22 })
    expect(groups[2].places.map(p => p.name)).toEqual(['The Eight Bells', 'Starbucks'])
  })

  it('ranks parks by size and sights by fame (regression: Paris showed corner squares, not the Luxembourg)', () => {
    const bounds = (size) => ({ minlat: 48.84, minlon: 2.33, maxlat: 48.84 + size, maxlon: 2.33 + size })
    const translations = n => Object.fromEntries(Array.from({ length: n }, (_, i) => [`name:l${i}`, 'x']))
    const { groups } = groupPlaces([
      { type: 'way', id: 1, bounds: bounds(0.001), tags: { name: 'Square Necker', leisure: 'park', wikidata: 'Q1' } },
      { type: 'relation', id: 2, bounds: bounds(0.01), tags: { name: 'Jardin du Luxembourg', leisure: 'park', wikidata: 'Q2' } },
      { type: 'way', id: 3, bounds: bounds(0.001), tags: { name: 'Musée Grévin', tourism: 'museum', wikidata: 'Q3', website: 'x', opening_hours: 'y', ...translations(3) } },
      { type: 'way', id: 4, bounds: bounds(0.001), tags: { name: 'Tour Eiffel', tourism: 'attraction', wikidata: 'Q4', ...translations(51) } }
    ])
    expect(groups.find(g => g.key === 'outdoors').places.map(p => p.name)).toEqual(['Jardin du Luxembourg', 'Square Necker'])
    expect(groups.find(g => g.key === 'sights').places.map(p => p.name)).toEqual(['Tour Eiffel', 'Musée Grévin'])
    // position comes from the bounds centre; ranking internals don't leak into output
    expect(groups.find(g => g.key === 'outdoors').places[0]).toEqual({ id: 'r2', name: 'Jardin du Luxembourg', kind: 'park', lat: 48.845, lng: 2.335, photo: { wikidata: 'Q2' } })
  })

  it('skips rivers and canals (regression: "La Seine" ranked as Paris\'s top park)', () => {
    const big = { minlat: 48, minlon: 2, maxlat: 49, maxlon: 3 }
    const { groups } = groupPlaces([
      { type: 'relation', id: 1, bounds: big, tags: { name: 'La Seine', natural: 'water', water: 'river' } },
      { type: 'way', id: 2, bounds: big, tags: { name: 'Morris Canal Basin', natural: 'water', water: 'basin' } },
      { type: 'way', id: 3, bounds: big, tags: { name: 'Grand Union', natural: 'water', waterway: 'canal' } },
      { type: 'way', id: 4, lat: 51.76, lon: -0.2, tags: { name: 'Stanborough Lake', natural: 'water', water: 'lake' } },
      { type: 'way', id: 5, lat: 51.76, lon: -0.2, tags: { name: 'Bunchleys Pond', natural: 'water' } }
    ])
    expect(groups[0].places.map(p => p.name)).toEqual(['Stanborough Lake', 'Bunchleys Pond'])
  })

  it('search box text in any script ends up at an English slug (regression: 東京 bounced to /town)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([{ name: 'Tokyo', lat: '35.68', lon: '139.76' }]))
    expect(await slugForQuery('東京', { fetchImpl, gate })).toBe('tokyo')
    expect(await slugForQuery('Łódź', { fetchImpl, gate })).toBe('lodz')
    expect(fetchImpl).toHaveBeenCalledTimes(1) // Latin text needs no lookup
    expect(await slugForQuery('   ', { fetchImpl, gate })).toBe(null)
  })

  it('links places by typed id so ways and relations resolve (regression: relation ids hit random nodes)', () => {
    const { groups } = groupPlaces([
      { type: 'node', id: 7, lat: 1, lon: 1, tags: { name: 'A', amenity: 'cafe' } },
      { type: 'way', id: 7, lat: 1, lon: 1, tags: { name: 'B', amenity: 'cafe' } },
      { type: 'relation', id: 7, lat: 1, lon: 1, tags: { name: 'C', amenity: 'cafe' } }
    ])
    // nodes stay bare: matches ids saved from Discover, opens in older app builds
    expect(groups[0].places.map(p => p.id)).toEqual([7, 'w7', 'r7'])
  })

  it('caps each group but reports the true total', () => {
    const many = Array.from({ length: 20 }, (_, i) => el(i, { name: `Cafe ${i}`, amenity: 'cafe' }))
    const { groups } = groupPlaces(many)
    expect(groups[0].places).toHaveLength(8)
    expect(groups[0].total).toBe(20)
  })

  it('handles empty and missing input', () => {
    expect(groupPlaces([])).toEqual({ groups: [], total: 0 })
    expect(groupPlaces()).toEqual({ groups: [], total: 0 })
  })

  it('placeScore', () => {
    expect(placeScore({ wikidata: 'Q', wikipedia: 'x' })).toBe(6)
    expect(placeScore({ brand: 'Costa' })).toBe(-2)
    expect(placeScore({ tourism: 'artwork' })).toBe(-2)
    expect(placeScore()).toBe(0)
  })

  it('counts historic sites as sights (regression: Hatfield House was missing)', () => {
    const { groups } = groupPlaces([
      el(1, { name: 'Sundial', tourism: 'artwork' }),
      el(2, { name: 'Hatfield House', historic: 'manor', wikidata: 'Q1' }),
      el(3, { name: 'Kinkaku-ji', 'name:en': 'Kinkaku-ji', amenity: 'place_of_worship', wikidata: 'Q2' })
    ])
    expect(groups[0].places.map(p => [p.name, p.kind])).toEqual([
      ['Hatfield House', 'manor'], ['Kinkaku-ji', 'place_of_worship'], ['Sundial', 'artwork']
    ])
    expect(placeScore({ amenity: 'place_of_worship', wikidata: 'Q' })).toBeLessThan(placeScore({ historic: 'manor', wikidata: 'Q' }))
  })

  it('shows English names for non-Latin scripts only', () => {
    expect(displayPlaceName({ name: '京都タワー', 'name:en': 'Kyoto Tower' })).toBe('Kyoto Tower')
    expect(displayPlaceName({ name: '京都タワー' })).toBe('京都タワー')
    expect(displayPlaceName({ name: "Musée de l'Armée", 'name:en': 'Army Museum' })).toBe("Musée de l'Armée")
    expect(displayPlaceName({ name: 'Café #1 & Co.', 'name:en': 'x' })).toBe('Café #1 & Co.')
    expect(displayPlaceName({ name: 'Łódź Kaliska', 'name:en': 'x' })).toBe('Łódź Kaliska')
  })

  it('roundCount never overstates', () => {
    expect(roundCount(1)).toBe('1')
    expect(roundCount(19)).toBe('19')
    expect(roundCount(20)).toBe('20+')
    expect(roundCount(227)).toBe('220+')
  })
})

describe('describeTown', () => {
  const paris = townFromResult('paris', PARIS)
  it('builds an honest sentence from real counts', () => {
    const grouped = groupPlaces([
      { id: 1, lat: 1, lon: 1, tags: { name: 'Louvre', tourism: 'museum' } },
      { id: 2, lat: 1, lon: 1, tags: { name: 'Café A', amenity: 'cafe' } },
      { id: 3, lat: 1, lon: 1, tags: { name: 'Café B', amenity: 'cafe' } }
    ])
    expect(describeTown(paris, grouped)).toBe('1 sight and 2 places to eat and drink in Paris, Ile-de-France.')
  })
  it('never claims places it did not find', () => {
    expect(describeTown(paris, { groups: [], total: 0 })).toBe('Places to explore in Paris, Ile-de-France, from ROAM.')
  })
  it('prefers the curated blurb for featured towns', async () => {
    const hatfield = await resolveTown('hatfield', { fetchImpl: async () => jsonResponse([HATFIELD]), gate })
    expect(describeTown(hatfield, { groups: [], total: 0 })).toMatch(/Hatfield House/)
  })
})

describe('renderTownPage', () => {
  const town = townFromResult('paris', PARIS)
  const grouped = groupPlaces([
    { id: 11, lat: 1, lon: 1, tags: { name: 'Musée <script>alert(1)</script>', tourism: 'museum' } },
    { id: 12, lat: 1, lon: 1, tags: { name: 'Jardin', leisure: 'garden' } }
  ])
  const html = renderTownPage(town, grouped)

  it('is indexable with a canonical URL and structured data', () => {
    expect(html).toContain('<link rel="canonical" href="https://www.go-roam.uk/town/paris" />')
    expect(html).not.toContain('noindex')
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1])
    const list = ld['@graph'].find(n => n['@type'] === 'ItemList')
    expect(list.itemListElement).toHaveLength(2)
    expect(list.itemListElement[1].url).toBe('https://www.go-roam.uk/place/12')
  })

  it('escapes place names everywhere, including inside JSON-LD', () => {
    expect(html).not.toContain('<script>alert(1)')
    expect(html).toContain('Musée &lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('drives installs: smart banner, both stores, Play referrer tagged per town', () => {
    expect(html).toContain('<meta name="apple-itunes-app" content="app-id=6768306617, app-argument=https://www.go-roam.uk/town/paris" />')
    expect(html).toContain('data-store="ios" href="https://apps.apple.com/gb/app/go-roam/id6768306617"')
    expect(html).toContain('utm_campaign%3Dparis')
  })

  it('passes only Commons files as photo hints, not categories', () => {
    const g = groupPlaces([
      { type: 'node', id: 1, lat: 1, lon: 1, tags: { name: 'A', tourism: 'attraction', wikimedia_commons: 'Category:Tour Eiffel', wikipedia: 'fr:Tour Eiffel' } },
      { type: 'node', id: 2, lat: 1, lon: 1, tags: { name: 'B', tourism: 'attraction', wikimedia_commons: 'File:B.jpg' } }
    ])
    expect(g.groups[0].places.map(p => p.photo)).toEqual([{ wikipedia: 'fr:Tour Eiffel' }, { commons: 'File:B.jpg' }])
  })

  it('photo script never uses lazy loading on the detached image (regression: no photo ever loaded)', () => {
    expect(renderTownPage(town, groupPlaces([{ type: 'node', id: 1, lat: 1, lon: 1, tags: { name: 'A', amenity: 'cafe' } }]))).not.toContain("loading='lazy'")
  })

  it('rows show the app\'s placeholder tile, then a photo from the app\'s own image resolver', () => {
    const g = groupPlaces([{ type: 'way', id: 9, lat: 51.7, lon: -0.2, tags: { name: 'Hatfield "House" & Park', historic: 'manor', wikidata: 'Q5', wikimedia_commons: 'File:HH.jpg' } }])
    const page = renderTownPage(town, g)
    const attr = page.match(/data-img="([^"]*)"/)[1].replace(/&amp;/g, '&')
    const q = new URLSearchParams(attr)
    expect(Object.fromEntries(q)).toEqual({ wikidata: 'Q5', commons: 'File:HH.jpg', name: 'Hatfield "House" & Park', category: 'historic', lat: '51.7', lng: '-0.2' })
    expect(page).toContain("fetch('/api/places/image-resolve?'+t.dataset.img)")
  })

  it('credits OpenStreetMap (ODbL requirement)', () => {
    expect(html).toContain('OpenStreetMap contributors')
  })

  it('links to places, other towns, search and near-me', () => {
    expect(html).toContain('href="/place/11"')
    expect(html).toContain('href="/town/hatfield"')
    expect(html).toContain('action="/town"')
    expect(html).toContain('href="/town/near-me" rel="nofollow"')
  })

  it('is noindex when there are no places (thin content)', () => {
    expect(renderTownPage(town, { groups: [], total: 0 })).toContain('<meta name="robots" content="noindex" />')
  })
})

describe('renderHub', () => {
  it('not-found echoes the query safely and is noindex', () => {
    const html = renderHub({ query: '"><img src=x>', notFound: true })
    expect(html).toContain('noindex')
    expect(html).not.toContain('<img src=x>')
    expect(html).toContain('&quot;&gt;&lt;img src=x&gt;')
  })
  it('hub is indexable', () => {
    expect(renderHub()).toContain('<link rel="canonical" href="https://www.go-roam.uk/town" />')
  })
})

describe('escapeHtml', () => {
  it('escapes the five characters that matter', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;\'')
    expect(escapeHtml(null)).toBe('')
  })
})
