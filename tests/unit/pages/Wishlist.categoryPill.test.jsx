import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Regression (26 Oct 2026): the Hidden Gems pill took its label from the first saved place,
// so with a notable gem (labelled "Landmark") first it read "Landmark" while also showing windmills
const gem = (id, name, label) => ({ id, name, type: 'attraction', lat: 53.96, lng: -1.08, savedAt: Date.now() - id,
  category: { key: 'unique', label, icon: '💎', color: '#d4a855' } })
const SAVED = [gem(1, 'York Guildhall', 'Landmark'), gem(2, 'Holgate Windmill', 'Hidden Gems'),
  { id: 3, name: 'Bettys', type: 'cafe', lat: 53.96, lng: -1.08, savedAt: 1, category: { key: 'food', label: 'Food & Drink' } }]

vi.mock('../../../src/hooks/useSavedPlaces', () => ({ useSavedPlaces: () => ({ places: SAVED, removePlace: vi.fn(), loading: false, refresh: vi.fn() }) }))
vi.mock('../../../src/hooks/useUserPlans', () => ({ useUserPlans: () => ({ plans: [], loading: false, deletePlan: vi.fn(), refresh: vi.fn() }) }))
vi.mock('../../../src/hooks/useSavedEvents', () => ({ useSavedEvents: () => ({ events: [], loading: false, unsaveEvent: vi.fn(), refresh: vi.fn() }) }))
vi.mock('../../../src/hooks/useSubscription', () => ({ useSubscription: () => ({ isPremium: true }) }))
vi.mock('../../../src/hooks/useToast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), show: vi.fn() }) }))
vi.mock('../../../src/hooks/useVisitedPlaces', () => ({ useVisitedPlaces: () => ({ isVisited: () => false, visitedPlaces: [] }) }))
vi.mock('../../../src/hooks/usePullToRefresh', () => ({ usePullToRefresh: () => ({ pullDistance: 0, isRefreshing: false, handlers: {} }) }))
vi.mock('../../../src/contexts/DistanceContext', () => ({ useFormatDistance: () => km => `${km} km` }))
vi.mock('../../../src/utils/nativePlugins', () => ({ getCurrentPosition: () => new Promise(() => {}) }))

// child components (images, collections) fetch on mount: keep the test offline
vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })))

describe('Saved places category pills', () => {
  it('name the category, whatever label the first saved place carries', async () => {
    const { default: Wishlist } = await import('../../../src/pages/Wishlist.jsx')
    render(<MemoryRouter><Wishlist /></MemoryRouter>)
    const pills = screen.getAllByRole('button').map(b => b.textContent)
    expect(pills.some(t => /Hidden Gems/.test(t))).toBe(true)
    expect(pills.some(t => /^\s*Landmark/.test(t))).toBe(false)
  })
})
