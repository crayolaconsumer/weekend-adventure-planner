/**
 * Cron: Discover Probe (synthetic monitor)
 *
 * Every ~30 min, hits the LIVE Discover path (the Overpass proxy) for a few
 * known-busy cities and checks it returns real places. If any city comes
 * back EMPTY or errors, it emails the operator — this auto-detects the exact
 * "Discover is empty" failure (degraded Overpass mirrors returning 200+empty,
 * poisoned cache, total outage) BEFORE paying users hit it. Every run is
 * recorded in cron_runs so the health history is visible.
 *
 * Auth mirrors the other crons: Vercel attaches `Authorization: Bearer
 * <CRON_SECRET>` to scheduled invocations; we also accept the x-vercel-cron
 * header. Side benefit: the probe warms the cache for these cities.
 */

export const config = { runtime: 'nodejs' }

import { recordCronRun } from '../lib/cronRuns.js'
import { sendEmail } from '../lib/email.js'
import { buildDiscoverOverpassQuery } from '../../shared/overpassQuery.js'

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

function isAuthorized(req) {
  if (req.headers['x-vercel-cron'] === '1') return true
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.authorization === `Bearer ${secret}`) return true
  return false
}

function getOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https'
  const host = req.headers['x-forwarded-host'] || req.headers.host
  return `${proto}://${host}`
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
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' })

  // Probe all cities in parallel so total time ~= the slowest single call,
  // staying well inside the function budget.
  const results = await Promise.all(PROBE_CITIES.map(c => probeCity(getOrigin(req), c)))
  const failures = results.filter(r => !r.ok)
  const healthy = results.length - failures.length

  if (failures.length > 0) {
    const detail = results
      .map(r => `${r.ok ? 'OK  ' : 'FAIL'} ${r.city}: ${r.ok ? `${r.count} places` : r.reason}`)
      .join('\n')
    try {
      await sendEmail({
        to: ALERT_EMAIL,
        subject: `[ROAM ALERT] Discover empty/failing in ${failures.length}/${results.length} probe cities`,
        text:
          `The synthetic Discover probe found the live POI path returning empty or errors.\n\n${detail}\n\n` +
          `This usually means degraded Overpass mirrors (200 + zero elements), a poisoned cache, or an outage. ` +
          `Check /api/places/overpass/nearby and the upstream mirror health. Discover may be empty for users in the FAIL cities.`,
      })
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
