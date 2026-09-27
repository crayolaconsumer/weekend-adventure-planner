import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { render } from '@testing-library/react'
import { useSEO } from '../../../src/hooks/useSEO'

const DEFAULT_TITLE = 'ROAM — Stop scrolling. Start roaming.'

function PlacePage() {
  useSEO({ title: 'Costa' })
  return null
}

describe('useSEO title', () => {
  // QA: a directly loaded /place/:id arrives with the server's "Costa | ROAM"
  // title; restoring that on unmount kept it on every later route.
  it('resets to the default title on unmount, not the title it found', () => {
    document.title = 'Costa | ROAM'
    const { unmount } = render(<PlacePage />)
    expect(document.title).toBe('Costa | ROAM')
    unmount()
    expect(document.title).toBe(DEFAULT_TITLE)
  })
})

describe('/saved', () => {
  it('App routes /saved to /wishlist', () => {
    const app = readFileSync('src/App.jsx', 'utf8')
    expect(app).toMatch(/<Route path="\/saved" element={<Navigate to="\/wishlist" replace \/>} \/>/)
  })
})
