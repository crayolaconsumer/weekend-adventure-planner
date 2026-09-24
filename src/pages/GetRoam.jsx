/**
 * Get ROAM — public download page (/get-roam).
 *
 * The one link partners and press can share: App Store, Google Play or the
 * web app. Web-only (App.jsx redirects to / on native). Links are plain <a>
 * so "Open the web app" does a full page load and gets normal onboarding.
 */
import './Legal.css'
import './GetRoam.css'

const APP_STORE_URL = 'https://apps.apple.com/gb/app/go-roam/id6768306617'
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.goroam.app'

export default function GetRoam() {
  return (
    <div className="legal-page">
      <article className="legal-article get-roam">
        <h1>Get ROAM</h1>
        <p className="get-roam-tagline">Stop scrolling. Start roaming.</p>
        <p>
          Swipe through curated local places and events, build spontaneous
          adventures, and get out there exploring. Free on iPhone, Android and the web.
        </p>

        <div className="get-roam-links">
          <a className="get-roam-button" href={APP_STORE_URL} target="_blank" rel="noopener noreferrer">
            Download on the App Store
          </a>
          <a className="get-roam-button" href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer">
            Get it on Google Play
          </a>
          <a className="get-roam-button get-roam-button--secondary" href="/">
            Open the web app
          </a>
        </div>

        <p className="legal-meta">
          Run events or a venue? <a href="/partners">Promote them on ROAM</a>.
        </p>
      </article>
    </div>
  )
}
