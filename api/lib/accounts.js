/**
 * Hard account deletion, shared by self-serve delete (api/auth), Sign in
 * with Apple revocation (api/auth/apple-notifications) and admin delete
 * (api/admin/users).
 *
 * Order:
 *   1. Cancel any Stripe subscription (best-effort, never blocks).
 *   2. One transaction: explicit deletes for tables that may lack FK
 *      cascade, then the users row; every other table cascades via FK
 *      (contributions, saved places, follows, notifications, ...).
 *   3. Delete the user's uploaded photos from Vercel Blob (best-effort).
 *      contributions rows cascade with the user but the blobs they point
 *      at do not, and they are public URLs, so they must go too. Upload
 *      writes them under contributions/<userId>/ (api/contributions/upload.js).
 *
 * Throws only if the DB transaction fails; the caller decides the status.
 */

import { queryOne, transaction } from './db.js'

async function cancelStripe(userId) {
  try {
    const row = await queryOne('SELECT subscription_id FROM users WHERE id = ?', [userId])
    if (!row?.subscription_id) return
    const { default: Stripe } = await import('stripe')
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
    await stripe.subscriptions.cancel(row.subscription_id).catch(() => {})
  } catch (err) {
    console.warn('Stripe cancel during delete failed (continuing):', err?.message)
  }
}

export async function deleteUserBlobs(userId) {
  try {
    const { list, del } = await import('@vercel/blob')
    const prefix = `contributions/${userId}/`
    let cursor
    let deleted = 0
    do {
      const page = await list({ prefix, cursor, limit: 1000 })
      if (page.blobs.length) {
        await del(page.blobs.map((b) => b.url))
        deleted += page.blobs.length
      }
      cursor = page.hasMore ? page.cursor : undefined
    } while (cursor)
    return deleted
  } catch (err) {
    console.warn('Blob cleanup during delete failed (continuing):', err?.message)
    return 0
  }
}

export async function deleteUserAccount(userId) {
  await cancelStripe(userId)

  await transaction(async (conn) => {
    await conn.query('DELETE FROM swiped_places WHERE user_id = ?', [userId])
    await conn.query('DELETE FROM content_reports WHERE reporter_id = ? OR reported_user_id = ?', [userId, userId]).catch(() => {})
    await conn.query('DELETE FROM users WHERE id = ?', [userId])
  })

  await deleteUserBlobs(userId)
}
