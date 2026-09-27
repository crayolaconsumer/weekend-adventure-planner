import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../../../api/lib/rateLimit.js', () => ({
  applyRateLimit: () => null,
  RATE_LIMITS: { API_GENERAL: {} },
}))
vi.mock('../../../api/lib/cors.js', () => ({ withCors: h => h }))

const { default: handler } = await import('../../../api/places/image-resolve.js')

function call(query) {
  return new Promise(resolve => {
    const res = {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[k.toLowerCase()] = v },
      status(c) { this.statusCode = c; return this },
      json(body) { resolve({ status: this.statusCode, body }); return this },
    }
    handler({ method: 'GET', query, headers: {} }, res)
  })
}

const json = body => ({ ok: true, status: 200, json: async () => body })
const miss = { ok: false, status: 404, json: async () => ({}) }

// Routes each upstream by URL; anything unrouted is a 404
function upstream(routes) {
  const fetch = vi.fn(async url => {
    for (const [match, body] of routes) if (url.includes(match)) return typeof body === 'function' ? body(url) : json(body)
    return miss
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const entity = (qid, claims) => ({ entities: { [qid]: { claims } } })
const p31 = (...ids) => ids.map(id => ({ mainsnak: { datavalue: { value: { id } } } }))
const p18 = file => [{ mainsnak: { datavalue: { value: file } } }]
const nameSearch = pages => ({ query: { pages: Object.fromEntries(pages.map((p, i) => [String(100 + i), { index: i + 1, ...p }])) } })

afterEach(() => vi.unstubAllGlobals())

// Real OSM tags of /place/w278033604 (captured 2026-09-27): the mapper tagged
// the memorial with the attacks' article and item
describe('9/11 Memorial & Museum (regression: burning towers and the attacks article)', () => {
  const memorial = {
    name: '9/11 Memorial & Museum', category: 'culture', wikipedia: 'en:September 11 attacks', wikidata: 'Q10806',
    website: 'https://www.911memorial.org/', lat: '40.7115', lng: '-74.0134'
  }

  it('uses neither the event item nor its article, and falls through to the venue site', async () => {
    upstream([
      ['wikidata.org', entity('Q10806', { P31: p31('Q898712', 'Q750215', 'Q217327'), P585: [{}], P18: p18('North face south tower after plane strike 9-11.jpg') })],
      ['wikipedia.org', { title: 'September 11 attacks', description: 'Islamist terrorist attacks in the United States', thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/WTC_smoking_on_9-11.jpeg/330px-WTC_smoking_on_9-11.jpeg' } }],
      ['911memorial.org', () => ({ ok: true, status: 200, headers: { get: () => 'text/html' }, body: { getReader: () => {
        let sent = false
        return { read: async () => sent ? { done: true } : (sent = true, { value: new TextEncoder().encode('<head><meta property="og:image" content="https://www.911memorial.org/pools.jpg"></head>') }), cancel() {} }
      } } })]
    ])
    const { body } = await call(memorial)
    expect(body.url).toBe('https://www.911memorial.org/pools.jpg')
    expect(body.source).toBe('website-og')
  })

  it('rejects the event article by title even without a Wikidata tag', async () => {
    upstream([['wikipedia.org', { title: 'September 11 attacks', thumbnail: { source: 'https://upload.wikimedia.org/x/Towers.jpg' } }]])
    const { body } = await call({ name: '9/11 Memorial & Museum', category: 'culture', wikipedia: 'en:September 11 attacks' })
    expect(body.url).toBe(null)
  })
})

describe('curated sources', () => {
  it("prefers the item's own P18 over the article's lead image", async () => {
    upstream([
      ['wikidata.org', entity('Q1', { P31: p31('Q33506'), P625: [{}], P18: p18('York Minster west front.jpg') })],
      ['wikipedia.org', { title: 'York Minster', thumbnail: { source: 'https://upload.wikimedia.org/lead.jpg' } }]
    ])
    const { body } = await call({ name: 'York Minster', category: 'historic', wikipedia: 'en:York Minster', wikidata: 'Q1' })
    expect(body.source).toBe('wikidata')
    expect(body.url).toContain('York%20Minster%20west%20front.jpg')
  })

  it('keeps an article about the place even when it mentions a war', async () => {
    upstream([['wikipedia.org', { title: 'Imperial War Museum', description: 'war museum in London', thumbnail: { source: 'https://upload.wikimedia.org/iwm.jpg' } }]])
    const { body } = await call({ name: 'Imperial War Museum', category: 'culture', wikipedia: 'en:Imperial War Museum' })
    expect(body.url).toBe('https://upload.wikimedia.org/iwm.jpg')
  })

  it.each(['smoking', 'burning', 'attack', 'explosion', 'bombing', 'massacre', 'corpse', 'crash'])('skips a file named with "%s" and falls to the next source', async term => {
    upstream([
      ['wikidata.org', entity('Q2', { P625: [{}], P18: p18(`Old tower ${term} 1990.jpg`) })],
      ['wikipedia.org', { title: 'Old Tower', thumbnail: { source: 'https://upload.wikimedia.org/tower.jpg' } }]
    ])
    const { body } = await call({ name: 'Old Tower', category: 'historic', wikipedia: `en:Old Tower ${term}`, wikidata: 'Q2' })
    expect(body.url).toBe('https://upload.wikimedia.org/tower.jpg')
  })
})

describe('Commons name search only near the place', () => {
  const garden = { name: "St John's Gardens", category: 'nature', lat: '51.4937', lng: '-0.1317' }

  it('rejects a same-named file geotagged in another city (regression: Westminster got Liverpool)', async () => {
    upstream([['generator=search', nameSearch([
      { title: "File:Over St John's Gardens to William Brown Street.jpg" },
      { title: "File:St John's Gardens Liverpool.jpg", coordinates: [{ lat: 53.4089, lon: -2.9818 }] }
    ])]])
    const { body } = await call(garden)
    expect(body.url).toBe(null)
  })

  it('accepts a file geotagged within 1 km', async () => {
    upstream([['generator=search', nameSearch([
      { title: "File:St John's Gardens Liverpool.jpg", coordinates: [{ lat: 53.4089, lon: -2.9818 }] },
      { title: "File:St John's Gardens Westminster.jpg", coordinates: [{ lat: 51.4940, lon: -0.1320 }] }
    ])]])
    const { body } = await call({ ...garden, lat: '51.4938' })
    expect(body.source).toBe('commons-name')
    expect(body.url).toContain('Westminster.jpg')
  })

  it('still accepts a file with no coordinates when nothing says it is elsewhere', async () => {
    upstream([['generator=search', nameSearch([{ title: "File:St John's Gardens in spring.jpg" }])]])
    const { body } = await call({ ...garden, lat: '51.4939' })
    expect(body.url).toContain('spring.jpg')
  })
})

describe('Commons geosearch only for photos of the place', () => {
  const geo = items => upstream([['list=geosearch', { query: { geosearch: items } }]])
  const q = { category: 'nature', lng: '-0.1300' }

  it('rejects a nearby photo of something else (regression: Causton Street Playground got a Gainsborough House sign)', async () => {
    geo([{ title: 'File:Gainsborough House blue plaque.jpg', dist: 85 }])
    const { body } = await call({ ...q, name: 'Causton Street Playground', lat: '51.4930' })
    expect(body.url).toBe(null)
  })

  it('does not count a shared stopword like "gardens" as a match', async () => {
    geo([{ title: 'File:Canopy at Cadogan Gardens.jpg', dist: 95 }])
    const { body } = await call({ ...q, name: 'Sloane Gardens', lat: '51.4931' })
    expect(body.url).toBe(null)
  })

  it('accepts a photo that names the place', async () => {
    geo([{ title: 'File:Unrelated.jpg', dist: 90 }, { title: 'File:Sloane Gardens in May.jpg', dist: 110 }])
    const { body } = await call({ ...q, name: 'Sloane Gardens', lat: '51.4932' })
    expect(body.url).toContain('Sloane%20Gardens%20in%20May.jpg')
  })

  it('accepts any photo taken within 60 m', async () => {
    geo([{ title: 'File:IMG_1234.jpg', dist: 40 }])
    const { body } = await call({ ...q, name: 'Causton Street Playground', lat: '51.4933' })
    expect(body.source).toBe('commons-geo')
  })
})
