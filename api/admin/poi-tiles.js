/**
 * GET /api/admin/poi-tiles[?n=10]
 *
 * R2 read latency as THIS function sees it (Vercel lhr1, not a home Mac), for the
 * static POI tiles (api/lib/poiTiles.js). Sequential reads through the serving store
 * (the same read-only r2Store, same timeouts), each timed:
 *   current  - current.json (small object, uncached)
 *   header   - a block header (825-byte Range GET), n blocks spread over the build
 *   cell     - the largest cell of each of those blocks (a typical body Range GET)
 * -> { region, build, n, current_ms, header: { p50, p90, max }, cell: { p50, p90, max, bytes_p50 }, errors }
 * About 1 + 2n Class B reads per call (n <= 30). Never returns credentials or keys.
 *
 * Auth as /api/admin/poi-load: `Authorization: Bearer <POI_LOAD_SECRET>`, or an admin session.
 * 503 when R2 is not configured on this deployment (R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 * R2_ENDPOINT, R2_BUCKET, R2_PREFIX).
 */
import { withCors } from '../lib/cors.js'
import { guardAdmin } from '../lib/adminGuard.js'
import { hasBearer } from '../lib/cronAuth.js'
import { tilesStore, loadManifest } from '../lib/poiTiles.js'
import { blockKey, decodeHeader, HEADER_BYTES } from '../../shared/poiTiles.mjs'

const pct = (xs, f) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.min(s.length - 1, Math.floor(f * s.length))] : null
}
const stats = xs => ({ p50: pct(xs, 0.5), p90: pct(xs, 0.9), max: xs.length ? Math.max(...xs) : null, samples: xs.length })

async function timed(fn) {
  const t = performance.now()
  const value = await fn()
  return { value, ms: Math.round(performance.now() - t) }
}

async function handler(req, res) {
  if (!hasBearer(req, process.env.POI_LOAD_SECRET) && !(await guardAdmin(req, res, { key: 'admin-poi-tiles-ip' }))) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' })
  const store = tilesStore()
  if (!store) return res.status(503).json({ error: 'R2 not configured on this deployment' })
  const n = Math.min(30, Math.max(1, Number.parseInt(req.query?.n, 10) || 10))
  const errors = []
  try {
    const current = await timed(() => store.get('current.json'))
    if (!current.value) return res.status(503).json({ error: 'No current.json under R2_PREFIX' })
    const m = await loadManifest(store)
    const ids = Object.keys(m.blocks).map(Number).sort((a, b) => a - b)
    const pick = Array.from({ length: Math.min(n, ids.length) }, (_, i) => ids[Math.floor((i * ids.length) / Math.min(n, ids.length))])
    const header = []
    const cell = []
    const bytes = []
    for (const b of pick) {
      const key = blockKey(b, m.blocks[b])
      try {
        const h = await timed(() => store.getRange(key, 0, HEADER_BYTES - 1))
        header.push(h.ms)
        const big = decodeHeader(h.value).cells.reduce((x, c) => (c.length > x.length ? c : x), { length: 0 })
        if (!big.length) continue
        const c = await timed(() => store.getRange(key, HEADER_BYTES + big.offset, HEADER_BYTES + big.offset + big.length - 1))
        cell.push(c.ms)
        bytes.push(c.value.length)
      } catch (err) {
        errors.push(err.message)
      }
    }
    return res.status(200).json({
      region: process.env.VERCEL_REGION || null, build: m.build_id, n: pick.length, current_ms: current.ms,
      header: stats(header), cell: { ...stats(cell), bytes_p50: pct(bytes, 0.5) }, errors,
    })
  } catch (err) {
    // r2Store errors carry the status and S3 code only, never request headers
    return res.status(502).json({ error: err.message })
  }
}

export default withCors(handler)
