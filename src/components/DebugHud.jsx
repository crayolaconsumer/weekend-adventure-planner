import { useEffect, useState, useRef } from 'react'

/**
 * On-device network debug HUD for native iOS/Android. Triple-tap anywhere
 * to toggle. Renders a draggable overlay listing the last 60 /api/* fetches
 * with method, path, status, latency, and error.
 *
 * Web is a no-op — use Chrome DevTools instead.
 *
 * Backed by window.__roamNetLog populated in main.jsx via a fetch wrapper.
 */
export default function DebugHud() {
  const [open, setOpen] = useState(false)
  const [, force] = useState(0)
  const tapTimes = useRef([])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!window.Capacitor?.isNativePlatform?.()) return

    const onTap = () => {
      const now = Date.now()
      tapTimes.current = [...tapTimes.current, now].filter(t => now - t < 800)
      if (tapTimes.current.length >= 3) {
        setOpen(o => !o)
        tapTimes.current = []
      }
    }
    document.addEventListener('touchstart', onTap, { capture: true, passive: true })
    document.addEventListener('mousedown', onTap, { capture: true, passive: true })

    const refresh = () => force(n => n + 1)
    window.addEventListener('roam:netlog', refresh)
    return () => {
      document.removeEventListener('touchstart', onTap, { capture: true })
      document.removeEventListener('mousedown', onTap, { capture: true })
      window.removeEventListener('roam:netlog', refresh)
    }
  }, [])

  if (!open) return null
  if (typeof window === 'undefined') return null

  const entries = window.__roamNetLog || []
  const slowCount = entries.filter(e => e.ms != null && e.ms > 2000).length
  const errCount = entries.filter(e => e.err).length
  const pendingCount = entries.filter(e => e.status == null && !e.err).length

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.92)', color: '#0f0', zIndex: 2147483647,
      font: '11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace',
      padding: '12px', overflow: 'auto', whiteSpace: 'pre-wrap'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <strong style={{ color: '#fff' }}>
          ROAM Net HUD &nbsp; ({entries.length} reqs, {errCount} err, {slowCount} slow, {pendingCount} pending)
        </strong>
        <button onClick={() => setOpen(false)} style={{
          background: '#fff', color: '#000', border: 0, padding: '4px 10px',
          borderRadius: 4, fontSize: 14, fontWeight: 700
        }}>Close</button>
      </div>
      <div style={{ marginBottom: 8, color: '#ccc' }}>
        Triple-tap to toggle. Latest at top.
      </div>
      {entries.length === 0 && <div style={{ color: '#ff0' }}>No /api/* fetches captured yet — interact with the app.</div>}
      {entries.map((e, i) => {
        const color = e.err ? '#f55' : (e.status == null ? '#ff0' : (e.status >= 400 ? '#fa0' : (e.ms != null && e.ms > 2000 ? '#fa0' : '#0f0')))
        const ts = new Date(e.t).toTimeString().slice(0, 8)
        const ms = e.ms != null ? `${e.ms}ms`.padStart(7) : 'PENDING'
        const code = e.err ? 'ERR' : (e.status ?? '...')
        return (
          <div key={`${e.t}-${i}`} style={{ color, marginBottom: 2 }}>
            {ts} {String(code).padStart(3)} {ms} {e.method.padEnd(4)} {e.url}
            {e.err && <div style={{ color: '#f55', marginLeft: 20 }}>↳ {e.err}</div>}
          </div>
        )
      })}
    </div>
  )
}
