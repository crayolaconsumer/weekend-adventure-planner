import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// The dashboard sets the one live rollout percentage (places from tiles, 0 = off)
// and only sends a whole number 0-100. Finished rollouts aren't shown.

const toast = { success: vi.fn(), error: vi.fn() }
vi.mock('../../../src/hooks/useToast', () => ({ useToast: () => toast }))
vi.mock('../../../src/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, isAdmin: true } }) }))
vi.mock('../../../src/utils/authToken', () => ({ authHeaders: () => ({}) }))

const { default: AdminDashboard } = await import('../../../src/pages/AdminDashboard')

let flags, fetchMock
beforeEach(() => {
  toast.success.mockReset()
  flags = { overpassProxy: true, contributionsUpload: true, pushNudges: true, promotedEvents: true, promotedEventPush: true, poiDbPct: 100, poiShadowPct: 0, poiCapPct: 100, poiTilesPct: 5, poiTilesFallback: true }
  fetchMock = vi.fn(async (url, opts = {}) => {
    if (url === '/api/admin/flags' && opts.method === 'POST') {
      flags = { ...flags, ...JSON.parse(opts.body).flags }
      return { ok: true, json: async () => ({ flags }) }
    }
    if (url === '/api/admin/flags') return { ok: true, json: async () => ({ flags }) }
    if (url === '/api/health') return { ok: true, json: async () => ({ status: 'ok', db: 'ok', kv: 'ok' }) }
    return { ok: true, json: async () => ({ actions: [] }) }
  })
  vi.stubGlobal('fetch', fetchMock)
})

const posts = () => fetchMock.mock.calls.filter(([, o]) => o?.method === 'POST').map(([, o]) => JSON.parse(o.body))

describe('AdminDashboard rollout percentages', () => {
  it('saves a percentage and shows the new value', async () => {
    render(<MemoryRouter><AdminDashboard /></MemoryRouter>)
    const input = await screen.findByLabelText('Places from tiles percent')
    fireEvent.change(input, { target: { value: '25' } })
    fireEvent.submit(input.closest('form'))
    await waitFor(() => expect(posts()).toEqual([{ flags: { poiTilesPct: 25 } }]))
    expect(await screen.findByText('Places from tiles: 25%')).toBeInTheDocument()
    expect(toast.success).toHaveBeenCalledWith('Places from tiles set to 25%. Live within about a minute.')
  })

  it('only the live rollout is shown: finished place rollouts and the tiles fallback switch are gone', async () => {
    render(<MemoryRouter><AdminDashboard /></MemoryRouter>)
    await screen.findByLabelText('Places from tiles percent')
    expect(screen.getAllByRole('spinbutton')).toHaveLength(1)
    for (const gone of [/Place database/, /Place tiles/]) expect(screen.queryByText(gone)).toBeNull()
  })

  it('off: back to 0', async () => {
    render(<MemoryRouter><AdminDashboard /></MemoryRouter>)
    const input = await screen.findByLabelText('Places from tiles percent')
    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.submit(input.closest('form'))
    await waitFor(() => expect(posts()).toEqual([{ flags: { poiTilesPct: 0 } }]))
  })

  it('a failed save rolls back and says so', async () => {
    toast.error.mockReset()
    render(<MemoryRouter><AdminDashboard /></MemoryRouter>)
    const input = await screen.findByLabelText('Places from tiles percent')
    fetchMock.mockImplementation(async (url, opts = {}) => (opts.method === 'POST' ? { ok: false, status: 500 } : { ok: true, json: async () => ({ flags }) }))
    fireEvent.change(input, { target: { value: '50' } })
    fireEvent.submit(input.closest('form'))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't save that change: HTTP 500"))
    expect(screen.getByText('Places from tiles: 5%')).toBeInTheDocument()
    expect(screen.getByLabelText('Places from tiles percent')).toHaveValue(5)
  })

  it.each(['101', '2.5', '', '-1'])('never sends %j', async (v) => {
    render(<MemoryRouter><AdminDashboard /></MemoryRouter>)
    const input = await screen.findByLabelText('Places from tiles percent')
    fireEvent.change(input, { target: { value: v } })
    fireEvent.submit(input.closest('form'))
    expect(input.closest('form').querySelector('button')).toBeDisabled()
    await new Promise(r => setTimeout(r, 20))
    expect(posts()).toEqual([])
  })
})
