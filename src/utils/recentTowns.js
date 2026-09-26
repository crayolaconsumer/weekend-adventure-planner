// Towns the user opened, newest first, for the Town Hub's "Recently viewed".
// Per-device convenience only, so any storage failure just means no recents.

const RECENT_KEY = 'roam_recent_towns'
const MAX_RECENT = 6

export function recentTowns() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function rememberTown({ slug, name }) {
  try {
    const list = [{ slug, name }, ...recentTowns().filter(t => t.slug !== slug)].slice(0, MAX_RECENT)
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch { /* storage full or blocked: recents are a nicety */ }
}
