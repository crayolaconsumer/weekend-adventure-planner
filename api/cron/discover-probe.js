/**
 * Cron: Discover Probe (synthetic monitor)
 *
 * Every 2 hours, hits the LIVE Discover path (the Overpass proxy) for a few
 * known-busy cities (2 per run, rotating) and checks it returns real places. If any city comes
 * back EMPTY or errors, it emails the operator — this auto-detects the exact
 * "Discover is empty" failure (degraded Overpass mirrors returning 200+empty,
 * poisoned cache, total outage) BEFORE paying users hit it. Every run is
 * recorded in cron_runs so the health history is visible.
 *
 * Auth: the Bearer CRON_SECRET Vercel attaches to scheduled runs
 * (lib/cronAuth.js). Side benefit: the probe warms the cache for these cities.
 */

export const config = { runtime: 'nodejs' }

import { recordCronRun } from '../lib/cronRuns.js'
import { sendEmail } from '../lib/email.js'
import { buildDiscoverOverpassQuery } from '../../shared/overpassQuery.js'
import { appOrigin } from '../lib/origin.js'
import { cacheGet, cacheSet } from '../lib/kvCache.js'
import { isAuthorizedCron } from '../lib/cronAuth.js'

const ALERT_THROTTLE_KEY = 'alert:discover-probe'

const JOB_NAME = 'discover-probe'
const ALERT_EMAIL = process.env.MODERATION_ALERT_EMAIL || 'fittonj@gmail.com'
const PROBE_RADIUS = 5000
const PROBE_TIMEOUT_MS = 50000

// Cities that MUST return places when Discover is healthy. A 0 here is a
// real signal, never a genuinely-empty area.
const PROBE_CITIES = [
  { name: 'London', lat: 51.5074, lng: -0.1278 },
  { name: 'New York', lat: 40.758, lng: -73.9855 },
  { name: 'Paris', lat: 48.8566, lng: 2.3522 },
  { name: 'Tokyo', lat: 35.6895, lng: 139.6917 },
]

// Two cities per run, rotating by 2-hour slot, so each city is still probed
// every 4 hours at half the Overpass load of probing all four every run
export const CITIES_PER_RUN = 2
export function citiesForRun(now = Date.now()) {
  const slot = Math.floor(now / (2 * 60 * 60 * 1000))
  const start = (slot * CITIES_PER_RUN) % PROBE_CITIES.length
  return PROBE_CITIES.slice(start, start + CITIES_PER_RUN)
}


async function probeCity(origin, city) {
  const { query } = buildDiscoverOverpassQuery(city.lat, city.lng, PROBE_RADIUS, null)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const response = await fetch(`${origin}/api/places/overpass/nearby`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    })
    if (!response.ok) return { city: city.name, ok: false, reason: `HTTP ${response.status}` }
    const data = await response.json()
    const count = Array.isArray(data.elements) ? data.elements.length : 0
    if (count === 0) return { city: city.name, ok: false, reason: '0 elements (Discover would be empty here)' }
    return { city: city.name, ok: true, count }
  } catch (err) {
    return { city: city.name, ok: false, reason: err.name === 'AbortError' ? 'timeout' : err.message || 'error' }
  } finally {
    clearTimeout(timeoutId)
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!isAuthorizedCron(req)) return res.status(401).json({ error: 'Unauthorized' })

  // Probe all cities in parallel so total time ~= the slowest single call,
  // staying well inside the function budget.
  const results = await Promise.all(citiesForRun().map(c => probeCity(appOrigin(req), c)))
  const failures = results.filter(r => !r.ok)
  const healthy = results.length - failures.length

  // Only EMAIL when both of this run's probe cities fail: a single-city blip is
  // usually a transient Overpass wobble that self-heals, and paging on every
  // one is noise (especially during a launch). Every run is still recorded in
  // cron_runs below, so the full health history is preserved either way.
  // At most one email per 6h, or a long outage would email every run
  const recentlyAlerted = failures.length >= 2 && await cacheGet(ALERT_THROTTLE_KEY).catch(() => null)
  if (failures.length >= 2 && !recentlyAlerted) {
    const detail = results
      .map(r => `${r.ok ? 'OK  ' : 'FAIL'} ${r.city}: ${r.ok ? `${r.count} places` : r.reason}`)
      .join('\n')
    try {
      const { sent } = await sendEmail({
        to: ALERT_EMAIL,
        subject: `[ROAM ALERT] Discover empty/failing in ${failures.length}/${results.length} probe cities`,
        text:
          `The synthetic Discover probe found the live POI path returning empty or errors.\n\n${detail}\n\n` +
          `This usually means degraded Overpass mirrors (200 + zero elements), a poisoned cache, or an outage. ` +
          `Check /api/places/overpass/nearby and the upstream mirror health. Discover may be empty for users in the FAIL cities.`,
      })
      // Throttle only after a real send, so a failed send doesn't mute the next alert
      if (sent) await cacheSet(ALERT_THROTTLE_KEY, { at: Date.now() }, 6 * 60 * 60).catch(() => {})
    } catch (err) {
      console.error('[discover-probe] alert email failed:', err?.message || err)
    }
  }

  await recordCronRun({
    jobName: JOB_NAME,
    eligibleCount: results.length,
    sentCount: healthy,
    failedCount: failures.length,
    errorMessage: failures.length ? failures.map(f => `${f.city}:${f.reason}`).join('; ').slice(0, 500) : null,
  }).catch(err => console.error('[discover-probe] recordCronRun failed:', err?.message || err))

  return res.status(failures.length ? 503 : 200).json({ job: JOB_NAME, healthy, failed: failures.length, results })
}
