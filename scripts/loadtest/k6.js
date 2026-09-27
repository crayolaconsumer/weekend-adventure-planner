/* global __ENV */
/**
 * ROAM staged load test (k6). Runbook: scripts/loadtest/README.md
 *
 *   node scripts/loadtest/queries.mjs      # writes queries.json (k6 can't import the repo's ESM)
 *   k6 run scripts/loadtest/k6.js          # env below; writes summary.json to the cwd
 *
 * Env: LOADTEST_SECRET (required), LOADTEST_PASSWORD, RUN_ID (accounts are
 * lt_<RUN_ID>_<i>@loadtest.invalid, from accounts.mjs), ACCOUNTS (default 100),
 * MAX_VUS (default 1000), BASE_URL (default https://www.go-roam.uk).
 *
 * Every request carries x-roam-loadtest (api/lib/loadtest.js): the API skips
 * per-IP limits and never goes upstream to Overpass/Wikimedia, answering 503
 * "cache-only" instead. Those 503s and 429s are counted apart and are not
 * failures. Client call sites are cited as file:line next to each request.
 */
import http from 'k6/http'
import exec from 'k6/execution'
import { sleep } from 'k6'
import { Counter, Rate } from 'k6/metrics'

const Q = JSON.parse(open('./queries.json'))

const BASE = (__ENV.BASE_URL || 'https://www.go-roam.uk').replace(/\/$/, '')
const SECRET = __ENV.LOADTEST_SECRET || ''
const RUN_ID = __ENV.RUN_ID || ''
const ACCOUNTS = parseInt(__ENV.ACCOUNTS || '100', 10)
const MAX_VUS = parseInt(__ENV.MAX_VUS || '1000', 10)

// 10 → 25 → … → 1000 VUs, up to MAX_VUS. Each level is 2 min: 20 s ramp, 100 s hold.
const ALL_LEVELS = [10, 25, 50, 100, 250, 500, 1000]
const LEVELS = ALL_LEVELS.filter(v => v <= MAX_VUS).length ? ALL_LEVELS.filter(v => v <= MAX_VUS) : [MAX_VUS]
const STAGE_MS = 120000
const STAGES = LEVELS.map((v, i) => `s${i + 1}_${v}vu`)
const ANON_SHARE = 0.7
const split = v => ({ anon: Math.round(v * ANON_SHARE), signed: v - Math.round(v * ANON_SHARE) })
const rampFor = who => LEVELS.flatMap(v => [
  { duration: '20s', target: split(v)[who] },
  { duration: '100s', target: split(v)[who] },
]).concat({ duration: '30s', target: 0 })

// Endpoint tags → what they are. Every request is tagged {name, stage}.
const ENDPOINTS = {
  flags: 'GET /api/flags',
  overpass_nearby: 'POST /api/places/overpass/nearby',
  image_resolve: 'GET /api/places/image-resolve',
  trending: 'GET /api/places/trending?limit=8&days=30',
  town_page: 'GET /town/:slug',
  auth_login: 'POST /api/auth {action:login}',
  notifications_poll: 'GET /api/notifications?limit=1&unread_only=true',
  notifications_list: 'GET /api/notifications?limit=20&offset=0&unread_only=false',
  social_feed: 'GET /api/social?action=feed&limit=20&offset=0',
  users_stats_put: 'PUT /api/users/stats {increment:{totalSwipes:1}}',
  places_swiped_post: 'POST /api/places/swiped {swipes}',
  places_saved_get: 'GET /api/places/saved',
  places_saved_post: 'POST /api/places/saved {place}',
  places_saved_delete: 'DELETE /api/places/saved?placeId=',
  contributions_batch: 'GET /api/contributions/batch?placeIds=',
  users_profile: 'GET /api/users/:username',
  social_follow: 'POST /api/social {action:follow}',
  social_unfollow: 'POST /api/social {action:unfollow}',
}

const failed = new Rate('roam_failed') // non-2xx/3xx, excluding 429 and load-test 503s
const n429 = new Counter('roam_429')
const rate429 = new Rate('roam_429_rate') // a flood of 429s means the test measures the limiter: abort
const n503 = new Counter('roam_503_loadtest')

// Sub-metric thresholds that always pass: the only way k6 puts a per-tag
// breakdown into handleSummary's data
function breakdownThresholds() {
  const t = {}
  const add = filter => {
    t[`http_req_duration{${filter}}`] = ['max>=0']
    t[`roam_failed{${filter}}`] = ['rate>=0']
    t[`roam_429{${filter}}`] = ['count>=0']
    t[`roam_503_loadtest{${filter}}`] = ['count>=0']
  }
  for (const stage of STAGES) {
    add(`stage:${stage}`)
    for (const name of Object.keys(ENDPOINTS)) if (name !== 'auth_login') add(`name:${name},stage:${stage}`)
  }
  add('name:auth_login,stage:setup')
  return t
}

const ABORT = threshold => [{ threshold, abortOnFail: true, delayAbortEval: '30s' }]

export const options = {
  userAgent: Q.userAgent, // desktop Chrome, never "bot" (queries.mjs checks)
  setupTimeout: '3m',
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(50)', 'p(95)', 'p(99)', 'count'],
  scenarios: {
    anonymous: { executor: 'ramping-vus', exec: 'anonymous', startVUs: 0, stages: rampFor('anon'), gracefulRampDown: '30s' },
    signed_in: { executor: 'ramping-vus', exec: 'signedIn', startVUs: 0, stages: rampFor('signed'), gracefulRampDown: '30s' },
  },
  thresholds: {
    http_req_failed: ABORT('rate<0.01'),
    http_req_duration: ABORT('p(95)<3000'),
    roam_failed: ABORT('rate<0.01'),
    roam_429_rate: ABORT('rate<0.05'),
    ...breakdownThresholds(),
  },
}

// 429 is counted separately, never a failure
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 429))
// Endpoints the server makes cache-only for load tests may also answer 503
const CACHE_ONLY_OK = http.expectedStatuses({ min: 200, max: 399 }, 429, 503)

const HDR = { 'x-roam-loadtest': SECRET }
// Browsers send Origin on every non-GET fetch; GETs carry none (api/lib/cors.js
// sets Vary: Origin, so adding one would split the CDN cache from real users)
const JSON_WRITE = { 'Content-Type': 'application/json', Origin: BASE }

function stageTag() {
  const i = Math.floor((Date.now() - exec.scenario.startTime) / STAGE_MS)
  return STAGES[Math.max(0, Math.min(STAGES.length - 1, i))]
}

const think = () => sleep(1 + Math.random() * 3)
const pick = list => list[Math.floor(Math.random() * list.length)]
const pickN = (list, n) => list.slice().sort(() => Math.random() - 0.5).slice(0, n)

function record(res, tags) {
  // api/lib/bots.js refuseBotUpstream → 'cache-only for crawlers';
  // api/places/overpass/nearby.js → 'Discover temporarily in cache-only mode'
  const cacheOnly = res.status === 503 && typeof res.body === 'string' && res.body.includes('cache-only')
  if (res.status === 429) n429.add(1, tags)
  rate429.add(res.status === 429, tags)
  if (cacheOnly) n503.add(1, tags)
  failed.add(!(res.status >= 200 && res.status < 400) && res.status !== 429 && !cacheOnly, tags)
}

function call(method, path, body, name, { headers = {}, responseCallback } = {}) {
  const tags = { name, stage: stageTag() }
  const params = { headers: { ...HDR, ...headers }, tags }
  if (responseCallback) params.responseCallback = responseCallback
  const res = http.request(method, BASE + path, body, params)
  record(res, tags)
  return res
}

// ── setup: one login per test account ───────────────────────────────────────
// The API limits logins to 10 per 15 min per account (not bypassed by the
// load-test header), so VUs never log in: they share these tokens round-robin.
export function setup() {
  if (SECRET.length < 32) exec.test.abort('LOADTEST_SECRET missing or shorter than 32 chars')
  if (!RUN_ID || !__ENV.LOADTEST_PASSWORD) exec.test.abort('RUN_ID and LOADTEST_PASSWORD are required')

  // Canary: prove the server honours the secret BEFORE any load. A query the
  // place DB can't answer (bench), in a box nothing has cached, must come back
  // as the cache-only 503; anything else means requests would go live upstream.
  const box = (51.4 + Math.random() * 0.2).toFixed(4)
  const canary = http.post(`${BASE}/api/places/overpass/nearby`,
    JSON.stringify({ query: `[out:json][timeout:10];node["amenity"="bench"](${box},-0.2000,${box},-0.1990);out;` }),
    { headers: { ...HDR, ...JSON_WRITE }, tags: { name: 'canary', stage: 'setup' }, responseCallback: CACHE_ONLY_OK })
  if (!(canary.status === 503 && /cache-only/.test(canary.body || ''))) {
    exec.test.abort(`load-test mode not active on the server (canary HTTP ${canary.status}): refusing to run`)
  }

  const accounts = []
  const tags = { name: 'auth_login', stage: 'setup' }
  for (let start = 0; start < ACCOUNTS; start += 10) {
    const batch = []
    for (let i = start; i < Math.min(start + 10, ACCOUNTS); i++) {
      // src/contexts/AuthContext.jsx:254-258: POST /api/auth, JSON, credentials: include
      batch.push({
        username: `lt_${RUN_ID}_${i}`,
        req: ['POST', `${BASE}/api/auth`, JSON.stringify({
          action: 'login', email: `lt_${RUN_ID}_${i}@loadtest.invalid`, password: __ENV.LOADTEST_PASSWORD, remember: false,
        }), { headers: { ...HDR, ...JSON_WRITE }, tags }],
      })
    }
    const responses = http.batch(batch.map(b => b.req))
    responses.forEach((res, j) => {
      record(res, tags)
      const body = res.status === 200 ? res.json() : null
      if (body?.token && body.user?.id) accounts.push({ token: body.token, id: body.user.id, username: batch[j].username })
      else console.warn(`login ${batch[j].username} failed: HTTP ${res.status}`)
    })
  }
  if (!accounts.length) exec.test.abort('no test account could log in')
  if (accounts.length < ACCOUNTS) console.warn(`${accounts.length}/${ACCOUNTS} accounts logged in`)
  return { accounts }
}

// ── 70%: anonymous Discover session ─────────────────────────────────────────
export function anonymous() {
  // api/flags.js (public, edge-cached 30 s). No client call site found in src/:
  // only listed in src/utils/nativeBridge.ts:57 PUBLIC_API_PATHS.
  call('GET', '/api/flags', null, 'flags')
  think()

  // src/utils/apiClient.js:92-97: POST, Content-Type JSON, body {query};
  // query = shared/overpassQuery.js buildDiscoverOverpassQuery (apiClient.js:403)
  const o = pick(Q.overpass)
  call('POST', '/api/places/overpass/nearby', JSON.stringify({ query: o.query }), 'overpass_nearby', {
    headers: JSON_WRITE, responseCallback: CACHE_ONLY_OK,
  })
  think()

  // src/utils/placeImage.js:244: plain GET, no auth; the deck resolves the
  // next few cards' images in parallel (src/components/CardStack.jsx:307)
  const reqs = pickN(Q.imageResolve, 4).map(path => ({ path, tags: { name: 'image_resolve', stage: stageTag() } }))
  const responses = http.batch(reqs.map(r => ['GET', BASE + r.path, null, { headers: HDR, tags: r.tags, responseCallback: CACHE_ONLY_OK }]))
  responses.forEach((res, i) => record(res, reqs[i].tags))
  think()

  // src/components/TrendingPlaces.jsx:41 → src/hooks/useTrendingPlaces.js:29, no auth
  call('GET', Q.trending, null, 'trending')
  think()

  // A browser navigation to a town page (vercel.json rewrite → api/town.js)
  call('GET', pick(Q.towns), null, 'town_page', {
    headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
    responseCallback: CACHE_ONLY_OK,
  })
  think()
}

// ── 30%: signed-in session ──────────────────────────────────────────────────
export function signedIn(data) {
  const accounts = data.accounts
  const idx = exec.vu.idInTest % accounts.length
  const me = accounts[idx]
  // Authorization: Bearer, as src/utils/authToken.js:16 authHeaders() adds
  const AUTH = { Authorization: `Bearer ${me.token}` }

  // src/hooks/useNotifications.js:198: the 60 s unread poll (NotificationBell)
  call('GET', '/api/notifications?limit=1&unread_only=true', null, 'notifications_poll', { headers: AUTH })
  think()
  // src/hooks/useNotifications.js:30-36: URLSearchParams {limit, offset, unread_only}
  call('GET', '/api/notifications?limit=20&offset=0&unread_only=false', null, 'notifications_list', { headers: AUTH })
  think()
  // src/hooks/useSocial.js:288
  call('GET', '/api/social?action=feed&limit=20&offset=0', null, 'social_feed', { headers: AUTH })
  think()

  // Three swipes. Each one: src/pages/Discover.jsx:743 incrementStat('totalSwipes')
  // → src/hooks/useUserStats.js:175-184 PUT {increment:{totalSwipes:1}}
  const swiped = pickN(Q.places, 3)
  for (let i = 0; i < swiped.length; i++) {
    call('PUT', '/api/users/stats', JSON.stringify({ increment: { totalSwipes: 1 } }), 'users_stats_put', { headers: { ...JSON_WRITE, ...AUTH } })
    think()
  }
  // Debounced (2 s) batch: src/hooks/useSwipedPlaces.js:128-136 {swipes:[{placeId, action}]}
  const swipes = swiped.map(p => ({ placeId: p.id, action: Math.random() < 0.5 ? 'like' : 'skip' }))
  call('POST', '/api/places/swiped', JSON.stringify({ swipes }), 'places_swiped_post', { headers: { ...JSON_WRITE, ...AUTH } })
  think()

  // src/hooks/useSavedPlaces.js:41 list, :114-121 save, :161 unsave
  call('GET', '/api/places/saved', null, 'places_saved_get', { headers: AUTH })
  think()
  const p = pick(Q.places)
  const place = { ...p, category: { key: p.category }, savedAt: Date.now() }
  call('POST', '/api/places/saved', JSON.stringify({ place }), 'places_saved_post', { headers: { ...JSON_WRITE, ...AUTH } })
  think()
  call('DELETE', `/api/places/saved?placeId=${encodeURIComponent(p.id)}`, null, 'places_saved_delete', { headers: AUTH })
  think()

  // src/hooks/useTopContributions.js:31: ids joined by ',' unencoded. The hook
  // sends no header itself; the native fetch interceptor adds the Bearer to
  // every non-public API path (src/utils/nativeBridge.ts:53-58)
  const ids = pickN(Q.places, 10).map(x => x.id).join(',')
  call('GET', `/api/contributions/batch?placeIds=${ids}`, null, 'contributions_batch', { headers: AUTH })
  think()

  // Follow then unfollow the next test account, as the profile page does:
  // src/hooks/useSocial.js:124 profile, :26-33 follow, :65-72 unfollow.
  // Test accounts have no privacy row, so the server treats them as private:
  // follow creates a follow_request + notification, unfollow cancels it.
  if (accounts.length > 1) {
    const target = accounts[(idx + 1) % accounts.length]
    const prof = call('GET', `/api/users/${encodeURIComponent(target.username)}`, null, 'users_profile', { headers: AUTH })
    const userId = (prof.status === 200 && prof.json('user.id')) || target.id
    think()
    call('POST', '/api/social', JSON.stringify({ action: 'follow', userId }), 'social_follow', { headers: { ...JSON_WRITE, ...AUTH } })
    think()
    call('POST', '/api/social', JSON.stringify({ action: 'unfollow', userId }), 'social_unfollow', { headers: { ...JSON_WRITE, ...AUTH } })
    think()
  }
}

// ── summary.json: per stage, per endpoint ───────────────────────────────────
const round = v => (typeof v === 'number' ? Math.round(v * 10) / 10 : null)

function row(metrics, filter) {
  const d = metrics[`http_req_duration{${filter}}`]?.values
  if (!d || !d.count) return null
  return {
    requests: d.count,
    p50_ms: round(d['p(50)']),
    p95_ms: round(d['p(95)']),
    p99_ms: round(d['p(99)']),
    fail_rate: round((metrics[`roam_failed{${filter}}`]?.values.rate || 0) * 1000) / 1000,
    count_429: metrics[`roam_429{${filter}}`]?.values.count || 0,
    count_503_loadtest: metrics[`roam_503_loadtest{${filter}}`]?.values.count || 0,
  }
}

export function handleSummary(data) {
  const m = data.metrics
  const stages = {}
  const setupLogin = row(m, 'name:auth_login,stage:setup')
  if (setupLogin) stages.setup = { endpoints: { auth_login: setupLogin } }
  LEVELS.forEach((vus, i) => {
    const stage = STAGES[i]
    const total = row(m, `stage:${stage}`)
    if (!total) return // not reached (aborted earlier)
    const endpoints = {}
    for (const name of Object.keys(ENDPOINTS)) {
      const r = row(m, `name:${name},stage:${stage}`)
      if (r) endpoints[name] = r
    }
    stages[stage] = { vus, ...split(vus), total: { ...total, rps_nominal: round(total.requests / (STAGE_MS / 1000)) }, endpoints }
  })
  const abort = {}
  for (const k of ['http_req_failed', 'http_req_duration', 'roam_failed']) {
    for (const [expr, t] of Object.entries(m[k]?.thresholds || {})) abort[`${k} ${expr}`] = t.ok ? 'ok' : 'CROSSED'
  }
  const out = {
    base_url: BASE,
    run_id: RUN_ID,
    accounts_logged_in: data.setup_data?.accounts?.length ?? 0, // never the tokens
    max_vus: MAX_VUS,
    test_run_duration_s: round((data.state?.testRunDurationMs || 0) / 1000),
    abort_thresholds: abort,
    endpoints: ENDPOINTS,
    stages,
  }
  const lines = ['stage          vus  reqs    rps   p95ms   fail%  429  503lt']
  for (const [stage, s] of Object.entries(stages)) {
    if (!s.total) continue
    const t = s.total
    lines.push([stage.padEnd(12), String(s.vus).padStart(5), String(t.requests).padStart(6), String(t.rps_nominal).padStart(6),
      String(t.p95_ms).padStart(7), String(round(t.fail_rate * 100)).padStart(7), String(t.count_429).padStart(4), String(t.count_503_loadtest).padStart(6)].join(' '))
  }
  lines.push('', ...Object.entries(abort).map(([k, v]) => `${v.padEnd(8)} ${k}`), '')
  return { 'summary.json': JSON.stringify(out, null, 2), stdout: lines.join('\n') + '\n' }
}
