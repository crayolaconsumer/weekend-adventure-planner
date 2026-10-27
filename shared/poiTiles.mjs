/**
 * Static POI block format ("option C", phase 1). The same rows as the `pois`
 * table (scripts/poi/build.mjs), stored as one object per 1-degree block so a
 * server can answer a Discover bbox with HTTP Range reads instead of MySQL.
 *
 *   b/<blockId>.<sha8>.bin   header + one brotli member per 0.1-degree cell
 *   b/large.<sha8>.bin       one brotli member: every LARGE_CELL row
 *   b/ids.<sha8>.bin         id index: (osm_type, osm_id) -> cell (see encodeIdIndex)
 *   manifests/<build>.json   { build_id, ..., blocks: { blockId: sha8 }, large: sha8, ids: sha8 }
 *   current.json             { manifest: 'manifests/<build>.json' }
 *
 * Block header (HEADER_BYTES, little-endian):
 *   0   'RPOI'               magic
 *   4   u8 version (1), 3 zero bytes
 *   8   u32 blockId
 *   12  100 x (u32 offset, u32 length) per cell, offset from the body start
 *       (= HEADER_BYTES); length 0 = no rows in that cell
 *   812 13-byte bitmap, bit i = cell i is covered (inside the extract polygons)
 * Cell i of a block = (row % 10) * 10 + (col % 10), row/col as in poiCell.mjs.
 *
 * Cell body: rows sorted by (osm_type, osm_id), one per line:
 *   JSON [osm_type, osm_id, min_lat, min_lon, max_lat, max_lon, k_amenity, k_tourism,
 *         k_leisure, k_historic, k_shop, k_natural, k_man_made, has_name_tag,
 *         has_wikidata, q, cat, flags] TAB el
 * el is the stored element JSON verbatim (JSON escapes tabs and newlines, so
 * neither can occur inside it); the query side never parses it.
 */
import { brotliCompressSync, brotliDecompress, brotliDecompressSync, constants } from 'node:zlib'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { POI_KEYS } from '../scripts/poi/filter.mjs'

export const MAGIC = 'RPOI'
export const FORMAT_VERSION = 1
export const CELLS = 100
export const HEADER_BYTES = 12 + CELLS * 8 + Math.ceil(CELLS / 8) // 825
const COLS = 3600
const BLOCK_COLS = 360

export const K_FIELDS = POI_KEYS.map(k => `k_${k}`)

/** A pois cell number -> { block, idx } (1-degree block id, cell index inside it). */
export function blockOf(cell) {
  const row = Math.floor(cell / COLS)
  const col = cell % COLS
  return { block: Math.floor(row / 10) * BLOCK_COLS + Math.floor(col / 10), idx: (row % 10) * 10 + (col % 10) }
}

/** Inverse of blockOf. */
export function cellOf(block, idx) {
  const row = Math.floor(block / BLOCK_COLS) * 10 + Math.floor(idx / 10)
  const col = (block % BLOCK_COLS) * 10 + (idx % 10)
  return row * COLS + col
}

const byOsm = (a, b) => a.osm_type - b.osm_type || a.osm_id - b.osm_id

export function encodeRow(r) {
  return JSON.stringify([r.osm_type, r.osm_id, r.min_lat, r.min_lon, r.max_lat, r.max_lon,
    ...K_FIELDS.map(k => r[k] ?? null), r.has_name_tag, r.has_wikidata, r.q, r.cat, r.flags]) + '\t' + r.el
}

export function decodeRow(line) {
  const tab = line.indexOf('\t')
  const m = JSON.parse(line.slice(0, tab))
  const row = { osm_type: m[0], osm_id: m[1], min_lat: m[2], min_lon: m[3], max_lat: m[4], max_lon: m[5] }
  for (let i = 0; i < K_FIELDS.length; i++) row[K_FIELDS[i]] = m[6 + i]
  const j = 6 + K_FIELDS.length
  Object.assign(row, { has_name_tag: m[j], has_wikidata: m[j + 1], q: m[j + 2], cat: m[j + 3], flags: m[j + 4], el: line.slice(tab + 1) })
  return row
}

// Brotli text mode, max quality: built once a night, read on every request
const BROTLI = { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT } }

/** Rows -> one brotli member (rows sorted here, so callers needn't). */
export function encodeRows(rows) {
  return brotliCompressSync([...rows].sort(byOsm).map(encodeRow).join('\n'), BROTLI)
}

// An empty member (a build with no LARGE_CELL rows) is no rows, not one empty line
const rowsOf = text => (text ? text.split('\n').map(decodeRow) : [])

export function decodeRows(buf) {
  return rowsOf(buf.length ? brotliDecompressSync(buf).toString('utf8') : '')
}

const brotliDecompressAsync = promisify(brotliDecompress)
/** decodeRows off the event loop: the decompression runs on libuv's threadpool. Same rows. */
export async function decodeRowsAsync(buf) {
  return rowsOf(buf.length ? (await brotliDecompressAsync(buf)).toString('utf8') : '')
}

export const sha8 = buf => createHash('sha256').update(buf).digest('hex').slice(0, 8)

/**
 * One block file. `cells`: Map idx -> rows; `covered`: iterable of covered idx.
 * Returns a Buffer (header + body).
 */
export function encodeBlock(block, cells, covered = []) {
  const header = Buffer.alloc(HEADER_BYTES)
  header.write(MAGIC, 0, 'latin1')
  header.writeUInt8(FORMAT_VERSION, 4)
  header.writeUInt32LE(block, 8)
  const parts = []
  let offset = 0
  for (let idx = 0; idx < CELLS; idx++) {
    const rows = cells.get(idx)
    const buf = rows?.length ? encodeRows(rows) : Buffer.alloc(0)
    header.writeUInt32LE(offset, 12 + idx * 8)
    header.writeUInt32LE(buf.length, 16 + idx * 8)
    parts.push(buf)
    offset += buf.length
  }
  for (const idx of covered) header[12 + CELLS * 8 + (idx >> 3)] |= 1 << (idx & 7)
  return Buffer.concat([header, ...parts])
}

/** Header bytes -> { block, cells: [{ offset, length }] x 100, covered: Uint8Array(100) of 0/1 }. Throws on a bad header. */
export function decodeHeader(buf) {
  if (buf.length < HEADER_BYTES || buf.toString('latin1', 0, 4) !== MAGIC) throw new Error('not a POI block')
  if (buf.readUInt8(4) !== FORMAT_VERSION) throw new Error(`POI block version ${buf.readUInt8(4)}`)
  const cells = []
  const covered = new Uint8Array(CELLS)
  for (let idx = 0; idx < CELLS; idx++) {
    cells.push({ offset: buf.readUInt32LE(12 + idx * 8), length: buf.readUInt32LE(16 + idx * 8) })
    covered[idx] = (buf[12 + CELLS * 8 + (idx >> 3)] >> (idx & 7)) & 1
  }
  return { block: buf.readUInt32LE(8), cells, covered }
}

export const blockKey = (block, sha) => `b/${block}.${sha}.bin`
export const largeKey = sha => `b/large.${sha}.bin`

/**
 * Id index (phase 2): b/ids.<sha8>.bin answers "which cell holds node/way/relation N"
 * for id lookups (lookupPlace, /place pages), so they can be read from the blocks too.
 *
 *   0   'RPID' magic, 4 u8 version (1), 3 zero bytes
 *   8   u32 shard count (ID_SHARDS)
 *   12  ID_SHARDS x (u32 offset, u32 length) per shard, offset from the body start
 *   ... one brotli member per shard: lines "osm_type osm_id cell", sorted by (type, id)
 * Shard of an element = osm_id % ID_SHARDS. GB (592k rows): ~580 ids, ~4 KB a shard.
 */
export const ID_MAGIC = 'RPID'
export const ID_SHARDS = 1024
export const ID_HEADER_BYTES = 12 + ID_SHARDS * 8 // 8204
export const idShardOf = osmId => osmId % ID_SHARDS
export const idsKey = sha => `b/ids.${sha}.bin`

/** Rows ({ osm_type, osm_id, cell }) -> the id index file. */
export function encodeIdIndex(rows) {
  const shards = Array.from({ length: ID_SHARDS }, () => [])
  for (const r of rows) shards[idShardOf(r.osm_id)].push(r)
  const header = Buffer.alloc(ID_HEADER_BYTES)
  header.write(ID_MAGIC, 0, 'latin1')
  header.writeUInt8(FORMAT_VERSION, 4)
  header.writeUInt32LE(ID_SHARDS, 8)
  const parts = []
  let offset = 0
  shards.forEach((list, i) => {
    const buf = list.length
      ? brotliCompressSync(list.sort(byOsm).map(r => `${r.osm_type} ${r.osm_id} ${r.cell}`).join('\n'), BROTLI)
      : Buffer.alloc(0)
    header.writeUInt32LE(offset, 12 + i * 8)
    header.writeUInt32LE(buf.length, 16 + i * 8)
    parts.push(buf)
    offset += buf.length
  })
  return Buffer.concat([header, ...parts])
}

/** Id index header -> [{ offset, length }] x ID_SHARDS. Throws on a bad header. */
export function decodeIdHeader(buf) {
  if (buf.length < ID_HEADER_BYTES || buf.toString('latin1', 0, 4) !== ID_MAGIC) throw new Error('not a POI id index')
  if (buf.readUInt8(4) !== FORMAT_VERSION || buf.readUInt32LE(8) !== ID_SHARDS) throw new Error('POI id index version')
  return Array.from({ length: ID_SHARDS }, (_, i) => ({ offset: buf.readUInt32LE(12 + i * 8), length: buf.readUInt32LE(16 + i * 8) }))
}

/** One shard member -> the cell of (type, id), or null when the build doesn't have it. */
export function findIdCell(buf, osmType, osmId) {
  if (!buf.length) return null
  const want = `${osmType} ${osmId} `
  for (const line of brotliDecompressSync(buf).toString('utf8').split('\n')) {
    if (line.startsWith(want)) return Number(line.slice(want.length))
  }
  return null
}
