/**
 * GET /api/health
 *
 * Lightweight health-check endpoint for external uptime monitoring.
 *
 * Checks:
 *   - DB:  testConnection() (SELECT 1). If it fails, the app is degraded.
 *   - KV:  a cheap read via kvCache. KV is a SOFT layer — if it isn't
 *          provisioned we report 'disabled' (not a failure); a read error
 *          on a provisioned store reports 'fail' but does NOT degrade the
 *          endpoint, since the app functions without KV.
 *
 * Each check is guarded by a ~2s timeout so the endpoint itself never
 * hangs waiting on a wedged dependency. Responses are never cached.
 *
 * Status codes:
 *   200 { status: 'ok',       db: 'ok',   kv: 'ok'|'fail'|'disabled', ts }
 *   503 { status: 'degraded', db: 'fail', kv: ...,                    ts }
 */

import { testConnection } from './lib/db.js'
import { isCacheEnabled, cacheGet } from './lib/kvCache.js'

const CHECK_TIMEOUT_MS = 2000

// Resolve to `fallback` if `promise` doesn't settle within `ms`, so a
// hung dependency can't stall the health response. Any rejection is also
// folded into `fallback` — health checks should never throw.
function withTimeout(promise, ms, fallback) {
  return Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ])
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // DB: testConnection() returns a boolean and never throws, but guard it
  // with a timeout anyway in case the underlying connect/query wedges.
  const dbOk = await withTimeout(testConnection(), CHECK_TIMEOUT_MS, false)

  // KV: not provisioned → 'disabled'. Otherwise probe with a cheap read.
  // cacheGet fails open (returns null on error), so distinguish a genuine
  // read failure by racing a sentinel: if the probe out-times or throws we
  // mark it 'fail', but this never affects the overall status.
  let kv = 'disabled'
  if (isCacheEnabled()) {
    const FAIL = Symbol('kv-fail')
    const probe = cacheGet('healthcheck').then(
      () => 'ok',
      () => FAIL
    )
    const result = await withTimeout(probe, CHECK_TIMEOUT_MS, FAIL)
    kv = result === FAIL ? 'fail' : 'ok'
  }

  const ts = new Date().toISOString()

  if (!dbOk) {
    return res.status(503).json({ status: 'degraded', db: 'fail', kv, ts })
  }

  return res.status(200).json({ status: 'ok', db: 'ok', kv, ts })
}

export default handler
