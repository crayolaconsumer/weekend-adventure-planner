#!/usr/bin/env node
/**
 * POI build: osmium geojsonseq -> pois table rows (chunks), manifest, coverage.
 * Output shape is the frozen CONTRACT in the POI pipeline plan; the loader
 * (api/admin/poi-load.js) and the query side (api/lib/poiQuery.js) read it.
 *
 *   osmium export pois.osm.pbf -f geojsonseq --add-unique-id=type_id -o pois.geojsonseq
 *   node scripts/poi/build.mjs --in pois.geojsonseq --relations rels.opl --poly great-britain.poly \
 *     --osm-timestamp 2026-09-26T20:22:51Z --region uk --out out/ [--prev-manifest prev.json]
 *
 * Exits 1 when a local gate fails (row count, sentinels, per-key drift), so
 * nothing gets published.
 */
import { createReadStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { trimOverpassResponse } from '../../api/lib/overpassTrim.js'
import { LARGE_CELL, OSM_TYPE_CODE, SCHEMA_VERSION, isLarge, poiCell } from '../../shared/poiCell.mjs'
import { POI_KEYS, filterPairs, makeMatcher } from './filter.mjs'
import { poiFeatures, FEATURES_VERSION } from '../../shared/poiRank.mjs'

export const CHUNK_ROWS = 10000
const K_MAX = 48 // VARCHAR(48); a longer value can't equal anything the app queries

const round7 = x => Math.round(x * 1e7) / 1e7

/**
 * osmium --add-unique-id=type_id: n<id>, w<id>, r<id>, and a<areaId> for
 * areas, where areaId = wayId*2 or relationId*2+1.
 */
const T = { n: 'node', w: 'way', r: 'relation' }
export function decodeId(fid) {
  const m = /^([nwra])(\d+)$/.exec(fid || '')
  if (!m) return null
  const n = Number(m[2])
  if (T[m[1]]) return { type: T[m[1]], id: n }
  return n % 2 === 0 ? { type: 'way', id: n / 2 } : { type: 'relation', id: (n - 1) / 2 }
}

/** Bounds of any GeoJSON geometry (coordinates are [lon, lat]). */
export function geometryBounds(geometry) {
  const bb = [Infinity, Infinity, -Infinity, -Infinity]
  const walk = c => {
    if (typeof c[0] === 'number') grow(bb, c[0], c[1])
    else for (const x of c) walk(x)
  }
  walk(geometry.coordinates)
  return { minlat: bb[1], minlon: bb[0], maxlat: bb[3], maxlon: bb[2] }
}

/**
 * One GeoJSON feature -> one pois row, or null when it isn't a named POI.
 * Ways/relations get Overpass `out center` semantics: centre of the bbox.
 */
export function featureToRow(feature, matches) {
  const ref = decodeId(feature.id)
  const tags = feature.properties
  if (!ref || !tags || !feature.geometry || !matches(tags)) return null
  let raw
  if (ref.type === 'node') {
    const [lon, lat] = feature.geometry.coordinates
    raw = { type: 'node', id: ref.id, lat: round7(lat), lon: round7(lon), tags }
  } else {
    const b = geometryBounds(feature.geometry)
    raw = {
      type: ref.type, id: ref.id,
      center: { lat: round7((b.minlat + b.maxlat) / 2), lon: round7((b.minlon + b.maxlon) / 2) },
      bounds: { minlat: round7(b.minlat), minlon: round7(b.minlon), maxlat: round7(b.maxlat), maxlon: round7(b.maxlon) },
      tags,
    }
  }
  const el = trimOverpassResponse({ elements: [raw] }).elements[0]
  const t = el.tags || {}
  if (!t.name && !t['name:en']) return null
  const lat = el.lat ?? el.center.lat
  const lon = el.lon ?? el.center.lon
  // Overpass (bbox) matches ways/relations that INTERSECT the box: keep their bounds
  const b = el.bounds || { minlat: lat, minlon: lon, maxlat: lat, maxlon: lon }
  const row = {
    cell: poiCell(lat, lon), osm_type: OSM_TYPE_CODE[ref.type], osm_id: ref.id, lat, lon,
    min_lat: b.minlat, min_lon: b.minlon, max_lat: b.maxlat, max_lon: b.maxlon,
  }
  if (isLarge(row)) row.cell = LARGE_CELL
  for (const k of POI_KEYS) {
    const v = t[k]
    row[`k_${k}`] = typeof v === 'string' && v.length <= K_MAX ? v : null
  }
  row.has_name = 1
  row.has_name_tag = t.name ? 1 : 0 // Overpass ["name"] means the name tag itself
  row.has_wikidata = t.wikidata ? 1 : 0
  // Relevance-cap features (shared/poiRank.mjs): the server ranks dense answers on these alone
  Object.assign(row, poiFeatures(el))
  row.el = JSON.stringify(el)
  return row
}

export const compareRows = (a, b) => a.cell - b.cell || a.osm_type - b.osm_type || a.osm_id - b.osm_id

export const MAX_LARGE = 2000 // sanity: GB expected < 500

// Features become rows as they are read: only named POI rows are ever held,
// never the raw features (GB is millions of them).
function collect(byKey, f, matches) {
  const row = featureToRow(f, matches)
  if (!row) return
  const key = row.osm_type * 1e13 + row.osm_id // osm ids are < 1e13
  // Same element twice: a closed way (w<id> and a<id*2>), or GB and Ireland
  // extracts both holding a border relation. Keep the larger bounds: an
  // extract can cut a relation's members, the other copy is then complete.
  const had = byKey.get(key)
  if (!had || bboxArea(row) > bboxArea(had)) byKey.set(key, row)
}

const bboxArea = r => (r.max_lat - r.min_lat) * (r.max_lon - r.min_lon)

/**
 * Rows from (async) feature streams, converting each feature as it arrives:
 * filtered, deduped by (type, id), sorted by PK.
 */
export async function buildRowsFromStreams(streams, matches = makeMatcher()) {
  const byKey = new Map()
  for (const stream of streams) for await (const f of stream) collect(byKey, f, matches)
  return [...byKey.values()].sort(compareRows)
}

const lines = p => createInterface({ input: createReadStream(p), crlfDelay: Infinity })

async function* readFeatures(path) {
  for await (const line of lines(path)) {
    const s = line.replace(/^\x1e/, '').trim() // RFC 8142 record separator
    if (s) yield JSON.parse(s)
  }
}

const unOpl = s => s.replace(/%([0-9a-fA-F]+)%/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
const oplTags = s => Object.fromEntries((s ? s.split(',') : []).map(kv => kv.split('=').map(unOpl)))

/**
 * osmium export only builds areas from multipolygon/boundary relations, but
 * Overpass returns every matching relation (type=site, or no type at all:
 * Rutland's "Clipsham Park Wood"). This reads relations plus member geometry
 * from `osmium add-locations-to-ways --keep-member-nodes -f opl` and yields one
 * MultiPoint feature per relation, so its bbox (= Overpass `out center`) is
 * the members' bbox. A relation osmium did build as an area arrives twice;
 * dedupe keeps the copy with the larger bounds (normally identical, so the
 * area, read first, stays).
 */
export async function* readOplRelations(lines) {
  // Only what a relation's bbox needs: a node's position, a way's bbox
  const nodes = new Map()
  const ways = new Map()
  for await (const line of lines) {
    const f = {}
    for (const part of line.split(' ')) f[part[0]] = part.slice(1)
    const kind = line[0]
    const id = Number(line.slice(1, line.indexOf(' ')))
    if (kind === 'n' && f.x && f.y) nodes.set(id, [Number(f.x), Number(f.y), Number(f.x), Number(f.y)])
    else if (kind === 'w' && f.N) {
      const bb = [Infinity, Infinity, -Infinity, -Infinity]
      for (const m of f.N.matchAll(/x(-?[\d.]+)y(-?[\d.]+)/g)) grow(bb, Number(m[1]), Number(m[2]))
      if (bb[0] !== Infinity) ways.set(id, bb)
    } else if (kind === 'r') {
      const bb = [Infinity, Infinity, -Infinity, -Infinity]
      for (const m of (f.M || '').split(',')) {
        const ref = Number(m.slice(1, m.indexOf('@')))
        const mb = m[0] === 'n' ? nodes.get(ref) : m[0] === 'w' ? ways.get(ref) : null
        if (mb) {
          grow(bb, mb[0], mb[1])
          grow(bb, mb[2], mb[3])
        }
      }
      if (bb[0] !== Infinity) {
        yield { id: `r${id}`, properties: oplTags(f.T), geometry: { type: 'MultiPoint', coordinates: [[bb[0], bb[1]], [bb[2], bb[3]]] } }
      }
    }
  }
}

function grow(bb, lon, lat) {
  if (lon < bb[0]) bb[0] = lon
  if (lat < bb[1]) bb[1] = lat
  if (lon > bb[2]) bb[2] = lon
  if (lat > bb[3]) bb[3] = lat
}

// Lazy: a readline interface created before it is iterated drops its lines
async function* readOplFile(path) {
  yield* readOplRelations(lines(path))
}

export function buildRowsFromFiles(paths, matches = makeMatcher(), relationOpl = []) {
  return buildRowsFromStreams([...paths.map(readFeatures), ...relationOpl.map(readOplFile)], matches)
}

/** Writes chunk-NNN.ndjson.gz files; returns [{name, sha256, rows}]. */
export function writeChunks(rows, outDir) {
  const chunks = []
  for (let i = 0; i * CHUNK_ROWS < rows.length; i++) {
    const part = rows.slice(i * CHUNK_ROWS, (i + 1) * CHUNK_ROWS)
    const gz = gzipSync(part.map(r => JSON.stringify(r)).join('\n') + '\n', { level: 9 })
    const name = `chunk-${String(i).padStart(3, '0')}.ndjson.gz`
    writeFileSync(join(outDir, name), gz)
    chunks.push({ name, sha256: createHash('sha256').update(gz).digest('hex'), rows: part.length })
  }
  return chunks
}

export function perKeyCounts(rows, pairs = filterPairs()) {
  const wanted = new Map([...pairs].map(([k, vs]) => [k, new Set(vs)]))
  const counts = {}
  for (const r of rows) {
    for (const k of POI_KEYS) {
      const v = r[`k_${k}`]
      if (v && wanted.get(k).has(v)) counts[`${k}=${v}`] = (counts[`${k}=${v}`] || 0) + 1
    }
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
}

/** Sentinels absent from the rows, or present under another name. */
export function missingSentinels(rows, sentinels) {
  const want = new Set(sentinels.map(s => `${OSM_TYPE_CODE[s.type]}:${s.id}`))
  const names = new Map()
  for (const r of rows) {
    const key = `${r.osm_type}:${r.osm_id}`
    if (want.has(key)) names.set(key, JSON.parse(r.el).tags?.name)
  }
  return sentinels.filter(s => names.get(`${OSM_TYPE_CODE[s.type]}:${s.id}`) !== s.name)
}

// ─── Coverage (.poly) ────────────────────────────────────────────

/** Geofabrik/Osmosis .poly -> [{hole, pts: [[lon, lat], ...]}] */
export function parsePoly(text) {
  const rings = []
  let cur = null
  for (const line of text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(1)) {
    if (line === 'END') {
      if (cur) rings.push(cur)
      cur = null
    } else if (!cur) {
      cur = { hole: line.startsWith('!'), pts: [] }
    } else {
      const [lon, lat] = line.split(/\s+/).map(Number)
      cur.pts.push([lon, lat])
    }
  }
  return rings
}

function inRing(pts, lon, lat) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]
    const [xj, yj] = pts[j]
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Inside a polygon = inside an outer ring and no hole ring of the same file. */
export function inPoly(rings, lon, lat) {
  return rings.some(r => !r.hole && inRing(r.pts, lon, lat)) && !rings.some(r => r.hole && inRing(r.pts, lon, lat))
}

/**
 * Does segment (x0,y0)-(x1,y1) touch the rectangle? Liang-Barsky clipping;
 * touching an edge counts (conservative: that cell is then not covered).
 */
export function segmentTouchesRect(x0, y0, x1, y1, xmin, ymin, xmax, ymax) {
  const dx = x1 - x0
  const dy = y1 - y0
  let t0 = 0
  let t1 = 1
  for (const [p, q] of [[-dx, x0 - xmin], [dx, xmax - x0], [-dy, y0 - ymin], [dy, ymax - y0]]) {
    if (p === 0) {
      if (q < 0) return false
    } else {
      const t = q / p
      if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t }
      else { if (t < t0) return false; if (t < t1) t1 = t }
    }
  }
  return true
}

const cellKey = (r, c) => r * 4000 + c

/**
 * Cells (keyed r*4000+c) that any ring edge, outer or hole, touches. Each edge
 * only visits the cells of its own bbox.
 */
function cellsTouchedByEdges(rings) {
  const touched = new Set()
  for (const { pts } of rings) {
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1]
      const [x1, y1] = pts[i]
      const ra = Math.floor((Math.min(y0, y1) + 90) * 10) - 1
      const rb = Math.floor((Math.max(y0, y1) + 90) * 10)
      const ca = Math.floor((Math.min(x0, x1) + 180) * 10) - 1
      const cb = Math.floor((Math.max(x0, x1) + 180) * 10)
      for (let r = ra; r <= rb; r++) {
        for (let c = ca; c <= cb; c++) {
          if (touched.has(cellKey(r, c))) continue
          const w = (c - 1800) / 10
          const s = (r - 900) / 10
          if (segmentTouchesRect(x0, y0, x1, y1, w, s, w + 0.1, s + 0.1)) touched.add(cellKey(r, c))
        }
      }
    }
  }
  return touched
}

/**
 * Cells whose whole rectangle lies inside the union of the extract polygons:
 * all four corners inside, and no ring edge (outer or hole) touches the cell.
 * The second test catches concave borders and holes between the corners; a
 * hole vertex inside the cell always has an edge touching it. Conservative
 * where two extracts meet (their edges disqualify the cell): those cells just
 * take the legacy Overpass path.
 */
export function coverageCells(polys) {
  const outer = polys.flat().filter(r => !r.hole).flatMap(r => r.pts)
  if (!outer.length) return []
  const touched = cellsTouchedByEdges(polys.flat())
  const r0 = Math.floor((Math.min(...outer.map(p => p[1])) + 90) * 10)
  const r1 = Math.floor((Math.max(...outer.map(p => p[1])) + 90) * 10)
  const c0 = Math.floor((Math.min(...outer.map(p => p[0])) + 180) * 10)
  const c1 = Math.floor((Math.max(...outer.map(p => p[0])) + 180) * 10)
  // Corner (r, c) is the SW corner of cell (r, c); integer maths avoids float drift
  const corner = new Map()
  const inside = (r, c) => {
    const key = r * 4000 + c
    if (!corner.has(key)) corner.set(key, polys.some(p => inPoly(p, (c - 1800) / 10, (r - 900) / 10)))
    return corner.get(key)
  }
  const cells = []
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (!touched.has(cellKey(r, c)) && inside(r, c) && inside(r + 1, c) && inside(r, c + 1) && inside(r + 1, c + 1)) {
        cells.push(poiCell((r - 900) / 10 + 0.05, (c - 1800) / 10 + 0.05))
      }
    }
  }
  return cells
}

// ─── Manifest + gates ────────────────────────────────────────────

export function buildId(region, osmTimestamp) {
  const d = new Date(osmTimestamp)
  if (Number.isNaN(d.getTime())) throw new Error(`bad --osm-timestamp ${osmTimestamp}`)
  return `${region}-${d.toISOString().replace(/[-:]/g, '').slice(0, 13)}Z`
}

const MAX_DRIFT = 0.1 // per-key change vs the previous build
const MIN_KEY_COUNT = 50 // keys smaller than this before are too noisy to judge

/**
 * Local gates (plan §3 step 5). Returns human-readable failures; empty = pass.
 * `missing` = missingSentinels(). Sentinels: 90%, the coordinator's decision
 * in the plan's critic rounds (round 2 item 8, round 3); the loader's G5 uses
 * the same 90%.
 */
export function gateFailures(m, prev, { minRows = 150000, minSentinelRatio = 0.9 } = {}, { missing = [] } = {}) {
  const fails = []
  if (m.row_count < minRows) fails.push(`row_count ${m.row_count} < ${minRows}`)
  if (m.sentinels_total && m.sentinels_found / m.sentinels_total < minSentinelRatio) {
    fails.push(`sentinels ${m.sentinels_found}/${m.sentinels_total} < ${minSentinelRatio}; missing: ${missing.map(s => `${s.type}/${s.id} ${s.name}`).join(', ')}`)
  }
  if (m.large_count > MAX_LARGE) fails.push(`large_count ${m.large_count} > ${MAX_LARGE} (elements in cell ${LARGE_CELL})`)
  for (const [k, before] of Object.entries(prev?.per_key_counts || {})) {
    if (before < MIN_KEY_COUNT) continue
    const now = m.per_key_counts[k] || 0
    if (Math.abs(now / before - 1) > MAX_DRIFT) fails.push(`${k} ${before} -> ${now} (over ±${MAX_DRIFT * 100}%)`)
  }
  return fails
}

export async function build({ inputs, relations = [], polys, osmTimestamp, region, outDir, prevManifest, sentinels, gates }) {
  mkdirSync(outDir, { recursive: true })
  const rows = await buildRowsFromFiles(inputs, makeMatcher(), relations)
  const chunks = writeChunks(rows, outDir)
  const coverage = coverageCells(polys.map(p => parsePoly(readFileSync(p, 'utf8'))))
  writeFileSync(join(outDir, 'coverage.json'), JSON.stringify(coverage))
  const missing = missingSentinels(rows, sentinels)
  const manifest = {
    build_id: buildId(region, osmTimestamp),
    schema_version: SCHEMA_VERSION,
    features_version: FEATURES_VERSION, // rows carry q, cat, flags (shared/poiRank.mjs)
    osm_timestamp: new Date(osmTimestamp).toISOString(),
    chunks,
    row_count: rows.length,
    per_key_counts: perKeyCounts(rows),
    photo_count: 0, // Phase 5 (photos.mjs)
    sentinels_found: sentinels.length - missing.length,
    sentinels_total: sentinels.length,
    large_count: rows.filter(r => r.cell === LARGE_CELL).length,
  }
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1))
  if (missing.length) console.warn(`Sentinels missing: ${missing.map(s => `${s.type}/${s.id} ${s.name}`).join(', ')}`)
  return { manifest, coverage, failures: gateFailures(manifest, prevManifest, gates, { missing }) }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { values: a } = parseArgs({
    options: {
      in: { type: 'string', multiple: true }, relations: { type: 'string', multiple: true }, poly: { type: 'string', multiple: true },
      'osm-timestamp': { type: 'string' }, region: { type: 'string', default: 'uk' }, out: { type: 'string' },
      'prev-manifest': { type: 'string' }, 'min-rows': { type: 'string' }, 'min-sentinel-ratio': { type: 'string' },
    },
  })
  if (!a.in || !a.poly || !a['osm-timestamp'] || !a.out) {
    console.error('usage: build.mjs --in f.geojsonseq [--in ...] [--relations rels.opl ...] --poly f.poly [--poly ...] --osm-timestamp ISO --out dir [--region uk] [--prev-manifest m.json] [--min-rows N] [--min-sentinel-ratio R]')
    process.exit(2)
  }
  const t0 = Date.now()
  const sentinels = JSON.parse(readFileSync(new URL('./sentinels.json', import.meta.url), 'utf8'))
  const prevManifest = a['prev-manifest'] ? JSON.parse(readFileSync(a['prev-manifest'], 'utf8')) : null
  const gates = {}
  if (a['min-rows'] !== undefined) gates.minRows = Number(a['min-rows'])
  if (a['min-sentinel-ratio'] !== undefined) gates.minSentinelRatio = Number(a['min-sentinel-ratio'])
  const { manifest, coverage, failures } = await build({
    inputs: a.in, relations: a.relations || [], polys: a.poly, osmTimestamp: a['osm-timestamp'], region: a.region, outDir: a.out,
    prevManifest, sentinels, gates,
  })
  console.log(JSON.stringify({
    build_id: manifest.build_id, rows: manifest.row_count, chunks: manifest.chunks.length, coverage_cells: coverage.length, large_count: manifest.large_count,
    sentinels: `${manifest.sentinels_found}/${manifest.sentinels_total}`, secs: (Date.now() - t0) / 1000,
  }))
  if (failures.length) {
    console.error('Gate failures:\n  ' + failures.join('\n  '))
    process.exit(1)
  }
}
