// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { execSync } from 'node:child_process'
import { isLoadTest, LOADTEST_BYPASS } from '../../../api/lib/loadtest.js'
import { refuseBotUpstream } from '../../../api/lib/bots.js'
import { applyRateLimit, applySharedRateLimit } from '../../../api/lib/rateLimit.js'

// Load-test mode: only a full-length exact secret counts, and it is inert
// without LOADTEST_SECRET. Such requests get the crawlers' cache-only path.
const SECRET = 'x'.repeat(40)
const req = h => ({ headers: { 'user-agent': 'Mozilla/5.0 (iPhone)', ...h } })
const res = () => { const r = { headers: {} }; r.setHeader = (k, v) => { r.headers[k] = v }; r.status = c => { r.statusCode = c; return r }; r.json = b => { r.body = b; return r }; return r }

describe('isLoadTest', () => {
  beforeEach(() => vi.stubEnv('LOADTEST_SECRET', SECRET))
  afterEach(() => vi.unstubAllEnvs())

  it('accepts only the exact secret', () => {
    expect(isLoadTest(req({ 'x-roam-loadtest': SECRET }))).toBe(true)
    for (const bad of [undefined, '', SECRET.slice(1), SECRET + 'x', 'y'.repeat(40), ['a']]) {
      expect(isLoadTest(req({ 'x-roam-loadtest': bad }))).toBe(false)
    }
  })

  it('is inert when the secret is unset or short', () => {
    vi.stubEnv('LOADTEST_SECRET', '')
    expect(isLoadTest(req({ 'x-roam-loadtest': '' }))).toBe(false)
    vi.stubEnv('LOADTEST_SECRET', 'short')
    expect(isLoadTest(req({ 'x-roam-loadtest': 'short' }))).toBe(false)
  })

  it('load-test requests skip allowlisted per-IP limits; everyone else is still limited', async () => {
    const cfg = { windowMs: 60000, max: 1 }
    const lt = { socket: {}, headers: { ...req({ 'x-roam-loadtest': SECRET }).headers, 'x-forwarded-for': '9.9.9.1' } }
    for (let i = 0; i < 5; i++) expect(applyRateLimit(lt, res(), cfg, 'places:trending')).toBeNull()
    const user = { socket: {}, headers: { 'user-agent': 'Mozilla/5.0', 'x-forwarded-for': '9.9.9.2' } }
    expect(applyRateLimit(user, res(), cfg, 'places:trending')).toBeNull()
    expect(applyRateLimit(user, res(), cfg, 'places:trending')).toMatchObject({ status: 429 })
    const kv = { pipeline: () => { throw new Error('KV must not be touched') } }
    expect(await applySharedRateLimit(lt, res(), { max: 1, windowSec: 60 }, 'overpass', kv)).toBeNull()
  })

  it('a leaked secret still hits the limits on sign-ups, deletes, uploads, share codes and paid quota', async () => {
    const cfg = { windowMs: 60000, max: 1 }
    const lt = () => ({ socket: {}, headers: { ...req({ 'x-roam-loadtest': SECRET }).headers, 'x-forwarded-for': '9.9.9.3' } })
    for (const name of ['register', 'google', 'apple', 'delete', 'upload', 'share', 'payments:portal', 'partners:checkout']) {
      expect(applyRateLimit(lt(), res(), cfg, name), name).toBeNull()
      expect(applyRateLimit(lt(), res(), cfg, name), name).toMatchObject({ status: 429 })
    }
    for (const name of ['ticketmaster', 'wikipedia-summary']) {
      const kv = { pipeline: () => ({ incr() { return this }, expire() { return this }, exec: async () => [2] }) }
      expect(await applySharedRateLimit(lt(), res(), { max: 1, windowSec: 60 }, name, kv), name).toMatchObject({ status: 429 })
    }
  })

  it('every allowlisted name is a real rate-limit key in api/', () => {
    const files = execSync("grep -rhoE \"(applyRateLimit|applySharedRateLimit)\\([^)]*'[^']+'\\)\" api", { encoding: 'utf8' })
    const used = new Set([...files.matchAll(/'([^']+)'\)/g)].map(m => m[1]))
    for (const name of LOADTEST_BYPASS) expect(used.has(name), name).toBe(true)
  })

  it('load-test requests never reach Wikimedia (cache-only, not cached by the CDN); users still do', () => {
    const r = res()
    expect(refuseBotUpstream(req({ 'x-roam-loadtest': SECRET }), r)).toBe(true)
    expect(r.statusCode).toBe(503)
    expect(r.headers['Cache-Control']).toBe('private, no-store')
    expect(refuseBotUpstream(req({}), res())).toBe(false)
  })
})
