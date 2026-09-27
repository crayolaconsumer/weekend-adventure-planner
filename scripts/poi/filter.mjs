#!/usr/bin/env node
/**
 * The osmium tags-filter expression for the POI build, generated from the
 * code that writes the app's Overpass queries, so the extract can never drift
 * from what Discover and the town pages ask for.
 *
 *   node scripts/poi/filter.mjs > filter.txt
 *   osmium tags-filter in.osm.pbf -e filter.txt -o pois.osm.pbf
 *
 * build.mjs re-applies matchesFilter() to every feature, because tags-filter
 * also keeps the ways/nodes a match references (needed for its geometry) and
 * those must not become rows.
 */
import { pathToFileURL } from 'node:url'
import { TYPE_TO_KEYS, buildOverpassQuery, getAllGoodTypes } from '../../shared/overpassQuery.js'
import { townOverpassQuery } from '../../api/lib/towns.js'

// One k_* column each in the pois table; parseQuery only answers these keys
export const POI_KEYS = ['amenity', 'tourism', 'leisure', 'historic', 'shop', 'natural', 'man_made']

const EXTRA = {
  amenity: ['place_of_worship'],
  natural: ['water', 'wood', 'beach'],
}

/** Every ["k"~"^(a|b)$"] / ["k"="v"] pair in an Overpass query. */
export function queryPairs(ql) {
  const pairs = []
  for (const [, key, op, value] of ql.matchAll(/\["([\w:]+)"(~|=)"([^"]+)"\]/g)) {
    const values = op === '=' ? [value] : value.replace(/^\^\(|\)\$$/g, '').split('|')
    for (const v of values) pairs.push([key, v.replace(/\\(.)/g, '$1')])
  }
  return pairs
}

/** Map key -> sorted values the build must keep. */
export function filterPairs() {
  const map = new Map(POI_KEYS.map(k => [k, new Set(EXTRA[k] || [])]))
  const add = (k, v) => {
    if (!map.has(k)) throw new Error(`app queries ${k}=${v} but the pois table has no k_${k} column`)
    map.get(k).add(v)
  }
  for (const [type, keys] of Object.entries(TYPE_TO_KEYS)) for (const k of keys) add(k, type)
  for (const [k, v] of queryPairs(buildOverpassQuery(0, 0, 1000, getAllGoodTypes()).query)) add(k, v)
  for (const [k, v] of queryPairs(townOverpassQuery(0, 0))) add(k, v)
  return new Map([...map].map(([k, s]) => [k, [...s].sort()]))
}

export function filterExpression(pairs = filterPairs()) {
  return [...pairs].map(([k, vs]) => `nwr/${k}=${vs.join(',')}`).join('\n') + '\n'
}

export function makeMatcher(pairs = filterPairs()) {
  const sets = [...pairs].map(([k, vs]) => [k, new Set(vs)])
  return tags => sets.some(([k, s]) => s.has(tags[k]))
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  process.stdout.write(filterExpression())
}
