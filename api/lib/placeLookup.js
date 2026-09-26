/**
 * One OSM place by id, for link previews (api/share-meta.js) and their image
 * (api/og/place.tsx). KV-cached, misses included, so previews for the same
 * place (or junk ids) cost at most one Overpass query a day.
 */
import { callOverpassProxy } from '../town.js'
import { cached, displayPlaceName, kindLabel, iconForKind } from './towns.js'
import { pickPlaceElement } from '../../shared/osmPick.mjs'

const HIT_TTL = 24 * 60 * 60
const MISS_TTL = 60 * 60

const OSM_ID = /^(?:([nwr])(\d{1,12})|(\d{1,12}))$/
const TYPES = { n: 'node', w: 'way', r: 'relation' }

export const isOsmId = id => OSM_ID.test(id || '')

// First tag that names what the place is ("historic=yes" says nothing, skip it)
const KIND_TAGS = ['tourism', 'leisure', 'historic', 'amenity', 'natural', 'shop']
const kindOf = tags => KIND_TAGS.map(k => tags[k]).find(v => v && v !== 'yes') || ''

// timeoutMs: link-preview bots can wait (they're the only readers of these tags);
// people shouldn't. A cold Overpass lookup takes 2-10s; once found it's cached.
export async function lookupPlace(id, ip, { proxy, timeoutMs = 8000 } = {}) {
  const m = OSM_ID.exec(id || '')
  if (!m) return null
  return cached(`place:preview:v3:${id}`, v => (v ? HIT_TTL : MISS_TTL), async () => {
    // Bare numbers are node-or-way (fetchPlaceById's rule); typed ids are exact
    const select = m[1] ? `${TYPES[m[1]]}(${m[2]});` : `(node(${m[3]});way(${m[3]}););`
    const { status, body } = await callOverpassProxy(`[out:json][timeout:10];${select}out tags center;`, ip, proxy, timeoutMs)
    if (status !== 200) throw new Error(`overpass ${status}`) // outages aren't cached as "no such place"
    const el = pickPlaceElement(body?.elements)
    const tags = el?.tags
    const name = tags && displayPlaceName(tags)
    if (!name) return null
    const kindKey = kindOf(tags)
    return {
      id,
      name,
      kind: kindLabel(kindKey),
      icon: iconForKind(kindKey),
      where: tags['addr:city'] || tags['addr:town'] || tags['addr:village'] || '',
      lat: el.lat ?? el.center?.lat ?? null,
      lng: el.lon ?? el.center?.lon ?? null,
      hints: {
        wikipedia: tags.wikipedia, wikidata: tags.wikidata, website: tags.website,
        commons: /^File:/i.test(tags.wikimedia_commons || '') ? tags.wikimedia_commons : undefined
      }
    }
  })
}
