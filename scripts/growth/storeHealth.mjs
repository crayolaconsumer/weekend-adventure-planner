// Store health: live versions, subscription states, reviews and ratings for
// both stores. Uses the release helpers (scripts/ios-release/stores.mjs).
// Read-only, with one caveat copied from status.mjs: Play only exposes tracks
// through an edit, so we open one and DELETE it unpublished (nothing changes).
import { existsSync } from 'node:fs'

const KEYS = `${process.env.HOME}/.appstoreconnect/private_keys/`
const APP = '6768306617'

/** Same wording as status.mjs: anything not APPROVED is not on sale. */
export function subscriptionNote(state) {
  if (state === 'APPROVED') return null
  if (['WAITING_FOR_REVIEW', 'IN_REVIEW'].includes(state)) return 'not on sale until approved'
  return 'NOT ON SALE and not in review: add it to the next review submission'
}

const clip = (s, n = 140) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '')

async function apple(asc, fetch, win) {
  const versions = (await asc(`apps/${APP}/appStoreVersions?limit=5`)).data.map(v => ({ version: v.attributes.versionString, state: v.attributes.appStoreState, platform: v.attributes.platform }))
  const subs = []
  for (const g of (await asc(`apps/${APP}/subscriptionGroups`)).data)
    for (const s of (await asc(`subscriptionGroups/${g.id}/subscriptions`)).data)
      subs.push({ store: 'ios', product: s.attributes.productId, state: s.attributes.state, note: subscriptionNote(s.attributes.state) })
  const reviews = (await asc(`apps/${APP}/customerReviews?sort=-createdDate&limit=50`)).data.map(r => ({
    store: 'ios', rating: r.attributes.rating, title: r.attributes.title, body: clip(r.attributes.body), date: new Date(r.attributes.createdDate).toISOString(),
  }))
  // The App Store's public lookup carries the aggregate rating; ASC's API does not.
  let rating = null
  try {
    const j = await (await fetch(`https://itunes.apple.com/lookup?id=${APP}&country=gb`)).json()
    const r = j.results?.[0]
    if (r) rating = { average: r.averageUserRating ?? null, count: r.userRatingCount ?? 0 }
  } catch { /* rating stays null */ }
  return { versions, subs, reviews, rating }
}

async function google(play, PKG) {
  const edit = await play(`androidpublisher/v3/applications/${PKG}/edits`, { method: 'POST' })
  let tracks
  try { tracks = (await play(`androidpublisher/v3/applications/${PKG}/edits/${edit.id}/tracks`)).tracks || [] }
  finally { await play(`androidpublisher/v3/applications/${PKG}/edits/${edit.id}`, { method: 'DELETE' }) }
  const versions = tracks.flatMap(t => (t.releases || []).map(r => ({ track: t.track, version: r.name, status: r.status, userFraction: r.userFraction ?? null })))
  const subs = []
  for (const s of (await play(`androidpublisher/v3/applications/${PKG}/subscriptions`)).subscriptions || [])
    for (const bp of s.basePlans || []) subs.push({ store: 'android', product: `${s.productId}/${bp.basePlanId}`, state: bp.state, note: bp.state === 'ACTIVE' ? null : 'base plan not ACTIVE: not on sale' })
  // Play's reviews API only returns reviews from the last 7 days that have text
  const reviews = ((await play(`androidpublisher/v3/applications/${PKG}/reviews?maxResults=50`)).reviews || []).map(r => {
    const c = r.comments?.find(x => x.userComment)?.userComment || {}
    return { store: 'android', rating: c.starRating, title: '', body: clip(c.text), date: new Date(Number(c.lastModified?.seconds || 0) * 1000).toISOString() }
  })
  return { versions, subs, reviews }
}

export async function collect(win, deps = {}) {
  const fetch = deps.fetch || globalThis.fetch
  let helpers = deps.helpers
  const hasAsc = deps.helpers || existsSync(KEYS + 'AuthKey_5QUN6Q3F38.p8')
  const hasPlay = deps.helpers || existsSync(KEYS + 'roam-play-rc-service-account.json')
  if (!hasAsc && !hasPlay) return { status: 'missing', need: `App Store Connect key and Play service account in ${KEYS}` }
  helpers ||= await import('../ios-release/stores.mjs')
  const out = { status: 'ok', ios: null, android: null, errors: [] }
  const [a, g] = await Promise.allSettled([hasAsc ? apple(helpers.asc, fetch, win) : null, hasPlay ? google(helpers.play, helpers.PKG) : null])
  if (a.status === 'fulfilled') out.ios = a.value; else out.errors.push(`App Store Connect: ${a.reason.message}`)
  if (g.status === 'fulfilled') out.android = g.value; else out.errors.push(`Google Play: ${g.reason.message}`)
  const all = [...(out.ios?.reviews || []), ...(out.android?.reviews || [])]
  const thisWeek = all.filter(r => r.date >= win.start.toISOString() && r.date < win.end.toISOString())
  out.reviewsThisWeek = { count: thisWeek.length, average: thisWeek.length ? thisWeek.reduce((s, r) => s + r.rating, 0) / thisWeek.length : null }
  out.latestReviews = all.sort((x, y) => y.date.localeCompare(x.date)).slice(0, 3)
  out.notOnSale = [...(out.ios?.subs || []), ...(out.android?.subs || [])].filter(s => s.note)
  delete out.ios?.reviews; delete out.android?.reviews
  return out
}
