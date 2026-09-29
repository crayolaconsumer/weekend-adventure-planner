import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const env = { native: true, required: true }
const showPrivacyOptions = vi.fn()
vi.mock('../../../src/utils/adMob', () => ({
  isPrivacyOptionsRequired: () => Promise.resolve(env.required),
  showPrivacyOptions: () => showPrivacyOptions(),
}))
vi.mock('../../../src/utils/nativeBridge', () => ({ isNative: () => env.native }))
vi.mock('../../../src/hooks/useSubscription', () => ({ useSubscription: () => ({ noAds: false }) }))
vi.mock('../../../src/contexts/DistanceContext', () => ({ useFormatDistance: () => (m) => `${m} m` }))

const { FilterModal } = await import('../../../src/components/FilterModal')

// Signed-out users see ads but can't reach profile settings, so the filter
// sheet (open to everyone) carries the Google UMP consent entry point too
describe('FilterModal privacy choices', () => {
  beforeEach(() => {
    Object.assign(env, { native: true, required: true })
    showPrivacyOptions.mockReset().mockResolvedValue()
  })

  it('shows the link when consent options are required and opens the form', async () => {
    render(<FilterModal isOpen onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Privacy choices' }))
    expect(showPrivacyOptions).toHaveBeenCalledTimes(1)
  })

  it('hides it when not required, and on web', async () => {
    env.required = false
    const { unmount } = render(<FilterModal isOpen onClose={() => {}} />)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Privacy choices' })).toBeNull())
    unmount()
    Object.assign(env, { native: false, required: true })
    render(<FilterModal isOpen onClose={() => {}} />)
    await new Promise(r => setTimeout(r, 0))
    expect(screen.queryByRole('button', { name: 'Privacy choices' })).toBeNull()
  })
})

// Closed places are hidden by default; the Discover ClosedNowNotice is the
// only way to include them, so the sheet has no "Open now" toggle
describe('FilterModal open-now toggle', () => {
  it('is gone', async () => {
    render(<FilterModal isOpen onClose={() => {}} />)
    await screen.findByText('Accessible places')
    expect(screen.queryByText('Open now')).toBeNull()
  })
})

// The Discover settings sheet is the signed-out user's "about": the place
// data (ODbL) credit lives there too
describe('FilterModal OSM credit', () => {
  it('links to the OpenStreetMap copyright page', async () => {
    render(<FilterModal isOpen onClose={() => {}} />)
    expect(await screen.findByRole('link', { name: 'OpenStreetMap contributors' }))
      .toHaveAttribute('href', 'https://www.openstreetmap.org/copyright')
  })
})

// "Bring the dog" is a premium filter: the toggle works for ROAM+ users,
// offers the upgrade for everyone else, and only counts as an active
// filter when the user can actually use it.
describe('FilterModal bring the dog', () => {
  it('toggles on tap for premium users', async () => {
    const onToggleDogs = vi.fn()
    render(<FilterModal isOpen isPremium onClose={() => {}} onToggleDogs={onToggleDogs} />)
    fireEvent.click(screen.getByText('Bring the dog'))
    expect(onToggleDogs).toHaveBeenCalledTimes(1)
  })

  it('offers the upgrade for free users', async () => {
    const onShowUpgrade = vi.fn()
    render(<FilterModal isOpen isPremium={false} onClose={() => {}} onToggleDogs={vi.fn()} onShowUpgrade={onShowUpgrade} />)
    fireEvent.click(screen.getByText('Bring the dog'))
    expect(onShowUpgrade).toHaveBeenCalledTimes(1)
  })

  it('counts as an active filter only for premium users', async () => {
    const { unmount } = render(<FilterModal isOpen isPremium showDogs onClose={() => {}} />)
    expect(screen.getByText('1 filter')).toBeInTheDocument()
    unmount()
    render(<FilterModal isOpen isPremium={false} showDogs onClose={() => {}} />)
    expect(screen.queryByText('1 filter')).toBeNull()
  })

  it('clear-all turns the dog toggle off for premium users', async () => {
    const onToggleDogs = vi.fn()
    render(<FilterModal isOpen isPremium showDogs onClearAll={null} onToggleDogs={onToggleDogs} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Clear all'))
    expect(onToggleDogs).toHaveBeenCalledTimes(1)
  })
})
