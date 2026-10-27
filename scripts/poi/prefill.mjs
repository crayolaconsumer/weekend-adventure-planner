#!/usr/bin/env node
/**
 * Prefill the shared full-answer cache for known incident queries.
 *
 * Answers the named queries from the active POI build (no public Overpass,
 * no worldwide scan) and writes each complete answer to the KV shared cache,
 * so the next caller for that query serves in ~100 ms. Reuses the exact
 * client query builder + snapping + DB path, so the cache key matches what
 * the phone sends.
 *
 *   node scripts/poi/prefill.mjs --dry-run     # show what would be written
 *   node scripts/poi/prefill.mjs               # write to KV
 *
 * Needs the same DB + KV env as the API (MYSQL_*, KV_REST_API_URL/TOKEN).
 * Exit 0 ok, 1 a query failed, 2 bad usage.
 */
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { buildDiscoverOverpassQuery } from '../../shared/overpassQuery.js'
import { snapQueryBbox } from '../../api/lib/bboxSnap.js'
import { parseQuery, getPois, getPoiGen } from '../../api/lib/poiQuery.js'
import { cacheSet, isCacheEnabled, sharedAnswerKey, SHARED_ANSWER_TTL_SECONDS } from '../../api/lib/kvCache.js'

// The 28 Sep incident: Sandridge, Driving, historical 20 km and current 30 km.
const DEFAULT_QUERIES = [
  { name: 'Sandridge 20 km', lat: 51.7866, lng: -0.3275, radius: 20000 },
  { name: 'Sandridge 30 km', lat: 51.7866, lng: -0.3275, radius: 30000 },
]

export async function prefill(queries, { dryRun = false, log = console.log } = {}) {
  const gen = await getPoiGen()
  if (gen == null) { log('no active build generation; nothing to key against'); return 1 }
  let failed = 0
  for (const q of queries) {
    const { query } = buildDiscoverOverpassQuery(q.lat, q.lng, q.radius, null)
    const snapped = snapQueryBbox(query)
    const plan = parseQuery(snapped)
    if (!plan) { log(`  ${q.name}: not a plan the DB answers (legacy path)`); continue }
    const answer = await getPois(plan, snapped, { gen, deadlineAt: Date.now() + 30000 })
    if (!answer || answer.n === 0) { log(`  ${q.name}: no complete answer (not covered or empty)`); failed++; continue }
    const key = sharedAnswerKey(snapped, gen)
    const value = { body: answer.body, buildId: answer.buildId, n: answer.n }
    if (dryRun) {
      log(`  ${q.name}: ${answer.n} places, key ${key.slice(0, 20)}…, would write ${Buffer.byteLength(answer.body)} bytes`)
      continue
    }
    const ok = await cacheSet(key, value, SHARED_ANSWER_TTL_SECONDS)
    log(`  ${q.name}: ${ok ? 'wrote' : 'SKIPPED (no KV or oversized)'} ${answer.n} places, ${Buffer.byteLength(answer.body)} bytes`)
    if (!ok) failed++
  }
  return failed ? 1 : 0
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const a = parseArgs({ options: { 'dry-run': { type: 'boolean' } } }).values
  if (!isCacheEnabled() && !a['dry-run']) {
    console.error('KV env not set (KV_REST_API_URL/TOKEN); use --dry-run to preview without KV')
    process.exit(2)
  }
  prefill(DEFAULT_QUERIES, { dryRun: Boolean(a['dry-run']) }).then(code => process.exit(code))
}
