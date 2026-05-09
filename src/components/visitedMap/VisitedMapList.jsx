/**
 * VisitedMapList
 *
 * Accordion list of visited places. Sort + filter controls.
 * Owner sees Edit Review on each expanded row.
 *
 * Sync with map: focusedPlaceId controls which row is expanded; tapping a
 * row reports back via onRowTap so the parent can fly the map.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { formatDistanceToNow } from '../../utils/dateUtils'
import './VisitedMapList.css'

const ChevronIcon = ({ open }) => (
  <svg
    width="16" height="16" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2"
    style={{ transform: open ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }}
  >
    <polyline points="6 9 12 15 18 9"/>
  </svg>
)

function recommendBadge(rating) {
  if (rating == null) return null
  return rating > 3 ? { text: 'Recommends', cls: 'positive' } : { text: "Doesn't recommend", cls: 'negative' }
}

export default function VisitedMapList({
  places,
  ratings,
  canEdit,
  focusedPlaceId,
  onRowTap,
  onEditClick,
  sort: sortProp = 'recent',
  filter: filterProp = 'all',
  onSortChange,
  onFilterChange
}) {
  // Allow controlled OR uncontrolled use of sort/filter
  const [sortLocal, setSortLocal] = useState(sortProp)
  const [filterLocal, setFilterLocal] = useState(filterProp)
  const sort = onSortChange ? sortProp : sortLocal
  const filter = onFilterChange ? filterProp : filterLocal
  const setSort = onSortChange || setSortLocal
  const setFilter = onFilterChange || setFilterLocal

  const rowRefs = useRef({})

  useEffect(() => {
    if (focusedPlaceId && rowRefs.current[focusedPlaceId]) {
      rowRefs.current[focusedPlaceId].scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [focusedPlaceId])

  const sorted = useMemo(() => {
    const enriched = (places || []).map(p => {
      const data = p.placeData || {}
      const review = ratings?.[p.placeId]?.review || null
      return {
        placeId: p.placeId,
        name: data.name || 'Unnamed place',
        category: data.category || null,
        imageUrl: data.image || data.imageUrl || null,
        visitedAt: p.visitedAt,
        rating: p.rating,
        notes: p.notes,
        placeData: data,
        review
      }
    })

    let filtered = enriched
    if (filter === 'recommended') filtered = filtered.filter(p => p.rating != null && p.rating > 3)
    else if (filter === 'not_recommended') filtered = filtered.filter(p => p.rating != null && p.rating <= 3)
    else if (filter === 'has_review') filtered = filtered.filter(p => p.review)

    const out = [...filtered]
    if (sort === 'recent') out.sort((a, b) => b.visitedAt - a.visitedAt)
    else if (sort === 'oldest') out.sort((a, b) => a.visitedAt - b.visitedAt)
    else if (sort === 'name') out.sort((a, b) => a.name.localeCompare(b.name))
    return out
  }, [places, ratings, sort, filter])

  if ((places || []).length === 0) {
    return (
      <div className="visited-list visited-list-empty">
        <p>No places visited yet.</p>
      </div>
    )
  }

  return (
    <div className="visited-list">
      <div className="visited-list-controls">
        <div className="visited-list-sort">
          <label htmlFor="visited-sort">Sort</label>
          <select id="visited-sort" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="recent">Most recent</option>
            <option value="oldest">Oldest first</option>
            <option value="name">By name</option>
          </select>
        </div>
        <div className="visited-list-filter" role="group" aria-label="Filter">
          {[
            { value: 'all', label: 'All' },
            { value: 'recommended', label: 'Recommended' },
            { value: 'not_recommended', label: "Didn't" },
            { value: 'has_review', label: 'With review' }
          ].map(opt => (
            <button
              key={opt.value}
              className={`visited-filter-chip ${filter === opt.value ? 'active' : ''}`}
              onClick={() => setFilter(opt.value)}
              type="button"
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <ul className="visited-list-rows">
        {sorted.map(place => {
          const open = focusedPlaceId === place.placeId
          const rec = recommendBadge(place.rating)
          return (
            <li
              key={place.placeId}
              ref={(el) => { rowRefs.current[place.placeId] = el }}
              className={`visited-list-row ${open ? 'open' : ''}`}
            >
              <button
                className="visited-list-row-summary"
                onClick={() => onRowTap?.(open ? null : place.placeId)}
                type="button"
                aria-expanded={open}
              >
                {place.imageUrl ? (
                  <img src={place.imageUrl} alt="" className="visited-list-thumb" loading="lazy" />
                ) : (
                  <div className="visited-list-thumb visited-list-thumb-placeholder">📍</div>
                )}
                <div className="visited-list-row-meta">
                  <span className="visited-list-name">{place.name}</span>
                  <span className="visited-list-sub">
                    {rec && <span className={`visited-list-rec ${rec.cls}`}>{rec.text}</span>}
                    <span className="visited-list-time">{formatDistanceToNow(new Date(place.visitedAt))}</span>
                  </span>
                </div>
                <ChevronIcon open={open} />
              </button>
              <AnimatePresence initial={false}>
                {open && (
                  <motion.div
                    className="visited-list-row-detail"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    {place.review ? (
                      <p className="visited-list-review">{place.review}</p>
                    ) : place.notes ? (
                      <p className="visited-list-review">{place.notes}</p>
                    ) : (
                      <p className="visited-list-review visited-list-review-empty">No review yet.</p>
                    )}
                    <div className="visited-list-row-actions">
                      {canEdit && (
                        <button
                          className="visited-list-action"
                          type="button"
                          onClick={() => onEditClick?.(place)}
                        >
                          Edit review
                        </button>
                      )}
                      <Link to={`/place/${place.placeId}`} className="visited-list-action visited-list-action-primary">
                        Open place →
                      </Link>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

