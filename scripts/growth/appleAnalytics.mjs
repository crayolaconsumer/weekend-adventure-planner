// App Store Connect Analytics Reports (the ONGOING request on app 6768306617).
// Reads the DAILY instances of "App Downloads Standard" and "App Store
// Discovery and Engagement Standard", downloads their gzipped TSV segments
// (presigned URLs, no auth) and sums them per report week by the row's Date.
import { existsSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { parseDelimited, sumInWindow } from './lib.mjs'

const APP = '6768306617'
const KEY = `${process.env.HOME}/.appstoreconnect/private_keys/AuthKey_5QUN6Q3F38.p8`
const REPORTS = { downloads: 'App Downloads Standard', engagement: 'App Store Discovery and Engagement Standard' }

/** Pure: weekly numbers from parsed report rows. Exported for tests. */
export function summarise({ downloads, engagement }, win) {
  const w = (rows, field, keep) => ({
    this: sumInWindow(rows, 'Date', field, win.start, win.end, keep),
    prev: sumInWindow(rows, 'Date', field, win.prevStart, win.start, keep),
  })
  const ev = name => r => (r.Event || '').toLowerCase() === name
  return {
    firstTimeDownloads: w(downloads, 'Counts', r => r['Download Type'] === 'First-time download'),
    redownloads: w(downloads, 'Counts', r => r['Download Type'] === 'Redownload'),
    impressions: w(engagement, 'Counts', ev('impression')),
    pageViews: w(engagement, 'Counts', ev('page view')),
    lastDataDate: [...downloads, ...engagement].map(r => r.Date).filter(Boolean).sort().pop() || null,
  }
}

export async function collect(win, { asc, fetch = globalThis.fetch } = {}) {
  if (!asc) {
    if (!existsSync(KEY)) return { status: 'missing', need: `App Store Connect API key at ${KEY}` }
    asc = (await import('../ios-release/stores.mjs')).asc
  }
  const req = (await asc(`apps/${APP}/analyticsReportRequests`)).data.find(r => r.attributes.accessType === 'ONGOING' && !r.attributes.stoppedDueToInactivity)
  if (!req) return { status: 'missing', need: 'an ONGOING analyticsReportRequest for the app (create one in App Store Connect)' }
  const reports = (await asc(`analyticsReportRequests/${req.id}/reports?limit=200`)).data
  const since = win.prevStart.toISOString().slice(0, 10)
  const rows = {}
  let instances = 0
  for (const [key, name] of Object.entries(REPORTS)) {
    rows[key] = []
    const rep = reports.find(r => r.attributes.name === name)
    if (!rep) continue
    const inst = (await asc(`analyticsReports/${rep.id}/instances?filter[granularity]=DAILY&limit=200`)).data
      .filter(i => i.attributes.processingDate >= since)
    instances += inst.length
    for (const i of inst)
      for (const seg of (await asc(`analyticsReportInstances/${i.id}/segments`)).data) {
        const buf = Buffer.from(await (await fetch(seg.attributes.url)).arrayBuffer())
        const text = (buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString('utf8')
        rows[key].push(...parseDelimited(text, '\t').filter(r => !r['App Apple Identifier'] || r['App Apple Identifier'] === APP))
      }
  }
  if (!instances) return { status: 'pending', note: 'first Apple data pending (the report request exists; Apple has not generated any daily instances yet)' }
  return { status: 'ok', ...summarise(rows, win) }
}
