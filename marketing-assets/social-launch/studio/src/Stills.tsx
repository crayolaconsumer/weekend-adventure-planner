import React from 'react'
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from 'remotion'
import { C, Place } from './Reel'
import { loadFont as loadSerif } from '@remotion/google-fonts/Newsreader'
import { loadFont as loadSans } from '@remotion/google-fonts/Outfit'

const serif = loadSerif('normal', { weights: ['500', '600'], subsets: ['latin'] }).fontFamily
const sans = loadSans('normal', { weights: ['500', '600', '700'], subsets: ['latin'] }).fontFamily

export type CarouselProps = { town: string; title: [string, string]; places: Place[] }

const Credit: React.FC<{ t: string }> = ({ t }) => (
  <div style={{ position: 'absolute', right: 36, bottom: 28, fontFamily: sans, fontSize: 18, color: 'rgba(250,248,245,.6)' }}>Photo: {t}</div>
)
const Brand: React.FC<{ dark?: boolean }> = ({ dark }) => (
  <div style={{ position: 'absolute', left: 56, top: 52, display: 'flex', alignItems: 'center', gap: 14 }}>
    <Img src={staticFile('icon.svg')} style={{ width: 56, height: 56 }} />
    <span style={{ fontFamily: serif, fontWeight: 600, fontSize: 40, letterSpacing: 2, color: dark ? C.forest : C.cream }}>ROAM</span>
  </div>
)

// One frame per slide: cover, one per place, closing CTA
export const Carousel: React.FC<CarouselProps> = ({ town, title, places }) => {
  const f = useCurrentFrame()
  if (f === 0) {
    const p = places[0]
    return (
      <AbsoluteFill style={{ background: C.forest }}>
        <Img src={staticFile(p.img)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(20,45,36,.5), rgba(20,45,36,.35) 35%, rgba(20,45,36,.92) 75%)' }} />
        <Brand />
        <div style={{ position: 'absolute', left: 64, right: 64, bottom: 120 }}>
          <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 52, color: C.goldLight }}>{title[0]}</div>
          <div style={{ fontFamily: serif, fontWeight: 600, fontSize: Math.min(190, 1400 / town.length), color: C.cream, lineHeight: 1 }}>{town}</div>
          <div style={{ display: 'inline-block', marginTop: 18, background: C.terra, color: C.cream, fontFamily: serif, fontStyle: 'italic', fontSize: 56, padding: '0 24px 8px', borderRadius: 14 }}>{title[1]}</div>
          <div style={{ fontFamily: sans, fontWeight: 500, fontSize: 32, color: 'rgba(250,248,245,.8)', marginTop: 28 }}>Swipe →</div>
        </div>
        <Credit t={p.credit} />
      </AbsoluteFill>
    )
  }
  if (f <= places.length) {
    const p = places[f - 1]
    return (
      <AbsoluteFill style={{ background: C.cream }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 860, overflow: 'hidden' }}>
          <Img src={staticFile(p.img)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <Credit t={p.credit} />
        </div>
        <div style={{ position: 'absolute', left: 64, top: 790, width: 140, height: 140, borderRadius: 70, background: C.forest, color: C.gold, fontFamily: serif, fontStyle: 'italic', fontSize: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `6px solid ${C.cream}` }}>{f}</div>
        <div style={{ position: 'absolute', left: 64, right: 64, top: 960 }}>
          <div style={{ display: 'inline-block', background: C.terra, color: C.cream, fontFamily: sans, fontWeight: 700, fontSize: 26, letterSpacing: 2, textTransform: 'uppercase', padding: '6px 16px', borderRadius: 8 }}>{p.tag}</div>
          <div style={{ fontFamily: serif, fontWeight: 600, fontSize: p.name.length > 24 ? 72 : 92, color: C.forest, lineHeight: 1, marginTop: 16 }}>{p.name}</div>
          {p.line && <div style={{ fontFamily: serif, fontStyle: 'italic', fontSize: 46, color: C.terra, marginTop: 14 }}>{p.line}</div>}
        </div>
      </AbsoluteFill>
    )
  }
  return (
    <AbsoluteFill style={{ background: C.forest, alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 80 }}>
      <Img src={staticFile('icon.svg')} style={{ width: 200, height: 200 }} />
      <div style={{ fontFamily: serif, fontWeight: 500, fontSize: 84, color: C.cream, marginTop: 40, lineHeight: 1.05 }}>Plus loads more in {town.replace('?', '')},</div>
      <div style={{ fontFamily: serif, fontStyle: 'italic', fontSize: 84, color: C.gold }}>in one app.</div>
      <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 40, color: C.cream, marginTop: 48 }}>ROAM · Free on iPhone & Android</div>
      <div style={{ marginTop: 28, background: C.terra, color: C.cream, fontFamily: sans, fontWeight: 600, fontSize: 44, padding: '14px 40px', borderRadius: 50 }}>Link in bio</div>
      <div style={{ fontFamily: sans, fontSize: 32, color: 'rgba(250,248,245,.7)', marginTop: 40 }}>Save this for the weekend ↓</div>
    </AbsoluteFill>
  )
}

// Frame 0: profile picture. 1+: highlight covers
export const PROFILE_COVERS = ['Towns', 'Rainy days', 'Hidden gems', 'How it works']
export const Profile: React.FC = () => {
  const f = useCurrentFrame()
  if (f === 0) return (
    <AbsoluteFill style={{ background: C.forest, alignItems: 'center', justifyContent: 'center' }}>
      <Img src={staticFile('icon.svg')} style={{ width: 860, height: 860 }} />
    </AbsoluteFill>
  )
  const glyph = ['⌂', '☂', '✦', '➜'][f - 1]
  return (
    <AbsoluteFill style={{ background: C.forest, alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 760, height: 760, borderRadius: 380, border: `10px solid ${C.gold}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 300, color: C.cream, lineHeight: 1 }}>{glyph}</div>
        <div style={{ fontFamily: serif, fontStyle: 'italic', fontSize: 92, color: C.gold, marginTop: 10 }}>{PROFILE_COVERS[f - 1]}</div>
      </div>
    </AbsoluteFill>
  )
}
