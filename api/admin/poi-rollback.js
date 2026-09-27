/**
 * GET/POST /api/admin/poi-rollback
 *
 * GET: the last 10 POI builds (status, counts, freshness) for the admin.
 * POST: put the previous build back live with one atomic RENAME. The build
 * being replaced is kept as pois_failed / poi_photos_failed for inspection
 * until the next rollback. Only one step back exists (pois_prev); anything
 * older is re-loaded from its GitHub Release with scripts/poi/load.mjs.
 *
 * Holds the same GET_LOCK as the loader (never during a load or swap), runs
 * the DDL with lock_wait_timeout 5 s (a timeout is 503 + Retry-After), and
 * sets poi_builds from the tables' COMMENTs via reconcile(), the same repair
 * that fixes a crash between RENAME and UPDATE.
 *
 * Same security posture as every /api/admin/* route (guardAdmin: 404 on
 * every reject, IP rate limit, Origin/Referer gate, is_admin).
 */

import { randomUUID } from 'node:crypto'
import { withCors } from '../lib/cors.js'
import { guardAdmin } from '../lib/adminGuard.js'
import { withPoiLock, reconcile, recover, flushPoiGen, BUILD_RE, q, q1, u } from './poi-load.js'

export const ROLLBACK_SQL = [
  'DROP TABLE IF EXISTS pois_failed, poi_photos_failed',
  'RENAME TABLE pois TO pois_failed, pois_prev TO pois, poi_photos TO poi_photos_failed, poi_photos_prev TO poi_photos',
]

class Busy extends Error {}

async function handler(req, res) {
  if (!(await guardAdmin(req, res, { key: 'admin-poi-rollback-ip' }))) return

  if (req.method === 'GET') {
    const builds = await q(
      `SELECT build_id, status, row_count, photo_count, chunks_loaded, chunks_total, osm_timestamp, activated_at, created_at
       FROM poi_builds ORDER BY created_at DESC LIMIT 10`)
    return res.status(200).json({ builds })
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' })

  try {
    const out = await withPoiLock(async conn => {
      const before = await recover()
      // A real previous build only: after the very first swap pois_prev holds the
      // empty migration tables (no COMMENT), and "rolling back" would blank Discover
      const owners = Object.fromEntries((await q(
        `SELECT table_name AS name, table_comment AS owner FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_name IN ('pois_prev', 'poi_photos_prev')`)).map(r => [r.name, r.owner]))
      const prevId = owners.pois_prev
      if (!BUILD_RE.test(prevId || '') || owners.poi_photos_prev !== prevId) return null
      const prevRow = await q1('SELECT status FROM poi_builds WHERE build_id = ?', [prevId])
      if (prevRow?.status !== 'previous') return null
      // Set before the RENAME: if we die after it, the next call still invalidates caches
      await u('UPDATE poi_builds SET gen_pending = 1 WHERE build_id = ?', [prevId])
      try {
        for (const sql of ROLLBACK_SQL) await conn.query(sql)
      } catch (err) {
        if (err?.errno === 1205 || err?.code === 'ER_LOCK_WAIT_TIMEOUT') throw new Busy()
        throw err
      }
      const active = await reconcile()
      return { rolled_back: before, active, poi_gen: await flushPoiGen(`rollback to ${active}`) }
    })
    if (!out) return res.status(409).json({ error: 'No previous build to roll back to' })
    return res.status(200).json(out)
  } catch (err) {
    if (err instanceof Busy) {
      res.setHeader('Retry-After', '5')
      return res.status(503).json({ error: 'Rollback waited too long for readers; try again', retry: true })
    }
    if (err?.status === 409 || err?.status === 503) {
      if (err.status === 503) res.setHeader('Retry-After', '5')
      return res.status(err.status).json({ error: err.message, retry: true })
    }
    const requestId = randomUUID()
    console.error(`[poi-rollback] ${requestId}`, err)
    return res.status(500).json({ error: 'Rollback failed', request_id: requestId })
  }
}

export default withCors(handler)
