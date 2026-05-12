/**
 * Terms of Use (EULA) — required by App Store Review Guideline 3.1.2
 * for any app offering subscriptions. Plain, factual. Update with the
 * lawyer-approved version when ready.
 */
import './Legal.css'

export default function Terms() {
  return (
    <div className="legal-page">
      <article className="legal-article">
        <h1>Terms of Use</h1>
        <p className="legal-meta">Last updated: 10 May 2026</p>

        <p>
          These Terms govern your use of ROAM. By creating an account or using the app, you agree to them.
        </p>

        <h2>Your account</h2>
        <p>
          You're responsible for activity under your account. Don't share credentials. You must be at least 13 to use ROAM. Provide accurate information and keep it current.
        </p>

        <h2>What you can do with ROAM</h2>
        <p>
          Discover places, save them to lists, share reviews and tips, follow other users, and use any premium features your subscription includes. Personal use only — don't resell or redistribute the service.
        </p>

        <h2>Content you post</h2>
        <p>
          You own what you write and the photos you upload. By posting, you grant us a non-exclusive licence to display and distribute that content within ROAM and via shared links you create.
        </p>
        <p>
          Don't post: anything illegal, harassing, defamatory, or that infringes someone else's rights; spam or commercial promotions without our consent; private information about other people; or content that misrepresents a place.
        </p>
        <p>
          We may remove content and suspend accounts that violate these terms. You can report content via the Report button on any post, or by emailing <a href="mailto:hello@go-roam.uk">hello@go-roam.uk</a> — we aim to act within 24 hours.
        </p>

        <h2>ROAM+ subscriptions</h2>
        <p>
          ROAM+ unlocks unlimited saves, offline packs, posters, extended discovery radius and other premium features. Subscriptions are billed monthly or annually.
        </p>
        <ul>
          <li><strong>Free trial:</strong> 7 days. Cancel before it ends to avoid charges.</li>
          <li><strong>Auto-renewal:</strong> Subscriptions auto-renew at the same plan and price until canceled at least 24 hours before the end of the current period.</li>
          <li><strong>Web purchases:</strong> Processed by Stripe. Manage or cancel via Settings → Manage Subscription, or directly with Stripe.</li>
          <li><strong>iOS purchases:</strong> Processed by Apple. Manage or cancel in your Apple ID settings under Subscriptions.</li>
          <li><strong>Android purchases:</strong> Processed by Google Play. Manage or cancel in the Play Store under Subscriptions.</li>
          <li><strong>Refunds:</strong> Handled by the platform that processed the payment (Stripe / Apple / Google).</li>
        </ul>

        <h2>Service availability</h2>
        <p>
          We aim for high uptime but don't guarantee 100% — third-party services (mapping, events APIs, payments) can fail. ROAM is provided "as is" without warranties beyond those required by UK consumer law.
        </p>

        <h2>Acceptable use</h2>
        <p>
          Don't try to disrupt the service, scrape it at scale, reverse-engineer it, or use it for anything illegal. Don't use automated tools to create accounts or interact with other users.
        </p>

        <h2>Termination</h2>
        <p>
          You can delete your account at any time via Settings → Delete account. We can suspend or terminate accounts that violate these terms.
        </p>

        <h2>Liability</h2>
        <p>
          To the extent permitted by law, we're not liable for indirect or consequential damages. ROAM recommends places curated from open data — we're not responsible for the accuracy of opening hours, prices, or conditions on the ground. Use common sense and check official sources before travelling.
        </p>

        <h2>Governing law</h2>
        <p>
          These Terms are governed by the laws of England and Wales.
        </p>

        <h2>Contact</h2>
        <p>
          Email: <a href="mailto:hello@go-roam.uk">hello@go-roam.uk</a>
        </p>
      </article>
    </div>
  )
}
