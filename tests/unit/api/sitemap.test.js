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

  it('every featured town is a verified canonical slug (regression: /town/newcastle duplicated newcastle-upon-tyne)', async () => {
    const { TOWNS } = await import('../../../shared/towns.mjs')
    expect(TOWNS.map(t => t.slug).filter(slug => !UK_TOWN_SLUGS.includes(slug))).toEqual([])
  })

  it('lists every shipped world city too', async () => {
    const { WORLD_TOWN_SLUGS } = await import('../../../shared/worldTowns.mjs')
    const { body } = await sitemap()
    for (const slug of WORLD_TOWN_SLUGS) expect(body).toContain(`<loc>https://www.go-roam.uk/town/${slug}</loc>`)
    for (const slug of ['paris', 'new-york', 'perth', 'london-ontario']) expect(WORLD_TOWN_SLUGS).toContain(slug)
  })

  it('stays well under the 50,000-URL sitemap limit, with places at their cap, and keeps its CDN cache', async () => {
    const { body, headers } = await sitemap()
    const towns = (body.match(/<loc>/g) || []).length
    // + MAX_PLACES (5,000) place pages when the database answers
    expect(towns + 5000).toBeLessThan(45000)
    expect(headers['Cache-Control']).toBe('public, s-maxage=3600, stale-while-revalidate=86400')
  })
})
