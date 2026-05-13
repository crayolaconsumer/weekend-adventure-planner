import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DiscoverHeader from '../../../src/pages/Discover/DiscoverHeader'

const baseProps = {
  streak: 0,
  activeFiltersCount: 0,
  hasLocation: true,
  placesCount: 5,
  loading: false,
  weather: null,
  travelMode: 'walking',
  travelModeLabel: 'Walking',
  onOpenFilters: () => {},
  onTriggerJustGo: () => {},
}

describe('Discover/DiscoverHeader', () => {
  it('renders the ROAM wordmark + tagline', () => {
    render(<DiscoverHeader {...baseProps} />)
    expect(screen.getByRole('heading', { level: 1, name: 'ROAM' })).toBeInTheDocument()
    expect(screen.getByText(/Stop scrolling. Start roaming/i)).toBeInTheDocument()
  })

  it('renders the filter button with default aria-label', () => {
    render(<DiscoverHeader {...baseProps} />)
    expect(screen.getByRole('button', { name: /Open filters$/i })).toBeInTheDocument()
  })

  it('shows active filter count in aria-label + badge', () => {
    render(<DiscoverHeader {...baseProps} activeFiltersCount={3} />)
    expect(screen.getByRole('button', { name: /Open filters \(3 active\)/i })).toBeInTheDocument()
  })

  it('renders the I\'m Bored CTA', () => {
    render(<DiscoverHeader {...baseProps} />)
    expect(screen.getByRole('button', { name: /I'm Bored/i })).toBeInTheDocument()
  })

  it('disables I\'m Bored when no location', () => {
    render(<DiscoverHeader {...baseProps} hasLocation={false} />)
    const btn = screen.getByRole('button', { name: /I'm Bored/i })
    expect(btn).toBeDisabled()
  })

  it('disables I\'m Bored when 0 places', () => {
    render(<DiscoverHeader {...baseProps} placesCount={0} />)
    const btn = screen.getByRole('button', { name: /I'm Bored/i })
    expect(btn).toBeDisabled()
  })

  it('shows tooltip when disabled and not loading', () => {
    render(<DiscoverHeader {...baseProps} hasLocation={false} loading={false} />)
    expect(screen.getByText(/Getting your location/i)).toBeInTheDocument()
  })

  it('hides tooltip while loading', () => {
    render(<DiscoverHeader {...baseProps} hasLocation={false} loading={true} />)
    expect(screen.queryByText(/Getting your location/i)).toBeNull()
  })

  it('renders weather when provided', () => {
    render(
      <DiscoverHeader
        {...baseProps}
        weather={{ temperature: 18.4, description: 'Partly cloudy' }}
      />,
    )
    expect(screen.getByText('18°')).toBeInTheDocument()
    expect(screen.getByText(/Partly cloudy/)).toBeInTheDocument()
  })

  it('renders travel mode label', () => {
    render(<DiscoverHeader {...baseProps} travelModeLabel="Driving" />)
    expect(screen.getByText('Driving')).toBeInTheDocument()
  })

  it('fires onOpenFilters when filter button clicked', async () => {
    const onOpenFilters = vi.fn()
    const user = userEvent.setup()
    render(<DiscoverHeader {...baseProps} onOpenFilters={onOpenFilters} />)
    await user.click(screen.getByRole('button', { name: /Open filters/i }))
    expect(onOpenFilters).toHaveBeenCalledTimes(1)
  })

  it('fires onTriggerJustGo when I\'m Bored clicked', async () => {
    const onTriggerJustGo = vi.fn()
    const user = userEvent.setup()
    render(<DiscoverHeader {...baseProps} onTriggerJustGo={onTriggerJustGo} />)
    await user.click(screen.getByRole('button', { name: /I'm Bored/i }))
    expect(onTriggerJustGo).toHaveBeenCalledTimes(1)
  })
})
