#!/usr/bin/env node
/**
 * POI release -> static block files (format: shared/poiTiles.mjs).
 *
 *   gh release download poi-uk-20261025T2121Z-f2 --pattern 'chunk-*' --pattern manifest.json --pattern coverage.json --dir rel/
 *   node scripts/poi/tiles.mjs --release rel/ --out tiles/ [--measure]
 *
 * Content-addressed: a block's key carries the sha of its bytes, so a block
 * whose rows didn't change keeps its key (and an existing file is not
 * rewritten); only changed blocks need uploading. --measure also compresses
 * every block as ONE brotli member, to report what per-cell members cost.
 * Exits 1 if the blocks don't hold exactly the release's rows.
 */
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { createGunzip } from 'node:zlib'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { LARGE_CELL } from '../../shared/poiCell.mjs'
import { blockKey, blockOf, encodeBlock, encodeIdIndex, encodeRow, encodeRows, idsKey, largeKey, sha8, HEADER_BYTES } from '../../shared/poiTiles.mjs'
import { brotliCompressSync, constants } from 'node:zlib'

export async function* releaseRows(dir) {
  for (const name of readdirSync(dir).filter(n => /^chunk-\d+\.ndjson\.gz$/.test(n)).sort()) {
    const lines = createInterface({ input: createReadStream(join(dir, name)).pipe(createGunzip()), crlfDelay: Infinity })
    for await (const line of lines) if (line) yield JSON.parse(line)
  }
}

/** Rows + covered cells -> { blocks: Map block -> Map idx -> rows, covered: Map block -> Set idx, large: rows } */
export function groupRows(rows, coverage) {
  const blocks = new Map()
  const covered = new Map()
  const large = []
  for (const r of rows) {
    if (r.cell === LARGE_CELL) { large.push(r); continue }
    const { block, idx } = blockOf(r.cell)
    if (!blocks.has(block)) blocks.set(block, new Map())
    const cells = blocks.get(block)
    if (!cells.has(idx)) cells.set(idx, [])
    cells.get(idx).push(r)
  }
  for (const c of coverage) {
    const { block, idx } = blockOf(c)
    if (!covered.has(block)) covered.set(block, new Set())
    covered.get(block).add(idx)
  }
  return { blocks, covered, large }
}

/** Writes the files; returns { manifest, stats }. */
export function writeTiles({ blocks, covered, large }, meta, outDir, { measure = false } = {}) {
  mkdirSync(join(outDir, 'b'), { recursive: true })
  mkdirSync(join(outDir, 'manifests'), { recursive: true })
  const put = (key, buf) => {
    const path = join(outDir, key)
    if (existsSync(path)) return false
    writeFileSync(path, buf)
    return true
  }
  const ids = [...new Set([...blocks.keys(), ...covered.keys()])].sort((a, b) => a - b)
  const entries = {}
  const stats = { blocks: 0, bytes: 0, rows: 0, written: 0, largest: null, wholeBlockBytes: 0, headerBytes: 0 }
  for (const block of ids) {
    const cells = blocks.get(block) || new Map()
    const buf = encodeBlock(block, cells, covered.get(block) || [])
    const sha = sha8(buf)
    entries[block] = sha
    if (put(blockKey(block, sha), buf)) stats.written++
    const rows = [...cells.values()].reduce((n, c) => n + c.length, 0)
    stats.blocks++
    stats.bytes += buf.length
    stats.headerBytes += HEADER_BYTES
    stats.rows += rows
    if (!stats.largest || buf.length > stats.largest.bytes) stats.largest = { block, bytes: buf.length, rows }
    if (measure && rows) {
      const all = [...cells.values()].flat().map(encodeRow).join('\n')
      stats.wholeBlockBytes += brotliCompressSync(all, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT } }).length
    }
  }
  const largeBuf = encodeRows(large)
  const largeSha = sha8(largeBuf)
  if (put(largeKey(largeSha), largeBuf)) stats.written++
  stats.largeBytes = largeBuf.length
  stats.rows += large.length
  // Id index over every row, LARGE ones included (their cell is LARGE_CELL)
  const idsBuf = encodeIdIndex([...large, ...[...blocks.values()].flatMap(cells => [...cells.values()].flat())])
  const idsSha = sha8(idsBuf)
  if (put(idsKey(idsSha), idsBuf)) stats.written++
  stats.idsBytes = idsBuf.length
  const manifest = { ...meta, format_version: 1, header_bytes: HEADER_BYTES, blocks: entries, large: largeSha, large_rows: large.length, ids: idsSha }
  const manifestKey = `manifests/${meta.build_id}.json`
  writeFileSync(join(outDir, manifestKey), JSON.stringify(manifest))
  writeFileSync(join(outDir, 'current.json'), JSON.stringify({ manifest: manifestKey, build_id: meta.build_id }))
  return { manifest, manifestKey, stats }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { values: a } = parseArgs({ options: { release: { type: 'string' }, out: { type: 'string' }, measure: { type: 'boolean', default: false } } })
  if (!a.release || !a.out) {
    console.error('usage: tiles.mjs --release <dir with chunk-*.ndjson.gz, manifest.json, coverage.json> --out <dir> [--measure]')
    process.exit(2)
  }
  const t0 = Date.now()
  const rel = JSON.parse(readFileSync(join(a.release, 'manifest.json'), 'utf8'))
  const coverage = JSON.parse(readFileSync(join(a.release, 'coverage.json'), 'utf8'))
  const rows = []
  for await (const r of releaseRows(a.release)) rows.push(r)
  const meta = { build_id: rel.build_id, schema_version: rel.schema_version, features_version: rel.features_version, osm_timestamp: rel.osm_timestamp, row_count: rel.row_count }
  const { manifestKey, stats } = writeTiles(groupRows(rows, coverage), meta, a.out, { measure: a.measure })
  const rawRowBytes = rows.reduce((n, r) => n + Buffer.byteLength(encodeRow(r)) + 1, 0)
  const total = stats.bytes + stats.largeBytes + stats.idsBytes
  console.log(JSON.stringify({
    build_id: rel.build_id, manifest: manifestKey, rows: stats.rows, release_rows: rel.row_count, blocks: stats.blocks, written: stats.written,
    total_bytes: total, bytes_per_row: +(total / stats.rows).toFixed(1), raw_row_bytes: rawRowBytes, header_bytes: stats.headerBytes,
    largest_block: stats.largest, large_bytes: stats.largeBytes, ids_bytes: stats.idsBytes,
    ...(a.measure ? { whole_block_brotli_bytes: stats.wholeBlockBytes, per_cell_overhead: +((stats.bytes - stats.headerBytes) / stats.wholeBlockBytes - 1).toFixed(4) } : {}),
    secs: (Date.now() - t0) / 1000,
  }, null, 1))
  if (stats.rows !== rel.row_count) {
    console.error(`blocks hold ${stats.rows} rows, release has ${rel.row_count}`)
    process.exit(1)
  }
}
