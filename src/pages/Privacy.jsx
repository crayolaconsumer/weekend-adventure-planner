/**
 * Privacy Policy — required by App Store Review Guideline 5.1.1.
 * Plain, factual. Update with the lawyer-approved version when ready;
 * this is enough to pass first review.
 */
import './Legal.css'

export default function Privacy() {
  return (
    <div className="legal-page">
      <article className="legal-article">
        <h1>Privacy Policy</h1>
        <p className="legal-meta">Last updated: 28 May 2026</p>

        <p>
          ROAM ("we", "us") respects your privacy. This policy describes what
          data we collect, why, and how it's protected. ROAM is operated from
          the United Kingdom.
        </p>

        <h2>Data we collect</h2>
        <ul>
          <li><strong>Account data</strong> — email, optional display name, profile photo URL (from Google/Apple sign-in when used). Used to authenticate you and personalize your experience.</li>
          <li><strong>Location</strong> — your device's coordinates, only when granted. Used to recommend nearby places and centre the offline pack. Coarse location of places you mark as visited is stored to render your personal visited-map. If you keep “Local Events Near You” notifications on (Settings), we also store a single coarse (~1km) last-known location so we can tell you about events happening nearby; turning that off stops this and erases the stored point.</li>
          <li><strong>User content</strong> — saved places, place reviews and tips, photos you upload, collections you create, follow connections. Stored to deliver the social and discovery features you use.</li>
          <li><strong>Subscription data</strong> — when you purchase ROAM+ on the web, Stripe processes payment and we store only your customer ID, subscription state and expiry. We never see your card details. On iOS, subscriptions are billed by Apple and we receive only the transaction ID.</li>
          <li><strong>Push tokens</strong> — your device's APNS (iOS), FCM (Android) or VAPID (web) token, only if you enable notifications. Used solely to deliver the notifications you opt into.</li>
          <li><strong>Diagnostics</strong> — anonymous crash reports and performance traces via Sentry (only if configured), with your user ID attached so we can fix issues affecting you. Session replay text and media are masked.</li>
          <li><strong>Product analytics</strong> — page views, key events (signed-up, place-saved, place-visited, upgrade-clicked, offline-pack-downloaded) via PostHog (only if configured). We respect Do-Not-Track.</li>
          <li><strong>Advertising (free tier only)</strong> — if you use ROAM without a ROAM+ subscription, we show ads via Google AdMob on iOS/Android and Google AdSense on the web, plus sponsored place cards from businesses we partner with. AdMob and AdSense may collect device identifiers (such as IDFA on iOS or Android Advertising ID), approximate location, and ad-interaction data to deliver and measure ads. On iOS you'll be asked to allow tracking before any personalised ads are shown; if you decline, you'll still see generic (non-personalised) ads. ROAM+ subscribers see <strong>no ads of any kind</strong>.</li>
        </ul>

        <h2>What we don't collect</h2>
        <ul>
          <li>Contacts, microphone audio, health data, financial card numbers.</li>
          <li>No cross-app tracking outside of Google's ad ecosystem (which only operates when you're not on ROAM+ and have not declined tracking on iOS).</li>
        </ul>

        <h2>How we use it</h2>
        <p>
          To run the service: showing you places, syncing your saves and reviews across devices, sending notifications you've enabled, processing subscription billing, and improving features based on aggregate usage. We do not sell your data to third parties.
        </p>

        <h2>Who we share it with</h2>
        <ul>
          <li><strong>Processors that run the service:</strong> Vercel (hosting + storage), AWS RDS (database, EU region), Stripe (payments — web only), Apple/Google (sign-in providers, push notification gateways, iOS subscription billing), Sentry (crash reporting), PostHog (product analytics).</li>
          <li><strong>Advertising partners (free tier only):</strong> Google AdMob (mobile), Google AdSense (web), and businesses whose sponsored places appear in your discovery feed. Google's advertising data practices are described at <a href="https://policies.google.com/technologies/ads" target="_blank" rel="noopener noreferrer">policies.google.com/technologies/ads</a>. You can opt out of personalised Google ads at <a href="https://adssettings.google.com" target="_blank" rel="noopener noreferrer">adssettings.google.com</a>.</li>
          <li><strong>Other ROAM users:</strong> only the data you've explicitly chosen to make public — your username, display name, place tips/reviews, and (if your privacy settings allow) your visited-places map. Your email and exact location are never shown to other users.</li>
        </ul>

        <h2>Your rights</h2>
        <p>
          You can access, edit and delete your data at any time via Settings → Profile, or by deleting your account entirely (Settings → Delete account). Deletion removes your user record and cascades to your saved places, reviews, photos, follows, and subscription. We may keep anonymized event logs for security and analytics for up to 90 days after deletion.
        </p>
        <p>
          You can withdraw consent for push notifications and product analytics at any time via Settings. To exercise UK GDPR rights (access, rectification, erasure, portability), email <a href="mailto:hello@go-roam.uk">hello@go-roam.uk</a>.
        </p>

        <h2>Children</h2>
        <p>
          ROAM is not directed at children under 13. We do not knowingly collect data from anyone under 13.
        </p>

        <h2>Security</h2>
        <p>
          Data is encrypted in transit (HTTPS) and at rest. Passwords are hashed with bcrypt. We rotate keys periodically and require fresh authentication for sensitive actions.
        </p>

        <h2>Changes to this policy</h2>
        <p>
          Material changes will be announced in the app and via email at least 14 days before they take effect.
        </p>

        <h2>Contact</h2>
        <p>
          Email: <a href="mailto:hello@go-roam.uk">hello@go-roam.uk</a>
        </p>
      </article>
    </div>
  )
}
