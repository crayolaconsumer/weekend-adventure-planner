import { APP_STORE_URL, PLAY_STORE_URL } from '../../shared/appLinks.mjs'
import { track } from '../utils/analytics'
import './GetAppCard.css'

/** Install prompt for web visitors (same look as the town pages' app card). */
export default function GetAppCard({ source }) {
  const click = store => () => track('store_click', { source, store })
  return (
    <section className="get-app-card">
      <img src="/icons/icon.svg" alt="" width="48" height="48" />
      <div>
        <h3>Get ROAM</h3>
        <p>Find places like this near you, save favourites and plan your weekend.</p>
      </div>
      <div className="get-app-card-stores">
        <a href={APP_STORE_URL} onClick={click('ios')} target="_blank" rel="noopener noreferrer">App Store</a>
        <a href={PLAY_STORE_URL} onClick={click('android')} target="_blank" rel="noopener noreferrer" className="alt">Google Play</a>
      </div>
    </section>
  )
}
