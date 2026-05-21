/**
 * Cron: Prewarm Overpass KV
 *
 * Starts a chained warmer for popular UK city centers across all Discover
 * travel-mode radii. Each invocation warms one query, waits one second,
 * then schedules the next invocation. This keeps Overpass traffic
 * sequential without requiring one long-running 35 minute function.
 */

export const config = {
  runtime: 'nodejs',
}

import { waitUntil } from '@vercel/functions'
import { recordCronRun } from '../lib/cronRuns.js'
import { buildDiscoverOverpassQuery } from '../../shared/overpassQuery.js'

const JOB_NAME = 'overpass-prewarm'
const DELAY_BETWEEN_CALLS_MS = 1000

const CITIES = [
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
]

const RADII = [
  { mode: 'walking', modeRadius: 5000, queryRadius: 5000 },
  { mode: 'transit', modeRadius: 15000, queryRadius: 15000 },
  { mode: 'driving', modeRadius: 30000, queryRadius: 30000 },
  // Discover's large-radius path renders first cards from a 35km
  // center tile, then streams outer 35km samples. Warming 75/150km
  // here would not match the client query or KV key.
  { mode: 'dayTrip', modeRadius: 75000, queryRadius: 35000 },
  { mode: 'explorer', modeRadius: 150000, queryRadius: 35000 },
]

const TARGETS = CITIES.flatMap(city =>
  RADII.map(mode => ({
    ...city,
    mode: mode.mode,
    modeRadius: mode.modeRadius,
    queryRadius: mode.queryRadius,
  })),
)

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

function isAuthorized(req) {
  const authHeader = req.headers.authorization
  const cronSecret = process.env.CRON_SECRET
  const isVercelCron = req.headers['x-vercel-cron'] === '1'

  if (isVercelCron) return true
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true
  return false
}

function getOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https'
  const host = req.headers['x-forwarded-host'] || req.headers.host
  return `${proto}://${host}`
}

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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })

  if (!response.ok) {
    throw new Error(`Proxy returned ${response.status}`)
  }

  return response.headers.get('x-overpass-cache') || 'UNKNOWN'
}

async function dispatchNext(origin, req, nextIndex, sent, failed, runId) {
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

async function processOne(req, origin, index, sent, failed, runId) {
  const target = TARGETS[index]
  let nextSent = sent
  let nextFailed = failed

  try {
    const cacheStatus = await warmTarget(origin, target)
    nextSent++
    console.log(
      `[cron] ${JOB_NAME} warmed ${target.name} ${target.mode} ${target.queryRadius}m query (${cacheStatus})`,
    )
  } catch (err) {
    nextFailed++
    console.error(
      `[cron] ${JOB_NAME} failed ${target.name} ${target.mode} ${target.queryRadius}m query:`,
      err?.message || err,
    )
  }

  const nextIndex = index + 1
  if (nextIndex >= TARGETS.length) {
    await recordRun({
      sent: nextSent,
      failed: nextFailed,
      errorMessage: nextFailed > 0 ? `${nextFailed} Overpass prewarm queries failed` : null,
    })
    return
  }

  await delay(DELAY_BETWEEN_CALLS_MS)
  await dispatchNext(origin, req, nextIndex, nextSent, nextFailed, runId)
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const index = Math.max(0, getIntParam(req.query.index, 0))
  const sent = Math.max(0, getIntParam(req.query.sent, 0))
  const failed = Math.max(0, getIntParam(req.query.failed, 0))
  const runId = String(req.query.runId || new Date().toISOString().slice(0, 10))

  if (index >= TARGETS.length) {
    await recordRun({ sent, failed })
    return res.status(200).json({ success: true, runId, total: TARGETS.length, sent, failed })
  }

  const origin = getOrigin(req)
  waitUntil(
    processOne(req, origin, index, sent, failed, runId).catch(err => {
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
