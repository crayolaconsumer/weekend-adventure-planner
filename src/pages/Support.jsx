/**
 * Support page — required by App Store Review (Support URL field on
 * the App Store version page) and Google Play. Keep it functional:
 * one contact email + answers to the questions people actually ask.
 */
import './Legal.css'

export default function Support() {
  return (
    <div className="legal-page">
      <article className="legal-article">
        <h1>Support</h1>
        <p className="legal-meta">Last updated: 12 May 2026</p>

        <p>
          ROAM is built and supported by one person. If something's not working, or you've got a question that isn't answered below, get in touch and you'll usually hear back within 24 hours.
        </p>

        <h2>Contact</h2>
        <p>
          Email: <a href="mailto:support@go-roam.uk">support@go-roam.uk</a>
        </p>
        <p>
          Include your account email, device model, and a short description of what went wrong. A screenshot helps if you can grab one.
        </p>

        <h2>Subscriptions</h2>

        <h3>How do I cancel my ROAM+ subscription?</h3>
        <ul>
          <li><strong>If you subscribed on iPhone:</strong> Settings app → tap your name → Subscriptions → ROAM → Cancel.</li>
          <li><strong>If you subscribed on Android:</strong> Play Store → Profile → Payments &amp; subscriptions → Subscriptions → ROAM → Cancel.</li>
          <li><strong>If you subscribed on the web:</strong> Sign in → Profile → Settings → Manage Subscription.</li>
        </ul>
        <p>
          You'll keep premium access until the end of the current billing period. No partial refunds.
        </p>

        <h3>How do I get a refund?</h3>
        <p>
          Refunds are handled by the platform you paid through, not by ROAM directly:
        </p>
        <ul>
          <li><strong>iOS:</strong> Request via <a href="https://reportaproblem.apple.com" target="_blank" rel="noopener noreferrer">reportaproblem.apple.com</a>.</li>
          <li><strong>Android:</strong> Request through your Play Store order history.</li>
          <li><strong>Web (Stripe):</strong> Email <a href="mailto:support@go-roam.uk">support@go-roam.uk</a> within 14 days of purchase and we'll process a refund.</li>
        </ul>

        <h3>I subscribed on iPhone but premium isn't showing up on the web (or vice versa)</h3>
        <p>
          Sign in with the same account on both platforms. Subscription status syncs automatically — if it doesn't, try Settings → Manage Subscription → Restore Purchases (or sign out and back in). If it still doesn't update, email us with your account email and the date you subscribed.
        </p>

        <h3>I was charged but premium isn't active</h3>
        <p>
          Email <a href="mailto:support@go-roam.uk">support@go-roam.uk</a> with the receipt or transaction ID. We'll get you sorted within 24 hours.
        </p>

        <h2>Account</h2>

        <h3>How do I change my email or password?</h3>
        <p>
          Profile → Settings. If you signed in with Apple or Google, the email is managed by them — go to your Apple ID or Google Account settings to change it.
        </p>

        <h3>How do I delete my account?</h3>
        <p>
          Profile → Settings → Delete Account. This permanently removes your data and cancels any active subscription. The deletion is immediate and can't be undone. If you'd rather just take a break, sign out instead.
        </p>

        <h3>I forgot my password</h3>
        <p>
          On the sign-in screen, tap "Forgot password" and we'll email a reset link. If the email doesn't arrive within a couple of minutes, check spam.
        </p>

        <h2>Using the app</h2>

        <h3>The app says "No places nearby"</h3>
        <p>
          ROAM searches a radius around your current location. If you're somewhere rural with sparse mapping data, try tapping "Expand Radius" or change your discovery mode to "Driving" or "Explorer" (premium) to reach further.
        </p>

        <h3>Location isn't working</h3>
        <p>
          ROAM falls back to London if you've denied location access. To enable it: Settings → ROAM → Location → While Using the App.
        </p>

        <h3>Push notifications aren't arriving</h3>
        <p>
          Profile → Settings → Notifications. If notifications are toggled on in-app but you're still not receiving any, check Settings → ROAM → Notifications on your device.
        </p>

        <h3>Offline maps aren't downloading</h3>
        <p>
          Offline maps are a ROAM+ feature. Once subscribed, head to Profile → Offline Packs to download maps for your current area. Downloads need an active internet connection and may take a few minutes depending on area size.
        </p>

        <h2>Privacy &amp; data</h2>
        <p>
          See our <a href="/privacy">Privacy Policy</a> for everything we collect and how we use it. Short version: we don't sell your data, we don't track you across other apps, and you can delete everything from Profile → Settings.
        </p>

        <h2>Reporting content or users</h2>
        <p>
          ROAM is a community space. If you see content or behaviour that breaks our rules, tap the three-dot menu on any post, review, or profile and choose "Report". Reports go straight to our moderation queue and are typically reviewed within 24 hours.
        </p>
        <p>
          For urgent issues (impersonation, safety concerns, abuse), email <a href="mailto:support@go-roam.uk">support@go-roam.uk</a> with the subject line "URGENT" and we'll prioritise.
        </p>

        <h2>Still need help?</h2>
        <p>
          Email <a href="mailto:support@go-roam.uk">support@go-roam.uk</a>. Replies usually come back within 24 hours (often much faster).
        </p>
      </article>
    </div>
  )
}
