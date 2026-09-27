import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { refuseBotUpstream, isSearchCrawler, isPreviewBot } from '../../../api/lib/bots.js'

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
    expect(readFileSync('api/places/overpass/nearby.js', 'utf8')).toMatch(/isSearchCrawler\(req\) \|\| !\(await isFeatureEnabled/)
  })

  it('robots.txt keeps crawlers off the data API but not the pages or share images', () => {
    const robots = readFileSync('public/robots.txt', 'utf8')
    expect(robots).toMatch(/Disallow: \/api\//)
    expect(robots).toMatch(/Allow: \/api\/og\//)
    expect(robots).not.toMatch(/Disallow: \/place/)
  })
})

const ua = s => ({ headers: { 'user-agent': s } })
describe('who counts as a crawler (regression: Amazonbot, PerplexityBot and friends got live lookups)', () => {
  it.each([
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot) Chrome/119 Safari/537.36',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot',
    'Mozilla/5.0 (compatible; MJ12bot/v1.4.8; http://mj12bot.com/)',
    'Mozilla/5.0 (compatible; GoogleOther)',
  ])('crawler: %s', s => expect(isSearchCrawler(ua(s))).toBe(true))

  it.each([
    'WhatsApp/2.23.20.0 A',
    'facebookexternalhit/1.1 Facebot Twitterbot/1.0', // iMessage
    'Twitterbot/1.0',
    'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
    'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
    'TelegramBot (like TwitterBot)',
    'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
    'Mozilla/5.0 Google-PageRenderer Google (+https://developers.google.com/+/web/snippet/)',
  ])('link preview keeps live lookups: %s', s => expect(isSearchCrawler(ua(s))).toBe(false))

  it.each([
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    'Mozilla/5.0 (Linux; Android 14; Cubot-X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Slack/4.41.97 Chrome/128 Electron/32 Safari/537.36',
    'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122 Mobile Safari/537.36',
  ])('person is never a crawler: %s', s => expect(isSearchCrawler(ua(s))).toBe(false))

  it('a Cubot phone is not even a bot', () => {
    expect(isPreviewBot(ua('Mozilla/5.0 (Linux; Android 14; Cubot-X30) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36'))).toBe(false)
  })
})
