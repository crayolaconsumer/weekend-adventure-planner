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
import { CompassMark, ReachIcon, MegaphoneIcon, StarIcon } from './icons'
import './Partners.css'

export default function PartnersHome() {
  const { user, loading, logout } = useAuth()
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
          <div className="partners-brand">
            <CompassMark size={36} />
            <span className="partners-wordmark">ROAM <em>for Partners</em></span>
          </div>
          <h1>Put your event in front of locals.</h1>
          <p>
            Promote your event to ROAM users near you. Pick a radius and dates,
            pay a single flat fee, and your event appears as a <strong>Featured</strong>
            {' '}listing in the “What’s On” feed — ranked above everything else nearby.
          </p>
          <ul className="partners-points">
            <li><span className="partners-point-ic"><ReachIcon level={3} size={22} /></span> Reach people within your chosen radius</li>
            <li><span className="partners-point-ic"><StarIcon size={18} /></span> Featured placement, above the listings</li>
            <li><span className="partners-point-ic"><MegaphoneIcon size={18} /></span> One flat fee — no commission on tickets</li>
          </ul>
        </div>
      </header>

      <main className="partners-main">
        {(loading || (user && checking)) && (
          <section className="partners-card" aria-hidden="true">
            <div className="partners-skel partners-skel-title" />
            <div className="partners-skel partners-skel-line" style={{ width: '80%' }} />
            <div className="partners-skel partners-skel-line" style={{ width: '55%' }} />
          </section>
        )}

        {!loading && !user && <SignedOut />}

        {!loading && user && !checking && partner === null && (
          <CreateOrg
            defaultEmail={user.email}
            onCreated={(p) => { setPartner(p); navigate('/partners/dashboard') }}
            onSignOut={logout}
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

      <section className="partners-section">
        <h2 className="partners-section-title">How it works</h2>
        <div className="partners-steps">
          <div className="partners-step">
            <span className="partners-step-num">1</span>
            <h3>Create your event</h3>
            <p>Add the details and an image — with a live preview of exactly how your card will look.</p>
          </div>
          <div className="partners-step">
            <span className="partners-step-num">2</span>
            <h3>Choose your reach</h3>
            <p>Pick how far to broadcast and for how long. One flat fee, shown upfront — no commission.</p>
          </div>
          <div className="partners-step">
            <span className="partners-step-num">3</span>
            <h3>Go live to locals</h3>
            <p>It appears as a Featured listing in “What’s On”, ranked above everything else nearby.</p>
          </div>
        </div>
      </section>

      <section className="partners-section">
        <h2 className="partners-section-title">Simple, flat pricing</h2>
        <div className="partners-pricing">
          <div className="partners-price-card"><span className="tier">Local</span><span className="from">£1.50<small>/day</small></span><span className="rad">up to 10km</span></div>
          <div className="partners-price-card"><span className="tier">Town</span><span className="from">£2.50<small>/day</small></span><span className="rad">up to 25km</span></div>
          <div className="partners-price-card"><span className="tier">City</span><span className="from">£4.00<small>/day</small></span><span className="rad">up to 50km</span></div>
          <div className="partners-price-card"><span className="tier">Region</span><span className="from">£6.00<small>/day</small></span><span className="rad">up to 100km</span></div>
        </div>
        <p className="partners-pricing-note">From £10. One-off payment — no subscription, no commission on ticket sales.</p>
      </section>

      <footer className="partners-footer">
        <span>ROAM for Partners</span>
        <a href="/terms">Terms</a>
        <a href="/privacy">Privacy</a>
        <a href="/support">Support</a>
      </footer>
    </div>
  )
}

function SignedOut() {
  // Reuse the app-wide AuthModal (email + Google + Apple) via its global event,
  // so the portal supports every sign-in method without duplicating the SDKs.
  const openAuth = (mode) => window.dispatchEvent(new CustomEvent('openAuthModal', { detail: { mode } }))

  return (
    <section className="partners-card">
      <h2>Sign in to get started</h2>
      <p className="partners-muted">
        Use your ROAM account — email, Google or Apple. New here? Create one in a few seconds.
      </p>
      <div className="partners-actions">
        <button className="partners-btn primary" onClick={() => openAuth('login')}>Sign in</button>
        <button className="partners-btn ghost" onClick={() => openAuth('register')}>Create account</button>
      </div>
    </section>
  )
}

function CreateOrg({ defaultEmail, onCreated, onSignOut }) {
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
      <p className="partners-muted">
        Signed in as <strong>{defaultEmail}</strong>. Tell us who’s running the events — you can change this later.
        {onSignOut && <> · <button type="button" className="partners-link" onClick={onSignOut}>Not you? Sign out</button></>}
      </p>
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
        {error && <p className="partners-error" role="alert">{error}</p>}
        <button className="partners-btn primary" disabled={busy} type="submit">
          {busy ? 'Saving…' : 'Create account'}
        </button>
      </form>
    </section>
  )
}
