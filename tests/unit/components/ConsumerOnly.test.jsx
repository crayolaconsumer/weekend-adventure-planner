import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../src/main.jsx', () => ({}))
const { ConsumerOnly } = await import('../../../src/App.jsx')

// Consumer overlays (location banner, sign-in nudge, bell, name prompt) must
// not cover the admin console
describe('ConsumerOnly', () => {
  const at = (path) => render(<MemoryRouter initialEntries={[path]}><ConsumerOnly><p>overlay</p></ConsumerOnly></MemoryRouter>)

  it('renders overlays on consumer routes', () => {
    at('/events')
    expect(screen.getByText('overlay')).toBeInTheDocument()
  })

  it('hides them on every admin route', () => {
    at('/admin/users')
    expect(screen.queryByText('overlay')).toBeNull()
  })
})
