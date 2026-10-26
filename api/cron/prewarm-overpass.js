/**
 * Cron: Prewarm Overpass KV
 *
 * Starts a chained warmer for GB/IE city centres (the KV backup behind the
 * POI DB) and the world's most-visited city centres (shared/prewarmCities.mjs).
 * Each invocation warms one query, waits DELAY_BETWEEN_CALLS_MS, then
 * schedules the next invocation. This keeps Overpass traffic sequential
 * (one query in flight, ~400 a night) without one long-running function.
 */

export const config = {
  runtime: 'nodejs',
}

import { waitUntil } from '@vercel/functions'
import { recordCronRun } from '../lib/cronRuns.js'
import { buildDiscoverOverpassQuery } from '../../shared/overpassQuery.js'
import { appOrigin } from '../lib/origin.js'
import { isAuthorizedCron } from '../lib/cronAuth.js'
import { PREWARM_CITIES, ALL_RADII_SLUGS } from '../../shared/prewarmCities.mjs'

const JOB_NAME = 'overpass-prewarm'
// 4s between chained warm calls (was 1s). Warming 48 cities × 5 radii = 240
// queries from one Vercel egress IP at 1/s tripped Overpass's per-IP rate
// limit (a run failed ~236/240). 1 query / 4s stays under the burst threshold
// so the cache actually warms. The gap starts after the previous query has
// answered, so at most one query is in flight; ~400 queries finish in about 1.5 h from 3am.
export const DELAY_BETWEEN_CALLS_MS = 4000

// GB and Ireland: restored exactly as at HEAD (same cities, coordinates and all five radii).
// The POI DB answers these areas, but these warm copies are the KV backup for when it can't.
// Dublin was in HEAD's launch set; it is kept here with the same entry.
// ponytail: static GB/IE tiles (R2) are planned to replace this backup; until then it stays
const GB_IE_CITIES = [
  { name: 'London', lat: 51.5074, lng: -0.1278 },
  { name: 'Manchester', lat: 53.4808, lng: -2.2426 },
  { name: 'Birmingham', lat: 52.4862, lng: -1.8904 },
  { name: 'Edinburgh', lat: 55.9533, lng: -3.1883 },
  { name: 'Glasgow', lat: 55.8642, lng: -4.2518 },
  { name: 'Bristol', lat: 51.4545, lng: -2.5879 },
  { name: 'Leeds', lat: 53.8008, lng: -1.5491 },
  { name: 'Liverpool', lat: 53.4084, lng: -2.9916 },
  { name: 'Newcastle', lat: 54.9783, lng: -1.6178 },
  { name: 'Sheffield', lat: 53.3811, lng: -1.4701 },
  { name: 'Cambridge', lat: 52.2053, lng: 0.1218 },
  { name: 'Oxford', lat: 51.7520, lng: -1.2577 },
  { name: 'Brighton', lat: 50.8225, lng: -0.1372 },
  { name: 'Bath', lat: 51.3811, lng: -2.3590 },
  { name: 'York', lat: 53.9590, lng: -1.0815 },
  { name: 'Cardiff', lat: 51.4816, lng: -3.1791 },
  { name: 'Belfast', lat: 54.5973, lng: -5.9301 },
  { name: 'Nottingham', lat: 52.9548, lng: -1.1581 },
  { name: 'Norwich', lat: 52.6309, lng: 1.2974 },
  { name: 'Plymouth', lat: 50.3755, lng: -4.1427 },
  // Home-turf trio — the project owner's local area. Smaller towns
  // than the others but explicitly worth warming because the founder
  // tests from here and reload-perf complaints surface fastest from
  // these tiles. Worth adding similar local clusters when other
  // regions start seeing real user volume.
  { name: 'Luton', lat: 51.8787, lng: -0.4200 },
  { name: 'Dunstable', lat: 51.8859, lng: -0.5210 },
  { name: 'St Albans', lat: 51.7553, lng: -0.3360 },
  { name: 'Dublin', lat: 53.3498, lng: -6.2603 },
]

const RADII = [
  // Discover's first open: walking (the default travel mode), all categories
  { mode: 'walking', modeRadius: 5000, queryRadius: 5000 },
  { mode: 'transit', modeRadius: 15000, queryRadius: 15000 },
  { mode: 'driving', modeRadius: 30000, queryRadius: 30000 },
  // Discover's large-radius path renders first cards from a 35km
  // center tile, then streams outer 35km samples. Warming 75/150km
  // here would not match the client query or KV key.
  { mode: 'dayTrip', modeRadius: 75000, queryRadius: 35000 },
  { mode: 'explorer', modeRadius: 150000, queryRadius: 35000 },
]

// GB/IE and the world launch set at every radius, the first-open query (walking) for the rest
export const TARGETS = [...GB_IE_CITIES.map(c => ({ ...c, allRadii: true })), ...PREWARM_CITIES].flatMap(city =>
  (city.allRadii || ALL_RADII_SLUGS.has(city.slug) ? RADII : RADII.slice(0, 1)).map(mode => ({
    ...city,
    mode: mode.mode,
    modeRadius: mode.modeRadius,
    queryRadius: mode.queryRadius,
  })),
)

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))


function getIntParam(value, fallback = 0) {
  const parsed = parseInt(Array.isArray(value) ? value[0] : value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

async function recordRun({ sent, failed, errorMessage = null }) {
  await recordCronRun({
    jobName: JOB_NAME,
    eligibleCount: TARGETS.length,
    sentCount: sent,
    failedCount: failed,
    errorMessage,
  })
}

async function warmTarget(origin, target) {
  const { query } = buildDiscoverOverpassQuery(target.lat, target.lng, target.queryRadius, null)
  const response = await fetch(`${origin}/api/places/overpass/nearby`, {
    method: 'POST',
    // The bearer makes the proxy wait for Overpass instead of answering from a stale copy or
    // GeoApify and refreshing in the background, which would put several queries in flight
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.CRON_SECRET}` },
    body: JSON.stringify({ query }),
  })

  // Overpass said 429 (the proxy's header), or our own limiter did. Read whatever the status:
  // after a 429 the proxy can still answer 200 from a stale copy or a mirror's empty body, and
  // nearly every target has a stale copy, so a 200 with this header is the usual rate-limited case
  const rateLimited = response.status === 429 || response.headers.get('x-overpass-upstream') === 'rate-limited'
  if (!response.ok) {
    const err = new Error(`Proxy returned ${response.status}`)
    err.rateLimited = rateLimited
    throw err
  }

  return { cacheStatus: response.headers.get('x-overpass-cache') || 'UNKNOWN', rateLimited }
}

async function dispatchNext(origin, req, nextIndex, sent, failed, runId, streak = 0) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    const remaining = TARGETS.length - nextIndex
    await recordRun({
      sent,
      failed: failed + remaining,
      errorMessage: 'CRON_SECRET missing; prewarm chain could not continue',
    })
    return
  }

  const params = new URLSearchParams({
    index: String(nextIndex),
    sent: String(sent),
    failed: String(failed),
    runId,
    streak: String(streak),
  })

  try {
    const path = new URL(req.url, origin).pathname
    const response = await fetch(`${origin}${path}?${params}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${cronSecret}`,
      },
    })

    if (response.ok) return

    const remaining = TARGETS.length - nextIndex
    await recordRun({
      sent,
      failed: failed + remaining,
      errorMessage: `Prewarm chain dispatch failed at index ${nextIndex}`,
    })
  } catch (err) {
    const remaining = TARGETS.length - nextIndex
    await recordRun({
      sent,
      failed: failed + remaining,
      errorMessage: `Prewarm chain dispatch crashed at index ${nextIndex}: ${err?.message || err}`,
    })
  }
}

// Consecutive rate-limited warms that end the night's run: a 429 means Overpass wants us to
// back off, and the next ~400 queries would only make it worse. The cache stays as it is.
export const STOP_AFTER_RATE_LIMITED = 3

async function processOne(req, origin, index, sent, failed, runId, streak = 0) {
  const target = TARGETS[index]
  let nextSent = sent
  let nextFailed = failed
  // Rate-limited warms in a row: a 429 adds one, a real warm resets it, any other failure (a
  // timeout, a 503) leaves it as it is, since a rate-limiting Overpass mixes 429s with timeouts
  let nextStreak = streak

  try {
    const { cacheStatus, rateLimited } = await warmTarget(origin, target)
    nextSent++
    nextStreak = rateLimited ? streak + 1 : 0
    console.log(
      `[cron] ${JOB_NAME} warmed ${target.name} ${target.mode} ${target.queryRadius}m query (${cacheStatus})`,
    )
  } catch (err) {
    nextFailed++
    if (err?.rateLimited) nextStreak = streak + 1
    console.error(
      `[cron] ${JOB_NAME} failed ${target.name} ${target.mode} ${target.queryRadius}m query:`,
      err?.message || err,
    )
  }

  const nextIndex = index + 1
  if (nextStreak >= STOP_AFTER_RATE_LIMITED) {
    await recordRun({
      sent: nextSent,
      failed: nextFailed + (TARGETS.length - nextIndex),
      errorMessage: `Stopped at index ${nextIndex}: Overpass rate-limited ${nextStreak} warms in a row`,
    })
    return
  }
  if (nextIndex >= TARGETS.length) {
    await recordRun({
      sent: nextSent,
      failed: nextFailed,
      errorMessage: nextFailed > 0 ? `${nextFailed} Overpass prewarm queries failed` : null,
    })
    return
  }

  await delay(DELAY_BETWEEN_CALLS_MS)
  await dispatchNext(origin, req, nextIndex, nextSent, nextFailed, runId, nextStreak)
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!isAuthorizedCron(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const index = Math.max(0, getIntParam(req.query.index, 0))
  const sent = Math.max(0, getIntParam(req.query.sent, 0))
  const failed = Math.max(0, getIntParam(req.query.failed, 0))
  const runId = String(req.query.runId || new Date().toISOString().slice(0, 10))
  const streak = Math.max(0, getIntParam(req.query.streak, 0))

  if (index >= TARGETS.length) {
    await recordRun({ sent, failed })
    return res.status(200).json({ success: true, runId, total: TARGETS.length, sent, failed })
  }

  const origin = appOrigin(req)
  waitUntil(
    processOne(req, origin, index, sent, failed, runId, streak).catch(err => {
      console.error(`[cron] ${JOB_NAME} step crashed:`, err?.message || err)
    }),
  )

  return res.status(202).json({
    success: true,
    message: 'Overpass prewarm step accepted',
    runId,
    index,
    total: TARGETS.length,
    target: {
      city: TARGETS[index].name,
      mode: TARGETS[index].mode,
      modeRadius: TARGETS[index].modeRadius,
      queryRadius: TARGETS[index].queryRadius,
    },
  })
}
