// Vercel Web Analytics for go-roam.uk (production only, Vercel's default filter).
// Token: the Vercel CLI's own auth.json, read at runtime and never logged.
import { readFileSync, existsSync } from 'node:fs'
import { days } from './lib.mjs'

const PROJECT = 'prj_y4iJ83FCWJsyVPvGQ1Ko8Bgxk1Bv'
const TEAM = 'team_z0hlw69Nm5pcVCyhtAUWcgex'
const AUTH = `${process.env.HOME}/Library/Application Support/com.vercel.cli/auth.json`

function token() {
  if (process.env.VERCEL_TOKEN) return process.env.VERCEL_TOKEN
  if (!existsSync(AUTH)) return null
  try { return JSON.parse(readFileSync(AUTH, 'utf8')).token || null } catch { return null }
}

/** Does the site ship the Web Analytics script at all? */
function hasScript() {
  try { return /"@vercel\/analytics"/.test(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) } catch { return null }
}

export async function collect(win, { fetch = globalThis.fetch, tok = token(), scriptInstalled = hasScript() } = {}) {
  if (!tok) return { status: 'missing', need: 'Vercel CLI login (vercel login) or VERCEL_TOKEN' }
  const get = async (path, params) => {
    const q = new URLSearchParams({ projectId: PROJECT, teamId: TEAM, ...params })
    const r = await fetch(`https://api.vercel.com${path}?${q}`, { headers: { Authorization: `Bearer ${tok}` } })
    const j = await r.json()
    if (!r.ok) throw new Error(`Vercel ${r.status} ${path}: ${j?.error?.message || ''}`.slice(0, 300))
    return j
  }
  const project = await get(`/v9/projects/${PROJECT}`, {})
  if (!project.webAnalytics?.enabledAt) return { status: 'disabled' }
  const range = (a, b) => ({ since: a.toISOString(), until: new Date(+b - 1).toISOString() })
  const [cur, prev, daily, pages] = await Promise.all([
    get('/v1/query/web-analytics/visits/count', range(win.start, win.end)),
    get('/v1/query/web-analytics/visits/count', range(win.prevStart, win.start)),
    get('/v1/query/web-analytics/visits/aggregate', { ...range(win.start, win.end), by: 'day' }),
    get('/v1/query/web-analytics/visits/aggregate', { ...range(win.start, win.end), by: 'requestPath', limit: '5' }),
  ])
  // Aggregate rows: the group key plus pageviews/visitors (count on older shapes)
  const perDay = Object.fromEntries(days(win.start, win.end).map(d => [d, { pageviews: 0, visitors: 0 }]))
  for (const r of daily.data || []) {
    const k = String(r.day ?? r.timestamp ?? r.date ?? '').slice(0, 10)
    if (k in perDay) perDay[k] = { pageviews: r.pageviews ?? r.count ?? 0, visitors: r.visitors ?? 0 }
  }
  return {
    status: 'ok',
    pageviews: { this: cur.data?.pageviews ?? 0, prev: prev.data?.pageviews ?? 0 },
    visitors: { this: cur.data?.visitors ?? 0, prev: prev.data?.visitors ?? 0 },
    perDay,
    topPages: (pages.data || []).map(r => ({ path: r.requestPath, pageviews: r.pageviews ?? r.count ?? 0, visitors: r.visitors ?? 0 })),
    scriptInstalled,
  }
}
