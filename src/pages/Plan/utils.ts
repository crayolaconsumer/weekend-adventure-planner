/**
 * Auth token retrieval — matches the storage keys used everywhere else
 * in the app (localStorage primary, sessionStorage fallback).
 */
export function getAuthToken(): string | null {
  return localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
}
