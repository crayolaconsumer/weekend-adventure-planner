import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// QA: the auto plan title read "Mix Adventure"; ROAM copy is sentence case.
describe('Plan default title', () => {
  it('is "{Vibe} adventure"', () => {
    const src = readFileSync('src/pages/Plan.jsx', 'utf8')
    expect(src).not.toMatch(/\$\{vibeName\} Adventure`/)
    expect(src.match(/\$\{vibeName\} adventure`/g)).toHaveLength(3)
  })
})
