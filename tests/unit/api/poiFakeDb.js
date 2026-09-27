// In-memory stand-in for the SQL the POI loader and rollback send (via
// api/lib/db.js). It answers only those statements and throws on anything
// else, so an unexpected query fails a test instead of passing silently.
// Used by poiLoad.test.js and poiRollback.test.js through vi.mock.

export const db = {}
// KV: roam:poiGen (INCR) plus any cacheSet writes (the loader must make none)
export const kv = {}

export function resetDb() {
  Object.assign(kv, { gen: 0, incrError: null, incrs: [], writes: [] })
  const table = (comment = '') => ({ rows: new Map(), comment, count: null })
  Object.assign(db, {
    builds: new Map(),
    tables: { pois: table(), poi_photos: table() },
    log: [],          // every statement, whitespace-normalised
    connLog: [],      // statements sent on a dedicated (locked) connection
    fail: [],         // [{ re, err, once }] injected failures
    lockHeld: null,   // id of the connection holding roam:poi-load
    poolCalls: 0,     // statements sent through the pool helpers (not a locked connection)
    connDies: false,  // the locked session dies right after GET_LOCK (wait_timeout)
    g6Count: () => 10, // COUNT(*) over a translator statement: (innerSql, params) -> n
    timeouts: [],     // per-query client timeouts seen
    execLimits: [],   // server MAX_EXECUTION_TIME(n) on outer SELECTs
    kills: [],        // KILL QUERY <id> sent
    lockConnIds: [],  // CONNECTION_ID() of each locked session
    onSql: null,      // (statement) => void, e.g. to advance a fake clock
    opened: 0,
    closed: 0,
    newTable: table,
  })
}
resetDb()

const count = t => (t.count ?? t.rows.size)
const quoted = s => [...s.matchAll(/'(\w+)'/g)].map(m => m[1])

export function fake(sql, p = []) {
  if (typeof sql === 'object') { db.timeouts.push(sql.timeout); sql = sql.sql }
  const raw = sql.replace(/\s+/g, ' ').trim()
  db.log.push(raw)
  // Match on the statement without our server-limit hint (recorded separately)
  const hint = /^SELECT \/\*\+ MAX_EXECUTION_TIME\((\d+)\) \*\/ /.exec(raw)
  if (hint) db.execLimits.push(Number(hint[1]))
  const s = hint ? `SELECT ${raw.slice(hint[0].length)}` : raw
  db.onSql?.(s)
  const hit = db.fail.find(f => f.re.test(s))
  if (hit) { if (hit.once) db.fail.splice(db.fail.indexOf(hit), 1); throw hit.err }
  const T = db.tables
  let m

  if (s.startsWith('SELECT table_name AS name, table_comment AS owner FROM information_schema.tables')) {
    const names = p.length ? p : quoted(s.slice(s.indexOf('IN (')))
    return names.filter(n => T[n]).map(n => ({ name: n, owner: T[n].comment }))
  }
  if (s.startsWith('SELECT COUNT(*) AS n FROM information_schema.tables')) {
    return [{ n: quoted(s.slice(s.indexOf('IN ('))).filter(n => T[n]).length }]
  }
  if (s === 'SELECT status FROM poi_builds WHERE build_id = ?' ||
      s === 'SELECT status, chunks_total, chunks_loaded, manifest_sha256, coverage_sha256 FROM poi_builds WHERE build_id = ?') {
    const r = db.builds.get(p[0]); return r ? [{ ...r }] : []
  }
  if (s.startsWith("SELECT build_id, row_count, photo_count, gate_report FROM poi_builds WHERE status = 'active'")) {
    const r = [...db.builds.entries()].find(([, b]) => b.status === 'active')
    return r ? [{ build_id: r[0], ...r[1] }] : []
  }
  if (s === 'SELECT build_id, status, chunks_loaded, chunks_total, created_at FROM poi_builds ORDER BY created_at DESC LIMIT 1') {
    const r = [...db.builds.entries()].at(-1) // insertion order stands in for created_at
    return r ? [{ build_id: r[0], ...r[1] }] : []
  }
  if (s === 'SELECT release_tag FROM poi_builds WHERE build_id = ?') {
    const r = db.builds.get(p[0]); return r ? [{ release_tag: r.release_tag ?? `poi-${p[0]}` }] : []
  }
  if (s.startsWith('SELECT build_id, status, row_count, photo_count, chunks_loaded')) {
    return [...db.builds.entries()].map(([build_id, b]) => ({ build_id, ...b }))
  }
  if (s.startsWith("UPDATE poi_builds SET activated_at = IF(build_id = ? AND status <> 'previous'")) { // reconcile
    const [live, , failedOwner] = p
    for (const [id, b] of db.builds) {
      if (!(b.status === 'active' || id === live)) continue
      b.status = id === live ? 'active' : id === failedOwner ? 'rolled_back' : 'previous'
    }
    return 1
  }
  if (s.startsWith("UPDATE poi_builds SET activated_at = IF(build_id = ?, NOW(), activated_at), status = IF(build_id = ?, 'active', 'previous')")) {
    for (const [id, b] of db.builds) {
      if (id === p[0]) b.status = 'active'
      else if (b.status === 'active') b.status = 'previous'
    }
    return 1
  }
  if ((m = /^UPDATE poi_builds SET status = '(\w+)' WHERE build_id = \?$/.exec(s))) { db.builds.get(p[0]).status = m[1]; return 1 }
  if (s.startsWith("UPDATE poi_builds SET status = 'failed', gate_report = ? WHERE status IN")) {
    for (const [id, b] of db.builds) if (id !== p[1] && ['loading', 'validating'].includes(b.status)) b.status = 'failed'
    return 1
  }
  if ((m = /^DROP TABLE IF EXISTS (.+)$/.exec(s))) { m[1].split(', ').forEach(n => delete T[n]); return {} }
  if ((m = /^CREATE TABLE (\w+) LIKE (\w+)$/.exec(s))) { T[m[1]] = db.newTable(T[m[2]].comment); return {} }
  if ((m = /^ALTER TABLE (\w+) COMMENT = \?$/.exec(s))) { T[m[1]].comment = p[0]; return {} }
  if (s.startsWith('INSERT INTO poi_builds')) {
    const [id, , , , total, , manifestSha, coverageSha] = p
    db.builds.set(id, { gen_pending: 0, ...(db.builds.get(id) || {}), status: 'loading', chunks_total: total, chunks_loaded: 0,
      gate_report: null, row_count: null, photo_count: null, manifest_sha256: manifestSha, coverage_sha256: coverageSha })
    return {}
  }
  if (s === 'UPDATE poi_builds SET gen_pending = 1 WHERE build_id = ?') { db.builds.get(p[0]).gen_pending = 1; return 1 }
  if (s === 'SELECT build_id FROM poi_builds WHERE gen_pending = 1') {
    return [...db.builds.entries()].filter(([, b]) => b.gen_pending === 1).map(([build_id]) => ({ build_id }))
  }
  if (s === 'UPDATE poi_builds SET gen_pending = 0 WHERE gen_pending = 1') {
    for (const b of db.builds.values()) if (b.gen_pending === 1) b.gen_pending = 0
    return 1
  }
  if ((m = /^SELECT COUNT\(\*\) AS n FROM \((.+)\) q$/.exec(s))) return [{ n: db.g6Count(m[1], p) }]
  if ((m = /^INSERT INTO (pois_staging|poi_photos_staging) \(([^)]+)\) VALUES \? AS new ON DUPLICATE KEY UPDATE/.exec(s))) {
    const cols = m[2].split(', ')
    for (const r of p[0]) {
      const o = Object.fromEntries(cols.map((c, i) => [c, r[i]]))
      T[m[1]].rows.set(m[1] === 'pois_staging' ? `${o.osm_type}/${o.osm_id}` : o.photo_key, o)
    }
    return {}
  }
  if (s === 'UPDATE poi_builds SET chunks_loaded = GREATEST(chunks_loaded, ?) WHERE build_id = ?') {
    const b = db.builds.get(p[1]); b.chunks_loaded = Math.max(b.chunks_loaded, p[0]); return 1
  }
  if (s === 'SELECT COUNT(*) AS n FROM pois_staging WHERE cell = ?') {
    const t = T.pois_staging
    return [{ n: t.largeCount ?? [...t.rows.values()].filter(r => r.cell === p[0]).length }]
  }
  if ((m = /^SELECT COUNT\(\*\) AS n FROM (\w+)$/.exec(s))) {
    if (!T[m[1]]) throw new Error(`Table '${m[1]}' doesn't exist`)
    return [{ n: count(T[m[1]]) }]
  }
  if ((m = /^SELECT (SUM\(.+) FROM (\w+)$/.exec(s))) {
    const rows = [...T[m[2]].rows.values()]
    const out = {}
    ;[...m[1].matchAll(/SUM\((k_\w+) = \?\) AS (m\d+)/g)].forEach(([, col, alias], i) => {
      out[alias] = rows.filter(r => r[col] === p[i]).length
    })
    return [out]
  }
  if (s.startsWith('SELECT osm_type, osm_id, el FROM pois_staging WHERE (osm_type, osm_id) IN')) {
    const out = []
    for (let n = 0; n < p.length; n += 2) {
      const r = T.pois_staging.rows.get(`${p[n]}/${p[n + 1]}`)
      if (r) out.push({ osm_type: r.osm_type, osm_id: r.osm_id, el: r.el })
    }
    return out
  }
  if (s.startsWith('UPDATE poi_builds SET gate_report = ?, row_count = ?, photo_count = ?')) {
    Object.assign(db.builds.get(p[3]), { gate_report: JSON.parse(p[0]), row_count: p[1], photo_count: p[2] }); return 1
  }
  if ((m = /^RENAME TABLE (.+)$/.exec(s))) {
    // All-or-nothing, pairs applied left to right, like MySQL
    const next = { ...T }
    for (const pair of m[1].split(', ')) {
      const [from, to] = pair.split(' TO ')
      if (!next[from] || next[to]) throw new Error(`RENAME ${pair} impossible`)
      next[to] = next[from]; delete next[from]
    }
    db.tables = next
    return {}
  }
  throw new Error(`fake db: unexpected SQL: ${s.slice(0, 140)}`)
}

export const kvModule = {
  getClient: () => ({
    incr: async key => {
      if (kv.incrError) throw kv.incrError
      kv.incrs.push(key)
      return ++kv.gen
    },
    get: async () => { throw new Error('the POI loader must not read KV blobs') },
  }),
  cacheSet: async (key, value, ttl) => { kv.writes.push({ key, value, ttl }); return true },
  cacheGet: async () => null,
  isCacheEnabled: () => true,
}

let connSeq = 0
export const dbModule = {
  query: async (sql, p) => { db.poolCalls++; return fake(sql, p) },
  queryOne: async (sql, p) => { db.poolCalls++; const r = fake(sql, p); return Array.isArray(r) ? r[0] || null : null },
  update: async (sql, p) => { db.poolCalls++; return fake(sql, p) },
  transaction: () => { throw new Error('the POI loader must not use transaction()') },
  dedicatedConnection: async () => {
    const id = ++connSeq
    db.opened++
    const connQuery = async (sql, p = []) => {
      const s = (typeof sql === 'object' ? sql.sql : sql).replace(/\s+/g, ' ').trim()
      if (s.startsWith('SET SESSION')) { db.log.push(s); return [{}] }
      if (s === 'SELECT GET_LOCK(?, 0) AS got') {
        db.log.push(s)
        if (db.lockHeld && db.lockHeld !== id) return [[{ got: 0 }]]
        db.lockHeld = id
        return [[{ got: 1 }]]
      }
      if (s === 'SELECT CONNECTION_ID() AS id') { db.lockConnIds.push(1000 + id); return [[{ id: 1000 + id }]] }
      if (s === 'KILL QUERY ?') { db.kills.push(p[0]); return [{}] }
      if (s === 'SELECT RELEASE_LOCK(?)') { if (db.lockHeld === id) db.lockHeld = null; return [[{}]] }
      if (db.connDies) throw Object.assign(new Error('Connection lost: The server closed the connection.'), { code: 'PROTOCOL_CONNECTION_LOST' })
      db.connLog.push(s)
      return [fake(sql, p)]
    }
    return {
      query: connQuery,
      // Closing the session releases its named locks, as in MySQL
      end: async () => { db.closed++; if (db.lockHeld === id) db.lockHeld = null },
      destroy: () => {},
    }
  },
}
