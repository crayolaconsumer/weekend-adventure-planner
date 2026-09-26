/**
 * Town Hub (/town, in-app): search any town, jump to the one you're in,
 * reopen recent towns, or pick a popular one. The web version of /town is
 * server-rendered by api/town.js; this is the app's own screen for it.
 */

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { TOWNS } from '../../shared/towns.mjs'
import { useSEO } from '../hooks/useSEO'
import { recentTowns } from '../utils/recentTowns'
import { BackIcon, PinIcon, ChevronIcon } from './townIcons'
import './TownPage.css'

export default function TownHub() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState(null) // null | 'searching' | 'missing' | 'error'
  const [recent] = useState(recentTowns)

  useSEO({ title: 'Explore a town', url: 'https://www.go-roam.uk/town' })

  const search = async e => {
    e.preventDefault()
    if (!query.trim() || status === 'searching') return
    setStatus('searching')
    try {
      const res = await fetch(`/api/town?q=${encodeURIComponent(query.trim())}&format=json`)
      if (res.status === 404) return setStatus('missing')
      if (!res.ok) throw new Error(`town ${res.status}`)
      navigate(`/town/${(await res.json()).slug}`)
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className="town-page">
      <div className="town-top">
        <button className="town-back" onClick={() => navigate(-1)} aria-label="Back"><BackIcon /></button>
      </div>
      <h1 className="town-title">Explore a town</h1>
      <p className="town-lead">Parks, sights and places to eat in any town or city.</p>

      <form className="town-search" onSubmit={search} role="search">
        <input
          type="search"
          value={query}
          onChange={e => { setQuery(e.target.value); setStatus(null) }}
          placeholder="Search any town or city"
          aria-label="Town or city"
          enterKeyHint="search"
        />
        <button type="submit" disabled={status === 'searching'}>
          {status === 'searching' ? 'Finding…' : 'Explore'}
        </button>
      </form>
      {status === 'missing' && <p className="town-search-note">No town by that name. Try the full name, or add the county or country.</p>}
      {status === 'error' && <p className="town-search-note">Search didn't go through. Check your connection and try again.</p>}

      <Link className="town-near" to="/town/near-me">
        <span className="town-near-icon"><PinIcon /></span>
        <span className="town-near-text">
          <strong>Near you</strong>
          <span>What's around where you are now</span>
        </span>
        <span className="town-near-chevron"><ChevronIcon /></span>
      </Link>

      {recent.length > 0 && (
        <>
          <h2 className="town-section">Recently viewed</h2>
          <div className="town-chips">
            {recent.map(t => <Link key={t.slug} className="chip" to={`/town/${t.slug}`}>{t.name}</Link>)}
          </div>
        </>
      )}

      <h2 className="town-section">Popular towns</h2>
      <div className="town-chips town-filters">
        {TOWNS.map(t => <Link key={t.slug} className="chip" to={`/town/${t.slug}`}>{t.name}</Link>)}
      </div>
    </div>
  )
}
