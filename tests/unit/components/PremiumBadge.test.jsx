import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import PremiumBadge from '../../../src/components/PremiumBadge.jsx'

describe('PremiumBadge', () => {
  it('renders with default props', () => {
    render(<PremiumBadge />)
    const badge = screen.getByRole('img', { name: /ROAM\+ subscriber/i })
    expect(badge).toBeInTheDocument()
    expect(badge.style.width).toBe('14px') // sm default
  })

  it('respects size preset', () => {
    render(<PremiumBadge size="hero" />)
    const badge = screen.getByRole('img', { name: /ROAM\+ subscriber/i })
    expect(badge.style.width).toBe('56px')
  })

  it('accepts custom numeric size', () => {
    render(<PremiumBadge size={42} />)
    expect(screen.getByRole('img').style.width).toBe('42px')
  })

  it('falls back to sm for unknown size string', () => {
    render(<PremiumBadge size="garbage" />)
    expect(screen.getByRole('img').style.width).toBe('14px')
  })

  it('renders title attribute', () => {
    render(<PremiumBadge title="My title" />)
    expect(screen.getByRole('img', { name: 'My title' })).toBeInTheDocument()
  })

  it('accepts additional className', () => {
    render(<PremiumBadge className="extra-class" />)
    const badge = screen.getByRole('img')
    expect(badge.className).toMatch(/premium-badge/)
    expect(badge.className).toMatch(/extra-class/)
  })
})
