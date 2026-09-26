import { useState } from 'react'
import { sharePlaceLink, isShareablePlaceId } from '../utils/shareCard'

/** "Share with a friend" for a place; says "Link copied" when it fell back to the clipboard. */
export default function SharePlaceButton({ place, source, className }) {
  const [result, setResult] = useState(null) // null | 'pending' | 'shared' | 'copied'
  if (!isShareablePlaceId(place.id)) return null
  const share = async () => {
    setResult('pending') // a second tap while the sheet is open would misfire
    setResult(await sharePlaceLink(place, source) || null)
  }
  return (
    <button className={className} onClick={share} disabled={result === 'pending'}>
      {result === 'copied' ? 'Link copied' : result === 'shared' ? 'Shared' : 'Share with a friend'}
    </button>
  )
}
