#!/usr/bin/env node
/**
 * Precomputes everything k6.js and warm.mjs request, into queries.json next to
 * this file. k6 can't import the repo's ESM, so the Discover Overpass queries
 * are built here with the same builder the client uses.
 *
 *   node scripts/loadtest/queries.mjs
 *
 * Deterministic: no network, same output every run (the workflow runs it on
 * every load test).
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { buildDiscoverOverpassQuery, GOOD_CATEGORY_TYPES } from '../../shared/overpassQuery.js'

const OUT = fileURLToPath(new URL('./queries.json', import.meta.url))

// A current desktop Chrome. Never contains "bot": api/lib/bots.js would treat
// it as a crawler and the run would measure the cache-only crawler path.
export const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

// City centres. Discover sends the device GPS, the server snaps the bbox to a
// ~1 km grid (api/lib/bboxSnap.js), so one point per city is one cache entry.
const CITIES = [
  ['York', 53.9590, -1.0815],
  ['Manchester', 53.4808, -2.2426],
  ['Birmingham', 52.4862, -1.8904],
  ['Bristol', 51.4545, -2.5879],
  ['Cardiff', 51.4816, -3.1791],
  ['Belfast', 54.5973, -5.9301],
  ['Edinburgh', 55.9533, -3.1883],
  ['Luton', 51.8787, -0.4200],
]
const RADII_M = [5000, 15000]

// 30 real OSM places with a wikidata tag, 15 around York and 15 around
// Belfast, snapshotted from overpass-api.de on 2026-09-27. Fields are what
// src/utils/apiClient.js parseOverpassResponse (~line 310) puts on a place:
// id = raw OSM element id (a number), type = first of amenity/tourism/leisure/
// historic/... tags, lat/lng = node coords or way center.
const PLACES = [
  { id: 27422877, name: 'York Army Museum', type: 'museum', lat: 53.9562721, lng: -1.0809171, wikidata: 'Q45112549', website: 'https://yorkarmymuseum.co.uk/' },
  { id: 316106165, name: 'Jorvik Viking Centre', type: 'museum', lat: 53.9573926, lng: -1.0802935, wikidata: 'Q1704043', wikipedia: 'en:Jorvik Viking Centre', website: 'https://www.jorvikvikingcentre.co.uk/' },
  { id: 316110590, name: 'Roman Column', type: 'attraction', lat: 53.9616362, lng: -1.0818203, wikidata: 'Q26548646', wikipedia: 'en:Roman column, York' },
  { id: 316115931, name: 'York Dungeon', type: 'attraction', lat: 53.9568953, lng: -1.0819782, wikidata: 'Q8055440', wikipedia: 'en:York Dungeon', website: 'https://www.thedungeons.com/york/' },
  { id: 457713424, name: 'Barley Hall', type: 'museum', lat: 53.96091, lng: -1.0825952, wikidata: 'Q4861158', wikipedia: 'en:Barley Hall', website: 'https://barleyhall.co.uk/' },
  { id: 730637298, name: "Quilters' Guild", type: 'museum', lat: 53.9604202, lng: -1.0758852, wikidata: 'Q125556685' },
  { id: 732346765, name: 'Bar Convent Museum', type: 'museum', lat: 53.9553835, lng: -1.0911805, wikidata: 'Q4857921', wikipedia: 'en:Bar Convent', website: 'https://www.bar-convent.org.uk/' },
  { id: 760466052, name: 'War Memorial', type: 'memorial', lat: 53.9599168, lng: -1.0895447, wikidata: 'Q22919983', wikipedia: 'en:York City War Memorial' },
  { id: 1145041932, name: 'Boer War Memorial', type: 'memorial', lat: 53.9616815, lng: -1.0837438, wikidata: 'Q111936599', wikipedia: 'en:Second Boer War Memorial, York' },
  { id: 1322858584, name: 'Queen Victoria', type: 'memorial', lat: 53.9541664, lng: -1.1120124, wikidata: 'Q26547763' },
  { id: 1374286557, name: 'Fulford Cross', type: 'monument', lat: 53.9437215, lng: -1.074167, wikidata: 'Q17662344' },
  { id: 1414952912, name: 'Railway Workers War Memorial', type: 'memorial', lat: 53.95866, lng: -1.0898163, wikidata: 'Q17549385', wikipedia: 'en:North Eastern Railway War Memorial' },
  { id: 1533530910, name: "Dick Turpin's grave", type: 'memorial', lat: 53.9548191, lng: -1.0759995, wikidata: 'Q26549103' },
  { id: 1593939831, name: 'Leeman Road District War Memorial', type: 'memorial', lat: 53.9651001, lng: -1.1082932, wikidata: 'Q26676710' },
  { id: 1843446913, name: 'Micklegate Bar Museum', type: 'museum', lat: 53.9558521, lng: -1.090889, wikidata: 'Q28232884', wikipedia: 'en:City Walls Experience at Micklegate Bar' },
  { id: 2214182263, name: 'W5', type: 'museum', lat: 54.604647, lng: -5.9150057, wikidata: 'Q115533768', website: 'https://w5online.co.uk/' },
  { id: 4011033716, name: 'Titanic Memorial', type: 'monument', lat: 54.5967047, lng: -5.9289903, wikidata: 'Q7809806', wikipedia: 'en:Titanic Memorial, Belfast' },
  { id: 4011033775, name: 'Lord Dufferin Monument', type: 'monument', lat: 54.5963754, lng: -5.9311808, wikidata: 'Q17778397' },
  { id: 4515810256, name: 'CS Lewis Square', type: 'park', lat: 54.5985808, lng: -5.8907589, wikidata: 'Q117829281' },
  { id: 12543575350, name: 'Northern Ireland War Memorial', type: 'museum', lat: 54.6024486, lng: -5.9280708, wikidata: 'Q7058536', website: 'https://www.niwarmemorial.org/' },
  { id: 13703593825, name: 'University of Atypical', type: 'gallery', lat: 54.602322, lng: -5.9311798, wikidata: 'Q141493077' },
  { id: 14077561738, name: 'Eileen Hickey Irish Republican History Museum', type: 'museum', lat: 54.5997333, lng: -5.950568, wikidata: 'Q6071154', wikipedia: 'en:Irish Republican History Museum', website: 'https://eileenhickeymuseum.com/' },
  { id: 10286999, name: 'Ormeau Park', type: 'park', lat: 54.5854997, lng: -5.9160527, wikidata: 'Q7103378', wikipedia: 'en:Ormeau Park' },
  { id: 10289074, name: 'Ulster Museum', type: 'museum', lat: 54.5823129, lng: -5.9353478, wikidata: 'Q3547979', wikipedia: 'en:Ulster Museum', website: 'http://www.nmni.com/um' },
  { id: 21532382, name: 'Botanic Gardens', type: 'park', lat: 54.5806154, lng: -5.9323491, wikidata: 'Q3115229', wikipedia: 'en:Botanic Gardens (Belfast)', website: 'https://www.belfastcity.gov.uk/botanicgardens' },
  { id: 32443996, name: 'Palm House', type: 'attraction', lat: 54.5835593, lng: -5.9336973, wikidata: 'Q17778220', website: 'https://www.belfastcity.gov.uk/things-to-do/tropical-ravine/visiting-the-tropical-ravine' },
  { id: 146343354, name: 'Musgrave Park', type: 'park', lat: 54.5699171, lng: -5.9761956, wikidata: 'Q6941169', wikipedia: 'en:Musgrave Park, Belfast' },
  { id: 158101610, name: 'HMS Caroline', type: 'attraction', lat: 54.6138856, lng: -5.9025938, wikidata: 'Q1504233', wikipedia: 'en:HMS Caroline (1914)', website: 'http://www.hmscaroline.co.uk/' },
  { id: 264217278, name: 'SS Nomadic', type: 'attraction', lat: 54.6063559, lng: -5.911149, wikidata: 'Q2287825', wikipedia: 'en:SS Nomadic (1911)', website: 'https://www.nomadicbelfast.com/' },
  { id: 296927506, name: 'The Belfast Barge', type: 'events_venue', lat: 54.5986568, lng: -5.920552, wikidata: 'Q113363768', website: 'https://www.belfastbarge.org/' },
]

// York plus 4 other UK towns from shared/towns.mjs (the /town hub's list)
const TOWN_SLUGS = ['york', 'manchester', 'edinburgh', 'bristol', 'cardiff']

// src/utils/categories.ts getCategoryForType: first category whose types
// include place.type (same table as shared/overpassQuery.js)
const categoryFor = type => Object.entries(GOOD_CATEGORY_TYPES).find(([, types]) => types.includes(type))?.[0] || null

// src/utils/placeImage.js fetchEnhancedImage (~lines 191-243): the exact
// params, in the exact order, the client sends. Warm and k6 must request the
// identical URL or they are different CDN cache entries.
export function imageResolvePath(place) {
  const params = new URLSearchParams()
  if (place.wikipedia) params.set('wikipedia', place.wikipedia)
  if (place.wikidata) params.set('wikidata', place.wikidata)
  if (place.commons) params.set('commons', place.commons)
  if (place.website) params.set('website', place.website)
  if (place.name) params.set('name', place.name)
  if (place.category) params.set('category', place.category)
  params.set('lat', String(place.lat))
  params.set('lng', String(place.lng))
  return `/api/places/image-resolve?${params.toString()}`
}

export function build() {
  const places = PLACES.map(p => ({ ...p, category: categoryFor(p.type) }))
  return {
    userAgent: USER_AGENT,
    overpass: CITIES.flatMap(([city, lat, lng]) => RADII_M.map(radius => ({
      city,
      radius,
      // src/utils/apiClient.js fetchNearbyPlaces: no category = the all-types deck
      query: buildDiscoverOverpassQuery(lat, lng, radius, null).query,
    }))),
    places,
    imageResolve: places.map(imageResolvePath),
    towns: TOWN_SLUGS.map(slug => `/town/${slug}`),
    // src/components/TrendingPlaces.jsx:41 → src/hooks/useTrendingPlaces.js:29
    trending: '/api/places/trending?limit=8&days=30',
  }
}

// Self-check: the contract k6.js and warm.mjs rely on
export function check(out) {
  assert.equal(out.overpass.length, 16)
  for (const { query } of out.overpass) {
    assert.ok(query.startsWith('[out:json]') && query.includes('out tags center;'))
    assert.ok(query.length < 10000, 'proxy rejects queries over 10000 chars (api/places/overpass/nearby.js)')
  }
  assert.equal(out.places.length, 30)
  assert.equal(new Set(out.places.map(p => p.id)).size, 30)
  assert.equal(new Set(out.places.map(p => p.wikidata)).size, 30)
  for (const p of out.places) {
    assert.match(p.wikidata, /^Q\d+$/)
    assert.ok(p.category, `no category for type ${p.type}`)
  }
  assert.equal(new Set(out.imageResolve).size, 30)
  assert.equal(out.towns.length, 5)
  assert.doesNotMatch(out.userAgent, /bot|crawl|spider|preview/i)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = build()
  check(out)
  writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n')
  console.log(`wrote ${OUT}: ${out.overpass.length} Overpass queries, ${out.imageResolve.length} image-resolve URLs, ${out.towns.length} town pages`)
}
