// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import {
  BATCH, UA, collectCandidates, commonsFileName, createClient, inRotation, missKey,
  photoRow, resolvePhotos, stripHtml
} from '../../../scripts/poi/photos.mjs'

const TODAY = '2026-09-27'
const row = (osm_type, osm_id, tags) => ({ osm_type, osm_id, el: JSON.stringify({ type: 'node', id: osm_id, tags }) })
const info = (over = {}) => ({
  thumbwidth: 800, thumbheight: 600,
  descriptionurl: 'https://commons.wikimedia.org/wiki/File:X.jpg',
  extmetadata: {
    Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Jo">Jo &amp; <b>Sam</b></a>' },
    LicenseShortName: { value: 'CC BY-SA 4.0' },
    LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' }
  },
  ...over
})

// A fake Wikimedia: every QID's P18 is "<QID>.jpg" unless overridden
function fakeWikimedia({ p18 = q => `${q}.jpg`, entity = () => ({}), ii = () => info() } = {}) {
  const calls = []
  const fetch = vi.fn(async url => {
    const u = new URL(url)
    calls.push(u)
    let body
    if (u.hostname === 'www.wikidata.org') {
      const ids = u.searchParams.get('ids').split('|')
      body = { entities: Object.fromEntries(ids.map(q => {
        const f = p18(q)
        return [q, { claims: f ? { P18: [{ mainsnak: { datavalue: { value: f } } }] } : {}, ...entity(q) }]
      })) }
    } else {
      const titles = u.searchParams.get('titles').split('|')
      body = { query: { pages: titles.map(t => ({ title: t, imageinfo: ii(t) ? [ii(t)] : undefined })) } }
    }
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => body }
  })
  return { fetch, calls }
}
const fastClient = fetch => createClient({ fetch, sleep: async () => {}, minIntervalMs: 0 })

describe('candidates', () => {
  it('reads wikidata, wikimedia_commons and Commons image= URLs; ignores other hosts', () => {
    const { qids, files } = collectCandidates([
      row(1, 1, { wikidata: 'Q42' }),
      row(1, 2, { wikidata: 'Q1;Q2' }),
      row(2, 3, { wikimedia_commons: 'File:castle_view.jpg', image: 'https://commons.wikimedia.org/wiki/File:Other.jpg' }),
      row(1, 4, { image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Foo_bar.jpg/800px-Foo_bar.jpg' }),
      row(3, 5, { image: 'https://example.com/pic.jpg' }),
      row(1, 6, { wikimedia_commons: 'Category:Castles' })
    ])
    expect([...qids]).toEqual(['Q42'])
    expect(Object.fromEntries(files)).toEqual({ w3: 'Castle view.jpg', n4: 'Foo bar.jpg' })
    expect(commonsFileName('File:a%20b.jpg')).toBe('A b.jpg')
  })
})

describe('rows', () => {
  it('strips HTML from the artist and decodes entities', () => {
    expect(stripHtml('<span>Jo&nbsp;&#x41;&#66; &lt;x&gt;</span>')).toBe('Jo AB <x>')
    expect(photoRow('Q1', 'X.jpg', info(), 'wikidata', TODAY)).toEqual({
      photo_key: 'Q1',
      url: 'https://commons.wikimedia.org/wiki/Special:FilePath/X.jpg?width=800',
      width: 800, height: 600, source: 'wikidata', artist: 'Jo & Sam',
      license: 'CC BY-SA 4.0', license_url: 'https://creativecommons.org/licenses/by-sa/4.0',
      page_url: 'https://commons.wikimedia.org/wiki/File:X.jpg', checked_on: TODAY
    })
  })

  it('drops a file with no licence', () => {
    expect(photoRow('Q1', 'X.jpg', info({ extmetadata: { Artist: { value: 'Jo' } } }), 'wikidata', TODAY)).toBe(null)
    expect(photoRow('Q1', 'X.jpg', info({ extmetadata: { LicenseShortName: { value: ' <b></b> ' } } }), 'wikidata', TODAY)).toBe(null)
  })

  it('drops distressing files (parity with image-resolve)', () => {
    expect(photoRow('Q1', 'WTC smoking on 9-11.jpeg', info(), 'wikidata', TODAY)).toBe(null)
    expect(photoRow('Q1', 'Crashaw Gardens.jpg', info(), 'wikidata', TODAY)).not.toBe(null)
  })

  it('drops a file with no named artist unless its licence needs no credit (Credit names a source, not an author)', () => {
    const meta = extra => info({ extmetadata: { LicenseShortName: { value: 'CC BY 4.0' }, ...extra } })
    expect(photoRow('Q1', 'X.jpg', meta({}), 'wikidata', TODAY)).toBe(null)
    for (const v of ['Own work', 'Transferred from en.wikipedia', 'Jo Bloggs']) expect(photoRow('Q1', 'X.jpg', meta({ Credit: { value: v } }), 'wikidata', TODAY), v).toBe(null)
    expect(photoRow('Q1', 'X.jpg', meta({ AttributionRequired: { value: 'true' } }), 'wikidata', TODAY)).toBe(null)
    // Public domain needs no credit: kept, artist null
    const pd = photoRow('Q1', 'X.jpg', meta({ LicenseShortName: { value: 'Public domain' }, AttributionRequired: { value: 'false' } }), 'wikidata', TODAY)
    expect(pd).toMatchObject({ license: 'Public domain', artist: null })
  })

  it('never builds a row the loader would refuse', () => {
    // 240 non-ASCII characters: fine as a name, over 512 once percent-encoded
    const long = 'ŵ'.repeat(236) + '.jpg'
    expect(commonsFileName('File:' + long)).toBe('Ŵ' + 'ŵ'.repeat(235) + '.jpg')
    expect(photoRow('Q1', long, info({ descriptionurl: undefined }), 'wikidata', TODAY)).toBe(null)
    expect(photoRow('Q1', 'X.jpg', info({ descriptionurl: 'http://commons.wikimedia.org/wiki/File:X.jpg' }), 'wikidata', TODAY)).toBe(null)
    const lic = v => photoRow('Q1', 'X.jpg', info({ extmetadata: { Artist: { value: 'Jo' }, LicenseShortName: { value: 'CC BY 4.0' }, LicenseUrl: { value: v } } }), 'wikidata', TODAY).license_url
    expect(lic('//creativecommons.org/licenses/by/4.0/')).toBe('https://creativecommons.org/licenses/by/4.0/')
    expect(lic('javascript:alert(1)')).toBe(null)
    expect(lic('https://x/' + 'a'.repeat(300))).toBe(null)
  })

  it('nulls a dimension that does not fit SMALLINT UNSIGNED', () => {
    expect(photoRow('Q1', 'X.jpg', info({ thumbheight: 70000 }), 'wikidata', TODAY).height).toBe(null)
  })
})

describe('resolvePhotos', () => {
  it('caps a run\'s lookups; the rest are deferred, not misses, and picked up next run', async () => {
    const rows = [...Array.from({ length: 5 }, (_, i) => row(1, i, { wikidata: `Q${i + 1}` })), row(1, 9, { wikimedia_commons: 'File:F.jpg' })]
    const { fetch } = fakeWikimedia()
    const first = await resolvePhotos(rows, { client: fastClient(fetch), today: TODAY, day: 0, maxLookups: 3 })
    expect(first.rows.map(r => r.photo_key)).toEqual(['Q1', 'Q2', 'Q3'])
    expect(first.misses).toEqual([])
    expect(first.counts).toMatchObject({ looked_up: 3, deferred: 3 })
    const prev = { rows: new Map(first.rows.map(r => [r.photo_key, r])), misses: new Set(first.misses) }
    const day = [...Array(30).keys()].find(d => ['Q1', 'Q2', 'Q3'].every(q => !inRotation(q, d)))
    const second = await resolvePhotos(rows, { client: fastClient(fetch), prev, today: TODAY, day, maxLookups: 3 })
    expect(second.rows.map(r => r.photo_key)).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'n9'])
    expect(second.counts).toMatchObject({ reused: 3, looked_up: 3, deferred: 0 })
  })

  it('a rotation re-check deferred by the cap keeps yesterday\'s row or miss (never silently dropped)', async () => {
    // Two old keys sharing today's rotation slot, both sorting after the new Q1, Q2
    const day = [...Array(30).keys()].find(d => inRotation('Q8', d))
    const other = Array.from({ length: 900 }, (_, i) => `Q${i + 30}`).find(q => q > 'Q2' && q !== 'Q8' && inRotation(q, day))
    const rows = ['Q1', 'Q2', 'Q8', other].map((q, i) => row(1, i, { wikidata: q }))
    const prev = { rows: new Map([[other, { photo_key: other, page_url: 'x', license: 'CC0', old: true }]]), misses: new Set(['Q8']) }
    const { fetch } = fakeWikimedia()
    // Q1, Q2 new; Q8 and the other are due for re-check but past the cap of 2
    const out = await resolvePhotos(rows, { client: fastClient(fetch), prev, today: TODAY, day, maxLookups: 2 })
    expect(out.rows.map(r => r.photo_key)).toEqual(['Q1', 'Q2', other])
    expect(out.rows[2].old).toBe(true)
    expect(out.misses).toEqual(['Q8'])
    expect(out.counts).toMatchObject({ looked_up: 2, deferred: 2 })
  })

  it('a non-id API error on a lone id fails the run instead of recording a miss', async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ error: { code: 'internal_api_error_DBQueryError', info: 'x' } }) }))
    await expect(resolvePhotos([row(1, 1, { wikidata: 'Q5' })], { client: fastClient(fetch), today: TODAY, day: 0 })).rejects.toThrow(/DBQueryError/)
  })

  it('only takes QIDs Wikibase accepts', () => {
    const { qids } = collectCandidates(['Q0', 'Q012', 'Q7', 'q7', 'Q12345678901'].map((q, i) => row(1, i, { wikidata: q })))
    expect([...qids]).toEqual(['Q7'])
  })

  it('a batch the API rejects is split until the bad id stands alone, which becomes a miss', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => row(1, i, { wikidata: `Q${i + 1}` }))
    const { fetch: good } = fakeWikimedia()
    const fetch = vi.fn(async url => {
      const ids = new URL(url).searchParams.get('ids')
      if (ids && ids.split('|').includes('Q13')) {
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ error: { code: 'no-such-entity', info: 'Q13' } }) }
      }
      return good(url)
    })
    const out = await resolvePhotos(rows, { client: fastClient(fetch), today: TODAY, day: 0 })
    expect(out.rows).toHaveLength(49)
    expect(out.misses).toEqual(['Q13'])
  })

  it('maps normalised titles back and follows continuation', async () => {
    const rows = [row(1, 1, { wikimedia_commons: 'File:a_b.jpg' }), row(1, 2, { wikimedia_commons: 'File:C.jpg' })]
    let n = 0
    const fetch = vi.fn(async () => {
      const body = n++ === 0
        ? { query: { normalized: [{ from: 'File:A b.jpg', to: 'File:Á b.jpg' }], pages: [{ title: 'File:Á b.jpg', imageinfo: [info()] }] }, continue: { iistart: 'x', continue: '||' } }
        : { query: { pages: [{ title: 'File:C.jpg', imageinfo: [info()] }] } }
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => body }
    })
    const out = await resolvePhotos(rows, { client: fastClient(fetch), today: TODAY, day: 0 })
    expect(out.rows.map(r => r.photo_key)).toEqual(['n1', 'n2'])
    expect(new URL(fetch.mock.calls[1][0]).searchParams.get('iistart')).toBe('x')
  })

  it('batches 50 QIDs and 50 titles per request', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => row(1, i + 1, { wikidata: `Q${i + 1}` }))
    const { fetch, calls } = fakeWikimedia()
    const out = await resolvePhotos(rows, { client: fastClient(fetch), today: TODAY, day: 0 })
    const wd = calls.filter(u => u.hostname === 'www.wikidata.org').map(u => u.searchParams.get('ids').split('|').length)
    const cm = calls.filter(u => u.hostname === 'commons.wikimedia.org').map(u => u.searchParams.get('titles').split('|').length)
    expect(wd).toEqual([BATCH, BATCH, 20])
    expect(cm).toEqual([BATCH, BATCH, 20])
    expect(calls.every(u => u.searchParams.get('maxlag') === '5')).toBe(true)
    expect(out.rows).toHaveLength(120)
    expect(out.counts.photo_count).toBe(120)
  })

  it('skips event items, missing P18 and missing files; licence breakdown counted', async () => {
    const rows = ['Q1', 'Q2', 'Q3', 'Q4'].map((q, i) => row(1, i, { wikidata: q }))
    const { fetch } = fakeWikimedia({
      p18: q => (q === 'Q2' ? null : `${q}.jpg`),
      entity: q => (q === 'Q3' ? { claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q898712' } } } }], P18: [{ mainsnak: { datavalue: { value: 'Q3.jpg' } } }] } } : {}),
      ii: t => (t === 'File:Q4.jpg' ? null : info())
    })
    const out = await resolvePhotos(rows, { client: fastClient(fetch), today: TODAY, day: 0 })
    expect(out.rows.map(r => r.photo_key)).toEqual(['Q1'])
    expect(out.misses).toEqual(['Q2', 'Q3', 'Q4'])
    expect(out.counts.licences).toEqual({ 'CC BY-SA 4.0': 1 })
  })

  it('reuses previous rows and misses, re-verifying only the rotating slice', async () => {
    const qs = Array.from({ length: 300 }, (_, i) => `Q${i + 1}`)
    const rows = qs.map((q, i) => row(1, i, { wikidata: q }))
    const prevRows = new Map(qs.slice(0, 200).map(q => [q, { photo_key: q, page_url: 'x', license: 'CC0', old: true }]))
    const prev = { rows: prevRows, misses: new Set(qs.slice(200, 290)) } // Q291-Q300 are new
    const { fetch, calls } = fakeWikimedia()
    const day = 7
    const out = await resolvePhotos(rows, { client: fastClient(fetch), prev, today: TODAY, day })
    const due = qs.slice(0, 290).filter(q => inRotation(q, day))
    expect(due.length).toBeGreaterThan(0)
    expect(due.length).toBeLessThan(30) // ~1/30 of 290
    const asked = calls.filter(u => u.hostname === 'www.wikidata.org').flatMap(u => u.searchParams.get('ids').split('|'))
    expect(asked.sort()).toEqual([...due, ...qs.slice(290)].sort())
    expect(out.counts.looked_up).toBe(due.length + 10)
    const reusedRow = out.rows.find(r => r.photo_key === qs.find(q => prevRows.has(q) && !inRotation(q, day)))
    expect(reusedRow.old).toBe(true)
  })

  it('drops rows whose element or QID left the build, and re-looks-up a retagged element file', async () => {
    const prev = {
      rows: new Map([
        ['Q9', { photo_key: 'Q9', page_url: 'x', license: 'CC0' }],
        ['n5', { photo_key: 'n5', page_url: 'https://commons.wikimedia.org/wiki/File:Old_name.jpg', license: 'CC0' }]
      ]),
      misses: new Set()
    }
    const { fetch, calls } = fakeWikimedia()
    const day = [...Array(30).keys()].find(d => !inRotation('n5', d))
    const out = await resolvePhotos([row(1, 5, { wikimedia_commons: 'File:New name.jpg' })], { client: fastClient(fetch), prev, today: TODAY, day })
    expect(out.rows.map(r => [r.photo_key, r.source])).toEqual([['n5', 'commons-osm']])
    expect(out.rows[0].url).toContain('New_name.jpg')
    expect(calls).toHaveLength(1)
    expect(missKey('n5', 'A.jpg')).toBe('n5:A.jpg')
  })
})

describe('polite client', () => {
  const resp = (status, body = {}, retryAfter = null) => ({
    ok: status >= 200 && status < 300, status,
    headers: { get: k => (k.toLowerCase() === 'retry-after' ? retryAfter : null) },
    json: async () => body
  })

  it('spaces requests, sends the UA, honours Retry-After on 429 and backs off on 5xx', async () => {
    let clock = 0
    const sleeps = []
    const sleep = async ms => { sleeps.push(ms); clock += ms }
    const seq = [resp(429, {}, '7'), resp(503), resp(200, { ok: 1 })]
    const fetch = vi.fn(async () => seq.shift())
    const c = createClient({ fetch, sleep, now: () => clock, minIntervalMs: 1000 })
    expect(await c.get('https://x/?a=1&maxlag=5')).toEqual({ ok: 1 })
    expect(fetch.mock.calls[0][1].headers['User-Agent']).toBe(UA)
    // 429 -> Retry-After 7 s; 503 -> 2^2 s backoff; no extra spacing needed after long sleeps
    expect(sleeps).toEqual([7000, 4000])
    expect(c.stats).toMatchObject({ requests: 3, retries: 2 })
    seq.push(resp(200, {}))
    await c.get('https://x/')
    expect(sleeps).toEqual([7000, 4000, 1000]) // back-to-back calls are 1 s apart
  })

  it('retries database maxlag, drops maxlag only for query-service lag, gives up on 4xx', async () => {
    let clock = 0
    const sleep = async ms => { clock += ms }
    const lag = type => resp(200, { error: { code: 'maxlag', type, lag: 12 } }, '5')
    const seq = [lag('db'), lag('wikibase-queryservice'), resp(200, { ok: 2 })]
    const fetch = vi.fn(async () => seq.shift())
    const c = createClient({ fetch, sleep, now: () => clock })
    expect(await c.get('https://x/?a=1&maxlag=5')).toEqual({ ok: 2 })
    expect(fetch.mock.calls.map(a => a[0])).toEqual(['https://x/?a=1&maxlag=5', 'https://x/?a=1&maxlag=5', 'https://x/?a=1'])
    expect(c.stats.wdqsLagSkips).toBe(1)

    const huge = []
    const capped = createClient({ fetch: vi.fn(async () => (huge.length ? resp(200, {}) : resp(429, {}, '86400'))), sleep: async ms => { huge.push(ms) }, now: () => clock })
    await capped.get('https://x/')
    expect(huge[0]).toBe(60000) // a hostile Retry-After can't park the build for a day

    const bad = createClient({ fetch: async () => resp(400), sleep, now: () => clock })
    await expect(bad.get('https://x/')).rejects.toThrow(/400/)
    const down = createClient({ fetch: async () => resp(502), sleep, now: () => clock, maxAttempts: 3 })
    await expect(down.get('https://x/')).rejects.toThrow(/after 3 attempt/)
  })
})
