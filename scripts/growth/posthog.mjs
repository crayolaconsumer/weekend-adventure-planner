// PostHog: unique people active in 30 days (the 500-users target), the
// activation funnel and day-1/day-7 retention. Key: ~/.roam-posthog-key
// (personal API key, query:read). Project 176178 on the EU cloud by default.
//
// Event names are the ones the app actually sends (grep track( in src/):
//   app opened     = $pageview (automatic, one per route change, app + web)
//   first swipe    = card-swiped (src/pages/Discover.jsx, from 7b9fd6e)
//   first save     = place-saved (src/hooks/useSavedPlaces.js)
//   plan generated = plan-generated (src/pages/Plan.jsx, from 7b9fd6e)
//
// Real people only: every query drops server-side town_page_view events (crawlers,
// no browser), headless crawlers on desktop Linux, Android emulators (by user agent) and the person ids listed one per
// line in ~/.roam-test-persons (iOS Simulator UAs look like real iPhones).
import { readFileSync, existsSync } from 'node:fs'

const KEYFILE = `${process.env.HOME}/.roam-posthog-key`
const TESTFILE = `${process.env.HOME}/.roam-test-persons`
const DAY = 86400000
export const FUNNEL = [
  { label: 'App opened', event: '$pageview' },
  { label: 'First swipe', event: 'card-swiped' },
  { label: 'First save', event: 'place-saved' },
  { label: 'Plan generated', event: 'plan-generated' },
]

/** Pure: HogQL condition that keeps real people's events only (see header). */
export function realPeople(testPersons = []) {
  const ids = testPersons.filter(id => /^[0-9a-f-]{36}$/i.test(id))
  return [
    "event != 'town_page_view'",
    "NOT match(coalesce(properties.$raw_user_agent, ''), 'sdk_gphone|Android SDK built for|Emulator')",
    // ponytail: a headless US crawler fleet (Linux Chrome, one hit per id, ~200 ids/month in
    // Oct 2026) runs our JS; dropping desktop Linux also drops a few real Linux users. Use a
    // proper bot signal (e.g. Vercel BotID) if Linux humans ever matter.
    "coalesce(properties.$os, '') != 'Linux'",
    ...(ids.length ? [`toString(person_id) NOT IN (${ids.map(id => `'${id}'`).join(', ')})`] : []),
  ].join(' AND ')
}

const ts = d => d.toISOString().replace('T', ' ').slice(0, 19)

/** Pure: day-N retention from RetentionQuery cohorts, over cohorts old enough to have day N. */
export function retentionRate(cohorts, n) {
  let base = 0, kept = 0
  for (const c of cohorts || []) {
    const v = c.values || []
    if (v.length > n) { base += v[0]?.count || 0; kept += v[n]?.count || 0 }
  }
  return base ? { rate: kept / base, base, kept } : null
}

export async function collect(win, {
  fetch = globalThis.fetch,
  key = existsSync(KEYFILE) ? readFileSync(KEYFILE, 'utf8').trim() : null,
  project = process.env.POSTHOG_PROJECT_ID || '176178',
  host = process.env.POSTHOG_HOST || 'https://eu.posthog.com',
  testPersons = existsSync(TESTFILE) ? readFileSync(TESTFILE, 'utf8').split('\n').map(l => l.trim()).filter(Boolean) : [],
} = {}) {
  host = host.replace('.i.posthog.com', '.posthog.com').replace(/\/$/, '') // the query API lives on the dashboard host, not ingestion
  if (!key) return { status: 'missing', need: `key file missing (${KEYFILE}, a personal API key with query:read)` }
  const query = async q => {
    const r = await fetch(`${host}/api/projects/${project}/query/`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }) })
    const j = await r.json()
    if (!r.ok) throw new Error(`PostHog ${r.status}: ${(j.detail || JSON.stringify(j)).slice(0, 200)}`)
    return j
  }
  const real = realPeople(testPersons)
  const properties = [{ type: 'hogql', key: real }]
  // Unique PEOPLE (person_id, which merges a device's anonymous id with its
  // account after identify) active in the 30 days before each of the last 4 week ends
  const ends = [3, 2, 1, 0].map(k => new Date(+win.end - k * 7 * DAY))
  const cols = ends.map(e => `count(DISTINCT if(timestamp >= toDateTime('${ts(new Date(+e - 30 * DAY))}') AND timestamp < toDateTime('${ts(e)}'), person_id, NULL))`)
  const hog = await query({ kind: 'HogQLQuery', query: `SELECT ${cols.join(', ')} FROM events WHERE timestamp >= toDateTime('${ts(new Date(+ends[0] - 30 * DAY))}') AND timestamp < toDateTime('${ts(win.end)}') AND ${real}` })
  const row = hog.results?.[0] || []
  const trend = ends.map((e, i) => ({ weekEnding: new Date(+e - DAY).toISOString().slice(0, 10), active30d: Number(row[i] ?? 0) }))

  const range = { date_from: win.start.toISOString(), date_to: new Date(+win.end - 1).toISOString() }
  const tracked = FUNNEL.filter(s => s.event)
  const funnel = await query({ kind: 'FunnelsQuery', dateRange: range, properties, series: tracked.map(s => ({ kind: 'EventsNode', event: s.event })), funnelsFilter: { funnelWindowInterval: 7, funnelWindowIntervalUnit: 'day' } })
  const steps = (Array.isArray(funnel.results?.[0]) ? funnel.results[0] : funnel.results || []).map(s => s.count)
  const retention = await query({
    kind: 'RetentionQuery',
    dateRange: { date_from: new Date(+win.end - 14 * DAY).toISOString(), date_to: new Date(+win.end - 1).toISOString() },
    properties,
    retentionFilter: { period: 'Day', totalIntervals: 8, retentionType: 'retention_first_time', targetEntity: { id: '$pageview', type: 'events' }, returningEntity: { id: '$pageview', type: 'events' } },
  })
  return {
    status: 'ok',
    active30d: trend[3].active30d,
    trend,
    funnel: FUNNEL.map(s => ({ label: s.label, event: s.event, missing: s.missing || null, value: s.event ? (steps[tracked.indexOf(s)] ?? null) : null })),
    day1: retentionRate(retention.results, 1),
    day7: retentionRate(retention.results, 7),
  }
}
