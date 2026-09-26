import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const track = vi.fn()
vi.mock('../../../src/utils/analytics', () => ({ track: (...a) => track(...a) }))
const { default: GetAppCard } = await import('../../../src/components/GetAppCard')

describe('GetAppCard', () => {
  it('links to both stores and records which one was tapped', () => {
    render(<GetAppCard source="place" />)
    const ios = screen.getByRole('link', { name: 'App Store' })
    expect(ios).toHaveAttribute('href', 'https://apps.apple.com/gb/app/go-roam/id6768306617')
    expect(screen.getByRole('link', { name: 'Google Play' })).toHaveAttribute('href', 'https://play.google.com/store/apps/details?id=com.goroam.app')
    fireEvent.click(ios)
    expect(track).toHaveBeenCalledWith('store_click', { source: 'place', store: 'ios' })
  })
})
