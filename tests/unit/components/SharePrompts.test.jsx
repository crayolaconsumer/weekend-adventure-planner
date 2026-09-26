import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const sharePlaceLink = vi.fn()
vi.mock('../../../src/utils/shareCard', async importOriginal => ({ ...(await importOriginal()), sharePlaceLink: (...a) => sharePlaceLink(...a) }))
vi.mock('../../../src/contexts/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: false }) }))
vi.mock('../../../src/hooks/useContributions', () => ({ useCreateContribution: () => ({ createContribution: vi.fn(), loading: false }) }))
vi.mock('../../../src/hooks/useUserStats', () => ({ useUserStats: () => ({ incrementStat: vi.fn() }) }))
vi.mock('../../../src/hooks/useVisitedPlaces', () => ({ useVisitedPlaces: () => ({ markVisited: vi.fn() }) }))
vi.mock('../../../src/hooks/usePlaceRatings', () => ({ usePlaceRatings: () => ({ ratePlace: vi.fn() }) }))
vi.mock('../../../src/hooks/useNeedsConnection', () => ({ useNeedsConnection: () => false }))
vi.mock('../../../src/components/PhotoUpload', () => ({ default: () => null }))

const { default: VisitedPrompt } = await import('../../../src/components/VisitedPrompt')
const { default: PlanPrompt } = await import('../../../src/components/PlanPrompt')

const place = { id: 'w815929296', name: 'Hatfield Park', category: { key: 'nature' } }

beforeEach(() => { sharePlaceLink.mockReset(); vi.useFakeTimers({ shouldAdvanceTime: true }) })
afterEach(() => vi.useRealTimers())

// Steps animate out before the next one mounts, so each step is awaited
async function visit(liked, onDismiss = vi.fn(), p = place) {
  render(<VisitedPrompt place={p} onDismiss={onDismiss} />)
  fireEvent.click(await screen.findByText('Yes, I went!'))
  fireEvent.click(await screen.findByText(liked ? 'Yes!' : 'Not really'))
  fireEvent.click(await screen.findByText('Done'))
  await screen.findByText('+1 on your map')
  return onDismiss
}

describe('share at the visit moment', () => {
  it('offers sharing a place the user loved, and waits for them instead of auto-closing', async () => {
    const onDismiss = await visit(true)
    expect(screen.getByText(/Know someone who'd love Hatfield Park too/)).toBeInTheDocument()
    vi.advanceTimersByTime(5000)
    expect(onDismiss).not.toHaveBeenCalled()

    sharePlaceLink.mockResolvedValue('copied')
    fireEvent.click(screen.getByRole('button', { name: 'Share with a friend' }))
    expect(sharePlaceLink).toHaveBeenCalledWith(place, 'visited')
    expect(await screen.findByRole('button', { name: 'Link copied' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onDismiss).toHaveBeenCalled()
  })

  it('does not ask to share a place the user did not like, and auto-closes as before', async () => {
    const onDismiss = await visit(false)
    expect(screen.queryByRole('button', { name: 'Share with a friend' })).toBeNull()
    vi.advanceTimersByTime(3000)
    expect(onDismiss).toHaveBeenCalled()
  })
})

describe('only places a friend can open are shareable', () => {
  it('no share offer for a Wikipedia-sourced place (regression: friend landed on "Place not found")', async () => {
    const onDismiss = await visit(true, vi.fn(), { id: 'wiki_123', name: 'Some Castle' })
    expect(screen.queryByRole('button', { name: 'Share with a friend' })).toBeNull()
    vi.advanceTimersByTime(3000)
    expect(onDismiss).toHaveBeenCalled() // auto-closes like before
  })

  it('no share button on the save prompt for one either', () => {
    render(<MemoryRouter><PlanPrompt place={{ id: 'wiki_9', name: 'X' }} onClose={vi.fn()} /></MemoryRouter>)
    expect(screen.queryByRole('button', { name: 'Share with a friend' })).toBeNull()
  })

  it('a double tap while the share sheet is open shares once', async () => {
    let finish
    sharePlaceLink.mockImplementation(() => new Promise(r => { finish = r }))
    render(<MemoryRouter><PlanPrompt place={place} onClose={vi.fn()} /></MemoryRouter>)
    const btn = screen.getByRole('button', { name: 'Share with a friend' })
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(sharePlaceLink).toHaveBeenCalledTimes(1)
    finish('shared')
    expect(await screen.findByRole('button', { name: 'Shared' })).toBeInTheDocument()
  })
})

describe('share at the save moment', () => {
  it('adds "Share with a friend" to the existing post-save prompt', async () => {
    sharePlaceLink.mockResolvedValue('shared')
    render(<MemoryRouter><PlanPrompt place={place} onClose={vi.fn()} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Share with a friend' }))
    expect(sharePlaceLink).toHaveBeenCalledWith(place, 'saved')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Shared' })).toBeInTheDocument())
  })

  it('leaves the label alone when the user cancels the share sheet', async () => {
    sharePlaceLink.mockResolvedValue(false)
    render(<MemoryRouter><PlanPrompt place={place} onClose={vi.fn()} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Share with a friend' }))
    await waitFor(() => expect(sharePlaceLink).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Share with a friend' })).toBeInTheDocument()
  })
})
