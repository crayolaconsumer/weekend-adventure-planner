// Tiles pipeline: what the nightly prune deletes (scripts/poi/tilesUpload.mjs pruneKeys) and
// the r2Store calls only the upload script uses (list, delete). No network: fetch is injected.
import { describe, it, expect, afterAll } from 'vitest'
import { Buffer } from 'node:buffer'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pruneKeys, manifestObjects, upload } from '../../../scripts/poi/tilesUpload.mjs'
import { r2Store } from '../../../api/lib/poiStore.js'
import { groupRows, writeTiles } from '../../../scripts/poi/tiles.mjs'
import { poiCell } from '../../../shared/poiCell.mjs'

const m = (blocks, large, ids) => ({ blocks, large, ids })
const MANIFESTS = {
  'manifests/uk-20261020T2023Z-f2.json': m({ 1: 'aaaa0001', 2: 'bbbb0001' }, 'llll0001', 'iiii0001'),
  'manifests/uk-20261022T2021Z-f2.json': m({ 1: 'aaaa0001', 2: 'bbbb0002' }, 'llll0001', 'iiii0002'),
  'manifests/uk-20261023T2020Z-f2.json': m({ 1: 'aaaa0003', 2: 'bbbb0002' }, 'llll0001', 'iiii0003'),
  'manifests/uk-20261025T2121Z-f2.json': m({ 1: 'aaaa0003', 2: 'bbbb0004' }, 'llll0004', 'iiii0004'),
}
const manifestKeys = Object.keys(MANIFESTS)
const blockKeys = [...new Set(Object.values(MANIFESTS).flatMap(manifestObjects))].concat('b/1.dead0000.bin')
const NEWEST = 'manifests/uk-20261025T2121Z-f2.json'

describe('pruneKeys', () => {
  it('keeps the DB\'s active and previous builds even when newer unloaded manifests push them out of the newest N', () => {
    // previous B; C, D, E uploaded before failed loads or load=false runs; F active and current
    const ids = ['B', 'C', 'D', 'E', 'F'].map((x, i) => `uk-2026102${i}T0215Z-f${i}`)
    const keys = ids.map(id => `manifests/${id}.json`)
    const ms = Object.fromEntries(keys.map((k, i) => [k, m({ 1: `b${i}` }, `l${i}`, `i${i}`)]))
    const blocks = Object.values(ms).flatMap(manifestObjects)
    const plan = pruneKeys({ manifestKeys: keys, blockKeys: blocks, manifests: ms, current: keys[4], keep: 3, keepBuilds: [ids[4], ids[0]] })
    expect(plan.kept.sort()).toEqual([keys[0], keys[2], keys[3], keys[4]].sort())
    expect(plan.delete).toContain(keys[1])
    expect(plan.delete).not.toContain(keys[0])
    expect(plan.delete).not.toContain('b/1.b0.bin')
    expect(plan.delete).toContain('b/1.b1.bin')
    // a keep build that isn't in the bucket is simply not there to keep
    expect(() => pruneKeys({ manifestKeys: keys, blockKeys: blocks, manifests: ms, current: keys[4], keep: 3, keepBuilds: ['uk-20200101T0000Z'] })).not.toThrow()
  })

  it('keeps the newest 3 manifests and every object they name; deletes older manifests and orphans', () => {
    const plan = pruneKeys({ manifestKeys, blockKeys, manifests: MANIFESTS, current: NEWEST, keep: 3 })
    expect(plan.kept.sort()).toEqual(manifestKeys.slice(1).sort())
    expect(plan.delete.sort()).toEqual([
      'b/1.dead0000.bin', // never named
      'b/2.bbbb0001.bin', 'b/ids.iiii0001.bin', // only the oldest build named these
      'manifests/uk-20261020T2023Z-f2.json',
    ].sort())
    // shared objects survive: block 1 aaaa0001 is named by a kept manifest (22 Oct), large by all
    expect(plan.delete).not.toContain('b/1.aaaa0001.bin')
    expect(plan.delete).not.toContain('b/large.llll0001.bin')
  })

  it('current.json\'s manifest is kept even when older than the newest N (a rollback of tiles)', () => {
    const old = 'manifests/uk-20261020T2023Z-f2.json'
    const plan = pruneKeys({ manifestKeys, blockKeys, manifests: MANIFESTS, current: old, keep: 1 })
    expect(plan.kept.sort()).toEqual([old, NEWEST].sort())
    expect(plan.delete).not.toContain('b/2.bbbb0001.bin')
    expect(plan.delete).toContain('b/2.bbbb0002.bin')
  })

  it('orders by the build stamp, not the region prefix', () => {
    const keys = ['manifests/zz-20261001T0000Z.json', 'manifests/aa-20261020T0000Z.json']
    const ms = { [keys[0]]: m({}, 'l', 'i'), [keys[1]]: m({}, 'l', 'i') }
    expect(pruneKeys({ manifestKeys: keys, blockKeys: [], manifests: ms, current: keys[1], keep: 1 }).delete).toEqual([keys[0]])
  })

  it('never deletes outside b/ and manifests/', () => {
    const plan = pruneKeys({ manifestKeys, blockKeys: [...blockKeys, 'current.json', 'spike/b/1.x.bin'], manifests: MANIFESTS, current: NEWEST, keep: 3 })
    expect(plan.delete.every(k => k.startsWith('b/') || k.startsWith('manifests/'))).toBe(true)
  })

  it('refuses to guess: current missing, a kept manifest unreadable, or a bad keep count throw', () => {
    expect(() => pruneKeys({ manifestKeys, blockKeys, manifests: MANIFESTS, current: 'manifests/nope.json', keep: 3 })).toThrow(/not pruning/)
    const { [NEWEST]: _, ...partial } = MANIFESTS
    expect(() => pruneKeys({ manifestKeys, blockKeys, manifests: partial, current: NEWEST, keep: 3 })).toThrow(/could not be read/)
    expect(() => pruneKeys({ manifestKeys, blockKeys, manifests: MANIFESTS, current: NEWEST, keep: NaN })).toThrow(/whole number/)
    expect(() => pruneKeys({ manifestKeys, blockKeys, manifests: MANIFESTS, current: NEWEST, keep: 0 })).toThrow(/whole number/)
  })

  it('manifestObjects: blocks, large and the id index (a phase-1 manifest has none)', () => {
    expect(manifestObjects(m({ 7: 'abcd1234' }, 'eeee0000', 'ffff0000'))).toEqual(['b/7.abcd1234.bin', 'b/large.eeee0000.bin', 'b/ids.ffff0000.bin'])
    expect(manifestObjects(m({ 7: 'abcd1234' }, 'eeee0000'))).toEqual(['b/7.abcd1234.bin', 'b/large.eeee0000.bin'])
  })
})

describe('r2Store list and delete (upload script only)', () => {
  const env = { accessKeyId: 'AKID', secretAccessKey: 'SECRET', endpoint: 'https://acct.r2.cloudflarestorage.com', bucket: 'roam-poi', prefix: 'tiles/',
    now: () => new Date('2026-10-26T12:00:00Z') }

  it('ListObjectsV2: signed bucket URL with a sorted, encoded query; pages followed; prefix stripped', async () => {
    const seen = []
    const pages = [
      '<ListBucketResult><Key>tiles/b/1.a.bin</Key><Key>tiles/b/2.b.bin</Key><IsTruncated>true</IsTruncated><NextContinuationToken>t+1/=</NextContinuationToken></ListBucketResult>',
      '<ListBucketResult><Key>tiles/b/3.c&amp;.bin</Key><IsTruncated>false</IsTruncated></ListBucketResult>',
    ]
    const store = r2Store({ ...env, fetchImpl: async (url, init) => { seen.push({ url, init }); return new Response(pages[seen.length - 1], { status: 200 }) } })
    expect(await store.list('b/')).toEqual(['b/1.a.bin', 'b/2.b.bin', 'b/3.c&.bin'])
    expect(seen[0].url).toBe('https://acct.r2.cloudflarestorage.com/roam-poi?list-type=2&prefix=tiles%2Fb%2F')
    expect(seen[1].url).toBe('https://acct.r2.cloudflarestorage.com/roam-poi?continuation-token=t%2B1%2F%3D&list-type=2&prefix=tiles%2Fb%2F')
    expect(seen[0].init.headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKID\/20261026\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/)
    // the query is part of what is signed
    expect(seen[0].init.headers.Authorization).not.toBe(seen[1].init.headers.Authorization)
  })

  it('a list error throws without secrets; delete treats 404 as done and throws on 403', async () => {
    const reply = status => r2Store({ ...env, fetchImpl: async () => new Response(status === 204 ? null : '<Error><Code>AccessDenied</Code></Error>', { status }) })
    await expect(reply(403).list('b/')).rejects.toThrow('R2 LIST b/: 403 AccessDenied')
    await expect(reply(404).delete('b/x')).resolves.toBeUndefined()
    await expect(reply(204).delete('b/x')).resolves.toBeUndefined()
    await expect(reply(403).delete('b/x')).rejects.toThrow('R2 DELETE b/x: 403 AccessDenied')
    await reply(403).list('b/').catch(err => expect(err.message).not.toContain('SECRET'))
  })
})

// upload(): the script's main path, against an in-memory store that records every call
describe('upload (tilesUpload main)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'poi-up-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  const rows = [51.5, 52.5, 53.5].map((lat, i) => ({ cell: poiCell(lat, -1.5), osm_type: 1, osm_id: i + 1, min_lat: lat, min_lon: -1.5, max_lat: lat, max_lon: -1.5,
    k_amenity: 'cafe', has_name_tag: 1, has_wikidata: 0, q: 0, cat: 0, flags: 0, el: JSON.stringify({ type: 'node', id: i + 1, lat, lon: -1.5, tags: { name: 'c' } }) }))
  const { manifest, manifestKey } = writeTiles(groupRows(rows, rows.map(r => r.cell)), { build_id: 'uk-20261026T2121Z-f2', schema_version: 1, features_version: 2 }, dir)
  const objects = manifestObjects(manifest)

  function memStore(initial = {}) {
    const files = new Map(Object.entries(initial))
    const ops = []
    return {
      files, ops,
      async head(k) { ops.push(['head', k]); return files.has(k) },
      // block PUTs are the slow ones (the big objects): an upload that doesn't wait for them
      // before the LARGE member, id index and manifest would show it in the order
      async put(k, body) { if (/^b\/\d+\./.test(k)) await new Promise(r => setTimeout(r, 5)); ops.push(['put', k]); files.set(k, body) },
      async get(k) { ops.push(['get', k]); return files.has(k) ? Buffer.from(files.get(k)) : null },
      async list(under) { return [...files.keys()].filter(k => k.startsWith(under)) },
      async delete(k) { ops.push(['delete', k]); files.delete(k) },
    }
  }
  const puts = st => st.ops.filter(o => o[0] === 'put').map(o => o[1])

  it('uploads blocks, then the LARGE member and id index, then the manifest, current.json last', async () => {
    const st = memStore()
    const out = await upload({ store: st, dir, concurrency: 3 })
    const order = puts(st)
    const last = k => order.lastIndexOf(k)
    const blockPuts = order.filter(k => /^b\/\d+\./.test(k))
    expect(blockPuts).toHaveLength(3)
    const ids = objects.find(k => k.startsWith('b/ids.'))
    const large = objects.find(k => k.startsWith('b/large.'))
    for (const b of blockPuts) expect(order.indexOf(b)).toBeLessThan(Math.min(order.indexOf(ids), order.indexOf(large)))
    expect(Math.max(order.indexOf(ids), order.indexOf(large))).toBeLessThan(order.indexOf(manifestKey))
    expect(last('current.json')).toBe(order.length - 1)
    expect(out).toMatchObject({ sent: objects.length, skipped: 0, switched: true })
    expect(JSON.parse(st.files.get('current.json'))).toMatchObject({ manifest: manifestKey })
  })

  it('objects already in the bucket are not sent again (content-addressed)', async () => {
    const st = memStore(Object.fromEntries(objects.map(k => [k, readFileSync(join(dir, k))])))
    const out = await upload({ store: st, dir })
    expect(out).toMatchObject({ sent: 0, skipped: objects.length })
    expect(puts(st)).toEqual([manifestKey, 'current.json'])
  })

  it('--no-switch: everything but current.json', async () => {
    const st = memStore()
    await upload({ store: st, dir, noSwitch: true })
    expect(puts(st)).toContain(manifestKey)
    expect(puts(st)).not.toContain('current.json')
  })

  it('--switch-only: no uploads; current.json written after every object answers HEAD', async () => {
    const st = memStore(Object.fromEntries([...objects, manifestKey].map(k => [k, readFileSync(join(dir, k))])))
    await upload({ store: st, dir, switchOnly: true })
    expect(puts(st)).toEqual(['current.json'])
    const heads = st.ops.filter(o => o[0] === 'head').map(o => o[1])
    expect(heads.sort()).toEqual([...objects, manifestKey].sort())
  })

  it('a missing object (or manifest) stops the switch: throws, current.json NOT written', async () => {
    for (const gone of [objects[0], manifestKey]) {
      const present = [...objects, manifestKey].filter(k => k !== gone)
      const st = memStore({ 'current.json': '{"manifest":"manifests/old.json"}', ...Object.fromEntries(present.map(k => [k, readFileSync(join(dir, k))])) })
      await expect(upload({ store: st, dir, switchOnly: true })).rejects.toThrow(/missing.*current\.json not switched/)
      expect(puts(st)).not.toContain('current.json')
      expect(st.files.get('current.json')).toBe('{"manifest":"manifests/old.json"}')
    }
  })

  it('prune: deletes only objects no kept manifest names, keeping the DB\'s previous build', async () => {
    const old = id => ({ blocks: { 7: `o${id}` }, large: `l${id}`, ids: `i${id}` })
    const olds = ['uk-20261001T0000Z', 'uk-20261002T0000Z', 'uk-20261003T0000Z', 'uk-20261004T0000Z']
    const initial = {}
    for (const id of olds) {
      initial[`manifests/${id}.json`] = JSON.stringify(old(id))
      for (const k of manifestObjects(old(id))) initial[k] = 'x'
    }
    initial['b/9.orphan00.bin'] = 'x'
    const st = memStore(initial)
    const out = await upload({ store: st, dir, prune: 3, keepBuilds: ['uk-20261026T2121Z-f2', 'uk-20261001T0000Z'] })
    const deleted = st.ops.filter(o => o[0] === 'delete').map(o => o[1]).sort()
    // newest 3: this build, 04, 03; plus previous 01. Gone: 02 and the orphan
    expect(deleted).toEqual(['b/7.ouk-20261002T0000Z.bin', 'b/9.orphan00.bin', 'b/ids.iuk-20261002T0000Z.bin', 'b/large.luk-20261002T0000Z.bin', 'manifests/uk-20261002T0000Z.json'].sort())
    for (const k of [...objects, manifestKey, 'current.json', ...manifestObjects(old('uk-20261001T0000Z'))]) expect(st.files.has(k), k).toBe(true)
    expect(out.deleted).toBe(5)
  })

  it('refuses junk keep-build ids and a both-modes call before writing anything', async () => {
    const st = memStore()
    await expect(upload({ store: st, dir, prune: 3, keepBuilds: ['../x'] })).rejects.toThrow(/bad build id/)
    await expect(upload({ store: st, dir, noSwitch: true, switchOnly: true })).rejects.toThrow(/together/)
    expect(st.ops).toEqual([])
  })
})
