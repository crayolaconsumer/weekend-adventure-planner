#!/usr/bin/env node
/**
 * POI photos step (plan §5). Reads the build's chunk-*.ndjson.gz, finds each
 * element's Wikidata QID, `wikimedia_commons=File:` tag and Commons `image=`
 * URL, resolves them against Wikidata + Commons and writes:
 *   photos.ndjson.gz      poi_photos rows (CONTRACT), sorted by photo_key
 *   photo-misses.json.gz  keys that had no usable photo (so tomorrow skips them)
 *   photos-manifest.json  { photo_count, photos_sha256, ... } for the workflow to merge
 *
 * Incremental: with --prev (a directory holding yesterday's two .gz files)
 * only new keys are looked up, plus a rotating 1/30 of old ones (each key is
 * re-verified about monthly, which catches deleted files and new P18s).
 *
 * Polite: one request at a time, >= 1 s apart, maxlag=5, a descriptive UA,
 * backoff on 429/5xx/maxlag honouring Retry-After.
 *
 *   node scripts/poi/photos.mjs --in out/ --out out/ [--prev prev/]
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { isDistressingImage, isEventEntity } from '../../shared/placeTopic.mjs'

export const UA = 'ROAM-poi-build/1.0 (https://www.go-roam.uk; support@extrastaff.com)'
export const BATCH = 50
export const ROTATE_DAYS = 30
// ~2 requests per 50 keys at 1 req/s: 40k keys is about 27 minutes
export const MAX_LOOKUPS = 40000
const WD_API = 'https://www.wikidata.org/w/api.php'
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'
const TYPE_LETTER = { 1: 'n', 2: 'w', 3: 'r' }
const SMALLINT_MAX = 65535
// Wikibase rejects Q0 / Q012, and one bad id fails its whole batch
export const QID_RE = /^Q[1-9]\d{0,9}$/

// ─── Candidates ─────────────────────────────────────────────────────────

/** File name (no "File:", spaces not underscores) from a tag/URL, or null. */
export function commonsFileName(value) {
  if (typeof value !== 'string') return null
  let v = value.trim()
  let m
  if ((m = v.match(/^https?:\/\/commons\.(?:m\.)?wikimedia\.org\/wiki\/(File:[^?#]+)/i))) v = m[1]
  else if ((m = v.match(/^https?:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)/i))) v = 'File:' + m[1]
  else if (/^https?:/i.test(v)) return null // other hosts: licence unknown
  if (!/^File:/i.test(v)) return null
  try { v = decodeURIComponent(v) } catch { /* keep raw */ }
  const name = v.replace(/^File:/i, '').replace(/_/g, ' ').trim()
  if (!name || name.length > 240 || /[|[\]{}<>#/\\]/.test(name)) return null
  // MediaWiki capitalises the first letter of every File: title
  return name[0].toUpperCase() + name.slice(1)
}

/**
 * From chunk rows: qids (Set) and files (Map element key -> file name).
 * wikimedia_commons wins over image= for the element key.
 */
export function collectCandidates(rows) {
  const qids = new Set()
  const files = new Map()
  for (const row of rows) {
    let tags
    try { tags = JSON.parse(row.el).tags || {} } catch { continue }
    if (QID_RE.test(tags.wikidata || '')) qids.add(tags.wikidata)
    const file = commonsFileName(tags.wikimedia_commons) || commonsFileName(tags.image)
    const letter = TYPE_LETTER[row.osm_type]
    if (file && letter) files.set(`${letter}${row.osm_id}`, file)
  }
  return { qids, files }
}

// A key's "identity": element keys include the file, so a retagged file is new
export const missKey = (key, file) => (file ? `${key}:${file}` : key)

/** True when this key is in today's rotating 1/30 re-verify slice. */
export function inRotation(key, day) {
  const h = parseInt(createHash('md5').update(key).digest('hex').slice(0, 8), 16)
  return h % ROTATE_DAYS === day % ROTATE_DAYS
}

// ─── Parsing Commons metadata ───────────────────────────────────────────

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
/** Plain text from Commons' HTML metadata (Artist is usually a link). */
export function stripHtml(html) {
  if (typeof html !== 'string') return ''
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
        try { return String.fromCodePoint(n) } catch { return '' }
      }
      return ENTITIES[e.toLowerCase()] ?? m
    })
    .replace(/\s+/g, ' ')
    .trim()
}

const safeDecode = s => { try { return decodeURIComponent(s) } catch { return s } }
const cap = (s, n) => (s && s.length > n ? s.slice(0, n) : s)
const dim = n => (Number.isInteger(n) && n > 0 && n <= SMALLINT_MAX ? n : null)

const URL_MAX = 512 // poi_photos.url / page_url; the loader refuses longer
/** http(s) or protocol-relative licence link, or null. */
function licenseUrl(v) {
  const u = stripHtml(v).replace(/^\/\//, 'https://')
  return /^https?:\/\//.test(u) && u.length <= 255 ? u : null
}

/**
 * A poi_photos row from one imageinfo entry, or null: no licence, distressing,
 * no honest credit where the licence needs one, or a URL the loader would
 * refuse (one bad row fails the whole photos load).
 */
export function photoRow(key, file, ii, source, today) {
  if (!ii || isDistressingImage(file)) return null
  const meta = ii.extmetadata || {}
  const license = cap(stripHtml(meta.LicenseShortName?.value), 64)
  if (!license) return null
  const artist = cap(stripHtml(meta.Artist?.value), 255) || null
  if (!artist && meta.AttributionRequired?.value !== 'false') return null
  const enc = encodeURIComponent(file.replace(/ /g, '_'))
  const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${enc}?width=800`
  const page_url = ii.descriptionurl || `https://commons.wikimedia.org/wiki/File:${enc}`
  if (url.length > URL_MAX || page_url.length > URL_MAX || !page_url.startsWith('https://')) return null
  return {
    photo_key: key,
    url,
    width: dim(ii.thumbwidth ?? ii.width),
    height: dim(ii.thumbheight ?? ii.height),
    source,
    artist,
    license,
    license_url: licenseUrl(meta.LicenseUrl?.value),
    page_url,
    checked_on: today
  }
}

// ─── Polite HTTP ────────────────────────────────────────────────────────

/**
 * Sequential JSON GETs, starts >= minIntervalMs apart, retrying 429/5xx,
 * network errors and Wikimedia's maxlag error with exponential backoff
 * (Retry-After wins when given). fetch/sleep/now are injectable for tests.
 */
export function createClient({ fetch = globalThis.fetch, sleep = ms => new Promise(r => setTimeout(r, ms)), now = Date.now, minIntervalMs = 1000, maxAttempts = 6 } = {}) {
  let last = -Infinity
  const stats = { requests: 0, retries: 0, wdqsLagSkips: 0 }
  async function get(url) {
    for (let attempt = 1; ; attempt++) {
      const wait = last + minIntervalMs - now()
      if (wait > 0) await sleep(wait)
      last = now()
      stats.requests++
      let res = null
      let body = null
      try {
        res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } })
        if (res.ok) body = await res.json()
      } catch { res = null }
      const lagged = body?.error?.code === 'maxlag'
      // Wikidata folds query-service (WDQS) lag into maxlag to slow edit bots;
      // it says nothing about read load and can sit above 5 s for hours
      // (13 s on 2026-09-27). Database replication lag is still honoured.
      if (lagged && body.error.type === 'wikibase-queryservice' && url.includes('&maxlag=')) {
        stats.wdqsLagSkips++
        url = url.replace(/&maxlag=\d+/, '')
        attempt--
        continue
      }
      if (res?.ok && !lagged) {
        if (body?.error) throw new Error(`API error ${body.error.code}: ${body.error.info || ''}`)
        return body
      }
      const retryable = !res || lagged || res.status === 429 || res.status >= 500
      if (!retryable || attempt >= maxAttempts) {
        throw new Error(`GET failed (${res ? res.status : 'network'}${lagged ? ' maxlag' : ''}) after ${attempt} attempt(s): ${url.slice(0, 120)}`)
      }
      stats.retries++
      const ra = Number(res?.headers?.get?.('retry-after'))
      await sleep(Math.min(60000, Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1000 * 2 ** attempt))
    }
  }
  return { get, stats }
}

export function chunk(arr, n = BATCH) {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

const BAD_ID_ERROR = /^API error (no-such-entity|invalid-entity-id|param-invalid|param-illegal)\b/
// A batch the API rejects (a deleted or malformed id fails all 50) is split
// until the bad id stands alone; that one becomes a miss
async function getEntities(client, ids) {
  try {
    return await client.get(`${WD_API}?action=wbgetentities&ids=${ids.join('|')}&props=claims&format=json&maxlag=5`)
  } catch (err) {
    if (!/^API error/.test(err.message)) throw err
    // A lone id: a bad id is a miss; anything else (a DB error on their side)
    // fails the run, and the workflow ships yesterday's photos
    if (ids.length === 1) {
      if (BAD_ID_ERROR.test(err.message)) return { entities: {} }
      throw err
    }
    const half = Math.ceil(ids.length / 2)
    const [a, b] = [await getEntities(client, ids.slice(0, half)), await getEntities(client, ids.slice(half))]
    return { entities: { ...a.entities, ...b.entities } }
  }
}

/** Map QID -> P18 file name (or null: no image / event / missing). */
export async function fetchP18(client, qids) {
  const out = new Map()
  for (const ids of chunk(qids)) {
    const data = await getEntities(client, ids)
    for (const [id, entity] of Object.entries(data?.entities || {})) {
      const qid = entity?.redirects?.from || id
      const file = entity?.missing !== undefined || isEventEntity(entity) ? null : entity?.claims?.P18?.[0]?.mainsnak?.datavalue?.value
      out.set(qid, typeof file === 'string' ? file : null)
    }
  }
  return out
}

/** Map file name -> imageinfo entry (absent: deleted / missing file). */
export async function fetchImageInfo(client, files) {
  const out = new Map()
  for (const names of chunk(files)) {
    const base = `${COMMONS_API}?action=query&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=800` +
      '&iiextmetadatafilter=Artist|AttributionRequired|LicenseShortName|LicenseUrl&format=json&formatversion=2&maxlag=5' +
      `&titles=${names.map(n => encodeURIComponent('File:' + n)).join('|')}`
    let cont = ''
    do {
      const data = await client.get(base + cont)
      // Titles come back normalised ("File:a_b.jpg" -> "File:A b.jpg")
      const byTitle = new Map()
      for (const page of data?.query?.pages || []) {
        const ii = page?.imageinfo?.[0]
        if (ii && page.title) byTitle.set(page.title, ii)
      }
      const asked = new Map((data?.query?.normalized || []).map(n => [n.to, n.from]))
      for (const [title, ii] of byTitle) out.set((asked.get(title) || title).replace(/^File:/, ''), ii)
      cont = data?.continue ? '&' + new URLSearchParams(data.continue).toString() : ''
    } while (cont)
  }
  return out
}

// ─── Orchestration ──────────────────────────────────────────────────────

const sameFileRow = (row, file) => safeDecode(row.page_url).replace(/_/g, ' ').endsWith('File:' + file)

/**
 * rows: chunk rows. prev: { rows: Map key->row, misses: Set missKey }.
 * Returns { rows (sorted), misses (sorted), counts }.
 */
export async function resolvePhotos(rows, { client, prev = { rows: new Map(), misses: new Set() }, today, day, maxLookups = MAX_LOOKUPS }) {
  const { qids, files } = collectCandidates(rows)
  const kept = new Map()
  const misses = new Set()
  const counts = { candidates_qid: qids.size, candidates_file: files.size, reused: 0, reused_miss: 0, looked_up: 0 }

  // Reuse yesterday's verdict unless the key is new or in today's rotation
  const todoQ = []
  for (const q of qids) {
    const verdict = prev.rows.get(q) || (prev.misses.has(q) ? 'miss' : null)
    if (verdict && !inRotation(q, day)) {
      if (verdict === 'miss') { misses.add(q); counts.reused_miss++ } else { kept.set(q, verdict); counts.reused++ }
    } else todoQ.push(q)
  }
  const todoF = new Map()
  for (const [key, file] of files) {
    const old = prev.rows.get(key)
    const verdict = old && sameFileRow(old, file) ? old : prev.misses.has(missKey(key, file)) ? 'miss' : null
    if (verdict && !inRotation(key, day)) {
      if (verdict === 'miss') { misses.add(missKey(key, file)); counts.reused_miss++ } else { kept.set(key, verdict); counts.reused++ }
    } else todoF.set(key, file)
  }
  // The first run has every key to look up (~67k, ~45 min at 1 req/s): cap a
  // run's lookups. A deferred key keeps yesterday's verdict (a rotation
  // re-check that didn't fit); one never judged stays unjudged for tomorrow.
  const carry = (key, mk) => {
    const old = prev.rows.get(key)
    if (old && (mk === key || sameFileRow(old, mk.slice(key.length + 1)))) kept.set(key, old)
    else if (prev.misses.has(mk)) misses.add(mk)
  }
  todoQ.sort()
  const deferQ = todoQ.splice(Math.max(0, maxLookups))
  for (const q of deferQ) carry(q, q)
  const fileKeys = [...todoF.keys()].sort()
  for (const k of fileKeys.slice(Math.max(0, maxLookups - todoQ.length))) { carry(k, missKey(k, todoF.get(k))); todoF.delete(k) }
  counts.deferred = deferQ.length + fileKeys.length - todoF.size
  counts.looked_up = todoQ.length + todoF.size

  const p18 = await fetchP18(client, todoQ)
  const wanted = new Set([...todoF.values()])
  for (const f of p18.values()) if (f) wanted.add(f)
  const info = await fetchImageInfo(client, [...wanted])

  for (const q of todoQ) {
    const file = p18.get(q)
    const row = file ? photoRow(q, file, info.get(file), 'wikidata', today) : null
    if (row) kept.set(q, row); else misses.add(q)
  }
  for (const [key, file] of todoF) {
    const row = photoRow(key, file, info.get(file), 'commons-osm', today)
    if (row) kept.set(key, row); else misses.add(missKey(key, file))
  }

  const out = [...kept.values()].sort((a, b) => (a.photo_key < b.photo_key ? -1 : 1))
  const licences = {}
  for (const r of out) licences[r.license] = (licences[r.license] || 0) + 1
  return { rows: out, misses: [...misses].sort(), counts: { ...counts, photo_count: out.length, misses: misses.size, licences } }
}

const readNdjsonGz = path => gunzipSync(readFileSync(path)).toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))

export function loadPrev(dir) {
  const prev = { rows: new Map(), misses: new Set() }
  if (!dir) return prev
  const p = join(dir, 'photos.ndjson.gz')
  const m = join(dir, 'photo-misses.json.gz')
  if (existsSync(p)) for (const r of readNdjsonGz(p)) prev.rows.set(r.photo_key, r)
  if (existsSync(m)) for (const k of JSON.parse(gunzipSync(readFileSync(m)).toString('utf8'))) prev.misses.add(k)
  return prev
}

async function main() {
  const { values: a } = parseArgs({ options: { in: { type: 'string' }, out: { type: 'string' }, prev: { type: 'string' } } })
  if (!a.in || !a.out) throw new Error('usage: photos.mjs --in <chunk dir> --out <dir> [--prev <dir>]')
  const t0 = Date.now()
  const chunks = readdirSync(a.in).filter(f => /^chunk-\d{3}\.ndjson\.gz$/.test(f)).sort()
  if (!chunks.length) throw new Error(`no chunk-NNN.ndjson.gz in ${a.in}`)
  const rows = chunks.flatMap(f => readNdjsonGz(join(a.in, f)))
  const today = new Date().toISOString().slice(0, 10)
  const day = Math.floor(Date.now() / 86400000)
  const client = createClient()
  const { rows: out, misses, counts } = await resolvePhotos(rows, { client, prev: loadPrev(a.prev), today, day })

  const gz = gzipSync(out.map(r => JSON.stringify(r)).join('\n') + (out.length ? '\n' : ''), { level: 9 })
  writeFileSync(join(a.out, 'photos.ndjson.gz'), gz)
  writeFileSync(join(a.out, 'photo-misses.json.gz'), gzipSync(JSON.stringify(misses), { level: 9 }))
  const manifest = {
    photo_count: out.length,
    photos_sha256: createHash('sha256').update(gz).digest('hex'),
    ...counts,
    requests: client.stats.requests,
    retries: client.stats.retries,
    wdqs_lag_skips: client.stats.wdqsLagSkips,
    seconds: Math.round((Date.now() - t0) / 1000)
  }
  writeFileSync(join(a.out, 'photos-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log(JSON.stringify({ evt: 'poi-photos', ...manifest }))
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(err => { console.error(err.message); process.exit(1) })
}
