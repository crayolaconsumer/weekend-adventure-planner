/**
 * MySQL Database Connection Utility
 *
 * Uses mysql2 with promise wrapper for async/await support.
 * Optimized for serverless (Vercel) with connection pooling.
 */

import mysql from 'mysql2/promise'

// Connection pool (reused across invocations in warm lambdas)
let pool = null

/**
 * Get database connection pool
 * Creates pool on first call, reuses on subsequent calls
 */
export function getPool() {
  if (!pool) {
    // Pool sizing is constrained by Aurora, not by this instance alone.
    // Verified 2026-06: the cluster (Aurora MySQL, eu-west-2) has
    // max_connections=250, all-time peak 122. Vercel functions run in
    // MULTIPLE regions (iad1/lhr1/gru1/hkg1), so the real ceiling is
    // connectionLimit × (peak warm instances across all regions) < 250.
    // We keep connectionLimit modest and rely on a BOUNDED queue so a
    // sudden influx fails fast (a thrown "Queue limit reached" → handled
    // 5xx) instead of the previous queueLimit:0 behaviour, which queued
    // unbounded and turned overload into silent 30s hangs / blank screens.
    // maxIdle + idleTimeout release spare connections between spikes so
    // idle warm instances across regions don't hoard the 250 budget.
    // The durable fix for serverless↔Aurora connection scaling is RDS
    // Proxy (multiplexes connections) — needs AWS access to the cluster.
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST,
      port: parseInt(process.env.MYSQL_PORT || '3306', 10),
      database: process.env.MYSQL_DATABASE,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      waitForConnections: true,
      connectionLimit: 8,
      queueLimit: 30,        // was 0 (unbounded) — fail fast under load
      maxIdle: 2,
      idleTimeout: 30000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0
    })
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
