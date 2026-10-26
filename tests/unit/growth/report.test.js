// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import process from 'node:process'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { reportWindow } from '../../../scripts/growth/lib.mjs'
import { render, gather, readAdmob, buildFunnel, main } from '../../../scripts/growth/report.mjs'

const win = reportWindow(new Date('2026-10-26T09:00:00Z'))
const missing = need => ({ status: 'missing', need })

const dbOk = {
  status: 'ok',
  signupsPerDay: Object.fromEntries(Array.from({ length: 14 }, (_, i) => [new Date(Date.UTC(2026, 9, 12 + i)).toISOString().slice(0, 10), i === 13 ? 2 : 0])),
  signups: { this: 2, prev: 0 }, activatedSignups: { this: 1, prev: 0 }, wau: { this: 3, prev: 1 },
  actions: { this: { swipe: 10, save: 2 }, prev: { swipe: 5 } }, accountsTotal: 34,
  trend: [{ weekEnding: '2026-10-04', accounts: 30, active30d: 2 }, { weekEnding: '2026-10-11', accounts: 31, active30d: 3 }, { weekEnding: '2026-10-18', accounts: 32, active30d: 4 }, { weekEnding: '2026-10-25', accounts: 34, active30d: 6 }],
  topTowns: [{ town: 'St Albans', actions: 3, users: 1 }], paying: { subscribed: 0, noExpiry: 2 },
}
const allMissing = {
  db: missing('MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE in the environment or .env.production'),
  vercel: missing('Vercel CLI login (vercel login) or VERCEL_TOKEN'),
  storeHealth: missing('App Store Connect key and Play service account'),
  appleAnalytics: { status: 'pending', note: 'first Apple data pending (no instances yet)' },
  playReports: missing('grant the service account bulk-report access and set PLAY_REPORTS_BUCKET'),
  posthog: missing('key file missing (~/.roam-posthog-key)'),
  revenuecat: missing('key file missing (~/.roam-revenuecat-key)'),
}

describe('render', () => {
  it('renders every section with nothing connected', () => {
    const { markdown, leak } = render(win, allMissing)
    expect(markdown).toMatch(/^# ROAM growth, 2026-W43 \(2026-10-19 to 2026-10-25, UTC\)/)
    const lines = markdown.split('\n')
    expect(lines[2]).toMatch(/^\*\*Target 1, 500 users by 1 Jan 2027:\*\* not connected/)
    expect(lines[3]).toMatch(/^\*\*Target 2, first AdMob payout:\*\* not connected: AdMob API OAuth needed \(or paste earnings/)
    expect(lines[3]).toContain('assumed £60')
    for (const h of ['## Funnel', '## Activity', '## Money', '## Store health', '## One thing to fix this week']) expect(markdown).toContain(h)
    expect(markdown).toContain('iOS store data: first Apple data pending')
    expect(markdown).toContain('Android store data: not connected: grant the service account bulk-report access and set PLAY_REPORTS_BUCKET')
    expect(markdown).toContain('(PostHog): not connected: key file missing')
    expect(markdown).toContain('RevenueCat (MRR, trials, subscriptions, churn): not connected: key file missing')
    expect(leak).toBeNull()
  })

  it('uses the DB proxy for target 1 until PostHog is connected, with computed pace', () => {
    const { markdown, goal } = render(win, { ...allMissing, db: dbOk })
    expect(goal).toMatchObject({ current: 6, daysLeft: 67 })
    expect(markdown).toContain('6 / 500 PROXY: accounts active in 30 days (DB) = 1.2%; 67 days left; needs +51.6/week')
    expect(markdown).toContain('last 4 weeks: 2 -> 3 -> 4 -> 6; 34 accounts total. Primary metric not connected: PostHog key file missing.')
    expect(markdown).toContain('Headline: 6 accounts active in 30 days, +2 this week vs +51.6 needed per week. Behind pace by 49.6.')
    expect(markdown).toContain('Weekly active accounts: **3 (+2, +200% vs last week)**')
    expect(markdown).toContain('| Swipes | 10 | 5 | 100% |')
    expect(markdown).toContain('| Places saved | 2 | 0 | new |')
    expect(markdown).toContain('| Sun | 10-18: 0 | 10-25: 2 |')
    expect(markdown).toContain('St Albans 3 (1 user)')
  })

  it('switches target 1 to PostHog people when connected, and shows funnel and retention', () => {
    const posthog = {
      status: 'ok', active30d: 120, trend: [{ active30d: 80 }, { active30d: 90 }, { active30d: 100 }, { active30d: 120 }],
      funnel: [{ label: 'App opened', event: '$pageview', value: 300 }, { label: 'First swipe', event: null, missing: 'no generic swipe event' }, { label: 'First save', event: 'place-saved', value: 60 }],
      day1: { rate: 0.25, base: 40, kept: 10 }, day7: null,
    }
    const { markdown } = render(win, { ...allMissing, db: dbOk, posthog })
    expect(markdown).toContain('120 / 500 unique people active in 30 days (PostHog, app + web) = 24.0%')
    expect(markdown).not.toContain('PROXY')
    expect(markdown).toContain('App opened 300 -> First swipe: not tracked (no generic swipe event) -> First save 60')
    expect(markdown).toContain('day 1 25.0% (10/40), day 7 n/a')
  })

  it('combines both stores into the funnel and picks the leak', () => {
    const s = {
      ...allMissing, db: dbOk,
      appleAnalytics: { status: 'ok', pageViews: { this: 200, prev: 150 }, firstTimeDownloads: { this: 10, prev: 8 } },
      playReports: { status: 'ok', listingVisitors: { this: 100, prev: 90 }, installs: { this: 20, prev: 12 } },
    }
    const f = buildFunnel(s)
    expect(f.map(x => [x.label, x.value, x.prev])).toEqual([['Store listing visitors', 300, 240], ['Installs', 30, 20], ['Signups', 2, 0], ['Activated', 1, 0]])
    const { markdown, leak } = render(win, s)
    expect(leak).toMatchObject({ kind: 'step', from: 'Installs', to: 'Signups' }) // 2/30 = 93.3% lost beats 30/300 = 90%
    expect(markdown).toContain('| Installs | 30 | 20 | 10.0% | iOS first-time downloads + Android user installs |')
    expect(markdown).toContain('**Installs -> Signups**: only 2 of 30 made it (6.7% conversion, 93.3% lost)')
  })

  it('labels one-store funnel steps', () => {
    const f = buildFunnel({ ...allMissing, appleAnalytics: { status: 'ok', pageViews: { this: 5, prev: 1 }, firstTimeDownloads: { this: 1, prev: 0 } } })
    expect(f[0]).toMatchObject({ value: 5, note: 'iOS only' })
  })

  it('flags subscriptions that are not on sale, loudly', () => {
    const storeHealth = {
      status: 'ok', errors: [], reviewsThisWeek: { count: 0, average: null }, latestReviews: [],
      notOnSale: [{ store: 'ios', product: 'premium_annual', state: 'WAITING_FOR_REVIEW', note: 'not on sale until approved' }],
      ios: { versions: [{ version: '1.3.17', state: 'WAITING_FOR_REVIEW' }], subs: [{ product: 'premium_annual', state: 'WAITING_FOR_REVIEW' }], rating: { average: 5, count: 2 } },
      android: null,
    }
    const { markdown } = render(win, { ...allMissing, storeHealth })
    expect(markdown).toContain('- **WARNING: ios subscription premium_annual is WAITING_FOR_REVIEW: not on sale until approved.**')
    expect(markdown).toContain('App Store rating (GB): 5 from 2 ratings')
  })

  it('shows MRR change against the previous report', () => {
    const revenuecat = { status: 'ok', mrr: 15, mrrUnit: '$', revenue28d: 40, activeTrials: 1, activeSubscriptions: 3, newCustomers28d: 9, churn: null }
    const { markdown } = render(win, { ...allMissing, revenuecat }, { previous: { sources: { revenuecat: { status: 'ok', mrr: 10 } } } })
    expect(markdown).toContain('MRR: $15 (+5 vs last report)')
    expect(markdown).toContain('Churn: not in the RevenueCat overview API')
    expect(markdown).toContain('| Paying (total, not weekly) | 3 |')
  })

  it('renders hand-entered AdMob earnings against the threshold', () => {
    const { markdown } = render(win, allMissing, { admob: { threshold: { gbp: 60, assumed: false }, earnings: 12.5, asOf: '2026-10-25' } })
    expect(markdown).toContain('**Target 2, first AdMob payout:** £12.50 of £60 = 20.8%, £47.50 to go (as of 2026-10-25, entered by hand).')
  })
})

describe('readAdmob', () => {
  const dir = mkdtempSync(join(tmpdir(), 'admob-'))
  it('env wins, then the file, else not connected; threshold assumed until set', () => {
    expect(readAdmob({}, join(dir, 'none.json'))).toEqual({ threshold: { gbp: 60, assumed: true }, earnings: null })
    writeFileSync(join(dir, 'admob.json'), JSON.stringify({ earningsToDateGBP: 3.2, asOf: '2026-10-20' }))
    expect(readAdmob({ ADMOB_THRESHOLD_GBP: '70' }, join(dir, 'admob.json'))).toMatchObject({ earnings: 3.2, asOf: '2026-10-20', threshold: { gbp: 70, assumed: false } })
    expect(readAdmob({ ADMOB_EARNINGS_GBP: '9' }, join(dir, 'admob.json'))).toMatchObject({ earnings: 9, source: 'ADMOB_EARNINGS_GBP' })
    writeFileSync(join(dir, 'confirmed.json'), JSON.stringify({ earningsToDateGBP: 0.14, thresholdGBP: 60, asOf: '2026-10-26' }))
    expect(readAdmob({}, join(dir, 'confirmed.json')).threshold).toEqual({ gbp: 60, assumed: false })
    expect(readAdmob({ ADMOB_THRESHOLD_GBP: '100' }, join(dir, 'confirmed.json')).threshold).toEqual({ gbp: 100, assumed: false })
    writeFileSync(join(dir, 'bad.json'), '{oops')
    expect(readAdmob({}, join(dir, 'bad.json')).earnings).toBeNull()
  })
})

describe('gather and main', () => {
  afterEach(() => { delete process.env.GROWTH_OUT_DIR; vi.restoreAllMocks() })
  it('a throwing source becomes an error line, the rest still render', async () => {
    const r = await gather(win, { a: { collect: async () => ({ status: 'ok', x: 1 }) }, b: { collect: async () => { throw new Error('Vercel 403 /v9') } } })
    expect(r).toEqual({ a: { status: 'ok', x: 1 }, b: { status: 'error', error: 'Vercel 403 /v9' } })
    expect(render(win, { ...allMissing, vercel: r.b }).markdown).toContain('Website (Vercel Web Analytics): error: Vercel 403 /v9')
  })
  it('writes <week>.md and <week>.json and prints the markdown', async () => {
    const out = mkdtempSync(join(tmpdir(), 'growth-out-'))
    process.env.GROWTH_OUT_DIR = out
    writeFileSync(join(out, '2026-W42.json'), JSON.stringify({ sources: { revenuecat: { status: 'ok', mrr: 1 } } }))
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const sources = Object.fromEntries(Object.entries({ ...allMissing, db: dbOk, revenuecat: { status: 'ok', mrr: 4, mrrUnit: '$' } }).map(([k, v]) => [k, { collect: async () => v }]))
    await main([], new Date('2026-10-26T07:00:00Z'), sources)
    const md = readFileSync(join(out, '2026-W43.md'), 'utf8')
    const j = JSON.parse(readFileSync(join(out, '2026-W43.json'), 'utf8'))
    expect(stdout.mock.calls[0][0]).toBe(md)
    expect(md).toContain('MRR: $4 (+3 vs last report)')
    expect(j.window.week).toBe('2026-W43')
    expect(j.sources.db.wau).toEqual({ this: 3, prev: 1 })
    expect(j.goal.current).toBe(6)
    expect(existsSync(join(out, 'admob.json'))).toBe(false)
  })
  it('--week picks an explicit week', async () => {
    const out = mkdtempSync(join(tmpdir(), 'growth-out-'))
    process.env.GROWTH_OUT_DIR = out
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await main(['--week', '2026-W40'], new Date(), Object.fromEntries(Object.entries(allMissing).map(([k, v]) => [k, { collect: async () => v }])))
    expect(readFileSync(join(out, '2026-W40.md'), 'utf8')).toMatch(/^# ROAM growth, 2026-W40 \(2026-09-28 to 2026-10-04/)
  })
})
