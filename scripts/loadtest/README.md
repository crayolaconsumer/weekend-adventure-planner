# ROAM load test (k6)

A staged load test of www.go-roam.uk: 10 → 25 → 50 → 100 → 250 → 500 → 1000
virtual users, 2 minutes per level (20 s ramp, 100 s hold, 30 s ramp-down at the
end, about 14.5 minutes in all). It runs on GitHub Actions (`.github/workflows/loadtest.yml`,
manual trigger) around 01:00 UK time. It stops itself when:

- `http_req_failed` goes over 1% (429s and load-test 503s don't count), or
- `roam_failed` goes over 1% (the same, but only a 503 whose body says "cache-only" is excused), or
- p95 of `http_req_duration` goes over 3000 ms.

Each check waits 30 s (`delayAbortEval`) before it can stop the run.
The thresholds are cumulative over the run. The later stages carry most of the
requests, so they dominate them.

| File | What it does |
|---|---|
| `queries.mjs` | Writes `queries.json`: 16 Discover Overpass queries (8 cities × 5/15 km, built by `shared/overpassQuery.js`), 30 image-resolve URLs (York and Belfast places with a wikidata tag), 5 town pages, the trending URL and the browser User-Agent. Deterministic, no network. |
| `warm.mjs` | Requests every image-resolve URL, town page and Overpass query **once**, 1 s apart, as a normal browser **without** the load-test header, so the CDN and KV hold real answers. Prints status and `x-vercel-cache`. Always exits 0. |
| `accounts.mjs` | Creates and deletes the test accounts directly in MySQL. |
| `k6.js` | The test. Writes `summary.json` to the current directory. |

## Traffic

Every request sends `x-roam-loadtest: $LOADTEST_SECRET`. While `LOADTEST_SECRET` is
set in Vercel, the API then skips per-IP rate limits and never calls Overpass or
Wikimedia. On a cache miss it answers `503 {"error":"…cache-only…"}` instead
(`api/lib/loadtest.js`). The User-Agent is desktop Chrome.

**70% anonymous VUs**, each iteration is one Discover session, with 1–4 s think time after each step:
`GET /api/flags` → `POST /api/places/overpass/nearby {query}` → 4 × `GET /api/places/image-resolve` in parallel → `GET /api/places/trending?limit=8&days=30` → `GET /town/<york|manchester|edinburgh|bristol|cardiff>`.

**30% signed-in VUs**. `setup()` logs each test account in **once**. The API allows
10 logins per 15 min per account, and the load-test header doesn't lift that limit.
VU *i* then uses account *i* % ACCOUNTS. Each iteration:
the notifications poll and list → social feed → 3 swipes (`PUT /api/users/stats` each) → `POST /api/places/swiped` batch →
`GET`, `POST` then `DELETE /api/places/saved` → `GET /api/contributions/batch` (10 ids) →
the next account's profile → follow → unfollow.

`k6.js` cites the client `file:line` for every request next to the call.

Expected rate (2.5 s mean think time, about 150 ms per cached response):

| Stage | VUs (anon/signed) | ≈ req/s |
|---|---|---|
| 1 | 10 (7/3) | 5 |
| 2 | 25 (18/7) | 14 |
| 3 | 50 (35/15) | 27 |
| 4 | 100 (70/30) | 54 |
| 5 | 250 (175/75) | 134 |
| 6 | 500 (350/150) | 268 |
| 7 | 1000 (700/300) | 536 |

Slower responses lower these numbers. That is expected with a closed model, because each VU waits for its reply before the next step.

## Running it

1. **From a trusted machine** (the DB credentials never reach Actions), create the accounts:

   ```bash
   export MYSQL_HOST=… MYSQL_PORT=3306 MYSQL_DATABASE=… MYSQL_USER=… MYSQL_PASSWORD=…
   export LOADTEST_PASSWORD='<12+ chars, same value as the GitHub secret>'
   node scripts/loadtest/accounts.mjs 20260928 100      # run id [a-z0-9]{1,20}, 100 accounts
   ```

   This creates users `lt_20260928_0` … `lt_20260928_99`, with emails `@loadtest.invalid`.
   It writes only the columns the register path writes. It refuses a run id that
   already has users.

2. Set `LOADTEST_SECRET` (32+ chars) in Vercel production and redeploy. Put the
   same value in the repo secret `LOADTEST_SECRET`, and the password in `LOADTEST_PASSWORD`.

3. Run the **Load test** workflow with `run_id=20260928` and `accounts=100`
   (the workflow's default is 50; any value works, but 100 spreads the 300
   signed-in VUs 3 per account) and `max_vus=1000` (or less to stop early).

4. Download the `loadtest-<run_id>` artifact:
   - `summary.json` has one entry per stage, and per endpoint in each stage: `requests`,
     `p50_ms`, `p95_ms`, `p99_ms`, `fail_rate`, `count_429`, `count_503_loadtest`.
     It also has the `rps_nominal` per stage and which abort thresholds were crossed.
     Stages the run never reached are missing.
   - `summary-export.json` is k6's own export.

5. **Clean up** from the trusted machine:

   ```bash
   node scripts/loadtest/accounts.mjs --cleanup 20260928
   ```

   It finds the users by exact username and email match. In one transaction it
   deletes their rows in `follows`, `follow_requests`, `notifications`,
   `swiped_places`, `saved_places`, `user_stats`, `user_badges` and `activity_log`,
   then the users themselves. Anything else that references them goes by the live
   FKs, and the script counts those rows first. It prints a count per table.

6. Remove `LOADTEST_SECRET` from Vercel and redeploy, so the header is inert again.

## Running locally

```bash
node scripts/loadtest/queries.mjs
BASE_URL=https://<preview>.vercel.app LOADTEST_SECRET=… LOADTEST_PASSWORD=… RUN_ID=… ACCOUNTS=10 MAX_VUS=25 \
  k6 run scripts/loadtest/k6.js
```

Point `BASE_URL` at a preview deployment unless you mean production.
