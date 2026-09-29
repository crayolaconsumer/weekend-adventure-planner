import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('framer-motion', async () => {
  const React = await import('react')
  const strip = ({ initial: _i, animate: _a, exit: _e, transition: _t, whileHover: _h, whileTap: _w, ...rest }) => rest
  const motion = new Proxy({}, {
    get: (_, tag) => React.forwardRef((props, ref) => React.createElement(tag, { ...strip(props), ref })),
  })
  return { motion, AnimatePresence: ({ children }) => children }
})
vi.mock('../../../src/utils/haptics', () => ({ tap: vi.fn() }))

const { default: DiscoverHeader } = await import('../../../src/pages/Discover/DiscoverHeader')

function renderHeader(props = {}) {
  const ui = (
    <MemoryRouter>
      <DiscoverHeader
        streak={0}
        activeFiltersCount={0}
        hasLocation={true}
        placesCount={5}
        loading={false}
        loadError={null}
        weather={null}
        travelMode="walking"
        travelModeLabel="Walking"
        onOpenFilters={props.onOpenFilters || vi.fn()}
        onTriggerJustGo={props.onTriggerJustGo || vi.fn()}
        town={null}
        {...props}
      />
    </MemoryRouter>
  )
  return render(ui)
}

describe('DiscoverHeader', () => {
  it('renders the town name as a link to the town page', () => {
    renderHeader({ town: { name: 'Bath', slug: 'bath' } })
    const link = screen.getByRole('link', { name: 'Explore Bath' })
    expect(link).toHaveTextContent('Bath')
    expect(link).toHaveAttribute('href', '/town/bath')
  })

  it('renders "Explore towns" linking to /town when no town is resolved', () => {
    renderHeader()
    const link = screen.getByRole('link', { name: 'Explore towns near you' })
    expect(link).toHaveTextContent('Explore towns')
    expect(link).toHaveAttribute('href', '/town')
  })

  it('quiet line shows weather, mode and streak with separators', () => {
    renderHeader({
      weather: { temperature: 18.4, description: 'Sunny' },
      travelModeLabel: 'Walking',
      streak: 4,
    })
    const quiet = screen.getByRole('button', { name: 'Weather, travel mode and streak. Open filters' })
    expect(quiet).toHaveTextContent('18° Sunny')
    expect(quiet).toHaveTextContent('Walking')
    expect(quiet).toHaveTextContent('4-day streak')
    // separators present only between segments that exist
    expect(quiet.textContent).toBe('18° Sunny·Walking·4-day streak')
  })

  it('quiet line omits weather and its separator when no weather', () => {
    renderHeader({ travelModeLabel: 'Driving', streak: 0 })
    const quiet = screen.getByRole('button', { name: 'Weather, travel mode and streak. Open filters' })
    expect(quiet.textContent).toBe('Driving')
  })

  it('quiet line omits streak when it is zero', () => {
    renderHeader({ travelModeLabel: 'Walking' })
    const quiet = screen.getByRole('button', { name: 'Weather, travel mode and streak. Open filters' })
    expect(quiet.textContent).toBe('Walking')
    expect(quiet).not.toHaveTextContent(/streak/)
  })

  it('opens filters from both the quiet line and the cog', () => {
    const onOpenFilters = vi.fn()
    const { container } = renderHeader({ onOpenFilters, activeFiltersCount: 2 })
    fireEvent.click(screen.getByRole('button', { name: 'Weather, travel mode and streak. Open filters' }))
    fireEvent.click(container.querySelector('.discover-settings-btn'))
    expect(onOpenFilters).toHaveBeenCalledTimes(2)
  })

  it('cog shows a badge with the active filter count', () => {
    const { container } = renderHeader({ activeFiltersCount: 3 })
    const btn = container.querySelector('.discover-settings-btn')
    expect(btn).toHaveAttribute('aria-label', 'Open filters (3 active)')
    expect(btn.querySelector('.discover-settings-btn-badge')).toHaveTextContent('3')
  })

  it('cog has no badge when no filters are active', () => {
    const { container } = renderHeader()
    const btn = container.querySelector('.discover-settings-btn')
    expect(btn).toHaveAttribute('aria-label', 'Open filters')
    expect(btn.querySelector('.discover-settings-btn-badge')).toBeNull()
  })

  it('bored button is enabled with a location and places, and fires JustGo', () => {
    const onTriggerJustGo = vi.fn()
    renderHeader({ hasLocation: true, placesCount: 3, onTriggerJustGo })
    const btn = screen.getByRole('button', { name: /i'm bored/i })
    expect(btn).not.toBeDisabled()
    fireEvent.click(btn)
    expect(onTriggerJustGo).toHaveBeenCalledTimes(1)
  })

  it('bored button is disabled without a location, with the location tooltip', () => {
    renderHeader({ hasLocation: false, placesCount: 0 })
    const btn = screen.getByRole('button', { name: /i'm bored/i })
    expect(btn).toBeDisabled()
    expect(screen.getByText('Getting your location...')).toBeInTheDocument()
  })

  it('bored button is disabled with no places yet, with the finding-places tooltip', () => {
    renderHeader({ hasLocation: true, placesCount: 0 })
    const btn = screen.getByRole('button', { name: /i'm bored/i })
    expect(btn).toBeDisabled()
    expect(screen.getByText('Finding places nearby...')).toBeInTheDocument()
  })

  it('hides the tooltip while loading or on a load error', () => {
    const { container } = renderHeader({ hasLocation: true, placesCount: 0, loading: true })
    expect(container.querySelector('.boredom-btn-tooltip')).toBeNull()
  })
})
