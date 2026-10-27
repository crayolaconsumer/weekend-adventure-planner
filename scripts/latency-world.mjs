// Usage: node scripts/latency-world.mjs [path]   (default /api/flags; GET only)
// Real HTTPS timings to go-roam.uk from probes around the world (Globalping, free public API)
const path = process.argv[2] || '/api/flags'
const cities = ['London', 'New York', 'Sao Paulo', 'Johannesburg', 'Mumbai', 'Singapore', 'Tokyo', 'Sydney']
const body = { type: 'http', target: 'www.go-roam.uk', locations: cities.map(c => ({ magic: c, limit: 1 })), measurementOptions: { protocol: 'HTTPS', request: { path, method: 'GET' } } }
const r = await fetch('https://api.globalping.io/v1/measurements', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const { id } = await r.json(); if (!id) { console.log('error', r.status); process.exit(1) }
let m; for (let i = 0; i < 30; i++) { await new Promise(s => setTimeout(s, 2000)); m = await (await fetch(`https://api.globalping.io/v1/measurements/${id}`)).json(); if (m.status === 'finished') break }
console.log(`GET ${path}`)
for (const x of m.results) {
  const t = x.result.timings || {}; const p = x.probe
  console.log(`${(p.city + ', ' + p.country).padEnd(24)} status ${x.result.statusCode ?? x.result.status}  total ${String(t.total ?? '-').padStart(5)} ms  (dns ${t.dns ?? '-'}, tcp ${t.tcp ?? '-'}, tls ${t.tls ?? '-'}, first byte ${t.firstByte ?? '-'})`)
}
