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
