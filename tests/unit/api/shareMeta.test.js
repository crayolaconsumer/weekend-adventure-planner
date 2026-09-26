import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

const queryOne = vi.fn()
vi.mock('../../../api/lib/db.js', () => ({ queryOne: (...a) => queryOne(...a), query: vi.fn() }))
const { createHandler } = await import('../../../api/share-meta.js')

// The real index.html template, so tag rewriting is tested against actual markup
const TEMPLATE = readFileSync('index.html', 'utf8')
const readTemplate = () => TEMPLATE

const proxyWith = elements => vi.fn(async (req, res) => res.status(200).json({ elements }))
const resolverWith = url => vi.fn(async (req, res) => res.status(200).json({ url }))

async function run(query, deps, ua = '') {
  const res = { h: {}, setHeader(k, v) { this.h[k] = v }, status(c) { this.code = c; return this }, send(b) { this.body = b; return this } }
  await createHandler({ readTemplate, ...deps })({ query, headers: { 'x-forwarded-for': '198.51.100.1', 'user-agent': ua } }, res)
  return res
}
// Attribute values are HTML-escaped (&amp;); unfurlers decode them, so compare decoded
const meta = (html, attr) => (html.match(new RegExp(`<meta ${attr}\\s+content="([^"]*)"`)) || [])[1]?.replace(/&amp;/g, '&')

beforeEach(() => { queryOne.mockReset() }) // braces: a returned function would run as teardown

describe('share-meta: places', () => {
  const park = { type: 'way', id: 815929296, center: { lat: 51.76, lon: -0.22 }, tags: { name: 'Hatfield Park', leisure: 'park', 'addr:town': 'Hatfield', wikidata: 'Q1' } }

  it('previews a shared place with its real name, kind, town and photo (regression: generic "Stop scrolling" card)', async () => {
    const proxy = proxyWith([park])
    const resolver = resolverWith('https://upload.wikimedia.org/hatfield-park.jpg')
    const res = await run({ kind: 'place', id: 'w815929296' }, { proxy, resolver }, 'WhatsApp/2.23')
    expect(res.code).toBe(200)
    expect(res.body).toContain('<title>Hatfield Park | ROAM</title>')
    expect(meta(res.body, 'property="og:title"')).toBe('Hatfield Park | ROAM')
    expect(meta(res.body, 'property="og:description"')).toBe('Park in Hatfield. Save it, plan a visit and find more places like it on ROAM.')
    expect(meta(res.body, 'property="og:image"')).toBe('https://upload.wikimedia.org/hatfield-park.jpg')
    expect(meta(res.body, 'name="twitter:image"')).toBe('https://upload.wikimedia.org/hatfield-park.jpg')
    expect(meta(res.body, 'property="og:url"')).toBe('https://www.go-roam.uk/place/w815929296')
    expect(res.body).not.toContain('og:image:width') // template's 512x250 no longer true
    expect(res.h['Cache-Control']).toMatch(/s-maxage=86400/)
    // typed id → exact way lookup
    expect(proxy.mock.calls[0][0].body.query).toContain('way(815929296);')
    expect(resolver.mock.calls[0][0].query).toMatchObject({ wikidata: 'Q1', name: 'Hatfield Park', category: 'nature', lat: '51.76', lng: '-0.22' })
    // the app still boots: script tags untouched
    expect(res.body).toContain('<div id="root"></div>')
  })

  it('falls back to the branded preview card when no photo exists', async () => {
    const res = await run({ kind: 'place', id: '123' }, { proxy: proxyWith([park]), resolver: resolverWith(null) })
    // the card reads the place by id: no free text in the image URL
    expect(meta(res.body, 'property="og:image"')).toBe('https://www.go-roam.uk/api/og/place?id=123')
  })

  it('a bare numeric id previews the named way, not an unrelated node with the same number (regression)', async () => {
    const strayNode = { type: 'node', id: 500288911, lat: 50.5, lon: 12.78, tags: {} }
    const parkWay = { ...park, id: 500288911 }
    const res = await run({ kind: 'place', id: '500288911' }, { proxy: proxyWith([strayNode, parkWay]), resolver: resolverWith(null) })
    expect(meta(res.body, 'property="og:title"')).toBe('Hatfield Park | ROAM')
  })

  it('bare numeric ids look up node or way, like the app does', async () => {
    const proxy = proxyWith([park])
    await run({ kind: 'place', id: '12345' }, { proxy, resolver: resolverWith(null) })
    expect(proxy.mock.calls[0][0].body.query).toContain('(node(12345);way(12345););')
  })

  it('escapes hostile OSM names', async () => {
    const evil = { ...park, tags: { name: '"><script>alert(1)</script>', amenity: 'cafe' } }
    const res = await run({ kind: 'place', id: 'n1' }, { proxy: proxyWith([evil]), resolver: resolverWith(null) })
    expect(res.body).not.toContain('<script>alert(1)')
    expect(meta(res.body, 'property="og:title"')).toBe('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt; | ROAM')
  })

  it('never looks up junk or wiki_ ids, and serves the normal page', async () => {
    for (const id of ['wiki_123', 'otm_x', '1;node(1)', '']) {
      const proxy = proxyWith([park])
      const res = await run({ kind: 'place', id }, { proxy, resolver: resolverWith(null) })
      expect(proxy).not.toHaveBeenCalled()
      expect(res.body).toBe(TEMPLATE)
      expect(res.h['Cache-Control']).toBe('public, s-maxage=600')
    }
  })

  it('serves the normal page if the lookup fails or finds nothing', async () => {
    const down = vi.fn(async (req, res) => res.status(503).json({ error: 'down' }))
    const failed = await run({ kind: 'place', id: 'w1' }, { proxy: down, resolver: resolverWith(null) })
    expect(failed.body).toBe(TEMPLATE)
    // a failure must not be CDN-cached and handed to the next preview bot (regression)
    expect(failed.h['Cache-Control']).toBe('private, no-store')
    expect((await run({ kind: 'place', id: 'w1' }, { proxy: proxyWith([]), resolver: resolverWith(null) })).body).toBe(TEMPLATE)
  })

  it('"historic=yes" never becomes "Yes in Hatfield"', async () => {
    const house = { ...park, tags: { name: 'Old Hall', historic: 'yes', tourism: 'attraction', 'addr:town': 'Hatfield' } }
    const res = await run({ kind: 'place', id: 'w2' }, { proxy: proxyWith([house]), resolver: resolverWith(null) })
    expect(meta(res.body, 'property="og:description"')).toMatch(/^Attraction in Hatfield\./)
  })

  it('a "$\'" in a title cannot corrupt the page (regression: String.replace patterns)', async () => {
    queryOne.mockResolvedValue({ id: 1, title: "Pub crawl $' $& $`", username: 'j', stops: 2 })
    const res = await run({ kind: 'plan', code: 'abcdef123456' })
    expect(res.body.length).toBeLessThan(TEMPLATE.length + 2000)
    expect((res.body.match(/<script/g) || []).length).toBe((TEMPLATE.match(/<script/g) || []).length)
    expect(meta(res.body, 'property="og:title"')).toBe("Pub crawl $' $& $` | ROAM")
  })

  it('people never wait on the photo lookup (only preview bots read og:image)', async () => {
    const resolver = resolverWith('https://img/x.jpg')
    const res = await run({ kind: 'place', id: 'w1' }, { proxy: proxyWith([park]), resolver }, 'Mozilla/5.0 (iPhone)')
    expect(resolver).not.toHaveBeenCalled()
    expect(meta(res.body, 'property="og:title"')).toBe('Hatfield Park | ROAM')
    // photo-less page must not sit in the CDN for the next WhatsApp preview (regression)
    expect(res.h['Cache-Control']).toBe('private, no-store')
  })

  it('tells people from preview bots by user agent', async () => {
    const { isPreviewBot } = await import('../../../api/share-meta.js')
    const ua = s => isPreviewBot({ headers: { 'user-agent': s } })
    for (const bot of ['WhatsApp/2.23.20.0', 'facebookexternalhit/1.1', 'Twitterbot/1.0', 'TelegramBot (like TwitterBot)', 'LinkedInBot/1.0', 'Slackbot-LinkExpanding 1.0', 'Discordbot/2.0', 'http.rb/5.1 (Mastodon/4.2; +https://x)', 'Iframely/1.3', 'Mozilla/5.0 Google-PageRenderer Google'])
      expect(ua(bot), bot).toBe(true)
    for (const person of ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 Safari/604.1', 'Mozilla/5.0 (Linux; Android 14; CUBOT KINGKONG 9) Chrome/128 Mobile', 'Mozilla/5.0 (iPhone) Mobile/15E148 [LinkedInApp]', 'Mozilla/5.0 (Linux; Android 13) Telegram-Android/10.0', 'Mozilla/5.0 (iPhone) Mobile/15E148 [FBAN/FBIOS]', 'Mozilla/5.0 (iPhone) Instagram 300.0'])
      expect(ua(person), person).toBe(false)
  })

  it('link-preview bots get time for a slow lookup; people get the page fast', async () => {
    const slow = vi.fn((req, res) => new Promise(r => setTimeout(() => r(res.status(200).json({ url: 'https://img/slow.jpg' })), 3000)))
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const bot = run({ kind: 'place', id: 'w1' }, { proxy: proxyWith([park]), resolver: slow }, 'WhatsApp/2.23.20 A')
    const person = run({ kind: 'place', id: 'w1' }, { proxy: proxyWith([park]), resolver: slow }, 'Mozilla/5.0 (iPhone)')
    await vi.advanceTimersByTimeAsync(3100)
    const [b, p] = await Promise.all([bot, person])
    vi.useRealTimers()
    expect(meta(b.body, 'property="og:image"')).toBe('https://img/slow.jpg')
    expect(meta(p.body, 'property="og:image"')).toContain('/api/og/place?id=w1')
    expect(slow).toHaveBeenCalledTimes(1) // only the bot asked for a photo
  })

  it('does not wait forever for a slow photo lookup', async () => {
    const hang = vi.fn(() => new Promise(() => {}))
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const p = run({ kind: 'place', id: 'w1' }, { proxy: proxyWith([park]), resolver: hang }, 'facebookexternalhit/1.1')
    await vi.advanceTimersByTimeAsync(7100)
    const res = await p
    vi.useRealTimers()
    expect(meta(res.body, 'property="og:image"')).toContain('/api/og/place?')
  })
})

describe('share-meta: plans and profiles', () => {
  it('previews a public plan with its title, stops and author', async () => {
    queryOne.mockResolvedValue({ id: 1, title: 'Sunday in St Albans', username: 'james', stops: 4 })
    const res = await run({ kind: 'plan', code: 'abcdef123456' })
    expect(meta(res.body, 'property="og:title"')).toBe('Sunday in St Albans | ROAM')
    expect(meta(res.body, 'property="og:description"')).toBe('A 4-stop day out planned by @james on ROAM. See the route, vote on stops and plan your own.')
    expect(meta(res.body, 'property="og:image"')).toBe('https://www.go-roam.uk/api/og/plan?code=abcdef123456')
    // only public plans from unbanned users
    expect(queryOne.mock.calls[0][0]).toMatch(/is_public = 1 AND u\.is_banned = FALSE/)
  })

  it('invalid share codes never reach the database', async () => {
    const res = await run({ kind: 'plan', code: "x' OR 1=1" })
    expect(queryOne).not.toHaveBeenCalled()
    expect(res.body).toBe(TEMPLATE)
  })

  it('profiles show only the public display name and username', async () => {
    queryOne.mockResolvedValue({ username: 'james', display_name: 'James' })
    const res = await run({ kind: 'user', username: 'james' })
    expect(meta(res.body, 'property="og:title"')).toBe('James (@james) | ROAM')
    expect(queryOne.mock.calls[0][0]).toMatch(/SELECT username, display_name FROM users WHERE username = \? AND is_banned = FALSE/)
  })

  it('unknown or banned users get the normal page', async () => {
    queryOne.mockResolvedValue(undefined)
    expect((await run({ kind: 'user', username: 'nobody' })).body).toBe(TEMPLATE)
  })

  it('a database error still serves the page', async () => {
    queryOne.mockImplementation(async () => { throw new Error('db down') })
    const res = await run({ kind: 'user', username: 'james' })
    expect(res.code).toBe(200)
    expect(res.body).toBe(TEMPLATE)
  })
})
