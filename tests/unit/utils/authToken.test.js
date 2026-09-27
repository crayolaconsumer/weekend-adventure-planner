import { describe, it, expect, beforeEach } from 'vitest'
import { getAuthToken, authHeaders, TOKEN_STORAGE_KEY, SESSION_TOKEN_STORAGE_KEY } from '../../../src/utils/authToken'

describe('authToken', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('uses the keys AuthContext has always written', () => {
    expect(TOKEN_STORAGE_KEY).toBe('roam_auth_token')
    expect(SESSION_TOKEN_STORAGE_KEY).toBe('roam_auth_token_session')
  })

  it('returns null and no header when nothing is stored', () => {
    expect(getAuthToken()).toBe(null)
    expect(authHeaders()).toEqual({})
  })

  it('prefers localStorage over sessionStorage', () => {
    localStorage.setItem('roam_auth_token', 'A')
    sessionStorage.setItem('roam_auth_token_session', 'B')
    expect(getAuthToken()).toBe('A')
    expect(authHeaders()).toEqual({ Authorization: 'Bearer A' })
  })

  it('falls back to sessionStorage', () => {
    sessionStorage.setItem('roam_auth_token_session', 'B')
    expect(getAuthToken()).toBe('B')
    expect(authHeaders()).toEqual({ Authorization: 'Bearer B' })
  })

  it('reads storage on every call, not once at import', () => {
    expect(getAuthToken()).toBe(null)
    localStorage.setItem('roam_auth_token', 'late')
    expect(getAuthToken()).toBe('late')
  })
})
