// Google Play statistics from the bulk-report bucket (gs://pubsite_prod_rev_...).
// Monthly CSVs, UTF-16LE, one row per day:
//   stats/installs/installs_<pkg>_<YYYYMM>_overview.csv
//   stats/store_performance/store_performance_<pkg>_<YYYYMM>_*.csv
// Read with the Play service account (needs "download bulk reports" in Play Console).
import { existsSync } from 'node:fs'
import { decodeText, parseDelimited, sumInWindow } from './lib.mjs'

const PKG = 'com.goroam.app'
const KEYFILE = `${process.env.HOME}/.appstoreconnect/private_keys/roam-play-rc-service-account.json`
const NEED = 'not connected: grant the service account bulk-report access and set PLAY_REPORTS_BUCKET'

const months = win => [...new Set([win.prevStart, new Date(+win.end - 1)].map(d => d.toISOString().slice(0, 7).replace('-', '')))]
const pick = (row, ...names) => names.find(n => n in row)

/** Pure: weekly numbers from parsed install and store-performance rows. */
export function summarise({ installs, listing }, win) {
  const w = (rows, field) => field ? ({ this: sumInWindow(rows, 'Date', field, win.start, win.end), prev: sumInWindow(rows, 'Date', field, win.prevStart, win.start) }) : null
  const i0 = installs[0] || {}, l0 = listing[0] || {}
  return {
    installs: w(installs, pick(i0, 'Daily User Installs', 'Install events')),
    uninstalls: w(installs, pick(i0, 'Daily User Uninstalls', 'Uninstall events')),
    listingVisitors: w(listing, pick(l0, 'Store listing visitors')),
    listingAcquisitions: w(listing, pick(l0, 'Store listing acquisitions')),
  }
}

export async function collect(win, { bucket = process.env.PLAY_REPORTS_BUCKET, fetch = globalThis.fetch, authHeader } = {}) {
  if (!bucket) return { status: 'missing', need: NEED.replace('not connected: ', '') }
  bucket = bucket.replace(/^gs:\/\//, '').replace(/\/.*$/, '')
  if (!authHeader) {
    if (!existsSync(KEYFILE)) return { status: 'missing', need: `Play service account key at ${KEYFILE}` }
    const { GoogleAuth } = await import('google-auth-library')
    const client = await new GoogleAuth({ keyFile: KEYFILE, scopes: ['https://www.googleapis.com/auth/devstorage.read_only'] }).getClient()
    authHeader = `Bearer ${(await client.getAccessToken()).token}`
  }
  const gcs = async (path, raw) => {
    const r = await fetch(`https://storage.googleapis.com/storage/v1/b/${bucket}/o${path}`, { headers: { Authorization: authHeader } })
    if (!r.ok) throw new Error(`GCS ${r.status} ${path.slice(0, 120)}: ${(await r.text()).slice(0, 200)}`)
    return raw ? Buffer.from(await r.arrayBuffer()) : r.json()
  }
  const read = async name => parseDelimited(decodeText(await gcs(`/${encodeURIComponent(name)}?alt=media`, true)), ',')
  const installs = [], listing = []
  for (const m of months(win)) {
    const inst = await gcs(`?prefix=${encodeURIComponent(`stats/installs/installs_${PKG}_${m}_overview`)}`)
    for (const o of inst.items || []) installs.push(...await read(o.name))
    const perf = (await gcs(`?prefix=${encodeURIComponent(`stats/store_performance/store_performance_${PKG}_${m}_`)}`)).items || []
    // One breakdown is enough: prefer overview, else country (summed per day)
    const file = perf.find(o => o.name.endsWith('_overview.csv')) || perf.find(o => o.name.endsWith('_country.csv'))
    if (file) listing.push(...await read(file.name))
  }
  if (!installs.length && !listing.length) return { status: 'pending', note: `bucket readable but no ${PKG} stats files for ${months(win).join(', ')} yet` }
  return { status: 'ok', ...summarise({ installs, listing }, win) }
}
