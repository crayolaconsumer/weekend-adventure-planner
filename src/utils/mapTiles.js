// Basemap tiles for every map in the app (Leaflet raster). CARTO has required
// a key since 2026-09 (tiles without one are stamped "API KEY REQUIRED"); the
// free key from carto.com/basemaps/apikey covers 1M requests/month commercially.
const KEY = import.meta.env.VITE_CARTO_BASEMAPS_KEY
const carto = style => `https://{s}.basemaps.cartocdn.com/rastertiles/${style}/{z}/{x}/{y}{r}.png${KEY ? `?key=${KEY}` : ''}`

export const TILE_LIGHT = carto('voyager')
export const TILE_DARK = carto('dark_all')
export const TILE_ATTRIBUTION = '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
export const tileUrlFor = theme => (theme === 'dark' ? TILE_DARK : TILE_LIGHT)
