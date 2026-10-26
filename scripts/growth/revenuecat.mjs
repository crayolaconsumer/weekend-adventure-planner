// RevenueCat v2 overview metrics (point-in-time: MRR, trials, subscriptions,
// new customers). Key: ~/.roam-revenuecat-key (secret v2 key, read-only
// permissions are enough). Project ca8b1519 by default.
import { readFileSync, existsSync } from 'node:fs'

const KEYFILE = `${process.env.HOME}/.roam-revenuecat-key`

export async function collect(win, {
  fetch = globalThis.fetch,
  key = existsSync(KEYFILE) ? readFileSync(KEYFILE, 'utf8').trim() : null,
  project = process.env.REVENUECAT_PROJECT_ID || 'ca8b1519',
} = {}) {
  if (!key) return { status: 'missing', need: `key file missing (${KEYFILE}, a secret v2 API key with charts/metrics read)` }
  const r = await fetch(`https://api.revenuecat.com/v2/projects/${project}/metrics/overview`, { headers: { Authorization: `Bearer ${key}` } })
  const j = await r.json()
  if (!r.ok) throw new Error(`RevenueCat ${r.status}: ${(j.message || JSON.stringify(j)).slice(0, 200)}`)
  const m = Object.fromEntries((j.metrics || []).map(x => [x.id, x]))
  const v = id => (m[id] ? Number(m[id].value) : null)
  const churn = Object.values(m).find(x => /churn/i.test(x.id))
  return {
    status: 'ok',
    mrr: v('mrr'), mrrUnit: m.mrr?.unit || '$',
    revenue28d: v('revenue'),
    activeTrials: v('active_trials'),
    activeSubscriptions: v('active_subscriptions'),
    newCustomers28d: v('new_customers'),
    activeUsers28d: v('active_users'),
    churn: churn ? Number(churn.value) : null,
  }
}
