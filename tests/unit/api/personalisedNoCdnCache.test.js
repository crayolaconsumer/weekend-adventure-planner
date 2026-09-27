import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Any route that reads the viewer (getUserFromRequest / requireAuth) must not
// hand the shared CDN a public copy. Vercel caches requests carrying a web
// session cookie (only Authorization bypasses it), so a public response here
// would be served to other viewers.
// Exceptions vary the public copy on Cookie, which Vercel refuses to cache.
const EXCEPTIONS = {
  'api/contributions/index.js': 'anonymous branch sets Vary: Authorization, Cookie',
}

function walk(dir) {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : /\.(js|ts|tsx)$/.test(f) ? [p] : []
  })
}

const personalised = walk('api').filter(f => !f.startsWith('api/lib/') && /getUserFromRequest|requireAuth/.test(readFileSync(f, 'utf8')))

describe('personalised routes are never publicly CDN-cacheable', () => {
  it('finds the personalised routes', () => {
    expect(personalised.length).toBeGreaterThan(30)
  })

  it.each(personalised.filter(f => !EXCEPTIONS[f]))('%s sets no public / s-maxage Cache-Control', f => {
    const src = readFileSync(f, 'utf8')
    expect(src).not.toMatch(/Cache-Control['"]\s*,\s*['"`][^'"`]*(public|s-maxage)/i)
    expect(src).not.toMatch(/CDN-Cache-Control/i)
  })
})
