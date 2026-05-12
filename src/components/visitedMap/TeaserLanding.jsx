/**
 * TeaserLanding
 *
 * Shown in place of the real map when a non-follower / anonymous viewer
 * lands on a followers-only map URL. Marketing surface that turns the
 * privacy boundary into a sign-up funnel: avatar + count + abstracted
 * constellation + primary "Sign up & follow X" CTA.
 *
 * No real coordinates are leaked — the constellation uses server-side
 * abstracted points (0.5° cells with random offset).
 */

import { useNavigate } from 'react-router-dom'
import { formatDisplayName } from '../../utils/displayName'
import Avatar from '../Avatar'
import './TeaserLanding.css'

export default function TeaserLanding({ user, placesAbstract = [], total }) {
  const navigate = useNavigate()
  const targetUsername = user.username
  const redirectUrl = `/user/${encodeURIComponent(targetUsername)}/map`

  const onSignUp = () => {
    navigate(`/?intent=follow:${encodeURIComponent(targetUsername)}&redirect=${encodeURIComponent(redirectUrl)}&authMode=register`)
  }
  const onSignIn = () => {
    navigate(`/?intent=follow:${encodeURIComponent(targetUsername)}&redirect=${encodeURIComponent(redirectUrl)}&authMode=login`)
  }

  // Compute abstracted bounding box for layout
  let minLat = 0, maxLat = 0, minLng = 0, maxLng = 0
  if (placesAbstract.length > 0) {
    const lats = placesAbstract.map(p => p.lat)
    const lngs = placesAbstract.map(p => p.lng)
    minLat = Math.min(...lats)
    maxLat = Math.max(...lats)
    minLng = Math.min(...lngs)
    maxLng = Math.max(...lngs)
  }
  const latRange = (maxLat - minLat) || 1
  const lngRange = (maxLng - minLng) || 1

  const displayName = formatDisplayName(user)

  return (
    <div className="teaser-landing">
      <Avatar user={user} size={72} className="teaser-landing-avatar" alt="" />
      <h2 className="teaser-landing-title">{displayName}'s map</h2>
      <p className="teaser-landing-count">
        {total} {total === 1 ? 'place visited' : 'places visited'}
      </p>

      <div className="teaser-landing-constellation" aria-hidden="true">
        {placesAbstract.map((p, i) => {
          const x = ((p.lng - minLng) / lngRange) * 100
          const y = ((maxLat - p.lat) / latRange) * 100
          return (
            <span
              key={i}
              className="teaser-landing-dot"
              style={{ left: `${x}%`, top: `${y}%` }}
            />
          )
        })}
      </div>

      <p className="teaser-landing-explainer">
        This map is for followers only.
      </p>
      <button className="teaser-landing-cta-primary" onClick={onSignUp}>
        Sign up & follow {displayName} →
      </button>
      <button className="teaser-landing-cta-secondary" onClick={onSignIn}>
        Already have an account? Sign in
      </button>

      <hr className="teaser-landing-divider" />
      <h3 className="teaser-landing-roam-title">What is ROAM?</h3>
      <p className="teaser-landing-roam-blurb">
        Stop scrolling. Start roaming. Beat boredom with one tap — swipe through curated local places, build spontaneous adventures, and get out there exploring.
      </p>
    </div>
  )
}
