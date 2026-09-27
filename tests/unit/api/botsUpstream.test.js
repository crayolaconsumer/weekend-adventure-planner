import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { refuseBotUpstream } from '../../../api/lib/bots.js'

// Regression: a crawler rendering ~1 place page/s after the sitemap went out
// fanned out into thousands of live Overpass / Wikipedia / Commons calls an
// hour, exhausting the free Overpass quota and slowing every user's Discover.
const res = () => { const r = { headers: {}, setHeader(k, v) { r.headers[k] = v }, status(c) { r.code = c; return r }, json(b) { r.body = b; return r } }; return r }

describe('crawlers never trigger live upstream calls', () => {
  it('refuses a crawler with a no-store 503', () => {
    const r = res()
    expect(refuseBotUpstream({ headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' } }, r)).toBe(true)
    expect(r.code).toBe(503)
    expect(r.headers['Cache-Control']).toBe('private, no-store')
  })

  it('lets people and internal calls through', () => {
    expect(refuseBotUpstream({ headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' } }, res())).toBe(false)
    expect(refuseBotUpstream({ headers: { 'x-forwarded-for': '1.2.3.4' } }, res())).toBe(false) // share-meta's internal lookups
  })

  it('is wired into every free-upstream proxy', () => {
    expect(readFileSync('api/wikipedia/summary.js', 'utf8')).toMatch(/refuseBotUpstream\(req, res\)/)
    expect(readFileSync('api/places/image-resolve.js', 'utf8')).toMatch(/refuseBotUpstream\(req, res\)/)
    expect(readFileSync('api/places/overpass/nearby.js', 'utf8')).toMatch(/isPreviewBot\(req\) \|\| !\(await isFeatureEnabled/)
  })

  it('robots.txt keeps crawlers off the data API but not the pages or share images', () => {
    const robots = readFileSync('public/robots.txt', 'utf8')
    expect(robots).toMatch(/Disallow: \/api\//)
    expect(robots).toMatch(/Allow: \/api\/og\//)
    expect(robots).not.toMatch(/Disallow: \/place/)
  })
})
