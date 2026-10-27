#!/usr/bin/env node
/**
 * Parity check: static POI blocks (api/lib/poiTiles.js) vs the live DB answer.
 * Replays realistic Discover queries (buildDiscoverOverpassQuery: towns x radii x
 * categories), ONE at a time with a pause, against the production proxy, and
 * compares each DB-served answer (X-Places-Source: db) with getTilePois on the
 * same snapped query: jaccard of element ids, exact order, exact body bytes.
 *
 *   node scripts/poi/tilesParity.mjs --tiles <dir> [--r2] [--out results.json] [--pause 3000] [--limit N] [--local-only]
 *     [--ids-tiles <dir>] [--id-limit 20] [--from N] [--r2-timeout ms]
 *
 * --ids-tiles: also compare id lookups (lookupPlace's node(N)/way(N) query) for the first
 * element of each DB-served answer, against the id index of the blocks in <dir>.
 *
 * Only queries the blocks say are covered are sent, so the DB answers them; a
 * response from any other source (KV, Overpass) is recorded and not compared.
 * Gentle by design: these hit our DB, never public Overpass on purpose. Do not
 * shorten the pause or run it in parallel.
 */
import { writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { parseQuery } from '../../api/lib/poiQuery.js'
import { snapQueryBbox } from '../../api/lib/bboxSnap.js'
import { hashKey } from '../../api/lib/kvCache.js'
import { buildDiscoverOverpassQuery } from '../../shared/overpassQuery.js'
import { getTilePois } from '../../api/lib/poiTiles.js'
import { localStore, r2Store } from '../../api/lib/poiStore.js'

const TOWNS = [
  ['London', 51.5074, -0.1278], ['Manchester', 53.4808, -2.2426], ['Birmingham', 52.4862, -1.8904], ['Leeds', 53.8008, -1.5491],
  ['Edinburgh', 55.9533, -3.1883], ['Glasgow', 55.8642, -4.2518], ['Cardiff', 51.4816, -3.1791], ['Bristol', 51.4545, -2.5879],
  ['York', 53.9600, -1.0873], ['Bath', 51.3811, -2.3590], ['Brighton', 50.8225, -0.1372], ['Oxford', 51.7520, -1.2577],
  ['Cambridge', 52.2053, 0.1218], ['Norwich', 52.6309, 1.2974], ['Inverness', 57.4778, -4.2247], ['Aberystwyth', 52.4153, -4.0829],
  ['Keswick', 54.6013, -3.1347], ['Plymouth', 50.3755, -4.1427], ['Newcastle', 54.9783, -1.6178], ['Liverpool', 53.4084, -2.9916],
  ['Sheffield', 53.3811, -1.4701], ['Nottingham', 52.9548, -1.1581], ['Exeter', 50.7184, -3.5339], ['St Andrews', 56.3398, -2.7967],
  ['Fort William', 56.8198, -5.1052], ['Lerwick', 60.1530, -1.1490], ['Belfast', 54.5973, -5.9301], ['Canterbury', 51.2802, 1.0789],
]
// Travel-mode radii the app sends (walk 2-5 km, cycle/transit 10-15, drive 25-30)
const RADII = [2000, 5000, 10000, 15000, 25000, 30000]
const CATS = [null, 'food', 'nature', 'culture', 'historic', 'entertainment', 'active', 'unique', 'shopping', 'nightlife']

/** Deterministic replay set: every town, cycling radius and category. */
export function replaySet() {
  return TOWNS.flatMap(([name, lat, lng], i) => [0, 1].map(j => {
    const radius = RADII[(i + j * 3) % RADII.length]
    const category = CATS[(i * 2 + j * 5) % CATS.length]
    return { name, lat, lng, radius, category, query: buildDiscoverOverpassQuery(lat, lng, radius, category).query }
  }))
}

const ids = body => JSON.parse(body).elements.map(e => `${e.type}/${e.id}`)
const sha = s => createHash('sha256').update(s).digest('hex').slice(0, 12)
function jaccard(a, b) {
  const A = new Set(a)
  const B = new Set(b)
  let both = 0
  for (const x of A) if (B.has(x)) both++
  return A.size + B.size - both ? both / (A.size + B.size - both) : 1
}

async function main() {
  const { values: a } = parseArgs({ options: {
    tiles: { type: 'string' }, r2: { type: 'boolean', default: false }, out: { type: 'string' },
    base: { type: 'string', default: 'https://www.go-roam.uk' }, pause: { type: 'string', default: '3000' },
    limit: { type: 'string' }, 'local-only': { type: 'boolean', default: false },
    'ids-tiles': { type: 'string' }, 'id-limit': { type: 'string', default: '20' },
    from: { type: 'string', default: '0' }, 'r2-timeout': { type: 'string', default: '5000' },
  } })
  const idStore = a['ids-tiles'] ? localStore(a['ids-tiles']) : null
  const idResults = []
  if (!a.tiles && !a.r2) throw new Error('--tiles <dir> or --r2')
  const store = a.r2 ? r2Store({ timeoutMs: Number(a['r2-timeout']) }) : localStore(a.tiles)
  const pause = Math.max(3000, Number(a.pause))
  const set = replaySet().slice(Number(a.from), a.limit ? Number(a.from) + Number(a.limit) : undefined)
  const results = []
  for (const [i, q] of set.entries()) {
    const key = snapQueryBbox(q.query)
    const plan = parseQuery(key)
    const row = { ...q, query: undefined, bucket: parseInt(hashKey(key).slice(0, 8), 16) % 100 }
    // Both cap modes: which one prod used depends on its poiCapPct bucket
    const tiles = {}
    for (const cap of [false, true]) {
      const trace = {}
      const t = performance.now()
      const r = plan && await getTilePois(plan, key, { store, cap, trace })
      tiles[cap ? 'cap' : 'all'] = { r, ms: +(performance.now() - t).toFixed(1), trace }
    }
    // Warm repeat (headers cached), uncapped-or-capped whichever answered
    const warmCap = !tiles.all.r && tiles.cap.r
    const t2 = performance.now()
    await getTilePois(plan, key, { store, cap: warmCap })
    row.warm_ms = +(performance.now() - t2).toFixed(1)
    row.tiles = Object.fromEntries(Object.entries(tiles).map(([k, v]) => [k, { n: v.r?.n ?? null, ms: v.ms, why: v.trace.why, bytes: v.trace.bytesRead, reads: v.trace.reads }]))
    if (!tiles.all.r && !tiles.cap.r) {
      row.skipped = `tiles: ${tiles.all.trace.why}`
      results.push(row)
      console.log(`${i + 1}/${set.length} ${q.name} ${q.radius} ${q.category}: skipped (${row.skipped})`)
      continue
    }
    if (a['local-only']) { results.push(row); console.log(`${i + 1}/${set.length} ${q.name} ${q.radius} ${q.category}: local n=${tiles.all.r?.n ?? tiles.cap.r?.n}`); continue }
    const t = Date.now()
    const res = await fetch(`${a.base}/api/places/overpass/nearby`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'ROAM-tiles-parity/1.0 (support@extrastaff.com)' },
      body: JSON.stringify({ query: q.query }),
    })
    const body = await res.text()
    row.prod = { status: res.status, source: res.headers.get('x-places-source') || res.headers.get('x-overpass-cache') || 'unknown',
      build: res.headers.get('x-places-build'), ms: Date.now() - t }
    if (res.status === 200 && row.prod.source === 'db') {
      const prodIds = ids(body)
      row.prod.n = prodIds.length
      // The tile answer in the same mode as prod: capped iff prod's looks capped
      const pick = [tiles.all.r, tiles.cap.r].filter(Boolean).find(r => r.n === prodIds.length) || tiles.all.r || tiles.cap.r
      row.mode = pick === tiles.cap.r && pick.capPath ? 'cap' : 'all'
      const tileIds = pick.ids
      row.jaccard = +jaccard(prodIds, tileIds).toFixed(4)
      row.same_order = prodIds.length === tileIds.length && prodIds.every((x, k) => x === tileIds[k])
      row.same_body = sha(body) === sha(pick.body)
      if (row.jaccard < 1) {
        const P = new Set(prodIds)
        const T = new Set(tileIds)
        row.only_prod = prodIds.filter(x => !T.has(x)).slice(0, 20)
        row.only_tiles = tileIds.filter(x => !P.has(x)).slice(0, 20)
      }
    }
    const [idType, idNum] = row.prod.n ? ids(body)[0].split('/') : []
    const idQl = `[out:json][timeout:10];${idType}(${idNum});out tags center;`
    // prod serves rollout buckets 0-98 from the DB (phase 1: bucket 98 was DB-served); bucket 99
    // might go to public Overpass, so it is never sent
    if (idStore && row.prod.n && idResults.length < Number(a['id-limit']) && parseInt(hashKey(idQl).slice(0, 8), 16) % 100 < 99) {
      await new Promise(r => setTimeout(r, pause))
      const [type, id, ql] = [idType, idNum, idQl]
      const plan = parseQuery(ql)
      const tiles = await getTilePois(plan, ql, { store: idStore })
      const r = await fetch(`${a.base}/api/places/overpass/nearby`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'ROAM-tiles-parity/1.0 (support@extrastaff.com)' },
        body: JSON.stringify({ query: ql }),
      })
      const prodBody = await r.text()
      const idRow = { id: `${type}/${id}`, status: r.status, source: r.headers.get('x-places-source') || r.headers.get('x-overpass-cache') || 'unknown',
        tiles_n: tiles?.n ?? null, same_body: r.headers.get('x-places-source') === 'db' ? sha(prodBody) === sha(tiles?.body || '') : null }
      idResults.push(idRow)
      console.log(`   id ${idRow.id}: prod ${idRow.status} ${idRow.source} tiles n=${idRow.tiles_n} body=${idRow.same_body}`)
    }
    results.push(row)
    console.log(`${i + 1}/${set.length} ${q.name} ${q.radius} ${q.category}: prod ${row.prod.status} ${row.prod.source} n=${row.prod.n ?? '-'} ` +
      `tiles(${row.mode ?? '-'}) jaccard=${row.jaccard ?? '-'} order=${row.same_order ?? '-'} body=${row.same_body ?? '-'} tile_ms=${tiles.all.ms}/${tiles.cap.ms}`)
    await new Promise(r => setTimeout(r, pause))
  }
  if (a.out) writeFileSync(a.out, JSON.stringify({ results, ids: idResults }, null, 1))
  const cmp = results.filter(r => r.jaccard !== undefined)
  console.log(JSON.stringify({
    queries: results.length, compared: cmp.length, jaccard_1: cmp.filter(r => r.jaccard === 1).length,
    same_order: cmp.filter(r => r.same_order).length, same_body: cmp.filter(r => r.same_body).length,
    not_db: results.filter(r => r.prod && r.prod.source !== 'db').map(r => `${r.name} ${r.radius} ${r.category}: ${r.prod.status} ${r.prod.source}`),
    builds: [...new Set(results.map(r => r.prod?.build).filter(Boolean))],
    ...(idStore && { ids_compared: idResults.filter(r => r.same_body !== null).length, ids_same_body: idResults.filter(r => r.same_body).length,
      ids_not_db: idResults.filter(r => r.same_body === null).map(r => `${r.id}: ${r.status} ${r.source}`) }),
  }, null, 1))
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch(err => { console.error(err); process.exit(1) })
