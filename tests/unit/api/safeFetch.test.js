import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import { isPublicAddress, fetchPublicPage } from '../../../api/lib/safeFetch.js'

describe('isPublicAddress', () => {
  it.each([
    '127.0.0.1', '127.9.9.9', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1', '192.0.2.1',
    '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1',
    '::ffff:7f00:1', '::127.0.0.1', '64:ff9b::a9fe:a9fe', '2001:db8::1', 'not-an-ip', ''
  ])('blocks %s', ip => expect(isPublicAddress(ip)).toBe(false))

  it.each(['8.8.8.8', '1.1.1.1', '151.101.1.1', '172.32.0.1', '2606:4700:4700::1111', '2a00:1450:4009:81f::200e', '::ffff:8.8.8.8'])(
    'allows %s', ip => expect(isPublicAddress(ip)).toBe(true))
})

describe('fetchPublicPage', () => {
  let server, port
  const hits = []
  const html = '<html><head><meta property="og:image" content="/hero.jpg"></head><body>' + 'x'.repeat(100_000) + '</body></html>'
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      hits.push(req.url)
      if (req.url === '/redirect-private') { res.writeHead(302, { Location: `http://127.0.0.1:${port}/secret` }); return res.end() }
      if (req.url === '/redirect-loop') { res.writeHead(302, { Location: '/redirect-loop' }); return res.end() }
      if (req.url === '/redirect-ok') { res.writeHead(301, { Location: '/page' }); return res.end() }
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(html)
    })
    await new Promise(r => server.listen(0, '127.0.0.1', r))
    port = server.address().port
  })
  afterAll(() => server.close())

  // The test server lives on 127.0.0.1, which the real lookup blocks: stand in a
  // lookup that treats one test hostname as "public" and still refuses the rest
  const testLookup = (hostname, options, cb) => (hostname === 'venue.test'
    ? (options?.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4))
    : cb(Object.assign(new Error('blocked'), { code: 'EBLOCKED' })))

  it.each([
    'http://127.0.0.1/', 'http://localhost/', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/',
    'http://[::ffff:127.0.0.1]/', 'http://10.0.0.1/', 'http://metadata.google.internal/', 'http://printer.local/',
    'https://user:pass@example.com/', 'ftp://example.com/', 'file:///etc/passwd', 'not a url', 'http://2130706433/'
  ])('refuses %s before connecting', async url => {
    expect(await fetchPublicPage(url, { timeoutMs: 1000 })).toBeNull()
  })

  it('refuses a non-default port (no port scanning through us)', async () => {
    expect(await fetchPublicPage('https://example.com:8443/', { timeoutMs: 1000 })).toBeNull()
  })

  it('real DNS: a hostname resolving to loopback is refused at connect time', async () => {
    expect(await fetchPublicPage('http://localhost.localtest.me/', { timeoutMs: 3000 })).toBeNull()
  })

  // _anyPort lets the test reach the ephemeral-port server; _lookup stands in DNS
  const opts = extra => ({ _lookup: testLookup, _anyPort: true, timeoutMs: 3000, ...extra })

  it('fetches a public page and stops reading early when told', async () => {
    const page = await fetchPublicPage(`http://venue.test:${port}/page`, opts({ stopWhen: t => t.includes('</head>') }))
    expect(page.status).toBe(200)
    expect(page.contentType).toContain('text/html')
    expect(page.body).toContain('og:image')
    expect(page.body.length).toBeLessThan(html.length)
  })

  it('caps the read at maxBytes', async () => {
    const page = await fetchPublicPage(`http://venue.test:${port}/page`, opts({ maxBytes: 1024 }))
    expect(page.body.length).toBeLessThan(70_000)
  })

  it('follows a redirect to a public hop and reports the final URL', async () => {
    const page = await fetchPublicPage(`http://venue.test:${port}/redirect-ok`, opts())
    expect(page.status).toBe(200)
    expect(page.url).toBe(`http://venue.test:${port}/page`)
  })

  it('refuses a redirect to a private address', async () => {
    expect(await fetchPublicPage(`http://venue.test:${port}/redirect-private`, opts())).toBeNull()
  })

  it('gives up on a redirect loop', async () => {
    expect(await fetchPublicPage(`http://venue.test:${port}/redirect-loop`, opts())).toBeNull()
  })

  it('a hostname whose DNS answer is private is refused at connect time', async () => {
    expect(await fetchPublicPage(`http://other.test:${port}/page`, opts())).toBeNull()
  })

  // Each of these would reach the loopback server if its guard were missing: it must see no request
  describe('the loopback server receives zero requests', () => {
    const noHitsTo = async (path, fn) => {
      hits.length = 0
      expect(await fn()).toBeNull()
      expect(hits.filter(h => h.startsWith(path))).toEqual([])
    }

    it('a private IP literal, even with the port check off (address check alone)', () =>
      noHitsTo('/page', () => fetchPublicPage(`http://127.0.0.1:${port}/page`, { _anyPort: true, timeoutMs: 2000 })))

    it('localhost by name, port check off (name check)', () =>
      noHitsTo('/page', () => fetchPublicPage(`http://localhost:${port}/page`, { _anyPort: true, timeoutMs: 2000 })))

    it('a name whose real DNS answer is loopback (localtest.me), port check off', () =>
      noHitsTo('/page', () => fetchPublicPage(`http://localtest.me:${port}/page`, { _anyPort: true, timeoutMs: 3000 })))

    it('a redirect from a public hop to loopback: the second hop never happens', async () => {
      hits.length = 0
      expect(await fetchPublicPage(`http://venue.test:${port}/redirect-private`, opts())).toBeNull()
      expect(hits).toEqual(['/redirect-private'])
    })

    it('a non-default port, with an address the lookup allows (port check alone)', () =>
      noHitsTo('/page', () => fetchPublicPage(`http://venue.test:${port}/page`, { _lookup: testLookup, timeoutMs: 2000 })))
  })
})
