// @vitest-environment node
// Every source with its network/DB mocked. globalThis.fetch throws, so a
import { Buffer } from 'node:buffer'
// source that forgot to use the injected fetch fails loudly instead of calling out.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { gzipSync } from 'node:zlib'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { reportWindow } from '../../../scripts/growth/lib.mjs'
import * as db from '../../../scripts/growth/db.mjs'
import * as vercel from '../../../scripts/growth/vercel.mjs'
import * as storeHealth from '../../../scripts/growth/storeHealth.mjs'
import * as apple from '../../../scripts/growth/appleAnalytics.mjs'
import * as playReports from '../../../scripts/growth/playReports.mjs'
import * as posthog from '../../../scripts/growth/posthog.mjs'
import * as revenuecat from '../../../scripts/growth/revenuecat.mjs'

const win = reportWindow(new Date('2026-10-26T09:00:00Z')) // W43: 19-25 Oct, prev W42
const realFetch = globalThis.fetch
beforeAll(() => { globalThis.fetch = () => { throw new Error('network in tests') } })
afterAll(() => { globalThis.fetch = realFetch })

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body), arrayBuffer: async () => Buffer.from(JSON.stringify(body)) })
const bin = buf => ({ ok: true, status: 200, arrayBuffer: async () => buf, text: async () => buf.toString() })

describe('db', () => {
  const users = [
    { id: 1, created_at: new Date('2026-08-01T10:00:00Z') },
    { id: 2, created_at: new Date('2026-10-13T10:00:00Z') }, // prev week signup, active prev week
    { id: 3, created_at: new Date('2026-10-20T10:00:00Z') }, // this week, active
    { id: 4, created_at: new Date('2026-10-25T23:59:59Z') }, // this week, never active
  ]
  const activity = [
    { user_id: 1, src: 'swipe', day: '2026-10-19', n: 5 },
    { user_id: 1, src: 'save', day: '2026-10-21', n: 2 },
    { user_id: 3, src: 'swipe', day: '2026-10-20', n: 3 },
    { user_id: 2, src: 'follow', day: '2026-10-14', n: 1 },
    { user_id: 1, src: 'plan', day: '2026-09-10', n: 1 }, // only inside the older 30-day windows
  ]
  const places = [
    { user_id: 1, lat: '51.752', lng: '-0.336' }, // St Albans
    { user_id: 3, lat: 51.75, lng: -0.34 },
    { user_id: 1, lat: '48.857', lng: '2.352' }, // Paris
    { user_id: 3, lat: null, lng: null },
    { user_id: 3, lat: 0, lng: 0 },
  ]
  it('summarises signups, activation, WAU, actions, trend and towns', () => {
    const s = db.summarise({ users, activity, places, paying: { subscribed: '1', no_expiry: '2' } }, win)
    expect(s.signups).toEqual({ this: 2, prev: 1 })
    expect(s.activatedSignups).toEqual({ this: 1, prev: 1 })
    expect(s.wau).toEqual({ this: 2, prev: 1 })
    expect(s.actions.this).toEqual({ swipe: 8, save: 2 })
    expect(s.actions.prev).toEqual({ follow: 1 })
    expect(Object.keys(s.signupsPerDay)).toHaveLength(14)
    expect(s.signupsPerDay['2026-10-13']).toBe(1)
    expect(s.signupsPerDay['2026-10-25']).toBe(1)
    expect(s.accountsTotal).toBe(4)
    expect(s.trend.map(t => t.weekEnding)).toEqual(['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25'])
    // 30 days to 5 Oct: plan on 10 Sep -> user 1. To 12 Oct (from 12 Sep): nobody. To 19 Oct: user 2. To 26 Oct: 1, 2, 3
    expect(s.trend.map(t => t.active30d)).toEqual([1, 0, 1, 3])
    expect(s.trend.map(t => t.accounts)).toEqual([1, 1, 2, 4])
    expect(s.topTowns[0]).toEqual({ town: 'St Albans', actions: 2, users: 2 })
    expect(s.topTowns[1].town).toBe('Paris, France')
    expect(s.paying).toEqual({ subscribed: 1, noExpiry: 2 })
  })
  it('collect runs SELECTs only, with UTC Date params, and closes the connection', async () => {
    const seen = []
    let ended = false
    const conn = {
      query: async (sql, params) => {
        seen.push({ sql, params })
        if (/FROM users WHERE created_at/.test(sql)) return [users]
        if (/swiped_places/.test(sql)) return [activity]
        if (/JSON_EXTRACT/.test(sql)) return [places]
        return [[{ subscribed: 0, no_expiry: 2 }]]
      },
      end: async () => { ended = true },
    }
    const r = await db.collect(win, { connect: async () => conn })
    expect(r.status).toBe('ok')
    expect(ended).toBe(true)
    for (const { sql } of seen) expect(sql.trim()).toMatch(/^SELECT/)
    expect(seen.map(x => x.sql).join(' ')).not.toMatch(/\b(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP)\b/i)
    const act = seen.find(x => /swiped_places/.test(x.sql))
    expect(act.params).toHaveLength(14)
    expect(act.params[0].toISOString()).toBe('2026-09-05T00:00:00.000Z') // 21 + 30 days before 26 Oct
    expect(act.params[1].toISOString()).toBe('2026-10-26T00:00:00.000Z')
  })
  it('closes the connection even when a query fails', async () => {
    let ended = false
    await expect(db.collect(win, { connect: async () => ({ query: async () => { throw new Error('boom') }, end: async () => { ended = true } }) })).rejects.toThrow('boom')
    expect(ended).toBe(true)
  })
  it('reads MYSQL_* from env first, then .env files, and reports missing config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'growth-'))
    expect(db.dbConfig({}, new URL(`file://${dir}/`))).toBeNull()
    writeFileSync(join(dir, '.env.production'), 'MYSQL_HOST="h"\nMYSQL_USER=u\nMYSQL_PASSWORD=p=x\nMYSQL_DATABASE=d\nOTHER=1\n')
    expect(db.dbConfig({ MYSQL_USER: 'envuser' }, new URL(`file://${dir}/`))).toMatchObject({ MYSQL_HOST: 'h', MYSQL_USER: 'envuser', MYSQL_PASSWORD: 'p=x', MYSQL_DATABASE: 'd' })
  })
})

describe('vercel', () => {
  const routes = (overrides = {}) => async url => {
    const u = new URL(url)
    if (u.pathname.startsWith('/v9/projects/')) return json(overrides.project ?? { webAnalytics: { enabledAt: 1 } })
    if (u.pathname.endsWith('/visits/count')) return json({ data: u.searchParams.get('since').startsWith('2026-10-19') ? { visitors: 12, pageviews: 40 } : { visitors: 8, pageviews: 20 } })
    if (u.searchParams.get('by') === 'day') return json({ data: [{ day: '2026-10-20', pageviews: 30, visitors: 9 }, { day: '2026-10-25T00:00:00Z', count: 10 }] })
    return json({ data: [{ requestPath: '/town/london', pageviews: 25, visitors: 7 }] })
  }
  it('collects totals, per-day and top pages', async () => {
    const r = await vercel.collect(win, { fetch: routes(), tok: 't', scriptInstalled: true })
    expect(r).toMatchObject({ status: 'ok', pageviews: { this: 40, prev: 20 }, visitors: { this: 12, prev: 8 }, topPages: [{ path: '/town/london', pageviews: 25, visitors: 7 }] })
    expect(r.perDay['2026-10-20']).toEqual({ pageviews: 30, visitors: 9 })
    expect(r.perDay['2026-10-25']).toEqual({ pageviews: 10, visitors: 0 })
    expect(r.perDay['2026-10-19']).toEqual({ pageviews: 0, visitors: 0 })
  })
  it('says when analytics is disabled or the token is missing', async () => {
    expect(await vercel.collect(win, { fetch: routes({ project: {} }), tok: 't' })).toEqual({ status: 'disabled' })
    expect((await vercel.collect(win, { fetch: routes(), tok: null })).status).toBe('missing')
  })
})

describe('storeHealth', () => {
  const asc = async path => {
    if (path.includes('appStoreVersions')) return { data: [{ attributes: { versionString: '1.3.17', appStoreState: 'WAITING_FOR_REVIEW', platform: 'IOS' } }] }
    if (path.endsWith('subscriptionGroups')) return { data: [{ id: 'g' }] }
    if (path.includes('subscriptionGroups/g')) return { data: [{ attributes: { productId: 'premium_monthly', state: 'APPROVED' } }, { attributes: { productId: 'premium_annual', state: 'DEVELOPER_ACTION_NEEDED' } }] }
    if (path.includes('customerReviews')) return { data: [{ attributes: { rating: 4, title: 'Nice', body: 'Good app', createdDate: '2026-10-21T08:00:00-07:00' } }, { attributes: { rating: 2, title: 'Old', body: 'x', createdDate: '2026-05-01T00:00:00Z' } }] }
    throw new Error('unexpected ' + path)
  }
  const calls = []
  const play = async (path, init = {}) => {
    calls.push(`${init.method || 'GET'} ${path}`)
    if (path.endsWith('/edits')) return { id: 'e1' }
    if (path.endsWith('/tracks')) return { tracks: [{ track: 'production', releases: [{ name: '1.3.17', status: 'completed' }] }] }
    if (path.endsWith('/edits/e1')) return {}
    if (path.endsWith('/subscriptions')) return { subscriptions: [{ productId: 'roam_premium_monthly', basePlans: [{ basePlanId: 'monthly', state: 'ACTIVE' }, { basePlanId: 'annual', state: 'INACTIVE' }] }] }
    if (path.includes('/reviews')) return { reviews: [{ comments: [{ userComment: { starRating: 5, text: 'Love it', lastModified: { seconds: String(Date.parse('2026-10-24T12:00:00Z') / 1000) } } }] }] }
    throw new Error('unexpected ' + path)
  }
  const fetch = async () => json({ results: [{ averageUserRating: 4.5, userRatingCount: 2 }] })
  it('collects versions, flags subscriptions not on sale, counts reviews this week', async () => {
    const r = await storeHealth.collect(win, { helpers: { asc, play, PKG: 'com.goroam.app' }, fetch })
    expect(r.status).toBe('ok')
    expect(r.ios.versions).toEqual([{ version: '1.3.17', state: 'WAITING_FOR_REVIEW', platform: 'IOS' }])
    expect(r.ios.rating).toEqual({ average: 4.5, count: 2 })
    expect(r.android.versions).toEqual([{ track: 'production', version: '1.3.17', status: 'completed', userFraction: null }])
    expect(r.notOnSale.map(s => s.product)).toEqual(['premium_annual', 'roam_premium_monthly/annual'])
    expect(r.notOnSale[0].note).toMatch(/NOT ON SALE/)
    expect(r.reviewsThisWeek).toEqual({ count: 2, average: 4.5 })
    expect(r.latestReviews.map(x => x.rating)).toEqual([5, 4, 2])
    expect(calls).toContain('DELETE androidpublisher/v3/applications/com.goroam.app/edits/e1') // edit never left open
  })
  it('one store failing still renders the other', async () => {
    const r = await storeHealth.collect(win, { helpers: { asc, play: async () => { throw new Error('Play 401') }, PKG: 'x' }, fetch })
    expect(r.ios).not.toBeNull()
    expect(r.android).toBeNull()
    expect(r.errors).toEqual(['Google Play: Play 401'])
  })
  it('subscriptionNote matches status.mjs wording', () => {
    expect(storeHealth.subscriptionNote('APPROVED')).toBeNull()
    expect(storeHealth.subscriptionNote('IN_REVIEW')).toBe('not on sale until approved')
    expect(storeHealth.subscriptionNote('READY_TO_SUBMIT')).toMatch(/NOT ON SALE and not in review/)
  })
})

describe('appleAnalytics', () => {
  const req = { data: [{ id: 'r1', attributes: { accessType: 'ONGOING', stoppedDueToInactivity: false } }] }
  const reports = { data: [{ id: 'd', attributes: { name: 'App Downloads Standard' } }, { id: 'e', attributes: { name: 'App Store Discovery and Engagement Standard' } }] }
  it('says "first Apple data pending" when no instances exist', async () => {
    const asc = async p => (p.endsWith('analyticsReportRequests') ? req : p.includes('/reports') ? reports : { data: [] })
    const r = await apple.collect(win, { asc, fetch: async () => { throw new Error('no') } })
    expect(r.status).toBe('pending')
    expect(r.note).toMatch(/^first Apple data pending/)
  })
  it('downloads gzipped segments and sums by week', async () => {
    const dl = 'Date\tApp Apple Identifier\tDownload Type\tCounts\n2026-10-20\t6768306617\tFirst-time download\t5\n2026-10-21\t6768306617\tRedownload\t2\n2026-10-14\t6768306617\tFirst-time download\t3\n2026-10-20\t999\tFirst-time download\t100\n'
    const en = 'Date\tApp Apple Identifier\tEvent\tCounts\n2026-10-20\t6768306617\tImpression\t400\n2026-10-20\t6768306617\tPage view\t40\n2026-10-13\t6768306617\tPage view\t10\n'
    const asc = async p => {
      if (p.endsWith('analyticsReportRequests')) return req
      if (p.includes('/reports')) return reports
      if (p.startsWith('analyticsReports/d/')) return { data: [{ id: 'di', attributes: { granularity: 'DAILY', processingDate: '2026-10-21' } }, { id: 'old', attributes: { processingDate: '2026-01-01' } }] }
      if (p.startsWith('analyticsReports/e/')) return { data: [{ id: 'ei', attributes: { granularity: 'DAILY', processingDate: '2026-10-21' } }] }
      if (p === 'analyticsReportInstances/di/segments') return { data: [{ attributes: { url: 'https://x/dl' } }] }
      if (p === 'analyticsReportInstances/ei/segments') return { data: [{ attributes: { url: 'https://x/en' } }] }
      throw new Error('unexpected ' + p)
    }
    const r = await apple.collect(win, { asc, fetch: async u => bin(gzipSync(u.endsWith('/dl') ? dl : en)) })
    expect(r).toMatchObject({ status: 'ok', firstTimeDownloads: { this: 5, prev: 3 }, redownloads: { this: 2, prev: 0 }, impressions: { this: 400, prev: 0 }, pageViews: { this: 40, prev: 10 }, lastDataDate: '2026-10-21' })
  })
})

describe('playReports', () => {
  it('is not connected without a bucket', async () => {
    const r = await playReports.collect(win, { bucket: '' })
    expect(r).toEqual({ status: 'missing', need: 'grant the service account bulk-report access and set PLAY_REPORTS_BUCKET' })
  })
  it('reads UTF-16 monthly CSVs from the bucket', async () => {
    const u16 = s => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')])
    const installs = 'Date,Package Name,Daily User Installs,Daily User Uninstalls\n2026-10-13,com.goroam.app,4,1\n2026-10-20,com.goroam.app,6,2\n2026-10-25,com.goroam.app,1,0\n'
    const perf = 'Date,Package name,Country,Store listing acquisitions,Store listing visitors\n2026-10-20,com.goroam.app,GB,5,50\n2026-10-20,com.goroam.app,US,1,30\n2026-10-12,com.goroam.app,GB,2,20\n'
    const seen = []
    const fetch = async url => {
      seen.push(url)
      const u = new URL(url)
      expect(u.pathname.startsWith('/storage/v1/b/pubsite_prod_rev_123/o')).toBe(true)
      const prefix = u.searchParams.get('prefix')
      if (prefix?.startsWith('stats/installs/')) return json({ items: [{ name: `${prefix}.csv` }] })
      if (prefix?.startsWith('stats/store_performance/')) return json({ items: [{ name: prefix + 'country.csv' }] })
      return bin(u16(decodeURIComponent(u.pathname).includes('installs_') ? installs : perf))
    }
    const r = await playReports.collect(win, { bucket: 'gs://pubsite_prod_rev_123', fetch, authHeader: 'Bearer x' })
    expect(r).toMatchObject({ status: 'ok', installs: { this: 7, prev: 4 }, uninstalls: { this: 2, prev: 1 }, listingVisitors: { this: 80, prev: 20 }, listingAcquisitions: { this: 6, prev: 2 } })
    expect(seen.some(u => u.includes('installs_com.goroam.app_202610_overview'))).toBe(true)
  })
})

describe('posthog', () => {
  it('is not connected without the key file', async () => {
    expect(await posthog.collect(win, { key: null })).toMatchObject({ status: 'missing', need: expect.stringMatching(/^key file missing/) })
  })
  it('queries the EU API host (not the ingestion host) and computes trend, funnel, retention', async () => {
    const bodies = []
    const fetch = async (url, init) => {
      expect(url).toBe('https://eu.posthog.com/api/projects/176178/query/')
      expect(init.headers.Authorization).toBe('Bearer phx_test')
      const q = JSON.parse(init.body).query
      bodies.push(q)
      if (q.kind === 'HogQLQuery') return json({ results: [[10, 12, 15, 21]] })
      if (q.kind === 'FunnelsQuery') return json({ results: [{ count: 100 }, { count: 30 }] })
      return json({ results: [
        { values: [{ count: 10 }, { count: 4 }, { count: 3 }, { count: 2 }, { count: 2 }, { count: 2 }, { count: 2 }, { count: 1 }] },
        { values: [{ count: 20 }, { count: 6 }] }, // too young for day 7
        { values: [{ count: 5 }] },               // too young for day 1
      ] })
    }
    const r = await posthog.collect(win, { fetch, key: 'phx_test', project: '176178', host: 'https://eu.i.posthog.com' })
    expect(r.active30d).toBe(21)
    expect(r.trend.map(t => t.active30d)).toEqual([10, 12, 15, 21])
    expect(r.funnel.map(f => f.value)).toEqual([100, null, 30, null])
    expect(r.funnel[1].missing).toMatch(/swipe/)
    expect(r.day1).toEqual({ rate: 10 / 30, base: 30, kept: 10 })
    expect(r.day7).toEqual({ rate: 0.1, base: 10, kept: 1 })
    expect(bodies[0].query).toContain("timestamp < toDateTime('2026-10-26 00:00:00')")
    expect(bodies[1].series.map(s => s.event)).toEqual(['$pageview', 'place-saved'])
  })
})

describe('revenuecat', () => {
  it('is not connected without the key file', async () => {
    expect((await revenuecat.collect(win, { key: null })).need).toMatch(/^key file missing/)
  })
  it('maps overview metrics and says when churn is absent', async () => {
    const fetch = async url => {
      expect(url).toBe('https://api.revenuecat.com/v2/projects/ca8b1519/metrics/overview')
      return json({ metrics: [{ id: 'mrr', value: 12.5, unit: '$' }, { id: 'active_trials', value: 3 }, { id: 'active_subscriptions', value: 2 }, { id: 'new_customers', value: 40 }, { id: 'revenue', value: 30 }] })
    }
    expect(await revenuecat.collect(win, { fetch, key: 'sk_x', project: 'ca8b1519' })).toEqual({
      status: 'ok', mrr: 12.5, mrrUnit: '$', revenue28d: 30, activeTrials: 3, activeSubscriptions: 2, newCustomers28d: 40, activeUsers28d: null, churn: null,
    })
  })
  it('throws on API errors (rendered as "error:" by the report)', async () => {
    await expect(revenuecat.collect(win, { fetch: async () => json({ message: 'bad key' }, 401), key: 'k' })).rejects.toThrow('RevenueCat 401: bad key')
  })
})
