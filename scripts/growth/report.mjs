#!/usr/bin/env node
/**
 * ROAM weekly growth report. One page for Monday: targets, funnel, activity,
 * money, store health and the one leak to fix. Every number is computed here
 * or in the per-source modules; missing credentials render as "not connected".
 *
 *   npm run growth:report                  last complete ISO week (UTC)
 *   npm run growth:report -- --week 2026-W43
 *
 * Writes Markdown to stdout and to $GROWTH_OUT_DIR (default /tmp/roam-growth)
 * as <ISO week>.md, with the raw numbers in <ISO week>.json next to it.
 * Read-only against every source. Never prints credentials.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { reportWindow, delta, pct, change, pickLeak, leakSentence, goalProgress, round } from './lib.mjs'
import * as db from './db.mjs'
import * as vercel from './vercel.mjs'
import * as storeHealth from './storeHealth.mjs'
import * as appleAnalytics from './appleAnalytics.mjs'
import * as playReports from './playReports.mjs'
import * as posthog from './posthog.mjs'
import * as revenuecat from './revenuecat.mjs'

export const SOURCES = { db, vercel, storeHealth, appleAnalytics, playReports, posthog, revenuecat }
const USERS_TARGET = 500
const USERS_DEADLINE = new Date('2027-01-01T00:00:00Z')

/** Run every source; a throw becomes { status: 'error' } so one bad source never sinks the page. */
export async function gather(win, sources = SOURCES, deps = {}) {
  const names = Object.keys(sources)
  const results = await Promise.allSettled(names.map(n => sources[n].collect(win, deps[n])))
  return Object.fromEntries(names.map((n, i) => [n, results[i].status === 'fulfilled' ? results[i].value : { status: 'error', error: String(results[i].reason?.message || results[i].reason) }]))
}

/** AdMob earnings to date, filled by hand until the AdMob API is connected. */
export function readAdmob(env = process.env, file = `${env.GROWTH_OUT_DIR || '/tmp/roam-growth'}/admob.json`) {
  const threshold = env.ADMOB_THRESHOLD_GBP ? { gbp: Number(env.ADMOB_THRESHOLD_GBP), assumed: false } : { gbp: 60, assumed: true }
  if (env.ADMOB_EARNINGS_GBP) return { threshold, earnings: Number(env.ADMOB_EARNINGS_GBP), asOf: env.ADMOB_EARNINGS_AS_OF || null, source: 'ADMOB_EARNINGS_GBP' }
  if (existsSync(file)) {
    try {
      const j = JSON.parse(readFileSync(file, 'utf8'))
      // A threshold read from AdMob > Payments into the file counts as confirmed (env still wins)
      const t = !env.ADMOB_THRESHOLD_GBP && Number.isFinite(Number(j.thresholdGBP)) ? { gbp: Number(j.thresholdGBP), assumed: false } : threshold
      if (Number.isFinite(Number(j.earningsToDateGBP))) return { threshold: t, earnings: Number(j.earningsToDateGBP), asOf: j.asOf || null, source: file }
    } catch { /* fall through to not connected */ }
  }
  return { threshold, earnings: null }
}

const ok = s => s?.status === 'ok'
const notOk = s => s?.status === 'missing' ? `not connected: ${s.need}`
  : s?.status === 'pending' ? s.note
  : s?.status === 'disabled' ? 'Web Analytics is not enabled for this project'
  : s?.status === 'error' ? `error: ${s.error}` : 'no data'
const sumParts = (...parts) => parts.some(p => p != null) ? parts.reduce((s, p) => s + (p ?? 0), 0) : null

/** The chained funnel; each step says which sources fed it. */
export function buildFunnel(s) {
  const apple = ok(s.appleAnalytics) ? s.appleAnalytics : null
  const play = ok(s.playReports) ? s.playReports : null
  const step = (label, a, p, note) => {
    const parts = [a && 'iOS', p && 'Android'].filter(Boolean)
    const val = k => sumParts(a?.[k], p?.[k])
    return { label, value: val('this'), prev: val('prev'), note: parts.length === 2 ? note : parts.length ? `${parts[0]} only` : null }
  }
  const d = ok(s.db) ? s.db : null
  return [
    step('Store listing visitors', apple?.pageViews, play?.listingVisitors, 'iOS page views + Android listing visitors'),
    step('Installs', apple?.firstTimeDownloads, play?.installs, 'iOS first-time downloads + Android user installs'),
    { label: 'Signups', value: d?.signups.this ?? null, prev: d?.signups.prev ?? null, note: 'new accounts' },
    { label: 'Activated', value: d?.activatedSignups.this ?? null, prev: d?.activatedSignups.prev ?? null, note: 'new accounts with 1+ action in their signup week' },
  ]
}

export function render(win, s, extra = {}) {
  const L = []
  const d = ok(s.db) ? s.db : null
  const ph = ok(s.posthog) ? s.posthog : null
  const rc = ok(s.revenuecat) ? s.revenuecat : null
  const admob = extra.admob || { threshold: { gbp: 60, assumed: true }, earnings: null }

  // --- Targets ---
  const usersTrend = ph ? ph.trend : d ? d.trend : null
  const cur = ph ? ph.active30d : d ? d.trend[3].active30d : null
  const goal = cur != null ? goalProgress(cur, USERS_TARGET, win.end, USERS_DEADLINE) : null
  const metricName = ph ? 'unique people active in 30 days (PostHog, app + web)' : 'PROXY: accounts active in 30 days (DB)'
  L.push(`# ROAM growth, ${win.week} (${win.start.toISOString().slice(0, 10)} to ${new Date(+win.end - 1).toISOString().slice(0, 10)}, UTC)`, '')
  L.push(goal
    ? `**Target 1, 500 users by 1 Jan 2027:** ${cur} / ${USERS_TARGET} ${metricName} = ${pct(goal.progress, 1)}; ${goal.daysLeft} days left; needs +${round(goal.perWeek ?? 0, 1)}/week (${goal.weeklyGrowth == null ? 'n/a' : pct(goal.weeklyGrowth, 1)} compound weekly growth); last 4 weeks: ${usersTrend.map(t => t.active30d).join(' -> ')}${!ph && d ? `; ${d.accountsTotal} accounts total` : ''}.${!ph ? ' Primary metric not connected: PostHog key file missing.' : ''}`
    : `**Target 1, 500 users by 1 Jan 2027:** not connected: PostHog key file and database both unavailable.`)
  const thr = `£${admob.threshold.gbp}${admob.threshold.assumed ? ' (assumed £60: confirm in AdMob > Payments and set ADMOB_THRESHOLD_GBP)' : ''}`
  L.push(admob.earnings != null
    ? `**Target 2, first AdMob payout:** £${admob.earnings.toFixed(2)} of ${thr} = ${pct(admob.earnings / admob.threshold.gbp, 1)}, £${Math.max(0, admob.threshold.gbp - admob.earnings).toFixed(2)} to go${admob.asOf ? ` (as of ${admob.asOf}, entered by hand)` : ' (entered by hand)'}.`
    : `**Target 2, first AdMob payout:** not connected: AdMob API OAuth needed (or paste earnings into ADMOB_EARNINGS_GBP or /tmp/roam-growth/admob.json as {"earningsToDateGBP": n, "thresholdGBP": n, "asOf": "YYYY-MM-DD"}). Threshold ${thr}.`)
  L.push('')

  // --- Headline: did the target metric move enough this week? ---
  if (usersTrend && goal) {
    const moved = usersTrend[3].active30d - usersTrend[2].active30d
    const need = goal.perWeek ?? 0
    L.push(`> **Headline: ${cur} ${ph ? 'people' : 'accounts'} active in 30 days, ${moved >= 0 ? '+' : ''}${moved} this week vs +${round(need, 1)} needed per week. ${moved >= need ? 'On pace.' : `Behind pace by ${round(need - moved, 1)}.`}**`, '')
  } else L.push('> **Headline: no user data connected.**', '')

  // --- Funnel ---
  const funnel = buildFunnel(s)
  L.push('## Funnel', '', '| Step | This week | Last week | From previous step | Source |', '|---|---:|---:|---:|---|')
  funnel.forEach((f, i) => {
    const prevStep = funnel.slice(0, i).reverse().find(x => x.value != null)
    const conv = prevStep && f.value != null && prevStep.value > 0 ? pct(f.value / prevStep.value, 1) : ''
    L.push(`| ${f.label} | ${f.value ?? 'n/a'} | ${f.prev ?? 'n/a'} | ${conv} | ${f.note || 'not connected'} |`)
  })
  const paying = rc ? rc.activeSubscriptions : d ? d.paying.subscribed : null
  L.push(`| Paying (total, not weekly) | ${paying ?? 'n/a'} | | | ${rc ? 'RevenueCat active subscriptions' : d ? 'DB premium with a live expiry' : 'not connected'} |`, '')
  if (!ok(s.appleAnalytics)) L.push(`- iOS store data: ${notOk(s.appleAnalytics)}`)
  if (!ok(s.playReports)) L.push(`- Android store data: ${notOk(s.playReports)}`)
  if (ph) {
    L.push('', '**In-app activation (PostHog, this week):** ' + ph.funnel.map(f => f.event ? `${f.label} ${f.value ?? 'n/a'}` : `${f.label}: not tracked (${f.missing})`).join(' -> '))
    L.push(`Retention (first $pageview cohorts, last 14 days): day 1 ${ph.day1 ? `${pct(ph.day1.rate, 1)} (${ph.day1.kept}/${ph.day1.base})` : 'n/a'}, day 7 ${ph.day7 ? `${pct(ph.day7.rate, 1)} (${ph.day7.kept}/${ph.day7.base})` : 'n/a'}`)
  } else L.push(`- In-app activation funnel and day-1/day-7 retention (PostHog): ${notOk(s.posthog)}`)
  if (ok(s.vercel)) {
    const v = s.vercel
    L.push(`- Website go-roam.uk: ${delta(v.visitors.this, v.visitors.prev)} visitors, ${v.pageviews.this} page views.${v.topPages.length ? ' Top pages: ' + v.topPages.map(p => `${p.path} (${p.pageviews})`).join(', ') + '.' : ''}${v.scriptInstalled === false && v.pageviews.this === 0 ? ' **Web Analytics is enabled but the site has no @vercel/analytics script, so it records nothing.**' : ''}`)
  } else L.push(`- Website (Vercel Web Analytics): ${notOk(s.vercel)}`)
  L.push('')

  // --- Activity ---
  L.push('## Activity', '')
  if (d) {
    L.push(`- Weekly active accounts: **${delta(d.wau.this, d.wau.prev)}** (active = swiped, saved, visited, rated, contributed, created a plan or followed someone; see scripts/growth/db.mjs)`)
    const label = { swipe: 'Swipes', save: 'Places saved', visit: 'Places visited', rating: 'Ratings', contribution: 'Contributions', plan: 'Plans created', follow: 'Follows' }
    L.push('', '| Action | This week | Last week | Change |', '|---|---:|---:|---:|')
    for (const [k, name] of Object.entries(label)) {
      const a = d.actions.this[k] || 0, b = d.actions.prev[k] || 0
      L.push(`| ${name} | ${a} | ${b} | ${b ? pct(change(a, b)) : a ? 'new' : '0'} |`)
    }
    const dates = Object.keys(d.signupsPerDay)
    L.push('', '| Signups by day | Last week | This week |', '|---|---:|---:|')
    for (let i = 0; i < 7; i++) {
      const p = dates[i], c = dates[i + 7]
      L.push(`| ${new Date(c + 'T00:00:00Z').toUTCString().slice(0, 3)} | ${p.slice(5)}: ${d.signupsPerDay[p]} | ${c.slice(5)}: ${d.signupsPerDay[c]} |`)
    }
    L.push(`| **Total** | **${d.signups.prev}** | **${d.signups.this}** |`, '')
    L.push(d.topTowns.length
      ? `- Top areas this week (saves + visits, nearest listed town): ${d.topTowns.map(t => `${t.town} ${t.actions} (${t.users} ${t.users === 1 ? 'user' : 'users'})`).join(', ')}`
      : '- Top areas this week: no saves or visits with a location.')
  } else L.push(`- ${notOk(s.db)}`)
  L.push('')

  // --- Money ---
  L.push('## Money', '')
  if (rc) {
    const prevRc = extra.previous?.sources?.revenuecat
    const mrrDelta = prevRc?.status === 'ok' && prevRc.mrr != null ? ` (${rc.mrr - prevRc.mrr >= 0 ? '+' : ''}${round(rc.mrr - prevRc.mrr)} vs last report)` : ''
    L.push(`- MRR: ${rc.mrrUnit}${rc.mrr ?? 'n/a'}${mrrDelta}; revenue last 28 days: ${rc.mrrUnit}${rc.revenue28d ?? 'n/a'}`)
    L.push(`- Active subscriptions ${rc.activeSubscriptions ?? 'n/a'}, active trials ${rc.activeTrials ?? 'n/a'}, new customers (28 days) ${rc.newCustomers28d ?? 'n/a'}`)
    L.push(`- Churn: ${rc.churn != null ? rc.churn : 'not in the RevenueCat overview API (see the Churn chart in the dashboard)'}`)
  } else L.push(`- RevenueCat (MRR, trials, subscriptions, churn): ${notOk(s.revenuecat)}`)
  if (d) L.push(`- DB: ${d.paying.subscribed} premium accounts with a live subscription expiry, ${d.paying.noExpiry} premium with no expiry (comped or lifetime, not paying through a store)`)
  L.push(`- AdMob: ${admob.earnings != null ? `£${admob.earnings.toFixed(2)} earned to date` : 'not connected (see Target 2)'}`, '')

  // --- Store health ---
  L.push('## Store health', '')
  const sh = s.storeHealth
  if (ok(sh)) {
    for (const x of sh.notOnSale) L.push(`- **WARNING: ${x.store} subscription ${x.product} is ${x.state}: ${x.note}.**`)
    if (sh.ios) {
      L.push(`- iOS versions: ${sh.ios.versions.map(v => `${v.version} ${v.state}`).join(', ') || 'none'}`)
      L.push(`- iOS subscriptions: ${sh.ios.subs.map(x => `${x.product} ${x.state}`).join(', ') || 'none'}`)
      L.push(`- App Store rating (GB): ${sh.ios.rating?.average != null ? `${round(sh.ios.rating.average, 2)} from ${sh.ios.rating.count} ratings` : 'no ratings yet'}`)
    }
    if (sh.android) {
      L.push(`- Android releases: ${sh.android.versions.map(v => `${v.track} ${v.version} ${v.status}${v.userFraction ? ` ${pct(v.userFraction)}` : ''}`).join(', ') || 'none'}`)
      L.push(`- Android subscriptions: ${sh.android.subs.map(x => `${x.product} ${x.state}`).join(', ') || 'none'}`)
      L.push('- Google Play rating: not available through the Play API (Play Console only)')
    }
    L.push(`- Reviews this week: ${sh.reviewsThisWeek.count}${sh.reviewsThisWeek.average != null ? `, average ${round(sh.reviewsThisWeek.average, 2)} stars` : ''} (Play's API only returns reviews with text from the last 7 days)`)
    for (const r of sh.latestReviews) L.push(`  - ${r.store} ${r.rating}* ${r.date.slice(0, 10)}: ${[r.title, r.body].filter(Boolean).join(' / ')}`)
    for (const e of sh.errors) L.push(`- error: ${e}`)
  } else L.push(`- ${notOk(sh)}`)
  L.push('')

  // --- One thing to fix ---
  const leak = pickLeak(funnel)
  L.push('## One thing to fix this week', '', leakSentence(leak), '')
  return { markdown: L.join('\n'), leak, goal, funnel }
}

export async function main(argv = process.argv.slice(2), now = new Date(), sources = SOURCES) {
  const i = argv.indexOf('--week')
  const win = reportWindow(now, i >= 0 ? argv[i + 1] : null)
  const out = process.env.GROWTH_OUT_DIR || '/tmp/roam-growth'
  const prevFile = `${out}/${win.prevWeek}.json`
  let previous = null
  try { if (existsSync(prevFile)) previous = JSON.parse(readFileSync(prevFile, 'utf8')) } catch { /* no comparison */ }
  const results = await gather(win, sources)
  const admob = readAdmob()
  const { markdown, leak, goal, funnel } = render(win, results, { admob, previous })
  mkdirSync(out, { recursive: true })
  writeFileSync(`${out}/${win.week}.md`, markdown + '\n')
  writeFileSync(`${out}/${win.week}.json`, JSON.stringify({ generatedAt: now.toISOString(), window: win, goal, funnel, leak, admob, sources: results }, null, 2) + '\n')
  process.stdout.write(markdown + '\n')
  process.stderr.write(`\nwrote ${out}/${win.week}.md and ${out}/${win.week}.json\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(e => { console.error(e.message); process.exit(1) })
}
