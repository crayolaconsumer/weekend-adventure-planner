/**
 * Write outbox for signed-in saves and visits.
 *
 * Every write is queued here before it is sent and leaves once the server
 * answers for good, so one that fails for a reason that may pass (offline,
 * 5xx, 429), or is cut off by a reload, stays and is sent again later: when the
 * session is confirmed (AuthContext: start, resume) or the browser comes back
 * online. Given up after 20 failed retries. One entry per key ("saved:<id>", "visited:<id>"), so the latest
 * intent for a place replaces an older one (save then unsave sends only the
 * DELETE). A write the server refuses for good (4xx: free-tier cap, bad data,
 * dead session) is dropped and the caller rolls back as before.
 *
 * The token is read when sending, not when queuing (it may have been renewed).
 * AuthContext clears the outbox on sign-out so writes never cross accounts.
 * A write refused during a background retry is dropped silently; the next
 * list refresh brings the screen back in line with the server.
 * A replayed save is stamped with the server's time (api/places/saved.js uses
 * NOW() and ignores the client's savedAt), so a save that waited offline sorts
 * as newer in Wishlist than it is. Accepted: order only, no data lost.
 * ponytail: last-write-wins per place, no backoff beyond the triggers above;
 * add exponential backoff if a long outage makes resume/online flushes noisy.
 */

import { getAuthToken } from './authToken'

const KEY = 'roam_outbox'

function read() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(list) ? list : []
  } catch { return [] }
}

function write(list) {
  try {
    if (list.length) localStorage.setItem(KEY, JSON.stringify(list))
    else localStorage.removeItem(KEY)
  } catch { /* private mode / full: the write stays optimistic for this session */ }
}

/** Status codes worth retrying. Everything else 4xx is a final answer. */
export function isTransientStatus(status) {
  return status >= 500 || status === 408 || status === 429
}

/** Queue (or replace) the write for `key`: { key, url, method, body? }. */
export function enqueue(entry) {
  write([...read().filter(e => e.key !== entry.key), entry])
}

/** Queued writes whose key starts with `prefix` ("saved:", "visited:"). */
export function pending(prefix) {
  return read().filter(e => e.key.startsWith(prefix))
}

export function clearOutbox() {
  write([])
}

/** Send one write with the current token. Resolves to the Response; throws when offline. */
export function sendWrite({ url, method, body }) {
  const token = getAuthToken()
  return fetch(url, {
    method,
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  })
}

/**
 * Send a signed-in write now. 'ok' | 'queued' (offline or a hiccup: kept and
 * retried later) | 'refused' (a final 4xx: the caller rolls back).
 */
export async function writeOrQueue(entry) {
  // Queued before sending: a reload mid-request, or a list refresh landing
  // while it is in flight, still sees it
  enqueue(entry)
  // Let a running flush finish first, so an older write for this place it
  // already has in flight can't land after this one
  if (flushing) await flushing.catch(() => {})
  let response = null
  try { response = await sendWrite(entry) } catch { /* offline */ }
  if (!response || isTransientStatus(response.status)) return 'queued'
  removeIfUnchanged(entry)
  return response.ok ? 'ok' : 'refused'
}

// Same write, ignoring its retry count
const sig = e => JSON.stringify({ ...e, tries: undefined })

// Remove `entry` unless a newer write for the same place replaced it meanwhile
function removeIfUnchanged(entry) {
  write(read().filter(e => sig(e) !== sig(entry)))
}

// A write still failing after this many flushes is given up (and drops out of
// the on-screen merge), so one broken entry can't stay pinned forever
const MAX_TRIES = 20

let flushing = null

/**
 * Send every queued write, oldest first. Stops at the first network failure
 * (still offline: try again on the next trigger). Returns how many were sent.
 */
export function flushOutbox() {
  if (flushing) return flushing
  flushing = (async () => {
    let sent = 0
    for (const entry of read()) {
      // Replaced or sent by a newer write since the snapshot: never send it
      if (!read().some(e => sig(e) === sig(entry))) continue
      let res
      try {
        res = await sendWrite(entry)
      } catch {
        break // offline: keep this and the rest
      }
      if (isTransientStatus(res.status)) {
        const tries = (entry.tries || 0) + 1
        if (tries >= MAX_TRIES) removeIfUnchanged(entry)
        else write(read().map(e => (sig(e) === sig(entry) ? { ...e, tries } : e)))
        continue
      }
      // Sent, or refused for good (the next list refresh reconciles the screen)
      removeIfUnchanged(entry)
      if (res.ok) sent++
    }
    return sent
  })().finally(() => { flushing = null })
  return flushing
}
