import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Admin users page: delete needs the username typed, is disabled for
// admins and yourself, and 'Likely test accounts' asks the server.

const toast = { success: vi.fn(), error: vi.fn() }
vi.mock('../../../src/hooks/useToast', () => ({ useToast: () => toast }))
vi.mock('../../../src/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, isAdmin: true } }) }))
vi.mock('../../../src/utils/authToken', () => ({ authHeaders: () => ({}) }))

const { default: AdminUsers } = await import('../../../src/pages/AdminUsers')

const USERS = [
  { id: 1, username: 'owner', email: 'owner@go-roam.uk', is_admin: 1, created_at: '2026-01-01' },
  { id: 2, username: 'mod', email: 'mod@go-roam.uk', is_admin: 1, created_at: '2026-01-01' },
  { id: 7, username: 'demo_user', email: 'demo@mailinator.com', is_admin: 0, created_at: '2026-01-01' },
]

let fetchMock
beforeEach(() => {
  toast.success.mockReset()
  toast.error.mockReset()
  fetchMock = vi.fn(async (url, opts = {}) => {
    if (opts.method === 'DELETE') return { ok: true, json: async () => ({ success: true }) }
    return { ok: true, json: async () => ({ users: USERS, total: 3, hasMore: false }) }
  })
  vi.stubGlobal('fetch', fetchMock)
})

const renderPage = (path = '/admin/users') => render(<MemoryRouter initialEntries={[path]}><AdminUsers /></MemoryRouter>)
const rowFor = async (name) => (await screen.findByText(name)).closest('tr')

describe('AdminUsers delete account', () => {
  it('disables delete for yourself and for other admins', async () => {
    renderPage()
    for (const name of ['@owner', '@mod']) {
      const row = await rowFor(name)
      expect(within(row).getByRole('button', { name: 'Delete account' })).toBeDisabled()
    }
    expect(within(await rowFor('@demo_user')).getByRole('button', { name: 'Delete account' })).toBeEnabled()
  })

  it('only deletes once the exact username is typed', async () => {
    renderPage()
    fireEvent.click(within(await rowFor('@demo_user')).getByRole('button', { name: 'Delete account' }))
    const input = await screen.findByLabelText(/Type .* to confirm/)

    fireEvent.change(input, { target: { value: 'demo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Type the name first' }))
    expect(fetchMock.mock.calls.some(([, o]) => o?.method === 'DELETE')).toBe(false)

    fireEvent.change(input, { target: { value: 'demo_user' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete account' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([, o]) => o?.method === 'DELETE')).toBe(true))
    const [, opts] = fetchMock.mock.calls.find(([, o]) => o?.method === 'DELETE')
    expect(JSON.parse(opts.body)).toEqual({ id: 7, confirm: 'demo_user' })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Account @demo_user deleted'))
  })

  it('sends the test filter to the server', async () => {
    renderPage('/admin/users?filter=test')
    await screen.findByText('@demo_user')
    expect(fetchMock.mock.calls[0][0]).toContain('filter=test')
    expect(screen.getByRole('button', { name: 'Likely test accounts' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows an error block with retry when the list fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('The server answered 500')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('@demo_user')).toBeInTheDocument()
  })
})
