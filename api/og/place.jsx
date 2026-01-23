/* eslint-disable react-refresh/only-export-components */
/**
 * GET /api/og/place?id=xxx
 *
 * Generate dynamic OG image for shared places
 * Uses @vercel/og for image generation
 */

import { ImageResponse } from '@vercel/og'

export const config = {
  runtime: 'edge'
}

export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    const name = searchParams.get('name') || 'Discover this place'
    const category = searchParams.get('category') || 'place'
    const distance = searchParams.get('distance')

    if (!id) {
      return new ImageResponse(
        <DefaultImage />,
        { width: 1200, height: 630 }
      )
    }

    // Category emoji mapping
    const categoryEmoji = {
      food: '🍜',
      nature: '🌲',
      culture: '🏛️',
      historic: '🏰',
      entertainment: '🎭',
      nightlife: '🍸',
      active: '🏃',
      unique: '✨',
      shopping: '🛍️'
    }[category] || '📍'

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
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '60px' }}>
          <span style={{ fontSize: '48px', fontWeight: 800, color: '#d4a855', letterSpacing: '-2px' }}>
            ROAM
          </span>
          <span style={{ fontSize: '24px', color: '#fff', opacity: 0.6, marginLeft: '20px' }}>
            Discovery
          </span>
        </div>

        {/* Main Content */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '30px' }}>
            <span style={{ fontSize: '100px' }}>{categoryEmoji}</span>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span
                style={{
                  fontSize: '64px',
                  fontWeight: 700,
                  color: '#fff',
                  lineHeight: 1.1,
                  maxWidth: '800px'
                }}
              >
                {decodeURIComponent(name)}
              </span>

              <div style={{ display: 'flex', gap: '24px', marginTop: '30px' }}>
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
                  <span style={{ fontSize: '20px', color: '#d4a855', fontWeight: 600, textTransform: 'capitalize' }}>
                    {category}
                  </span>
                </div>
                {distance && (
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
                    <span style={{ fontSize: '20px' }}>📍</span>
                    <span style={{ fontSize: '20px', color: '#fff', fontWeight: 600 }}>
                      {distance}
                    </span>
                  </div>
                )}
              </div>
            </div>
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
          <span style={{ fontSize: '24px', color: 'rgba(255,255,255,0.7)' }}>
            Stop scrolling. Start roaming.
          </span>
          <span style={{ fontSize: '24px', color: '#d4a855', fontWeight: 600 }}>
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
      <DefaultImage />,
      { width: 1200, height: 630 }
    )
  }
}

function DefaultImage() {
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
      <span style={{ fontSize: '20px', color: 'rgba(255,255,255,0.5)', marginTop: '30px' }}>
        Discover amazing places near you
      </span>
    </div>
  )
}
