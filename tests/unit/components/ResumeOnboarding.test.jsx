import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import ResumeOnboarding from '../../../src/components/ResumeOnboarding'
import { keepDeferring, shouldDeferOnboarding } from '../../../src/utils/sharedLink'

vi.mock('../../../src/utils/analytics', () => ({ track: vi.fn() }))
let signedIn = false
vi.mock('../../../src/contexts/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: signedIn }) }))

const firstVisit = pathname => shouldDeferOnboarding({ onboarded: false, native: false, pathname })

describe('shared-link entry paths', () => {
  it('match the pages people share', () => {
    for (const p of ['/place/w123', '/place/12345', '/user/james', '/user/james/map', '/plan/share/abc']) {
      expect(firstVisit(p)).toBe(true)
    }
  })
  it('do not match the app itself', () => {
    for (const p of ['/', '/events', '/plan', '/plan/share', '/wishlist', '/placeholder', '/town/hatfield']) {
      expect(firstVisit(p)).toBe(false)
    }
  })
})

function Nav() {
  const navigate = useNavigate()
  return (
    <>
      <button onClick={() => navigate('/place/456')}>another place</button>
      <button onClick={() => navigate('/')}>discover</button>
    </>
  )
}

describe('shouldDeferOnboarding (the App-level decision)', () => {
  it('defers only for first-time web visitors on a shared link', () => {
    expect(shouldDeferOnboarding({ onboarded: false, native: false, pathname: '/place/w1' })).toBe(true)
    expect(shouldDeferOnboarding({ onboarded: true, native: false, pathname: '/place/w1' })).toBe(false) // returning user
    expect(shouldDeferOnboarding({ onboarded: false, native: true, pathname: '/place/w1' })).toBe(false) // native app
    expect(shouldDeferOnboarding({ onboarded: false, native: false, pathname: '/' })).toBe(false) // normal first visit
  })
})

describe('keepDeferring', () => {
  it('keeps waiting through info pages opened from a shared page (regression: onboarding over Terms)', () => {
    for (const p of ['/terms', '/privacy', '/support', '/pricing', '/get-roam', '/place/2']) expect(keepDeferring(p)).toBe(true)
    for (const p of ['/', '/events', '/wishlist', '/plan', '/social', '/town', '/termsx']) expect(keepDeferring(p)).toBe(false)
  })
})

describe('ResumeOnboarding', () => {
  it('waits while the visitor stays on shared pages, then resumes onboarding when they move on', () => {
    const onResume = vi.fn()
    render(
      <MemoryRouter initialEntries={['/place/w123']}>
        <Nav />
        <ResumeOnboarding onResume={onResume} />
      </MemoryRouter>
    )
    expect(onResume).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('another place')) // still browsing shared content
    expect(onResume).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('discover')) // tapped Discover
    expect(onResume).toHaveBeenCalledWith(true) // show the intro
  })

  it('skips the intro for someone who signed in on the shared page (regression: splash offered "Sign in" again)', () => {
    signedIn = true
    localStorage.removeItem('roam_onboarded')
    const onResume = vi.fn()
    render(
      <MemoryRouter initialEntries={['/user/james']}>
        <Nav />
        <ResumeOnboarding onResume={onResume} />
      </MemoryRouter>
    )
    fireEvent.click(screen.getByText('discover'))
    expect(onResume).toHaveBeenCalledWith(false)
    expect(localStorage.getItem('roam_onboarded')).toBe('true')
    signedIn = false
  })
})
