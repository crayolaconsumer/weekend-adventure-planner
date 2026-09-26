import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import TownHub from '../../../src/pages/TownHub'
import { rememberTown, recentTowns } from '../../../src/utils/recentTowns'

function Where() {
  return <p data-testid="path">{useLocation().pathname}</p>
}

const renderHub = () => render(
  <MemoryRouter initialEntries={['/town']}>
    <Routes>
      <Route path="/town" element={<TownHub />} />
      <Route path="/town/:slug" element={<Where />} />
    </Routes>
  </MemoryRouter>
)

const realFetch = globalThis.fetch
beforeEach(() => localStorage.clear())
afterEach(() => { globalThis.fetch = realFetch })

describe('TownHub', () => {
  it('searches any town through the server and opens it', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ slug: 'lodz' }) }))
    renderHub()
    const user = userEvent.setup()
    await user.type(screen.getByRole('searchbox', { name: 'Town or city' }), 'Łódź')
    await user.click(screen.getByRole('button', { name: 'Explore' }))
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/town/lodz'))
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/town?q=%C5%81%C3%B3d%C5%BA&format=json')
  })

  it('says plainly when no town matches', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }))
    renderHub()
    const user = userEvent.setup()
    await user.type(screen.getByRole('searchbox'), 'asdfqwer')
    await user.click(screen.getByRole('button', { name: 'Explore' }))
    expect(await screen.findByText(/No town by that name/)).toBeInTheDocument()
  })

  it('offers near-me, recents and popular towns', () => {
    rememberTown({ slug: 'paris', name: 'Paris' })
    renderHub()
    expect(screen.getByRole('link', { name: /Near you/ })).toHaveAttribute('href', '/town/near-me')
    expect(screen.getByRole('link', { name: 'Paris' })).toHaveAttribute('href', '/town/paris')
    expect(screen.getByRole('link', { name: 'Hatfield' })).toHaveAttribute('href', '/town/hatfield')
  })

  it('hides "Recently viewed" when there are none', () => {
    renderHub()
    expect(screen.queryByText('Recently viewed')).toBeNull()
  })
})

describe('recentTowns', () => {
  it('keeps newest first, deduped, capped at 6', () => {
    for (const n of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) rememberTown({ slug: n, name: n })
    rememberTown({ slug: 'c', name: 'c' })
    expect(recentTowns().map(t => t.slug)).toEqual(['c', 'g', 'f', 'e', 'd', 'b'])
  })
  it('survives corrupt storage', () => {
    localStorage.setItem('roam_recent_towns', '{not json')
    expect(recentTowns()).toEqual([])
    localStorage.setItem('roam_recent_towns', '{"a":1}')
    expect(recentTowns()).toEqual([])
  })
})
