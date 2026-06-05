/**
 * /partners — partner portal entry & onboarding.
 *
 * Three states, handled in one place so a cold visitor flows straight through:
 *   1. Logged out          -> value prop + sign in / create account
 *   2. Logged in, no org    -> create your organiser (partner) account
 *   3. Logged in, has org    -> welcome + go to dashboard
 */

import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { getPartnerAccount, savePartnerAccount } from '../../utils/partnersClient'
import './Partners.css'

export default function PartnersHome() {
  const { user, loading, login, register, logout } = useAuth()
  const navigate = useNavigate()

  const [partner, setPartner] = useState(undefined) // undefined = unknown, null = none
  const [checking, setChecking] = useState(false)

  const loadPartner = useCallback(async () => {
    if (!user) { setPartner(undefined); return }
    setChecking(true)
    try {
      const res = await getPartnerAccount()
      setPartner(res?.partner || null)
    } catch {
      setPartner(null)
    } finally {
      setChecking(false)
    }
  }, [user])

  useEffect(() => { loadPartner() }, [loadPartner])

  return (
    <div className="partners-shell">
      <header className="partners-hero">
        <div className="partners-hero-inner">
          <span className="partners-kicker">ROAM for Partners</span>
          <h1>Put your event in front of locals.</h1>
          <p>
            Promote your event to ROAM users near you. Pick a radius and dates,
            pay a single flat fee, and your event appears as a <strong>Featured</strong>
            {' '}listing in the “What’s On” feed — ranked above everything else nearby.
          </p>
        </div>
      </header>

      <main className="partners-main">
        {loading && <p className="partners-muted">Loading…</p>}

        {!loading && !user && <SignedOut login={login} register={register} />}

        {!loading && user && checking && <p className="partners-muted">Loading your account…</p>}

        {!loading && user && !checking && partner === null && (
          <CreateOrg
            defaultEmail={user.email}
            onCreated={(p) => { setPartner(p); navigate('/partners/dashboard') }}
          />
        )}

        {!loading && user && !checking && partner && (
          <section className="partners-card">
            <h2>Welcome back, {partner.org_name}</h2>
            <p className="partners-muted">Manage your events and create new promotions.</p>
            <div className="partners-actions">
              <button className="partners-btn primary" onClick={() => navigate('/partners/dashboard')}>
                Go to dashboard
              </button>
              <button className="partners-btn ghost" onClick={() => navigate('/partners/events/new')}>
                Create an event
              </button>
            </div>
            <button className="partners-link" onClick={logout}>Sign out</button>
          </section>
        )}
      </main>

      <footer className="partners-footer">
        <span>ROAM for Partners</span>
        <a href="/terms">Terms</a>
        <a href="/privacy">Privacy</a>
        <a href="/support">Support</a>
      </footer>
    </div>
  )
}

function SignedOut({ login, register }) {
  const [mode, setMode] = useState('login') // 'login' | 'register'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (mode === 'login') {
        await login(email.trim(), password, true)
      } else {
        await register(email.trim(), password, displayName.trim() || undefined)
      }
    } catch (err) {
      setError(err?.message || 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="partners-card">
      <div className="partners-tabs">
        <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Sign in</button>
        <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Create account</button>
      </div>
      <form onSubmit={submit} className="partners-form">
        {mode === 'register' && (
          <label>
            Your name
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" />
          </label>
        )}
        <label>
          Email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </label>
        <label>
          Password
          <input type="password" required minLength={8} value={password}
            onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
        </label>
        {error && <p className="partners-error">{error}</p>}
        <button className="partners-btn primary" disabled={busy} type="submit">
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
      </form>
      <p className="partners-muted small">
        Your ROAM account works here too — sign in with the same details.
      </p>
    </section>
  )
}

function CreateOrg({ defaultEmail, onCreated }) {
  const [orgName, setOrgName] = useState('')
  const [contactEmail, setContactEmail] = useState(defaultEmail || '')
  const [contactPhone, setContactPhone] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const res = await savePartnerAccount({
        org_name: orgName.trim(),
        contact_email: contactEmail.trim(),
        contact_phone: contactPhone.trim() || undefined,
        website_url: websiteUrl.trim() || undefined
      })
      onCreated(res.partner)
    } catch (err) {
      setError(err?.message || 'Could not save your account')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="partners-card">
      <h2>Set up your organiser account</h2>
      <p className="partners-muted">Tell us who’s running the events. You can change this later.</p>
      <form onSubmit={submit} className="partners-form">
        <label>
          Organisation / venue name *
          <input required value={orgName} onChange={(e) => setOrgName(e.target.value)} maxLength={160} />
        </label>
        <label>
          Contact email *
          <input type="email" required value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
        </label>
        <label>
          Phone (optional)
          <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} maxLength={50} />
        </label>
        <label>
          Website (optional)
          <input type="url" placeholder="https://…" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} />
        </label>
        {error && <p className="partners-error">{error}</p>}
        <button className="partners-btn primary" disabled={busy} type="submit">
          {busy ? 'Saving…' : 'Create account'}
        </button>
      </form>
    </section>
  )
}
