/**
 * Email Utility
 *
 * Sends transactional emails. Currently uses console logging as a placeholder.
 * Replace with actual provider (Resend, SendGrid, Postmark, etc.) when ready.
 *
 * To configure with Resend:
 * 1. npm install resend
 * 2. Set RESEND_API_KEY environment variable
 * 3. Uncomment the Resend implementation below
 */

/* global process */

/**
 * Send an email
 * @param {Object} options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.text - Plain text body
 * @param {string} [options.html] - HTML body
 * @returns {Promise<{sent: boolean, provider: string}>}
 */
export async function sendEmail({ to, subject, text, html }) {
  // Check if Resend is configured
  if (process.env.RESEND_API_KEY) {
    try {
      const { Resend } = await import('resend')
      const resend = new Resend(process.env.RESEND_API_KEY)

      await resend.emails.send({
        from: 'ROAM <noreply@go-roam.uk>',
        to,
        subject,
        text,
        html
      })

      return { sent: true, provider: 'resend' }
    } catch (err) {
      console.error('Email send error:', err)
      // Fall through to console logging
    }
  }

  // Placeholder: log email to console
  console.log('═══════════════════════════════════════')
  console.log('EMAIL (no provider configured)')
  console.log('═══════════════════════════════════════')
  console.log(`To: ${to}`)
  console.log(`Subject: ${subject}`)
  console.log('───────────────────────────────────────')
  console.log(text)
  console.log('═══════════════════════════════════════')

  return { sent: true, provider: 'console' }
}

/**
 * Send payment failure notification email
 * @param {string} userEmail - User's email address
 * @param {string} [userName] - User's display name
 */
export async function sendPaymentFailedEmail(userEmail, userName) {
  const greeting = userName ? `Hi ${userName}` : 'Hi there'

  return sendEmail({
    to: userEmail,
    subject: 'Payment failed for your ROAM subscription',
    text: `${greeting},

We weren't able to process your payment for ROAM Premium.

Please update your payment method to continue enjoying premium features:
https://go-roam.uk/profile

What happens next:
- Your premium features will remain active for a few more days while we retry
- If payment continues to fail, your account will revert to the free tier
- You won't lose any saved places or data

If you have any questions, just reply to this email.

- The ROAM Team`,
    html: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto;">
  <p>${greeting},</p>
  <p>We weren't able to process your payment for ROAM Premium.</p>
  <p><a href="https://go-roam.uk/profile" style="display: inline-block; padding: 12px 24px; background: #1a3a2f; color: white; text-decoration: none; border-radius: 8px; font-weight: 500;">Update Payment Method</a></p>
  <p style="color: #666; font-size: 14px;"><strong>What happens next:</strong></p>
  <ul style="color: #666; font-size: 14px;">
    <li>Your premium features will remain active for a few more days while we retry</li>
    <li>If payment continues to fail, your account will revert to the free tier</li>
    <li>You won't lose any saved places or data</li>
  </ul>
  <p style="color: #666;">If you have any questions, just reply to this email.</p>
  <p>- The ROAM Team</p>
</div>`
  })
}

/**
 * Send welcome email to new users
 * @param {string} userEmail - User's email address
 * @param {string} [userName] - User's display name
 */
export async function sendWelcomeEmail(userEmail, userName) {
  const greeting = userName ? `Hi ${userName}` : 'Welcome to ROAM'

  return sendEmail({
    to: userEmail,
    subject: 'Welcome to ROAM!',
    text: `${greeting},

Thanks for joining ROAM - your new adventure companion!

Get started:
1. Enable location to discover places near you
2. Swipe right on places that interest you
3. Build adventures and explore with friends

Happy exploring!
- The ROAM Team`,
    html: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto;">
  <h2 style="color: #1a3a2f;">${greeting}!</h2>
  <p>Thanks for joining ROAM - your new adventure companion!</p>
  <p><strong>Get started:</strong></p>
  <ol>
    <li>Enable location to discover places near you</li>
    <li>Swipe right on places that interest you</li>
    <li>Build adventures and explore with friends</li>
  </ol>
  <p><a href="https://go-roam.uk" style="display: inline-block; padding: 12px 24px; background: #1a3a2f; color: white; text-decoration: none; border-radius: 8px; font-weight: 500;">Start Exploring</a></p>
  <p>Happy exploring!<br>- The ROAM Team</p>
</div>`
  })
}

export default {
  sendEmail,
  sendPaymentFailedEmail,
  sendWelcomeEmail
}
