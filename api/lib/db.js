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

/**
 * Get database connection pool
 * Creates pool on first call, reuses on subsequent calls
 */
export function getPool() {
  if (!pool) {
    // Pool sizing is constrained by the database, not by this instance alone:
    // the real ceiling is connectionLimit x (peak warm instances) and must stay
    // under the server's max_connections. Every function now runs in lhr1 only
    // (vercel.json "regions"), next to the eu-west-2 database, and Fluid
    // instances serve many requests each, so 3 connections per instance is
    // plenty. The BOUNDED queue makes a sudden influx fail fast (a thrown
    // "Queue limit reached" -> handled 5xx) instead of silent 30s hangs.
    // idleTimeout releases every connection idle for 10s (mysql2 reaps idle
    // connections whenever maxIdle < connectionLimit), so a quiet warm
    // instance doesn't hold slots. connectTimeout stops a sick database from
    // pinning requests for mysql2's default 10s.
    // The durable fix for serverless connection scaling is RDS Proxy.
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST,
      port: parseInt(process.env.MYSQL_PORT || '3306', 10),
      database: process.env.MYSQL_DATABASE,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      waitForConnections: true,
      connectionLimit: 3,
      queueLimit: 100,       // bounded, but deep enough for cron push bursts and admin dashboards
      maxIdle: 1,
      idleTimeout: 10000,
      connectTimeout: 5000,
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
