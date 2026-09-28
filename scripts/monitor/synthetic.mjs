#!/usr/bin/env node
/**
 * Synthetic monitor: the user paths a campaign depends on, every 15 minutes
 * from GitHub Actions (.github/workflows/synthetic.yml). A failed run makes
 * GitHub email the repo owner, so an outage reaches James within ~15 min at £0.
 * Each check gets 2 tries 20 s apart, so one blip doesn't page anyone.
 */
import { pathToFileURL } from 'node:url'

const BASE = process.env.BASE_URL || 'https://www.go-roam.uk'
const UA = 'Mozilla/5.0 (compatible; ROAM-synthetic/1.0; +https://www.go-roam.uk)'
// A York Discover query the place DB answers (parseQuery accepts it; rollout
// bucket 5, so served at any poiDbPct above 5), so the probe never reaches
// public Overpass. tests/unit/poi/synthetic.test.js pins both facts.
export const YORK = '[out:json][timeout:25][bbox:53.94,-1.12,53.98,-1.04];nw["amenity"="cafe"];out center;'

export const CHECKS = [
  { name: 'home', path: '/', maxMs: 3000 },
  { name: 'health', path: '/api/health', maxMs: 3000, expect: b => b?.db === 'ok' && b?.kv === 'ok' },
  { name: 'discover', path: '/api/places/overpass/nearby', method: 'POST', body: { query: YORK }, maxMs: 4000, expect: b => Array.isArray(b?.elements) && b.elements.length > 0 },
  { name: 'town', path: '/town/york', maxMs: 4000 },
  { name: 'trending', path: '/api/places/trending?limit=8&days=30', maxMs: 3000 },
]

/** One verdict per check from its attempts: ok if any attempt passed. */
export function judge(check, attempts) {
  const good = attempts.find(a => a.status === 200 && a.ms <= check.maxMs && (!check.expect || a.ok))
  if (good) return { name: check.name, ok: true, ms: good.ms }
  const last = attempts.at(-1)
  const why = last.error || (last.status !== 200 ? `HTTP ${last.status}` : last.ms > check.maxMs ? `slow ${last.ms} ms > ${check.maxMs}` : 'unexpected body')
  return { name: check.name, ok: false, ms: last.ms, why }
}

async function attempt(check) {
  const t = Date.now()
  try {
    const res = await fetch(BASE + check.path, {
      method: check.method || 'GET',
      headers: { 'User-Agent': UA, ...(check.body ? { 'Content-Type': 'application/json', Origin: BASE } : {}) },
      body: check.body ? JSON.stringify(check.body) : undefined,
      signal: AbortSignal.timeout(check.maxMs + 5000),
    })
    const text = await res.text()
    let body = null
    try { body = JSON.parse(text) } catch { /* html pages */ }
    return { status: res.status, ms: Date.now() - t, ok: check.expect ? Boolean(check.expect(body)) : true }
  } catch (err) {
    return { status: 0, ms: Date.now() - t, ok: false, error: err.name }
  }
}

async function main() {
  const verdicts = []
  for (const check of CHECKS) {
    const attempts = [await attempt(check)]
    if (!judge(check, attempts).ok) { await new Promise(r => setTimeout(r, 20000)); attempts.push(await attempt(check)) }
    verdicts.push(judge(check, attempts))
  }
  for (const v of verdicts) console.log(`${v.ok ? 'ok  ' : 'FAIL'} ${v.name.padEnd(9)} ${v.ms} ms${v.why ? `  (${v.why})` : ''}`)
  const failed = verdicts.filter(v => !v.ok)
  if (failed.length) {
    console.error(`::error::ROAM synthetic check failed: ${failed.map(f => `${f.name} (${f.why})`).join(', ')}`)
    process.exit(1)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main()
