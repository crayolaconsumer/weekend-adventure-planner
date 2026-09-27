// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { Readable } from 'node:stream'
import { trimOverpassResponse } from '../../../api/lib/overpassTrim.js'
import { LARGE_CELL, poiCell } from '../../../shared/poiCell.mjs'
import {
  CHUNK_ROWS, build, buildId, buildRowsFromStreams, coverageCells, decodeId, featureToRow,
  MAX_LARGE, gateFailures, inPoly, missingSentinels, parsePoly, segmentTouchesRect, readOplRelations, writeChunks,
} from '../../../scripts/poi/build.mjs'
import { makeMatcher } from '../../../scripts/poi/filter.mjs'

const match = makeMatcher()
const buildRows = features => buildRowsFromStreams([features], match)

// Real Rutland fixture: Oakham Castle as osmium exports it (closed way ->
// w<id> LineString AND a<id*2> area), and what live Overpass returned for it.
const oakhamRing = [[-0.7276453, 52.6709113], [-0.7276113, 52.6710308], [-0.7274084, 52.6710096], [-0.727404, 52.6710244], [-0.7273711, 52.6711439], [-0.7272484, 52.6711316], [-0.7272608, 52.671088], [-0.7272881, 52.6710908], [-0.7273138, 52.6710005], [-0.7272152, 52.6709902], [-0.727254, 52.6708535], [-0.7275892, 52.6708885], [-0.7275846, 52.6709049], [-0.7276453, 52.6709113]]
const oakhamTags = { 'addr:city': 'Oakham', 'addr:postcode': 'LE15 6DR', 'addr:street': 'Castle Lane', building: 'yes', castle_type: 'manor', historic: 'castle', 'historic:civilization': 'Norman', name: 'Oakham Castle', operator: 'Rutland County Council', source: 'survey', wikidata: 'Q2968294', wikipedia: 'en:Oakham Castle' }
const oakhamLine = { type: 'Feature', id: 'w417617998', geometry: { type: 'LineString', coordinates: oakhamRing }, properties: oakhamTags }
const oakhamArea = { type: 'Feature', id: 'a835235996', geometry: { type: 'MultiPolygon', coordinates: [[oakhamRing]] }, properties: oakhamTags }
const oakhamOverpass = {
  center: { lat: 52.6709987, lon: -0.7274303 },
  bounds: { minlat: 52.6708535, minlon: -0.7276453, maxlat: 52.6711439, maxlon: -0.7272152 },
}

const node = (id, lon, lat, tags) => ({ type: 'Feature', id: `n${id}`, geometry: { type: 'Point', coordinates: [lon, lat] }, properties: tags })
const el = row => JSON.parse(row.el)

describe('decodeId (osmium --add-unique-id=type_id)', () => {
  it('decodes nodes, ways, relations and areas', () => {
    expect(decodeId('n18337815')).toEqual({ type: 'node', id: 18337815 })
    expect(decodeId('w417617998')).toEqual({ type: 'way', id: 417617998 })
    expect(decodeId('r9769265')).toEqual({ type: 'relation', id: 9769265 })
    expect(decodeId('a835235996')).toEqual({ type: 'way', id: 417617998 })
    expect(decodeId('a8055165')).toEqual({ type: 'relation', id: 4027582 })
    expect(decodeId('x1')).toBeNull()
    expect(decodeId(undefined)).toBeNull()
  })
})

describe('featureToRow', () => {
  it('node: lat/lon, no center/bounds, cell from its position', () => {
    const row = featureToRow(node(18337815, -0.7221169, 52.5875688, { amenity: 'pub', name: 'The Vaults', fixme: 'x' }), match)
    expect(row).toMatchObject({ cell: poiCell(52.5875688, -0.7221169), osm_type: 1, osm_id: 18337815, lat: 52.5875688, lon: -0.7221169, k_amenity: 'pub', k_shop: null, has_name: 1, has_name_tag: 1, has_wikidata: 0 })
    expect(row).toMatchObject({ min_lat: 52.5875688, max_lat: 52.5875688, min_lon: -0.7221169, max_lon: -0.7221169 })
    expect(el(row)).toEqual({ type: 'node', id: 18337815, lat: 52.5875688, lon: -0.7221169, tags: { amenity: 'pub', name: 'The Vaults' } })
  })

  it('closed way: centre and bounds match live Overpass exactly, LineString or area', () => {
    for (const f of [oakhamLine, oakhamArea]) {
      const row = featureToRow(f, match)
      const e = el(row)
      expect(e.type).toBe('way')
      expect(e.id).toBe(417617998)
      expect(e.center).toEqual(oakhamOverpass.center)
      expect(e.bounds).toEqual(oakhamOverpass.bounds)
      expect(e.lat).toBeUndefined()
      expect(row).toMatchObject({ osm_type: 2, lat: 52.6709987, lon: -0.7274303, cell: poiCell(52.6709987, -0.7274303), k_historic: 'castle', has_wikidata: 1 })
      // Row bounds = el bounds, so the query can match Overpass (bbox) intersection
      expect(row).toMatchObject({ min_lat: 52.6708535, min_lon: -0.7276453, max_lat: 52.6711439, max_lon: -0.7272152 })
    }
  })

  it('relation (multipolygon area): centre = bbox centre of all rings', () => {
    const f = { type: 'Feature', id: 'a8055165', properties: { natural: 'water', name: 'Rutland Water' }, geometry: { type: 'MultiPolygon', coordinates: [
      [[[-0.7, 52.63], [-0.6, 52.63], [-0.6, 52.68], [-0.7, 52.63]]],
      [[[-0.66, 52.6], [-0.62, 52.6], [-0.62, 52.61], [-0.66, 52.6]]],
    ] } }
    const row = featureToRow(f, match)
    expect(el(row)).toMatchObject({ type: 'relation', id: 4027582, center: { lat: 52.64, lon: -0.65 }, bounds: { minlat: 52.6, minlon: -0.7, maxlat: 52.68, maxlon: -0.6 } })
    expect(row.osm_type).toBe(3)
    expect(row.k_natural).toBe('water')
  })

  it('tags are trimmed exactly like trimOverpassResponse', () => {
    const tags = { ...oakhamTags, 'name:fr': 'Château', 'addr:country': 'GB', 'source:geometry': 'x', check_date: '2024' }
    const row = featureToRow({ ...oakhamArea, properties: tags }, match)
    const expected = trimOverpassResponse({ elements: [{ type: 'way', id: 417617998, ...oakhamOverpass, tags }] }).elements[0]
    expect(el(row)).toEqual(expected)
    expect(row.el).toBe(JSON.stringify(expected))
  })

  it('drops unnamed elements, keeps name:en-only ones', () => {
    expect(featureToRow(node(1, 0, 51, { amenity: 'cafe' }), match)).toBeNull()
    // has_name_tag: Overpass ["name"] needs the name tag itself, name:en doesn't count
    expect(featureToRow(node(2, 0, 51, { amenity: 'cafe', 'name:en': 'Cafe' }), match)).toMatchObject({ has_name: 1, has_name_tag: 0 })
    expect(featureToRow(node(2, 0, 51, { amenity: 'cafe', name: 'Caffè', 'name:en': 'Cafe' }), match)).toMatchObject({ has_name: 1, has_name_tag: 1 })
  })

  it('drops things tags-filter only kept for geometry', () => {
    expect(featureToRow(node(3, 0, 51, { highway: 'bus_stop', name: 'Stop' }), match)).toBeNull()
    expect(featureToRow({ ...oakhamLine, properties: { building: 'yes', name: 'Shed' } }, match)).toBeNull()
  })

  it('k_* is null for a value too long for VARCHAR(48)', () => {
    const row = featureToRow(node(4, 0, 51, { amenity: 'cafe', shop: 'x'.repeat(49), name: 'A' }), match)
    expect(row.k_shop).toBeNull()
    expect(row.k_amenity).toBe('cafe')
  })
})

describe('LARGE_CELL bucket (elements wider than the query padding)', () => {
  const wide = (id, span) => featureToRow({ id: `w${id}`, properties: { natural: 'bay', name: `Bay ${id}` }, geometry: { type: 'LineString', coordinates: [[-4.5, 51.2], [-4.5 + span, 51.3]] } }, match)

  it('a Bristol Channel-sized bay goes to cell 0, keeping its real centre and bounds', () => {
    const row = wide(668036107, 2.25)
    expect(LARGE_CELL).toBe(0)
    expect(row.cell).toBe(LARGE_CELL)
    expect(row).toMatchObject({ lat: 51.25, lon: -3.375, min_lon: -4.5, max_lon: -2.25 })
    expect(JSON.parse(row.el).center).toEqual({ lat: 51.25, lon: -3.375 })
  })

  it('a normal park keeps its centre cell', () => {
    const park = featureToRow({ id: 'w372975520', properties: { leisure: 'park', name: 'Hyde Park' }, geometry: { type: 'LineString', coordinates: [[-0.1878, 51.5025], [-0.1527, 51.5118]] } }, match)
    expect(park.cell).toBe(poiCell(park.lat, park.lon))
    expect(park.cell).not.toBe(LARGE_CELL)
  })

  it('cell-0 rows sort first', async () => {
    const rows = await buildRows([node(1, -0.1, 51.5, { amenity: 'cafe', name: 'A' }), { id: 'w9', properties: { natural: 'bay', name: 'Big' }, geometry: { type: 'LineString', coordinates: [[-5, 51], [-3, 51.1]] } }])
    expect(rows.map(r => r.cell)).toEqual([0, poiCell(51.5, -0.1)])
  })
})

describe('buildRowsFromStreams', () => {
  it('dedupes by (type, id) and sorts by (cell, osm_type, osm_id)', async () => {
    const rows = await buildRows([
      oakhamLine, oakhamArea,
      node(900, -0.72743, 52.671, { amenity: 'cafe', name: 'Same cell, node' }),
      node(5, -0.72743, 52.671, { amenity: 'cafe', name: 'Same cell, lower id' }),
      node(5, -0.72743, 52.671, { amenity: 'cafe', name: 'Duplicate from 2nd extract' }),
      node(7, -3.19, 55.95, { historic: 'castle', name: 'North' }),
      node(8, -5.93, 54.6, { amenity: 'pub', name: 'West' }),
    ])
    expect(rows.map(r => `${r.osm_type}/${r.osm_id}`)).toEqual(['1/5', '1/900', '2/417617998', '1/8', '1/7'])
    expect(el(rows[0]).tags.name).toBe('Same cell, lower id')
    for (let i = 1; i < rows.length; i++) expect(rows[i].cell).toBeGreaterThanOrEqual(rows[i - 1].cell)
  })
})

describe('dedupe across extracts', () => {
  it('keeps the copy with the larger bounds (the complete relation), whichever came first', async () => {
    const cut = { id: 'a8055165', properties: { natural: 'water', name: 'Lough' }, geometry: { type: 'MultiPolygon', coordinates: [[[[-6, 54], [-5.9, 54], [-5.9, 54.1], [-6, 54]]]] } }
    const full = { ...cut, geometry: { type: 'MultiPolygon', coordinates: [[[[-6.2, 54], [-5.9, 54], [-5.9, 54.2], [-6.2, 54]]]] } }
    for (const order of [[cut, full], [full, cut]]) {
      const [row] = await buildRows(order)
      expect(row).toMatchObject({ min_lon: -6.2, max_lat: 54.2 })
    }
  })
})

describe('buildRowsFromStreams (memory: never holds raw features)', () => {
  it('converts each feature before the next is read', async () => {
    const events = []
    const matcher = tags => { events.push(`match ${tags.name}`); return match(tags) }
    async function* stream() {
      for (let i = 0; i < 3; i++) {
        events.push(`read ${i}`)
        yield node(i + 1, -0.1, 51.5, { amenity: 'cafe', name: String(i) })
      }
    }
    const rows = await buildRowsFromStreams([stream()], matcher)
    expect(rows).toHaveLength(3)
    expect(events).toEqual(['read 0', 'match 0', 'read 1', 'match 1', 'read 2', 'match 2'])
  })
})

describe('readOplRelations (relations osmium cannot build as areas)', () => {
  it('uses member ways and nodes for the bbox and decodes OPL tags', async () => {
    const opl = [
      'n10 v1 dV c0 t2020-01-01T00:00:00Z i0 u T x-0.60 y52.70',
      'n11 v1 dV c0 t2020-01-01T00:00:00Z i0 u Tbarrier=gate x-0.50 y52.75',
      'w20 v1 dV c0 t2020-01-01T00:00:00Z i0 u T Nn1x-0.58y52.72,n2x-0.55y52.74',
      'r9769265 v1 dV c0 t2019-07-09T22:57:26Z i0 u Tname=Clipsham%20%Park%20%Wood,natural=wood Mw20@outer,n10@label,w999@outer',
      'r30 v1 dV c0 t2020-01-01T00:00:00Z i0 u Tname=Empty,natural=wood Mw998@outer',
    ]
    const feats = []
    for await (const f of readOplRelations(Readable.from(opl))) feats.push(f)
    expect(feats).toHaveLength(1)
    const row = featureToRow(feats[0], match)
    expect(el(row)).toEqual({ type: 'relation', id: 9769265, center: { lat: 52.72, lon: -0.575 }, bounds: { minlat: 52.7, minlon: -0.6, maxlat: 52.74, maxlon: -0.55 }, tags: { name: 'Clipsham Park Wood', natural: 'wood' } })
  })
})

describe('chunks', () => {
  it('splits at 10,000 rows, names zero-padded, sha256 of the gz bytes, CONTRACT row keys', () => {
    const dir = mkdtempSync(join(tmpdir(), 'poi-chunks-'))
    try {
      const rows = Array.from({ length: CHUNK_ROWS + 1 }, (_, i) => featureToRow(node(i + 1, -0.1, 51.5, { amenity: 'cafe', name: `C${i}` }), match))
      const chunks = writeChunks(rows, dir)
      expect(chunks.map(c => [c.name, c.rows])).toEqual([['chunk-000.ndjson.gz', 10000], ['chunk-001.ndjson.gz', 1]])
      const gz = readFileSync(join(dir, 'chunk-001.ndjson.gz'))
      expect(chunks[1].sha256).toBe(createHash('sha256').update(gz).digest('hex'))
      const lines = gunzipSync(gz).toString().split('\n').filter(Boolean)
      const row = JSON.parse(lines[0])
      expect(Object.keys(row)).toEqual(['cell', 'osm_type', 'osm_id', 'lat', 'lon', 'min_lat', 'min_lon', 'max_lat', 'max_lon', 'k_amenity', 'k_tourism', 'k_leisure', 'k_historic', 'k_shop', 'k_natural', 'k_man_made', 'has_name', 'has_name_tag', 'has_wikidata', 'el'])
      expect(typeof row.el).toBe('string')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('coverage (.poly)', () => {
  const square = (s, w, n, e) => [[w, s], [e, s], [e, n], [w, n], [w, s]].map(([x, y]) => `   ${x.toExponential(6)}   ${y.toExponential(6)}`).join('\n')
  const polyText = `test\n1\n${square(50.99, -0.31, 51.31, 0.01)}\nEND\n!2\n${square(51.12, -0.18, 51.18, -0.12)}\nEND\nEND\n`

  it('parses outer rings and ! holes (scientific notation, like Geofabrik)', () => {
    const rings = parsePoly(polyText)
    expect(rings.map(r => [r.hole, r.pts.length])).toEqual([[false, 5], [true, 5]])
    expect(rings[0].pts[0]).toEqual([-0.31, 50.99])
    expect(inPoly(rings, -0.25, 51.05)).toBe(true)
    expect(inPoly(rings, -0.15, 51.15)).toBe(false) // in the hole
    expect(inPoly(rings, 0.5, 51.05)).toBe(false)
  })

  const all9 = () => {
    const out = []
    for (const lat of [51.05, 51.15, 51.25]) for (const lon of [-0.25, -0.15, -0.05]) out.push(poiCell(lat, lon))
    return out
  }
  const sorted = a => [...a].sort((x, y) => x - y)

  it('a hole strictly inside one cell (no corner in it) uncovers that cell', () => {
    // hole 51.12-51.18 x -0.18..-0.12 sits inside cell (51.1-51.2, -0.2..-0.1)
    const cells = coverageCells([parsePoly(polyText)])
    expect(sorted(cells)).toEqual(sorted(all9().filter(c => c !== poiCell(51.15, -0.15))))
  })

  it('a hole over a shared corner uncovers the four cells around it', () => {
    const holed = `test\n1\n${square(50.99, -0.31, 51.31, 0.01)}\nEND\n!2\n${square(51.08, -0.22, 51.12, -0.18)}\nEND\nEND\n`
    const withHole = coverageCells([parsePoly(holed)])
    expect(withHole).toHaveLength(5)
    expect(withHole).not.toContain(poiCell(51.05, -0.25))
  })

  it('a concave notch between the corners uncovers the cell even with all 4 corners inside', () => {
    // square with a thin notch cut in from the south edge, up to lat 51.15, between lon -0.16 and -0.14
    const pts = [[-0.31, 50.99], [-0.16, 50.99], [-0.16, 51.15], [-0.14, 51.15], [-0.14, 50.99], [0.01, 50.99], [0.01, 51.31], [-0.31, 51.31], [-0.31, 50.99]]
    const text = `n\n1\n${pts.map(([x, y]) => `  ${x} ${y}`).join('\n')}\nEND\nEND\n`
    const rings = parsePoly(text)
    // every corner of cell (51.1-51.2, -0.2..-0.1) is inside the polygon
    for (const [x, y] of [[-0.2, 51.1], [-0.1, 51.1], [-0.2, 51.2], [-0.1, 51.2]]) expect(inPoly(rings, x, y)).toBe(true)
    const cells = coverageCells([rings])
    expect(cells).not.toContain(poiCell(51.15, -0.15))
    expect(cells).not.toContain(poiCell(51.05, -0.15))
    expect(cells).toContain(poiCell(51.25, -0.15))
    expect(cells).toContain(poiCell(51.15, -0.25))
  })

  it('segmentTouchesRect: crossing, inside, touching, missing', () => {
    expect(segmentTouchesRect(-1, 0.5, 2, 0.5, 0, 0, 1, 1)).toBe(true) // crosses
    expect(segmentTouchesRect(0.2, 0.2, 0.3, 0.3, 0, 0, 1, 1)).toBe(true) // inside
    expect(segmentTouchesRect(1, -1, 1, 2, 0, 0, 1, 1)).toBe(true) // along an edge
    expect(segmentTouchesRect(1.5, 0, 2.5, 1, 0, 0, 1, 1)).toBe(false)
    expect(segmentTouchesRect(-1, 0.9, 0.9, -1, 0, 0, 1, 1)).toBe(false) // diagonal past the corner, bboxes overlap
  })

  it('unions several extracts; another extract border disqualifies the cells it crosses (conservative)', () => {
    const a = parsePoly(`a\n1\n${square(50.99, -0.31, 51.11, -0.19)}\nEND\nEND\n`)
    const b = parsePoly(`b\n1\n${square(52.99, -0.31, 53.11, -0.19)}\nEND\nEND\n`)
    expect(sorted(coverageCells([a, b]))).toEqual(sorted([poiCell(51.05, -0.25), poiCell(53.05, -0.25)]))
    // Overlapping: c's west edge (-0.21) crosses a's cell and a's east edge
    // (-0.19) crosses c's, so neither counts; those tiles use the legacy path
    const c = parsePoly(`c\n1\n${square(50.99, -0.21, 51.11, -0.09)}\nEND\nEND\n`)
    expect(coverageCells([a, c])).toEqual([])
  })
})

describe('gates and ids', () => {
  const m = { row_count: 200000, sentinels_found: 33, sentinels_total: 34, per_key_counts: { 'amenity=cafe': 10000, 'amenity=pub': 9500, 'historic=castle': 100 } }

  it('buildId from the osm replication timestamp', () => {
    expect(buildId('uk', '2026-09-26T20:22:51Z')).toBe('uk-20260926T2022Z')
    expect(buildId('uk', '2026-09-26T20:22:51Z')).toMatch(/^[a-z]{2,8}-\d{8}T\d{4}Z$/)
    expect(() => buildId('uk', 'nope')).toThrow()
  })

  it('drift applies to every key with 50+ rows before, not below', () => {
    expect(gateFailures(m, { per_key_counts: { 'amenity=cafe': 10000, 'historic=castle': 60 } })).toEqual(['historic=castle 60 -> 100 (over ±10%)'])
    expect(gateFailures(m, { per_key_counts: { 'amenity=cafe': 10000, 'historic=castle': 49 } })).toEqual([])
  })

  it('passes a healthy build', () => {
    expect(gateFailures(m, { per_key_counts: { 'amenity=cafe': 9800, 'amenity=pub': 9900, 'historic=castle': 95 } })).toEqual([])
    expect(gateFailures(m, null)).toEqual([])
  })

  it('fails on low rows, missing sentinels (naming them), and >10% drift on keys with 500+ rows', () => {
    const missing = [{ type: 'way', id: 1, name: 'York Minster' }]
    const f = gateFailures({ ...m, row_count: 1000, sentinels_found: 30 }, { per_key_counts: { 'amenity=cafe': 12000, 'historic=castle': 40 } }, {}, { missing })
    expect(f).toHaveLength(3)
    expect(f.join()).toMatch(/row_count/)
    expect(f.join()).toMatch(/sentinels 30\/34 < 0.9; missing: way\/1 York Minster/)
    expect(f.join()).toMatch(/amenity=cafe 12000 -> 10000/)
  })

  it('sentinel gate is 90%: 31/34 passes, 30/34 fails', () => {
    expect(gateFailures({ ...m, sentinels_found: 31 }, null)).toEqual([])
    expect(gateFailures({ ...m, sentinels_found: 30 }, null)).toHaveLength(1)
  })

  it('lists missing sentinels by type, id and exact name', async () => {
    const rows = await buildRows([oakhamArea])
    const wanted = [{ type: 'way', id: 417617998, name: 'Oakham Castle' }, { type: 'relation', id: 417617998, name: 'Oakham Castle' }, { type: 'way', id: 417617998, name: 'Other' }]
    expect(missingSentinels(rows, wanted)).toEqual(wanted.slice(1))
  })

  it('fails only when large_count exceeds MAX_LARGE', () => {
    expect(gateFailures({ ...m, large_count: MAX_LARGE }, null)).toEqual([])
    expect(gateFailures({ ...m, large_count: MAX_LARGE + 1 }, null)).toEqual([`large_count ${MAX_LARGE + 1} > ${MAX_LARGE} (elements in cell 0)`])
  })
})

describe('build (end to end on files)', () => {
  let dir
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'poi-build-')) })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('writes chunks, coverage.json and a CONTRACT-shaped manifest', async () => {
    const seq = [oakhamLine, oakhamArea, node(1, -0.72, 52.6, { amenity: 'cafe', name: 'A' }), node(2, -0.72, 52.6, { amenity: 'cafe' })]
    writeFileSync(join(dir, 'in.geojsonseq'), seq.map(f => '\x1e' + JSON.stringify(f)).join('\n') + '\n')
    writeFileSync(join(dir, 'rels.opl'), 'w20 v1 dV c0 t2020-01-01T00:00:00Z i0 u T Nn1x-0.58y52.72,n2x-0.55y52.74\nr30 v1 dV c0 t2020-01-01T00:00:00Z i0 u Tname=Wood,natural=wood Mw20@outer\n')
    writeFileSync(join(dir, 'x.poly'), 'x\n1\n -0.81 52.49\n -0.39 52.49\n -0.39 52.81\n -0.81 52.81\nEND\nEND\n')
    const out = join(dir, 'out')
    const { manifest, failures } = await build({
      inputs: [join(dir, 'in.geojsonseq')], relations: [join(dir, 'rels.opl')], polys: [join(dir, 'x.poly')],
      osmTimestamp: '2026-09-26T20:22:51Z', region: 'uk', outDir: out, prevManifest: null,
      sentinels: [{ type: 'way', id: 417617998, name: 'Oakham Castle' }], gates: { minRows: 0 },
    })
    expect(failures).toEqual([])
    const onDisk = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'))
    expect(onDisk).toEqual(manifest)
    expect(Object.keys(manifest)).toEqual(['build_id', 'schema_version', 'osm_timestamp', 'chunks', 'row_count', 'per_key_counts', 'photo_count', 'sentinels_found', 'sentinels_total', 'large_count'])
    expect(manifest.large_count).toBe(0)
    expect(manifest).toMatchObject({ build_id: 'uk-20260926T2022Z', schema_version: 1, osm_timestamp: '2026-09-26T20:22:51.000Z', row_count: 3, photo_count: 0, sentinels_found: 1, sentinels_total: 1 })
    expect(manifest.per_key_counts).toEqual({ 'amenity=cafe': 1, 'historic=castle': 1, 'natural=wood': 1 })
    expect(manifest.chunks).toHaveLength(1)
    const coverage = JSON.parse(readFileSync(join(out, 'coverage.json'), 'utf8'))
    expect(coverage).toHaveLength(3 * 4)
    expect(coverage.every(Number.isInteger)).toBe(true)
    expect(coverage).toContain(poiCell(52.6709987, -0.7274303))
  })
})
