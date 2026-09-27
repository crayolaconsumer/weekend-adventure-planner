// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// user-scalable=no / maximum-scale=1 blocks pinch-zoom (WCAG 1.4.4, Lighthouse
// meta-viewport). The web page must allow zoom; only the native app locks it.
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
const shipped = html.match(/<meta name="viewport" content="([^"]+)"/)[1]
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('user-scalable=no'))

function run({ capacitor, protocol = 'https:' }) {
  const meta = { content: shipped, setAttribute(k, v) { this[k] = v } }
  const document = { querySelector: sel => (sel === 'meta[name="viewport"]' ? meta : null) }
  const window = { Capacitor: capacitor }
  new Function('window', 'document', 'location', script)(window, document, { protocol })
  return meta.content
}

describe('index.html viewport', () => {
  it('ships a zoomable viewport for the web', () => {
    expect(shipped).not.toMatch(/user-scalable\s*=\s*no|maximum-scale/)
    expect(shipped).toContain('viewport-fit=cover')
    expect(run({ capacitor: undefined })).toBe(shipped)
    expect(run({ capacitor: { isNativePlatform: () => false } })).toBe(shipped)
  })

  it.each([
    ['Capacitor native', { capacitor: { isNativePlatform: () => true } }],
    ['the iOS capacitor:// bundle', { capacitor: undefined, protocol: 'capacitor:' }],
  ])('locks zoom in %s', (_, env) => {
    const content = run(env)
    expect(content).toContain('maximum-scale=1.0')
    expect(content).toContain('user-scalable=no')
    expect(content).toContain('viewport-fit=cover')
  })
})
