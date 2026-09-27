import { lazy } from 'react'

const RELOAD_KEY = 'roam_chunk_reload_at'

// React.lazy that survives a stale deploy: when a chunk fails to download
// (the old build's files are gone), retry once, then reload the page (at most
// once per 30s) instead of letting the error reach "Something went wrong".
export function lazyWithReload(loader) {
  return lazy(() => loader().catch(() => loader()).catch((err) => {
    let last = 0
    try { last = Number(sessionStorage.getItem(RELOAD_KEY) || 0) } catch { /* private mode */ }
    if (Date.now() - last < 30_000) throw err
    try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())) } catch { /* private mode */ }
    window.location.reload()
    return new Promise(() => {}) // keep Suspense waiting until the reload happens
  }))
}
