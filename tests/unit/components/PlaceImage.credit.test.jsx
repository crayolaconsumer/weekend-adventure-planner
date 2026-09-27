import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const META = {
  url: 'https://upload.wikimedia.org/tower.jpg',
  source: 'wikipedia',
  attribution: { name: 'Tower of London', url: 'https://en.wikipedia.org/wiki/Tower_of_London', source: 'Wikipedia' },
}
vi.mock('../../../src/utils/placeImage', () => ({
  resolvePlaceImageSync: () => null,
  resolvePlaceImageWithMeta: vi.fn(async () => META),
}))

const { default: PlaceImage } = await import('../../../src/components/PlaceImage')
const place = { id: 'p1', name: 'Tower of London', wikipedia: 'en:Tower of London' }

// The async upgrade shows a Wikipedia/Commons photo: large renders credit it
describe('PlaceImage photo credit', () => {
  it('credits the resolved photo when asked', async () => {
    render(<PlaceImage place={place} creditClassName="c" />)
    const link = await screen.findByRole('link', { name: 'Photo: Wikipedia' })
    expect(link).toHaveAttribute('href', META.attribution.url)
    expect(link).toHaveClass('c')
  })
  it('stays bare on thumbnails', async () => {
    const { container } = render(<PlaceImage place={place} />)
    await waitFor(() => expect(container.querySelector('img')).toHaveAttribute('src', META.url))
    expect(screen.queryByRole('link')).toBeNull()
  })
})
