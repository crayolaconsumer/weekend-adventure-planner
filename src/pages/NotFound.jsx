/**
 * NotFound — the canonical 404 page.
 *
 * Used by the catch-all route AND by AdminRoute when a non-admin lands
 * on /admin/*. The two paths render identical markup so route
 * discovery via DOM diffing is foreclosed.
 *
 * Reuses the .place-page-error block (BRAND.md: error / empty block).
 */
import { Link } from 'react-router-dom'
import './Place.css'

export default function NotFound() {
  return (
    <div className="place-page">
      <div className="place-page-body">
        <div className="place-page-error">
          <img className="place-page-error-mark" src="/icons/icon.svg" alt="" width="64" height="64" />
          <h2>Page not found</h2>
          <p>This link doesn&apos;t go anywhere. Head back to Discover to find somewhere to go.</p>
          <Link to="/" className="btn btn-primary">Back to Discover</Link>
        </div>
      </div>
    </div>
  )
}
