#!/usr/bin/env node
/**
 * Load-test accounts, written straight to the DB (the register endpoint is not
 * in the load-test bypass, and 100 sign-ups would trip its per-IP limit).
 *
 *   node scripts/loadtest/accounts.mjs <run> <n>      create lt_<run>_0 .. lt_<run>_<n-1>
 *   node scripts/loadtest/accounts.mjs --cleanup <run>  delete them and everything they wrote
 *
 * Env: MYSQL_HOST, MYSQL_PORT, MYSQL_DATABASE, MYSQL_USER, MYSQL_PASSWORD
 * (same names as api/lib/db.js) and, for create, LOADTEST_PASSWORD.
 *
 * Create writes exactly what the register path writes (api/auth/index.js
 * handleRegister: INSERT INTO users (email, password_hash, username,
 * display_name, email_verified) VALUES (?, ?, ?, NULL, FALSE)) and nothing
 * else: no privacy row, no preferences, no stats.
 */
import mysql from 'mysql2/promise'
import bcrypt from 'bcryptjs' // api/lib/auth.js:8, SALT_ROUNDS = 10
import { pathToFileURL } from 'node:url'

const EMAIL_DOMAIN = 'loadtest.invalid'
const RUN_RE = /^[a-z0-9]{1,20}$/
const MAX_ACCOUNTS = 2000

// Every table the load test writes for its users, with the columns that point
// at users.id. Deleted explicitly so cleanup never depends on the live DB
// having the FKs database/*.sql declares (they all say ON DELETE CASCADE).
//   follows, follow_requests      POST /api/social follow|unfollow (api/social/index.js)
//   notifications                 follow request notice for the target (createNotification)
//   swiped_places                 POST /api/places/swiped
//   saved_places                  POST|DELETE /api/places/saved
//   user_stats, user_badges       PUT /api/users/stats (+ evaluateBadges)
//   activity_log                  written by some social paths (phase4-social.sql)
const OWNED = [
  ['follows', ['follower_id', 'following_id']],
  ['follow_requests', ['requester_id', 'target_id']],
  ['notifications', ['user_id', 'actor_id']],
  ['swiped_places', ['user_id']],
  ['saved_places', ['user_id']],
  ['user_stats', ['user_id']],
  ['user_badges', ['user_id']],
  ['activity_log', ['user_id']],
]

export const username = (run, i) => `lt_${run}_${i}`
export const email = (run, i) => `${username(run, i)}@${EMAIL_DOMAIN}`
// Exact match, so a LIKE wildcard can never widen what cleanup deletes
export const isRunUser = (run, row) => {
  const m = new RegExp(`^lt_${run}_(\\d+)$`).exec(row.username || '')
  return Boolean(m) && row.email === email(run, Number(m[1]))
}

function connect() {
  for (const k of ['MYSQL_HOST', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD']) {
    if (!process.env[k]) throw new Error(`${k} is not set`)
  }
  return mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    database: process.env.MYSQL_DATABASE,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    connectTimeout: 10000,
  })
}

async function runUsers(db, run) {
  // `_` is a LIKE wildcard: escape it, then re-check every row exactly
  const [rows] = await db.query(
    "SELECT id, username, email FROM users WHERE username LIKE ? ESCAPE '!' AND email LIKE ? ESCAPE '!'",
    [`lt!_${run}!_%`, `%@${EMAIL_DOMAIN}`]
  )
  return rows.filter(r => isRunUser(run, r))
}

async function create(run, n) {
  const password = process.env.LOADTEST_PASSWORD
  if (!password || password.length < 12) throw new Error('LOADTEST_PASSWORD must be set (12+ chars)')
  const db = await connect()
  try {
    const existing = await runUsers(db, run)
    if (existing.length) throw new Error(`run ${run} already has ${existing.length} users; pick a new run id or --cleanup ${run}`)
    // One hash for all: same password, and 10 rounds x n would take minutes
    const hash = await bcrypt.hash(password, 10)
    const rows = Array.from({ length: n }, (_, i) => [email(run, i), hash, username(run, i), null, false])
    for (let i = 0; i < rows.length; i += 500) {
      await db.query(
        'INSERT INTO users (email, password_hash, username, display_name, email_verified) VALUES ?',
        [rows.slice(i, i + 500)]
      )
    }
    const made = await runUsers(db, run)
    console.log(`created ${made.length} users: ${username(run, 0)} .. ${username(run, n - 1)} (@${EMAIL_DOMAIN})`)
    if (made.length !== n) throw new Error(`expected ${n}, found ${made.length}`)
  } finally {
    await db.end()
  }
}

async function cleanup(run) {
  const db = await connect()
  try {
    const users = await runUsers(db, run)
    if (!users.length) {
      console.log(`no users for run ${run}`)
      return
    }
    const ids = users.map(u => u.id)
    const [present] = await db.query(
      'SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()'
    )
    const tables = new Set(present.map(r => r.t))

    // Anything else pointing at users (per the live FKs) goes by CASCADE /
    // SET NULL when the user row is deleted; count it so the report is complete
    const [fks] = await db.query(
      `SELECT k.TABLE_NAME AS t, k.COLUMN_NAME AS c, r.DELETE_RULE AS rule
         FROM information_schema.KEY_COLUMN_USAGE k
         JOIN information_schema.REFERENTIAL_CONSTRAINTS r
           ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
        WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME = 'users' AND k.REFERENCED_COLUMN_NAME = 'id'`
    )

    await db.beginTransaction()
    const report = {}
    for (const [table, cols] of OWNED) {
      if (!tables.has(table)) continue
      const where = cols.map(c => `${c} IN (?)`).join(' OR ')
      const [res] = await db.query(`DELETE FROM ${table} WHERE ${where}`, cols.map(() => ids))
      report[table] = res.affectedRows
    }
    for (const { t, c, rule } of fks) {
      if (OWNED.some(([table]) => table === t)) continue
      const [[{ n }]] = await db.query(`SELECT COUNT(*) AS n FROM \`${t}\` WHERE \`${c}\` IN (?)`, [ids])
      if (n) report[`${t}.${c} (${rule})`] = n
    }
    const [res] = await db.query('DELETE FROM users WHERE id IN (?)', [ids])
    report.users = res.affectedRows
    await db.commit()

    console.log(`cleanup run ${run}: rows deleted`)
    console.table(report)
    const left = await runUsers(db, run)
    if (left.length) throw new Error(`${left.length} users still present`)
  } catch (err) {
    await db.rollback().catch(() => {})
    throw err
  } finally {
    await db.end()
  }
}

async function main(argv) {
  if (argv[0] === '--cleanup') {
    if (!RUN_RE.test(argv[1] || '')) throw new Error('usage: accounts.mjs --cleanup <run>  (run = [a-z0-9]{1,20})')
    return cleanup(argv[1])
  }
  const [run, nRaw] = argv
  const n = Number(nRaw)
  if (!RUN_RE.test(run || '') || !Number.isInteger(n) || n < 1 || n > MAX_ACCOUNTS) {
    throw new Error(`usage: accounts.mjs <run> <n>  (run = [a-z0-9]{1,20}, 1 <= n <= ${MAX_ACCOUNTS})\n       accounts.mjs --cleanup <run>`)
  }
  return create(run, n)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(err => {
    console.error(err.message)
    process.exit(1)
  })
}
