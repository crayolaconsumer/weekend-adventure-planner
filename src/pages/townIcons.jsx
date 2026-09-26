// Small stroke icons for the town screens (2px, round caps, like src/pages/Discover/icons.jsx)
const Svg = ({ size = 20, children }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
)

export const BackIcon = () => <Svg><path d="M19 12H5M12 19l-7-7 7-7" /></Svg>
export const ShareIcon = () => <Svg size={16}><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></Svg>
export const PinIcon = ({ size = 22 }) => <Svg size={size}><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></Svg>
export const ChevronIcon = () => <Svg size={18}><path d="M9 18l6-6-6-6" /></Svg>
