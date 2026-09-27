/**
 * MySQL Database Connection Utility
 *
 * Uses mysql2 with promise wrapper for async/await support.
 * Optimized for serverless (Vercel) with connection pooling.
 */

import mysql from 'mysql2/promise'
import { attachDatabasePool } from '@vercel/functions'

// Connection pool (reused across invocations in warm lambdas)
let pool = null

const connectionConfig = () => ({
  host: process.env.MYSQL_HOST,
  port: parseInt(process.env.MYSQL_PORT || '3306', 10),
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  connectTimeout: 5000,
})

/**
 * One connection OUTSIDE the pool, for session state that has to outlive a
 * single query (a named lock, lock_wait_timeout) while the request keeps
 * using the pool's one connection for everything else. Borrowing the pool's
 * connection instead would deadlock the request's own pool queries. Rare
 * admin jobs only (the POI loader); the caller must end() it.
 */
export function dedicatedConnection() {
  return mysql.createConnection(connectionConfig())
}

/**
 * Get database connection pool
 * Creates pool on first call, reuses on subsequent calls
 */
export function getPool() {
  if (!pool) {
    // Pool sizing is constrained by the database, not by this instance alone:
    // the real ceiling is connectionLimit x (peak warm instances, one set per
    // endpoint function) and must stay under the server's max_connections.
    // Every function runs in lhr1 next to the eu-west-2 database. The BOUNDED
    // queue makes a sudden influx fail fast (a thrown "Queue limit reached" ->
    // handled 5xx) instead of silent 30s hangs. A busy instance keeps its one
    // connection; attachDatabasePool (below) frees it before Fluid suspends
    // the instance. connectTimeout stops a sick database from pinning requests
    // for mysql2's default 10s. Past this, the next steps are fewer, larger
    // functions or RDS Proxy.
    pool = mysql.createPool({
      ...connectionConfig(),
      waitForConnections: true,
      // 1 per instance: a query takes milliseconds, so one connection serves
      // hundreds a second, while the database's total (connections x warm
      // instances, across ~80 functions) is what runs out. Safe because no
      // transaction asks the pool for a second connection (checked 2026-09-27).
      connectionLimit: 1,
      queueLimit: 100,       // bounded, but deep enough for cron push bursts and admin dashboards
      maxIdle: 1,
      idleTimeout: 10000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0
    })
    // idleTimeout can't fire while Fluid compute has the instance suspended,
    // so every paused function (one per endpoint) kept an idle connection
    // open: one user's session across ~17 endpoints held 51 connections
    // (alarm 2026-09-27). This closes idle connections before suspension.
    // mysql2/promise wraps the callback pool that attachDatabasePool knows
    try { attachDatabasePool(pool.pool) } catch (err) { console.warn('[db] attachDatabasePool failed', err.message) }
  }
  return pool
}

/**
 * Execute a query with automatic connection handling
 * @param {string} sql - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Array>} Query results
 */
export async function query(sql, params = []) {
  const pool = getPool()
  // Use query() instead of execute() for better type handling
  // execute() uses prepared statements which have strict type requirements
  const [rows] = await pool.query(sql, params)
  return rows
}

/**
 * Execute a query and return first row only
 * @param {string} sql - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Object|null>} First row or null
 */
export async function queryOne(sql, params = []) {
  const rows = await query(sql, params)
  return rows[0] || null
}

/**
 * Execute an INSERT and return the inserted ID
 * @param {string} sql - INSERT query
 * @param {Array} params - Query parameters
 * @returns {Promise<number>} Inserted row ID
 */
export async function insert(sql, params = []) {
  const pool = getPool()
  const [result] = await pool.query(sql, params)
  return result.insertId
}

/**
 * Execute an UPDATE/DELETE and return affected rows count
 * @param {string} sql - UPDATE or DELETE query
 * @param {Array} params - Query parameters
 * @returns {Promise<number>} Number of affected rows
 */
export async function update(sql, params = []) {
  const pool = getPool()
  const [result] = await pool.query(sql, params)
  return result.affectedRows
}

/**
 * Execute multiple queries in a transaction
 * @param {Function} callback - Async function receiving connection
 * @returns {Promise<any>} Result of callback
 */
export async function transaction(callback) {
  const pool = getPool()
  const connection = await pool.getConnection()

  try {
    await connection.beginTransaction()
    const result = await callback(connection)
    await connection.commit()
    return result
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

/**
 * Test database connection
 * @returns {Promise<boolean>} True if connected successfully
 */
export async function testConnection() {
  try {
    await query('SELECT 1')
    return true
  } catch (error) {
    console.error('Database connection failed:', error.message)
    return false
  }
}

export default { getPool, query, queryOne, insert, update, transaction, testConnection }
