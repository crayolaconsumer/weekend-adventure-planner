#!/usr/bin/env node
/**
 * Drive api/admin/poi-load.js for one published build: begin, then every
 * chunk from the resume point, then photos, then finalize. Safe to re-run:
 * begin resumes from chunks_loaded and re-sent chunks are idempotent.
 *
 *   POI_LOAD_SECRET=... node scripts/poi/load.mjs --build uk-20261001T0215Z
 *   [--base https://www.go-roam.uk] [--skip-photos: only for a release without photos; G7 fails otherwise]
 *
 * Forcing past failed gates needs an admin session, never the secret:
 *   ROAM_ADMIN_TOKEN=<admin JWT> node scripts/poi/load.mjs --build <id> --force
 * (runs finalize only; staging from the earlier load must still be in place).
 *
 * Exit codes: 0 live, 1 gates failed or a step gave up, 2 bad usage.
 */
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'

const BUILD_RE = /^[a-z]{2,8}-\d{8}T\d{4}Z$/
const BASE = 'https://www.go-roam.uk'
export const MAX_ATTEMPTS = 8 // backoff 2..128 s outlasts a lock held ~150 s by a killed function

// Worth retrying: network errors, 5xx, rate limits and a busy lock. Anything
// else (bad sha, gates failed, out of order) is a verdict, not a blip.
const retryable = (status, body) => status >= 500 || status === 429 || (status === 409 && body?.retry)

export async function run({ build, base = BASE, secret, adminToken, force = false, skipPhotos = false,
  fetchImpl = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)), log = console.log }) {
  const headers = force
    ? { Authorization: `Bearer ${adminToken}`, Origin: BASE }
    : { Authorization: `Bearer ${secret}` }

  async function step(params) {
    const url = `${base}/api/admin/poi-load?${new URLSearchParams({ build, ...params, ...(force ? { force: '1' } : {}) })}`
    for (let attempt = 1; ; attempt++) {
      let status = 0, body = null
      try {
        const res = await fetchImpl(url, { method: 'POST', headers, signal: AbortSignal.timeout(150000) })
        status = res.status
        body = await res.json().catch(() => null)
      } catch (err) {
        body = { error: err?.message || String(err) }
      }
      if (status === 200) return body
      if (status && !retryable(status, body)) return Object.assign(body || {}, { failed: true, status })
      if (attempt >= MAX_ATTEMPTS) return Object.assign(body || {}, { failed: true, status })
      const wait = 2000 * 2 ** (attempt - 1)
      log(`  ${params.step}${params.i != null ? ` ${params.i}` : ''}: ${status || 'network'} ${body?.error || ''}; retry in ${wait / 1000}s`)
      await sleep(wait)
    }
  }

  if (!force) {
    const b = await step({ step: 'begin' })
    if (b.failed) { log(`begin failed: ${b.status} ${b.error}`); return 1 }
    if (b.noop) { log(`${build} is already active`); return 0 }
    log(`${build}: ${b.resumed ? `resuming at chunk ${b.chunks_loaded}` : 'fresh load'} of ${b.chunks_total}`)
    for (let i = b.chunks_loaded; i < b.chunks_total; i++) {
      const c = await step({ step: 'chunk', i: String(i) })
      if (c.failed) { log(`chunk ${i} failed: ${c.status} ${c.error}`); return 1 }
      log(`  chunk ${i + 1}/${b.chunks_total}: ${c.rows} rows`)
    }
    if (!skipPhotos) {
      // Paged like the chunks; each page is an idempotent upsert, safe to retry
      for (let offset = 0; offset != null;) {
        const p = await step({ step: 'photos', offset: String(offset) })
        if (p.failed) { log(`photos failed at ${offset}: ${p.status} ${p.error}`); return 1 }
        log(`  photos: ${p.skipped || `${offset + p.photos}/${p.total}`}`)
        offset = p.next ?? null
      }
    }
  }

  const f = await step({ step: 'finalize' })
  for (const g of (f.report || f).gates || []) {
    log(`  ${g.pass === false ? 'FAIL' : g.pass === null ? 'SKIP' : 'ok  '} ${g.id} ${g.name}`)
  }
  if (f.failed) { log(`finalize: ${f.status} ${f.error}`); return 1 }
  log(`${build} is live${f.forced ? ' (forced)' : ''}`)
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  let a = {}
  try {
    a = parseArgs({ options: {
      build: { type: 'string' }, base: { type: 'string', default: BASE },
      'skip-photos': { type: 'boolean' }, force: { type: 'boolean', default: false },
    } }).values
  } catch { /* usage below */ }
  const secret = process.env.POI_LOAD_SECRET
  const adminToken = process.env.ROAM_ADMIN_TOKEN
  if (!BUILD_RE.test(a.build || '') || (a.force ? !adminToken : !secret)) {
    console.error('usage: POI_LOAD_SECRET=... node scripts/poi/load.mjs --build <region-YYYYMMDDTHHMMZ> [--base URL] [--skip-photos]\n' +
      '       ROAM_ADMIN_TOKEN=... node scripts/poi/load.mjs --build <id> --force')
    process.exit(2)
  }
  run({ build: a.build, base: a.base, secret, adminToken, force: a.force, skipPhotos: Boolean(a['skip-photos']) })
    .then(code => process.exit(code))
}
