#!/usr/bin/env node
/**
 * Fixtures for the relevance-cap eval (tests/evals/rankCap.eval.js), too big to
 * commit (London 30 km alone is 14 MB). Each is a Discover answer shaped exactly
 * as the POI build shapes pois rows (trimmed tags, named elements only, 7 dp,
 * ways as centre + bounds), in the DB's (osm_type, osm_id) order:
 *   { center: {lat, lng}, radius, bbox: {s, w, n, e}, source, rows: [{ osm_type, osm_id, el }] }
 *
 * Source here: the same snapped Discover query sent to public Overpass (never
 * our database). The London 5/15/30, Manchester 15 and York 5 fixtures used on
 * 2026-09-27/28 were read from the pois table instead (read-only SELECTs of the
 * served statement, scripts/poi/shadow-check.mjs style); answers from the two
 * sources differ slightly (build date, bbox-overlap extras).
 *
 *   node scripts/poi/evalFixtures.mjs [--out /tmp/roam-overnight/ranking/fixtures] [name ...]
 *
 * Polite to Overpass: one query at a time, 15 s apart, identifying User-Agent.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { buildDiscoverOverpassQuery } from '../../shared/overpassQuery.js'
import { snapQueryBbox } from '../../api/lib/bboxSnap.js'
import { trimOverpassResponse } from '../../api/lib/overpassTrim.js'
import { parseQuery } from '../../api/lib/poiQuery.js'

export const CITIES = {
  'london-5': [51.5074, -0.1278, 5000], 'london-15': [51.5074, -0.1278, 15000], 'london-30': [51.5074, -0.1278, 30000],
  'manchester-15': [53.4808, -2.2426, 15000], 'york-5': [53.959, -1.0815, 5000],
  // out of sample: never used to tune the ranker
  'birmingham-15': [52.4862, -1.8904, 15000], 'glasgow-15': [55.8642, -4.2518, 15000], 'leeds-15': [53.8008, -1.5491, 15000],
  'edinburgh-5': [55.9533, -3.1883, 5000],
}
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter']
const UA = 'ROAM-eval-fixtures/1.0 (https://www.go-roam.uk; support@extrastaff.com)'
const r7 = x => Math.round(x * 1e7) / 1e7
const T = { node: 1, way: 2, relation: 3 }

/** Overpass `out center bb` elements -> pois-shaped rows, as scripts/poi/build.mjs featureToRow shapes them. */
export function toRows(elements) {
  const raw = elements.filter(e => e.type === 'node' || e.bounds).map(e => e.type === 'node'
    ? { type: 'node', id: e.id, lat: r7(e.lat), lon: r7(e.lon), tags: e.tags }
    : { type: e.type, id: e.id, center: { lat: r7((e.bounds.minlat + e.bounds.maxlat) / 2), lon: r7((e.bounds.minlon + e.bounds.maxlon) / 2) },
        bounds: { minlat: r7(e.bounds.minlat), minlon: r7(e.bounds.minlon), maxlat: r7(e.bounds.maxlat), maxlon: r7(e.bounds.maxlon) }, tags: e.tags })
  return trimOverpassResponse({ elements: raw }).elements
    .filter(el => el.tags?.name || el.tags?.['name:en'])
    .map(el => ({ osm_type: T[el.type], osm_id: el.id, el: JSON.stringify(el) }))
    .sort((a, b) => a.osm_type - b.osm_type || a.osm_id - b.osm_id)
}

async function fetchOverpass(ql) {
  for (const ep of ENDPOINTS) {
    try {
      const res = await fetch(ep, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
        body: `data=${encodeURIComponent(ql)}`, signal: AbortSignal.timeout(120000) })
      if (res.ok) {
        const data = await res.json()
        if (data.elements?.length) return data.elements
      }
      console.warn(`${ep}: HTTP ${res.status}`)
    } catch (err) {
      console.warn(`${ep}: ${err.message}`)
    }
    await new Promise(r => setTimeout(r, 20000))
  }
  return null
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values, positionals } = parseArgs({ options: { out: { type: 'string', default: '/tmp/roam-overnight/ranking/fixtures' } }, allowPositionals: true })
  mkdirSync(values.out, { recursive: true })
  for (const name of positionals.length ? positionals : Object.keys(CITIES)) {
    const [lat, lng, radius] = CITIES[name]
    const q = snapQueryBbox(buildDiscoverOverpassQuery(lat, lng, radius, null).query)
    const elements = await fetchOverpass(q.replace(/out tags center;\s*$/, 'out center bb;'))
    if (!elements) { console.error(`${name}: every endpoint failed`); continue }
    const rows = toRows(elements)
    writeFileSync(join(values.out, `${name}.json`), JSON.stringify({ center: { lat, lng }, radius, bbox: parseQuery(q).bbox, source: 'public Overpass', rows }))
    console.log(`${name}: ${rows.length} rows`)
    await new Promise(r => setTimeout(r, 15000))
  }
}
