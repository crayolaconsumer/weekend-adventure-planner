/* eslint-disable react-refresh/only-export-components */
/**
 * GET /api/og/plan?code=xxx
 *
 * Generate dynamic OG image for shared plans
 * Uses @vercel/og for image generation
 */

import { ImageResponse } from '@vercel/og'

export const config = {
  runtime: 'edge'
}

export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url)
    const code = searchParams.get('code')

    if (!code) {
      return new ImageResponse(
        <DefaultImage message="Invalid share code" />,
        { width: 1200, height: 630 }
      )
    }

    // Fetch plan data
    let plan = null
    let stops = []

    try {
      // Note: Edge functions use different DB approach - this is a simplified version
      // In production, you'd use a database client compatible with edge functions
      const response = await fetch(`${getBaseUrl(req)}/api/plans/share/${code}`)
      if (response.ok) {
        const data = await response.json()
        plan = data.plan
        stops = data.plan?.stops || []
      }
    } catch {
      // Silently fall back to default image
    }

    if (!plan) {
      return new ImageResponse(
        <DefaultImage message="Plan not found" />,
        { width: 1200, height: 630 }
      )
    }

    const vibeEmoji = {
      mixed: '🎲',
      foodie: '🍜',
      culture: '🏛️',
      nature: '🌲'
    }[plan.vibe] || '📍'

    const stopNames = stops.slice(0, 3).map(s => s.placeData?.name || 'Stop')

    return new ImageResponse(
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(135deg, #1a2f23 0%, #2d4a3e 50%, #3d5c4a 100%)',
          padding: '60px',
          fontFamily: 'system-ui, sans-serif'
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '40px' }}>
          <span style={{ fontSize: '48px', fontWeight: 800, color: '#d4a855', letterSpacing: '-2px' }}>
            ROAM
          </span>
          <span style={{ fontSize: '24px', color: '#fff', opacity: 0.6, marginLeft: '20px' }}>
            Adventure Plan
          </span>
        </div>

        {/* Main Content */}
        <div style={{ display: 'flex', flex: 1, gap: '60px' }}>
          {/* Left side - Plan info */}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '20px' }}>
              <span style={{ fontSize: '64px', marginRight: '20px' }}>{vibeEmoji}</span>
              <span
                style={{
                  fontSize: '56px',
                  fontWeight: 700,
                  color: '#fff',
                  lineHeight: 1.1,
                  maxWidth: '500px'
                }}
              >
                {plan.title}
              </span>
            </div>

            <div style={{ display: 'flex', gap: '24px', marginTop: '20px' }}>
              <div
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  borderRadius: '12px',
                  padding: '16px 24px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <span style={{ fontSize: '24px' }}>📍</span>
                <span style={{ fontSize: '24px', color: '#fff', fontWeight: 600 }}>
                  {stops.length} stops
                </span>
              </div>
              <div
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  borderRadius: '12px',
                  padding: '16px 24px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <span style={{ fontSize: '24px' }}>⏱️</span>
                <span style={{ fontSize: '24px', color: '#fff', fontWeight: 600 }}>
                  {plan.durationHours}h
                </span>
              </div>
            </div>
          </div>

          {/* Right side - Stop preview */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              width: '400px'
            }}
          >
            {stopNames.map((name, i) => (
              <div
                key={i}
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  borderRadius: '16px',
                  padding: '20px 24px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px'
                }}
              >
                <span
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    background: '#d4a855',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '16px',
                    fontWeight: 700,
                    color: '#1a2f23'
                  }}
                >
                  {i + 1}
                </span>
                <span
                  style={{
                    fontSize: '20px',
                    color: '#fff',
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {name}
                </span>
              </div>
            ))}
            {stops.length > 3 && (
              <span style={{ fontSize: '18px', color: 'rgba(255,255,255,0.5)', marginLeft: '50px' }}>
                +{stops.length - 3} more stops
              </span>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: '40px',
            paddingTop: '30px',
            borderTop: '1px solid rgba(255,255,255,0.1)'
          }}
        >
          <span style={{ fontSize: '20px', color: 'rgba(255,255,255,0.5)' }}>
            Created by @{plan.user?.username || 'explorer'}
          </span>
          <span style={{ fontSize: '20px', color: '#d4a855', fontWeight: 600 }}>
            go-roam.uk
          </span>
        </div>
      </div>,
      {
        width: 1200,
        height: 630
      }
    )
  } catch (error) {
    console.error('OG image error:', error)
    return new ImageResponse(
      <DefaultImage message="Error generating preview" />,
      { width: 1200, height: 630 }
    )
  }
}

function DefaultImage({ message }) {
  return (
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #1a2f23 0%, #2d4a3e 100%)',
        fontFamily: 'system-ui, sans-serif'
      }}
    >
      <span style={{ fontSize: '72px', fontWeight: 800, color: '#d4a855', letterSpacing: '-3px' }}>
        ROAM
      </span>
      <span style={{ fontSize: '32px', color: '#fff', marginTop: '20px' }}>
        Stop scrolling. Start roaming.
      </span>
      {message && (
        <span style={{ fontSize: '20px', color: 'rgba(255,255,255,0.5)', marginTop: '30px' }}>
          {message}
        </span>
      )}
    </div>
  )
}

function getBaseUrl(req) {
  const host = req.headers.get('host')
  const protocol = host?.includes('localhost') ? 'http' : 'https'
  return `${protocol}://${host}`
}
