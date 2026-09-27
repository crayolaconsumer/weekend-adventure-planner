/**
 * Resume point for capped push crons. A run handles at most N users in id
 * order and records the last id here; the next scheduled slot the same day
 * carries on from it, and `done` stops the remaining slots.
 *
 * Unlike kvCache, this fails CLOSED: if KV can't be read or written, callers
 * skip the run, because starting over from id 0 would push the same users twice.
 */

import { getClient } from './kvCache.js'

const TTL_SECONDS = 2 * 24 * 60 * 60
const keyFor = (job, day) => `cron:cursor:${job}:${day}`

/** { after, done } for this job today, or null when KV is unusable. */
export async function readCursor(job, day, client = getClient()) {
  if (!client) return null
  try {
    const raw = await client.get(keyFor(job, day))
    if (raw == null) return { after: 0, done: false }
    const cursor = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Number.isFinite(cursor?.after) ? cursor : null
  } catch (err) {
    console.warn(`[cronCursor] read ${job} failed:`, err.message)
    return null
  }
}

/** True once stored. */
export async function writeCursor(job, day, cursor, client = getClient()) {
  if (!client) return false
  try {
    await client.set(keyFor(job, day), JSON.stringify(cursor), { ex: TTL_SECONDS })
    return true
  } catch (err) {
    console.warn(`[cronCursor] write ${job} failed:`, err.message)
    return false
  }
}
