import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import ProfileSkeleton from '../../../src/pages/UnifiedProfile/ProfileSkeleton.jsx'

describe('UnifiedProfile/ProfileSkeleton', () => {
  it('renders the page shell with avatar + stats placeholders', () => {
    const { container } = render(<ProfileSkeleton />)
    expect(container.querySelector('.unified-profile-page')).toBeInTheDocument()
    expect(container.querySelector('.unified-profile-back svg')).toBeInTheDocument()
    expect(container.querySelector('.unified-profile-avatar.skeleton')).toBeInTheDocument()
    // 4 stat-slot skeletons
    const stats = container.querySelectorAll('.unified-profile-stat')
    expect(stats.length).toBe(4)
  })
})
