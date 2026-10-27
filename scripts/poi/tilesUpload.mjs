#!/usr/bin/env node
/**
 * Upload a tiles build (scripts/poi/tiles.mjs --out) to R2. Blocks are
 * content-addressed, so a block already in the bucket is skipped; the manifest
 * goes up after every block, current.json last (readers switch builds only
 * once everything the new manifest names exists).
 *
 *   R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_ENDPOINT=... R2_BUCKET=roam-poi [R2_PREFIX=tiles/] \
 *     node scripts/poi/tilesUpload.mjs --tiles <dir> [--no-switch | --switch-only] [--prune 3]
 *
 * The nightly workflow runs it twice: --no-switch before the DB load (objects and
 * manifests/<build>.json, which the API reads for the DB's active build), then
 * --switch-only --prune 3 once the load is live: every object the manifest names
 * is checked (HEAD) before current.json moves, so it never points at a partial build.
 * --prune N keeps the newest N manifests, current.json's, and those of --keep-builds (the
 * DB's active and previous builds, from the loader's status), deletes the others, then
 * deletes every b/ object none of the kept manifests names.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { r2Store } from '../../api/lib/poiStore.js'
import { blockKey, idsKey, largeKey } from '../../shared/poiTiles.mjs'

/** Every object a manifest names. */
export const manifestObjects = m => [
  ...Object.entries(m.blocks).map(([b, sha]) => blockKey(Number(b), sha)), largeKey(m.large), ...(m.ids ? [idsKey(m.ids)] : []),
]

// Build ids end in a UTC stamp (uk-20261025T2121Z-f2): order by it, then by the id
const stamp = key => (/(\d{8}T\d{4}Z)/.exec(key) || [])[1] || ''
const newestFirst = (a, b) => stamp(b).localeCompare(stamp(a)) || b.localeCompare(a)

/**
 * What --prune deletes. `manifestKeys`: every manifests/*.json in the bucket; `blockKeys`: every
 * b/* object; `manifests`: key -> parsed manifest for (at least) the kept ones; `current`: the
 * manifest current.json names; `keepBuilds`: build ids the DB may serve (the loader's active and
 * previous: a rollback target must keep its tiles). Keeps the newest `keep` manifests, current's
 * and those builds' (when present). Pure. Throws rather than guess when current's manifest is
 * missing or a kept manifest can't be read.
 */
export function pruneKeys({ manifestKeys, blockKeys, manifests, current, keep = 3, keepBuilds = [] }) {
  if (!Number.isInteger(keep) || keep < 1) throw new Error(`--prune needs a whole number >= 1, got ${keep}`)
  if (!current || !manifestKeys.includes(current)) throw new Error(`current manifest ${current} is not in the bucket: not pruning`)
  const kept = new Set([...manifestKeys].sort(newestFirst).slice(0, keep))
  kept.add(current)
  for (const id of keepBuilds) if (manifestKeys.includes(manifestKey(id))) kept.add(manifestKey(id))
  const live = new Set()
  for (const k of kept) {
    if (!manifests[k]) throw new Error(`kept manifest ${k} could not be read: not pruning`)
    for (const o of manifestObjects(manifests[k])) live.add(o)
  }
  return {
    kept: [...kept],
    delete: [...manifestKeys.filter(k => !kept.has(k)), ...blockKeys.filter(k => k.startsWith('b/') && !live.has(k))],
  }
}

export const BUILD_RE = /^[a-z]{2,8}-\d{8}T\d{4}Z(-f\d+)?$/
const manifestKey = id => `manifests/${id}.json`

async function pool(items, n, fn) {
  const queue = [...items]
  await Promise.all(Array.from({ length: n }, async () => {
    for (let item; (item = queue.shift()) !== undefined;) await fn(item)
  }))
}

/**
 * The upload itself, against any store with head/put/get/list/delete (r2Store in production).
 * `dir`: a tiles build (tiles.mjs --out). Order: blocks, then the LARGE member and id index,
 * then the manifest; current.json only after every object it names answers HEAD (`noSwitch`
 * skips that; `switchOnly` skips the uploads). `prune` (N) as pruneKeys, with `keepBuilds`.
 * Throws on any failure; returns a summary.
 */
export async function upload({ store, dir, noSwitch = false, switchOnly = false, prune = null, keepBuilds = [], concurrency = 8 }) {
  if (noSwitch && switchOnly) throw new Error('--no-switch and --switch-only together do nothing')
  const bad = keepBuilds.find(id => !BUILD_RE.test(id))
  if (bad !== undefined) throw new Error(`bad build id to keep: ${bad}`)
  const current = JSON.parse(readFileSync(join(dir, 'current.json'), 'utf8'))
  const manifest = JSON.parse(readFileSync(join(dir, current.manifest), 'utf8'))
  const keys = manifestObjects(manifest)
  const out = { build: manifest.build_id, objects: keys.length }

  if (!switchOnly) {
    let sent = 0, skipped = 0, bytes = 0
    const send = async key => {
      if (await store.head(key)) { skipped++; return }
      const body = readFileSync(join(dir, key))
      await store.put(key, body)
      sent++
      bytes += body.length
    }
    const blocks = keys.filter(k => /^b\/\d+\./.test(k))
    await pool(blocks, concurrency, send)
    await pool(keys.filter(k => !blocks.includes(k)), concurrency, send) // LARGE member, id index
    await store.put(current.manifest, readFileSync(join(dir, current.manifest)), 'application/json')
    Object.assign(out, { sent, skipped, bytes })
  }
  if (!noSwitch) {
    // Only a complete build becomes current
    const missing = []
    await pool([...keys, current.manifest], concurrency, async key => { if (!(await store.head(key))) missing.push(key) })
    if (missing.length) throw new Error(`${missing.length} objects of ${manifest.build_id} missing (${missing.slice(0, 3).join(', ')}): current.json not switched`)
    await store.put('current.json', readFileSync(join(dir, 'current.json')), 'application/json')
    out.switched = true
  }
  if (prune !== null) {
    const keep = Number(prune)
    const manifestKeys = (await store.list('manifests/')).filter(k => k.endsWith('.json'))
    const blockKeys = await store.list('b/')
    const curBuf = await store.get('current.json')
    if (!curBuf) throw new Error('no current.json in the bucket: not pruning')
    const live = JSON.parse(curBuf.toString('utf8')).manifest
    const wanted = new Set([...manifestKeys].sort(newestFirst).slice(0, keep > 0 ? keep : 0).concat(live, keepBuilds.map(manifestKey)))
    const manifests = {}
    for (const k of wanted) {
      if (!manifestKeys.includes(k)) continue
      const buf = await store.get(k)
      if (buf) manifests[k] = JSON.parse(buf.toString('utf8'))
    }
    const plan = pruneKeys({ manifestKeys, blockKeys, manifests, current: live, keep, keepBuilds })
    await pool(plan.delete, concurrency, key => store.delete(key))
    Object.assign(out, { kept: plan.kept, deleted: plan.delete.length })
  }
  return out
}

async function main() {
  const { values: a } = parseArgs({ options: {
    tiles: { type: 'string' }, concurrency: { type: 'string', default: '8' },
    'no-switch': { type: 'boolean', default: false }, 'switch-only': { type: 'boolean', default: false },
    prune: { type: 'string' }, 'keep-builds': { type: 'string', default: '' },
  } })
  if (!a.tiles) {
    console.error('usage: tilesUpload.mjs --tiles <dir> [--no-switch | --switch-only] [--prune N --keep-builds id,id]   (env: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, R2_BUCKET, [R2_PREFIX])')
    process.exit(2)
  }
  const t0 = Date.now()
  const out = await upload({
    store: r2Store({ timeoutMs: 120000 }), dir: a.tiles, noSwitch: a['no-switch'], switchOnly: a['switch-only'],
    prune: a.prune ?? null, keepBuilds: a['keep-builds'].split(',').filter(Boolean), concurrency: Number(a.concurrency),
  })
  console.log(JSON.stringify({ ...out, secs: (Date.now() - t0) / 1000 }))
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch(err => { console.error(err.message); process.exit(1) })
