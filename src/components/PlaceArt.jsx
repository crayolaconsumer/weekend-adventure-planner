import CategoryIcon from './icons/CategoryIcon'
import { GOOD_CATEGORIES } from '../utils/categories'
import { W, H, hash, mix, contourLayout } from '../utils/placeArt'

// Artwork for a place with no photo: contour lines around a summit, seeded by
// the place id so every card differs, in the category's colour. The summit sits
// in the top third, clear of the card text.

const FOREST = '#1a3a2f'
const CREAM = '#f4ecd8'

export default function PlaceArt({ seed, categoryKey }) {
  const key = GOOD_CATEGORIES[categoryKey] ? categoryKey : null
  const tint = key ? GOOD_CATEGORIES[key].color : FOREST
  const { sx, sy, rings } = contourLayout(seed)
  const gid = `pa-${hash(String(seed))}`
  return (
    <div className="place-art" style={{ '--sx': `${sx * 100}%`, '--sy': `${sy * 100}%` }} aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" focusable="false">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={mix(tint, FOREST, 0.45)} />
            <stop offset="0.65" stopColor={mix(tint, FOREST, 0.78)} />
            <stop offset="1" stopColor={FOREST} />
          </linearGradient>
        </defs>
        <rect width={W} height={H} fill={`url(#${gid})`} />
        <g fill="none" stroke={CREAM} strokeLinejoin="round">
          {rings.map((ring, i) => (
            <path key={i} d={ring.d} strokeWidth={ring.index ? 1.6 : 0.8} strokeOpacity={ring.index ? 0.3 : 0.16} />
          ))}
        </g>
      </svg>
      <span className="place-art-summit">
        <CategoryIcon name={key || 'default'} size={48} />
      </span>
    </div>
  )
}
