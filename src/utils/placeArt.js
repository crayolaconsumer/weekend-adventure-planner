// Seeded contour artwork for places with no photo (components/PlaceArt.jsx)

export const W = 300
export const H = 400

export function hash(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619)
  return h >>> 0
}

function rng(seed) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function mix(hex, other, t) {
  const c = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
  const [a, b] = [c(hex), c(other)]
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('')
}

// Closed Catmull-Rom curve through the points, as cubic Béziers
function smoothPath(pts) {
  const n = pts.length
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [pts[(i - 1 + n) % n], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]]
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += `C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
  }
  return d + 'Z'
}

/** Deterministic layout for a seed: summit position (0-1) and ring paths. */
export function contourLayout(seed) {
  const r = rng(hash(String(seed ?? 'roam')))
  const sx = 0.35 + r() * 0.3
  const sy = 0.2 + r() * 0.1
  const waves = [2, 3, 5].map(k => ({ k, a: 0.04 + r() * 0.06, p: r() * Math.PI * 2 }))
  const stretch = 0.8 + r() * 0.4
  const rings = []
  for (let i = 0; i < 11; i++) {
    const radius = 18 + i * 27
    const wobble = 1 + i * 0.12
    const pts = []
    for (let j = 0; j < 40; j++) {
      const t = (j / 40) * Math.PI * 2
      const f = 1 + waves.reduce((s, w) => s + w.a * wobble * Math.sin(w.k * t + w.p + i * 0.35), 0)
      pts.push([sx * W + Math.cos(t) * radius * f * stretch, sy * H + Math.sin(t) * radius * f])
    }
    rings.push({ d: smoothPath(pts), index: i % 4 === 3 })
  }
  return { sx, sy, rings }
}
