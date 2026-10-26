// PostHog: unique people active in 30 days (the 500-users target), the
// activation funnel and day-1/day-7 retention. Key: ~/.roam-posthog-key
// (personal API key, query:read). Project 176178 on the EU cloud by default.
//
// Event names are the ones the app actually sends (grep track( in src/):
//   app opened   = $pageview (automatic, one per route change, app + web)
//   first save   = place-saved (src/hooks/useSavedPlaces.js)
// NOT TRACKED, so they can't be funnel steps until the app sends them:
//   first swipe  (only 'ready-card-swiped' exists, for the ready card alone)
//   plan generated
import { readFileSync, existsSync } from 'node:fs'

const KEYFILE = `${process.env.HOME}/.roam-posthog-key`
const DAY = 86400000
export const FUNNEL = [
  { label: 'App opened', event: '$pageview' },
  { label: 'First swipe', event: null, missing: "no generic swipe event (add track('card-swiped') in Discover's swipe handler)" },
  { label: 'First save', event: 'place-saved' },
  { label: 'Plan generated', event: null, missing: "no plan event (add track('plan-generated') where a plan is created)" },
]

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
} = {}) {
  host = host.replace('.i.posthog.com', '.posthog.com').replace(/\/$/, '') // the query API lives on the dashboard host, not ingestion
  if (!key) return { status: 'missing', need: `key file missing (${KEYFILE}, a personal API key with query:read)` }
  const query = async q => {
    const r = await fetch(`${host}/api/projects/${project}/query/`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }) })
    const j = await r.json()
    if (!r.ok) throw new Error(`PostHog ${r.status}: ${(j.detail || JSON.stringify(j)).slice(0, 200)}`)
    return j
  }
  // Unique PEOPLE (person_id, which merges a device's anonymous id with its
  // account after identify) active in the 30 days before each of the last 4 week ends
  const ends = [3, 2, 1, 0].map(k => new Date(+win.end - k * 7 * DAY))
  const cols = ends.map(e => `count(DISTINCT if(timestamp >= toDateTime('${ts(new Date(+e - 30 * DAY))}') AND timestamp < toDateTime('${ts(e)}'), person_id, NULL))`)
  const hog = await query({ kind: 'HogQLQuery', query: `SELECT ${cols.join(', ')} FROM events WHERE timestamp >= toDateTime('${ts(new Date(+ends[0] - 30 * DAY))}') AND timestamp < toDateTime('${ts(win.end)}')` })
  const row = hog.results?.[0] || []
  const trend = ends.map((e, i) => ({ weekEnding: new Date(+e - DAY).toISOString().slice(0, 10), active30d: Number(row[i] ?? 0) }))

  const range = { date_from: win.start.toISOString(), date_to: new Date(+win.end - 1).toISOString() }
  const tracked = FUNNEL.filter(s => s.event)
  const funnel = await query({ kind: 'FunnelsQuery', dateRange: range, series: tracked.map(s => ({ kind: 'EventsNode', event: s.event })), funnelsFilter: { funnelWindowInterval: 7, funnelWindowIntervalUnit: 'day' } })
  const steps = (Array.isArray(funnel.results?.[0]) ? funnel.results[0] : funnel.results || []).map(s => s.count)
  const retention = await query({
    kind: 'RetentionQuery',
    dateRange: { date_from: new Date(+win.end - 14 * DAY).toISOString(), date_to: new Date(+win.end - 1).toISOString() },
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
