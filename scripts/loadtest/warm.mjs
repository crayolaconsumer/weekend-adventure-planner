#!/usr/bin/env node
/**
 * Fills the caches with real answers before k6 runs: every image-resolve URL,
 * town page and Discover Overpass query k6 will request, ONCE each,
 * sequentially, 1 s apart, as a normal browser and WITHOUT x-roam-loadtest
 * (load-test requests are cache-only and would never fill anything).
 *
 *   node scripts/loadtest/queries.mjs && node scripts/loadtest/warm.mjs
 *
 * Env: BASE_URL (default https://www.go-roam.uk). Always exits 0 once
 * queries.json is readable: a few misses only mean a few cold answers.
 */
import { readFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'

const BASE = (process.env.BASE_URL || 'https://www.go-roam.uk').replace(/\/$/, '')
const Q = JSON.parse(readFileSync(new URL('./queries.json', import.meta.url), 'utf8'))

// Same request shapes as k6.js, minus the load-test header
const requests = [
  ...Q.imageResolve.map(path => ({ path })),
  ...Q.towns.map(path => ({ path, headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } })),
  // Not CDN-cached (POST) but KV-cached server side for 24 h: without this a
  // load-test Discover request can only get the stale copy or a 503
  ...Q.overpass.map(({ city, radius, query }) => ({
    path: '/api/places/overpass/nearby',
    label: `overpass ${city} ${radius / 1000}km`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ query }),
  })),
]

let bad = 0
for (const [i, r] of requests.entries()) {
  if (i) await delay(1000)
  const t0 = Date.now()
  let line
  try {
    const res = await fetch(BASE + r.path, {
      method: r.method || 'GET',
      headers: { 'User-Agent': Q.userAgent, ...r.headers },
      body: r.body,
      signal: AbortSignal.timeout(65000),
    })
    await res.arrayBuffer()
    if (!res.ok) bad++
    const cache = res.headers.get('x-vercel-cache') || '-'
    const extra = res.headers.get('x-overpass-cache') || res.headers.get('x-roam-cache') || ''
    line = `${res.status} ${cache.padEnd(7)} ${String(Date.now() - t0).padStart(6)}ms ${extra.padEnd(6)}`
  } catch (err) {
    bad++
    line = `ERR ${err.name}     ${String(Date.now() - t0).padStart(6)}ms       `
  }
  console.log(`${line} ${r.label || r.path}`)
}
console.log(`warmed ${requests.length - bad}/${requests.length} OK`)
