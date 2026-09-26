import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../api/lib/db.js', () => ({ query: vi.fn(async () => { throw new Error('db down') }) }))
const { default: handler } = await import('../../../api/sitemap.js')
const { UK_TOWN_SLUGS } = await import('../../../shared/ukTowns.mjs')

async function sitemap() {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v }, status(c) { this.code = c; return this }, send(b) { this.body = b; return this } }
  await handler({}, res)
  return res
}

describe('sitemap', () => {
  it('lists a page for every UK city and town, once each', async () => {
    const { code, body } = await sitemap()
    expect(code).toBe(200)
    const locs = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1])
    const towns = locs.filter(l => l.includes('/town/'))
    expect(towns.length).toBeGreaterThan(1500)
    expect(new Set(locs).size).toBe(locs.length)
    for (const slug of ['hatfield', 'houghton-regis', 'luton', 'belfast', 'inverness']) {
      expect(locs).toContain(`https://www.go-roam.uk/town/${slug}`)
    }
  })

  it('still serves the static and town routes when the database is down', async () => {
    const { body } = await sitemap()
    expect(body).toContain('<loc>https://www.go-roam.uk/town</loc>')
    expect(body.startsWith('<?xml')).toBe(true)
  })

  it('stays well under the 50,000-URL sitemap limit', () => {
    expect(UK_TOWN_SLUGS.length).toBeLessThan(45000)
  })
})
