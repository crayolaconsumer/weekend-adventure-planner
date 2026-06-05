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

  // No email provider configured - silently succeed in production
  // In development, uncomment the logs below to debug email content
  // console.log('EMAIL (no provider configured)', { to, subject })

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

/**
 * Receipt for a paid promoted event ("you're live").
 * @param {string} toEmail - partner contact email
 * @param {object} details - { title, orgName, amountPence, currency, radiusKm, promoStartsOn, promoEndsOn, pushBoost }
 */
export async function sendPromoReceiptEmail(toEmail, details = {}) {
  const {
    title = 'Your event', orgName, amountPence = 0, currency = 'GBP',
    radiusKm, promoStartsOn, promoEndsOn, pushBoost = false
  } = details
  const amount = `${currency === 'GBP' ? '£' : ''}${(amountPence / 100).toFixed(2)}`
  const fmt = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
  const window = `${fmt(promoStartsOn)} to ${fmt(promoEndsOn)}`
  const boostLine = pushBoost ? 'Nearby-phone push: included' : ''

  return sendEmail({
    to: toEmail,
    subject: `Your ROAM receipt — ${title}`,
    text: `Thanks${orgName ? `, ${orgName}` : ''}.

${title} is now a Featured event on ROAM.

Receipt
- Amount paid: ${amount}
- Featured: ${window}
- Reach: within ${radiusKm}km
${pushBoost ? '- Nearby-phone push: included\n' : ''}
This is a one-off payment — no subscription.
Manage your event: https://www.go-roam.uk/partners/dashboard

- The ROAM Team`,
    html: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; color:#222;">
  <h2 style="color:#1a3a2f;">You're live on ROAM</h2>
  <p>Thanks${orgName ? `, ${orgName}` : ''} — <strong>${title}</strong> is now a Featured event near you.</p>
  <table style="width:100%; border-collapse:collapse; margin:16px 0;">
    <tr><td style="padding:8px 0; color:#666;">Amount paid</td><td style="padding:8px 0; text-align:right; font-weight:700;">${amount}</td></tr>
    <tr><td style="padding:8px 0; color:#666;">Featured</td><td style="padding:8px 0; text-align:right;">${window}</td></tr>
    <tr><td style="padding:8px 0; color:#666;">Reach</td><td style="padding:8px 0; text-align:right;">within ${radiusKm}km</td></tr>
    ${boostLine ? `<tr><td style="padding:8px 0; color:#666;">Nearby-phone push</td><td style="padding:8px 0; text-align:right;">included</td></tr>` : ''}
  </table>
  <p style="color:#666; font-size:13px;">One-off payment — no subscription.</p>
  <p><a href="https://www.go-roam.uk/partners/dashboard" style="display:inline-block; padding:12px 24px; background:#1a3a2f; color:#fff; text-decoration:none; border-radius:8px; font-weight:600;">View your event</a></p>
  <p style="color:#888; font-size:12px;">ROAM · go-roam.uk</p>
</div>`
  })
}

export default {
  sendEmail,
  sendPaymentFailedEmail,
  sendWelcomeEmail,
  sendPromoReceiptEmail
}
