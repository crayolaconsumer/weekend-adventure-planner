import { query } from './db.js'

export const RE_ENGAGEMENT_NUDGE_JOB = 're-engagement-nudge'

export function createPlatformBreakdown() {
  return {
    web: { sent: 0, failed: 0 },
    ios: { sent: 0, failed: 0 },
    android: { sent: 0, failed: 0 }
  }
}

export function mergePlatformBreakdown(target, source) {
  for (const platform of Object.keys(target)) {
    target[platform].sent += source?.[platform]?.sent || 0
    target[platform].failed += source?.[platform]?.failed || 0
  }
  return target
}

export async function ensureCronRunsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS cron_runs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      job_name VARCHAR(100) NOT NULL,
      run_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      eligible_count INT NOT NULL DEFAULT 0,
      sent_count INT NOT NULL DEFAULT 0,
      failed_count INT NOT NULL DEFAULT 0,
      per_platform JSON NULL,
      error_message VARCHAR(500) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_job_run_at (job_name, run_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
}

export async function recordCronRun({
  jobName,
  eligibleCount,
  sentCount,
  failedCount,
  perPlatform,
  errorMessage = null
}) {
  await ensureCronRunsTable()
  await query(
    `INSERT INTO cron_runs
       (job_name, run_at, eligible_count, sent_count, failed_count, per_platform, error_message)
     VALUES (?, NOW(), ?, ?, ?, ?, ?)`,
    [
      jobName,
      eligibleCount,
      sentCount,
      failedCount,
      JSON.stringify(perPlatform || createPlatformBreakdown()),
      errorMessage ? String(errorMessage).slice(0, 500) : null
    ]
  )
}

export async function getLastCronRuns(jobName = RE_ENGAGEMENT_NUDGE_JOB, limit = 10) {
  await ensureCronRunsTable()
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 25)
  const rows = await query(
    `SELECT id, job_name, run_at, eligible_count, sent_count, failed_count, per_platform, error_message
     FROM cron_runs
     WHERE job_name = ?
     ORDER BY run_at DESC
     LIMIT ${safeLimit}`,
    [jobName]
  )

  return rows.map(row => {
    let perPlatform = row.per_platform
    if (typeof perPlatform === 'string') {
      try {
        perPlatform = JSON.parse(perPlatform)
      } catch {
        perPlatform = null
      }
    }
    return {
      id: row.id,
      jobName: row.job_name,
      runAt: row.run_at instanceof Date ? row.run_at.toISOString() : new Date(row.run_at).toISOString(),
      eligibleCount: row.eligible_count,
      sentCount: row.sent_count,
      failedCount: row.failed_count,
      perPlatform,
      errorMessage: row.error_message || null
    }
  })
}
