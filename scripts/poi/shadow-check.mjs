#!/usr/bin/env node
/**
 * On-demand shadow comparison: the loader's G6 sample queries (20 towns, 10
 * Discover boxes) answered by live Overpass and by the `pois` table, scored
 * exactly like nearby.js poiShadow (Jaccard of element ids, live filtered to
 * named elements). Same SQL, same 800 ms server limit and same truncation
 * rule as the served path, so "fallback" here means the app would have used
 * Overpass. For when real traffic is too thin to fill the poi_shadow logs.
 *
 *   node scripts/poi/shadow-check.mjs            (reads MYSQL_* from .env.production)
 *
 * Polite to Overpass: one query at a time, 3 s apart. DB times include the
 * network from wherever this runs (from lhr1 they are lower).
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// The app's own endpoints, in order: a 504 or network error tries the next
const OVERPASS = ['https://overpass.openstreetmap.fr/api/interpreter', 'https://overpass-api.de/api/interpreter']
const UA = 'ROAM-shadow-check/1.0 (https://www.go-roam.uk; support@extrastaff.com)'

export function jaccard(dbIds, liveEls) {
  const ids = new Set(liveEls.map(el => `${el.type}/${el.id}`))
  let both = 0
  for (const id of dbIds) if (ids.has(id)) both++
  const union = ids.size + dbIds.size - both
  return union ? Math.round((both / union) * 1000) / 1000 : 1
}

export const named = els => els.filter(el => el.tags?.name || el.tags?.['name:en'])

export function percentile(xs, p) {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null
}

async function samples() {
  const src = readFileSync(new URL('../../api/admin/poi-load.js', import.meta.url), 'utf8')
  // The loader's own sample lists, so this checks what G6 checks
  const towns = JSON.parse(src.match(/const G6_TOWNS = (\[[^\]]*\])/)[1].replace(/'/g, '"'))
  const discover = JSON.parse(src.match(/const G6_DISCOVER = (\[[\s\S]*?\n\])/)[1].replace(/'/g, '"').replace(/,\s*\]/g, ']'))
  const [{ townOverpassQuery }, { UK_TOWNS }, { buildDiscoverOverpassQuery }, { snapQueryBbox }] = await Promise.all([
    import('../../api/lib/towns.js'), import('../../shared/ukTowns.mjs'),
    import('../../shared/overpassQuery.js'), import('../../api/lib/bboxSnap.js'),
  ])
  return [
    ...towns.map(slug => UK_TOWNS.find(t => t.slug === slug)).filter(Boolean)
      .map(t => ({ label: `town:${t.slug}`, ql: townOverpassQuery(t.lat, t.lng) })),
    ...discover.map(([name, lat, lng, r]) => ({ label: `discover:${name}:${r / 1000}km`, ql: snapQueryBbox(buildDiscoverOverpassQuery(lat, lng, r, null).query) })),
  ]
}

async function main() {
  const env = Object.fromEntries(readFileSync('.env.production', 'utf8').split('\n').filter(l => /^MYSQL_/.test(l))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')] }))
  const mysql = (await import('mysql2/promise')).default
  const conn = await mysql.createConnection({ host: env.MYSQL_HOST, user: env.MYSQL_USER, password: env.MYSQL_PASSWORD, database: env.MYSQL_DATABASE, port: Number(env.MYSQL_PORT) || 3306 })
  const { parseQuery, buildSql, SCAN_ROWS } = await import('../../api/lib/poiQuery.js')
  const out = []
  for (const { label, ql } of await samples()) {
    const plan = parseQuery(ql)
    const { sql, params } = buildSql(plan)
    const t0 = Date.now()
    let rows = null
    let why = null
    try { [rows] = await conn.query({ sql, timeout: 2500 }, params) } catch (err) { why = err.code || err.message }
    const dbMs = Date.now() - t0
    if (rows) {
      const perGroup = {}
      if (rows.some(r => !plan.groups[r.g].limit && (perGroup[r.g] = (perGroup[r.g] || 0) + 1) > SCAN_ROWS)) why = 'over row cap'
    }
    let live = null
    const tried = []
    for (const url of OVERPASS) {
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(ql), signal: AbortSignal.timeout(40000) })
        live = res.ok ? await res.json().catch(() => null) : null
        // A 200 with zero elements is Overpass failing quietly (see nearby.js)
        if (live?.elements?.length) break
        tried.push(`${new URL(url).host} ${res.status}`)
      } catch (err) { tried.push(`${new URL(url).host} ${err.name}`) }
      live = null
    }
    const row = { label, db_ms: dbMs, n_db: rows?.length ?? null, fallback: why }
    if (!live) row.live = tried.join(', ')
    else {
      row.n_live_named = named(live.elements).length
      if (rows && !why) row.jaccard = jaccard(new Set(rows.map(r => `${['', 'node', 'way', 'relation'][r.osm_type]}/${r.osm_id}`)), named(live.elements))
    }
    out.push(row)
    console.log(JSON.stringify(row))
    await new Promise(r => setTimeout(r, 3000))
  }
  await conn.end()
  const js = out.filter(r => r.jaccard != null).map(r => r.jaccard)
  const ms = out.filter(r => !r.fallback).map(r => r.db_ms)
  console.log(JSON.stringify({
    evt: 'shadow-check', samples: out.length, compared: js.length, fallbacks: out.filter(r => r.fallback).map(r => `${r.label}: ${r.fallback}`),
    jaccard_median: percentile(js, 0.5), jaccard_min: js.length ? Math.min(...js) : null, db_ms_p50: percentile(ms, 0.5), db_ms_p95: percentile(ms, 0.95),
  }))
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(err => { console.error(err.message); process.exit(1) })
}
