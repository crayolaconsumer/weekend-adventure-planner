import React from 'react'
import {
  AbsoluteFill, Audio, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, Easing
} from 'remotion'
import { loadFont as loadSerif } from '@remotion/google-fonts/Newsreader'
import { loadFont as loadSans } from '@remotion/google-fonts/Outfit'

const serif = loadSerif('normal', { weights: ['500', '600'], subsets: ['latin'] }).fontFamily
loadSerif('italic', { weights: ['400', '500'], subsets: ['latin'] })
const sans = loadSans('normal', { weights: ['500', '600', '700'], subsets: ['latin'] }).fontFamily

export const C = { forest: '#1a3a2f', forestDark: '#142d24', terra: '#c45c3e', terraLight: '#e07a5f', gold: '#d4a855', goldLight: '#e8c677', cream: '#faf8f5' }

export type Place = { name: string; tag: string; description: string; credit: string; img: string; w: number; h: number; line?: string; pos?: string }
export type Scene =
  | { kind: 'hook'; place: Place; lines: string[] }
  | { kind: 'place'; place: Place; index: number; of: number; label?: string; continued?: boolean }
  | { kind: 'phone'; page: string; title: string; sub: string }
  | { kind: 'payoff'; town: string; word: string }
  | { kind: 'cta'; line?: [string, string] }
  | { kind: 'screen'; img: string; prev?: string; tap?: { x: number; y: number }; lines: [string, string]; big?: boolean }
export type ReelProps = { music: { file: string; start: number; volume: number } | null; cuts: number[]; scenes: Scene[]; total: number }

const settle = (frame: number, fps: number, delay = 0, damping = 200) =>
  spring({ frame: frame - delay, fps, config: { damping, stiffness: 180, mass: 0.6 } })

// Every cut lands on a beat; each scene enters with a punch-in (even) or a whip (odd)
const Entrance: React.FC<{ i: number; children: React.ReactNode }> = ({ i, children }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  if (i === 0) return <AbsoluteFill>{children}</AbsoluteFill> // frame 0 is already the hook: no fade from nothing
  const p = settle(frame, fps)
  const blur = interpolate(frame, [0, 4], [8, 0], { extrapolateRight: 'clamp' })
  const transform = i % 2
    ? `translateX(${interpolate(p, [0, 1], [70, 0])}%)`
    : `scale(${interpolate(p, [0, 1], [1.1, 1])})`
  return <AbsoluteFill style={{ transform, filter: blur > 0.3 ? `blur(${blur}px)` : undefined }}>{children}</AbsoluteFill>
}

// Sharp photo in the top 1260px (a gentle crop for landscape shots), feathering into a blurred,
// darkened copy of itself that fills the caption zone below
const Photo: React.FC<{ place: Place; dur: number; zoom?: [number, number] }> = ({ place, dur, zoom: range = [1.04, 1.12] }) => {
  const frame = useCurrentFrame()
  const zoom = interpolate(frame, [0, dur], range)
  const src = staticFile(place.img)
  const fade = 'linear-gradient(to bottom, #000 72%, transparent 100%)'
  return (
    <AbsoluteFill style={{ overflow: 'hidden', background: C.forestDark }}>
      <Img src={src} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(36px) brightness(0.6) saturate(1.3)', transform: 'scale(1.25)' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 1260, overflow: 'hidden', WebkitMaskImage: fade, maskImage: fade }}>
        <Img src={src} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: place.pos ?? '50% 50%', transform: `scale(${zoom})` }} />
      </div>
    </AbsoluteFill>
  )
}

const Shade: React.FC = () => (
  <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(20,45,36,.35) 0%, rgba(20,45,36,0) 22%, rgba(20,45,36,0) 40%, rgba(20,45,36,.82) 56%, rgba(20,45,36,.55) 75%, rgba(20,45,36,.35) 100%)' }} />
)

const Words: React.FC<{ text: string; delay: number; style: React.CSSProperties; step?: number }> = ({ text, delay, style, step = 2 }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  return (
    <div style={style}>
      {text.split(' ').map((w, i) => {
        const p = settle(frame, fps, delay + i * step)
        return <span key={i} style={{ display: 'inline-block', marginRight: '0.24em', opacity: p, transform: `translateY(${(1 - p) * 40}px)` }}>{w}</span>
      })}
    </div>
  )
}

const Chip: React.FC<{ text: string; delay: number; bg?: string }> = ({ text, delay, bg = C.terra }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const p = spring({ frame: frame - delay, fps, config: { damping: 12, stiffness: 160 } })
  return <div style={{ display: 'inline-block', background: bg, color: C.cream, fontFamily: sans, fontWeight: 700, fontSize: 30, letterSpacing: 2, textTransform: 'uppercase', padding: '8px 18px', borderRadius: 10, transform: `scale(${p})`, transformOrigin: 'left center' }}>{text}</div>
}

const Credit: React.FC<{ text: string }> = ({ text }) => (
  <div style={{ position: 'absolute', right: 165, top: 276, fontFamily: sans, fontSize: 20, color: 'rgba(250,248,245,.92)', textShadow: '0 1px 3px rgba(0,0,0,.95), 0 0 10px rgba(0,0,0,.7)', maxWidth: 520, textAlign: 'right' }}>Photo: {text}</div>
)

const HookScene: React.FC<{ s: Extract<Scene, { kind: 'hook' }>; dur: number }> = ({ s, dur }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const pop = spring({ frame, fps, config: { damping: 200 }, from: 1.08, to: 1 })
  const [a, b, c] = s.lines
  return (
    <AbsoluteFill>
      <Photo place={s.place} dur={dur} zoom={[1, 1.06]} />
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 50% 45%, rgba(20,45,36,.0), rgba(20,45,36,.38) 85%)' }} />
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: '0 150px 0 65px', transform: `scale(${pop})`, marginTop: -280 }}>
        <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 66, color: C.cream, lineHeight: 1.1, textShadow: '0 2px 18px rgba(0,0,0,.75), 0 0 4px rgba(0,0,0,.5)' }}>{a}</div>
        <div style={{ fontFamily: serif, fontWeight: 600, fontSize: Math.min(190, 1350 / b.length), color: C.cream, lineHeight: 0.95, margin: '14px 0 18px', textShadow: '0 2px 14px rgba(0,0,0,.7), 0 0 50px rgba(0,0,0,.5)' }}>{b}</div>
        {c && <div style={{ display: 'inline-block', background: C.terra, color: C.cream, fontFamily: serif, fontStyle: 'italic', fontWeight: 500, fontSize: 62, padding: '2px 26px 8px', borderRadius: 14 }}>{c}</div>}
      </AbsoluteFill>
      <Credit text={s.place.credit} />
    </AbsoluteFill>
  )
}

const PlaceScene: React.FC<{ s: Extract<Scene, { kind: 'place' }>; dur: number }> = ({ s, dur }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const num = settle(frame, fps, 2)
  const nameSize = s.place.name.length > 22 ? 96 : s.place.name.length > 14 ? 116 : 138
  return (
    <AbsoluteFill>
      <Photo place={s.place} dur={dur} zoom={s.continued ? [1.06, 1.12] : undefined} />
      <Shade />
      <div style={{ position: 'absolute', left: 75, top: 290, fontFamily: serif, fontStyle: 'italic', fontSize: 150, color: C.cream, opacity: num, transform: `translateY(${(1 - num) * -30}px)`, textShadow: '0 2px 10px rgba(0,0,0,.85), 0 0 30px rgba(0,0,0,.5)' }}>
        {s.index}<span style={{ fontSize: 60, color: C.cream, opacity: 0.85 }}>/{s.of}</span>
      </div>
      <div style={{ position: 'absolute', left: 75, right: 150, bottom: 715 }}>
        <Chip text={s.label ?? s.place.tag} delay={1} />
        <Words text={s.place.name} delay={3} step={2} style={{ fontFamily: serif, fontWeight: 600, fontSize: nameSize, lineHeight: 0.98, color: C.cream, marginTop: 14 }} />
        {s.place.line && <Words text={s.place.line} delay={10} step={1} style={{ fontFamily: serif, fontStyle: 'italic', fontSize: 44, lineHeight: 1.2, color: C.goldLight, marginTop: 14 }} />}
      </div>
      <Credit text={s.place.credit} />
    </AbsoluteFill>
  )
}

const PhoneScene: React.FC<{ s: Extract<Scene, { kind: 'phone' }>; dur: number }> = ({ s, dur }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const tilt = settle(frame, fps, 0)
  const scroll = interpolate(frame, [6, dur - 4], [0, 1900], { easing: Easing.inOut(Easing.cubic), extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const W = 760, H = 1560
  return (
    <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 40%, ${C.forest} 0%, ${C.forestDark} 80%)`, perspective: 1800 }}>
      <AbsoluteFill style={{ alignItems: 'center', paddingTop: 290 }}>
        <Words text={s.title} delay={0} step={2} style={{ fontFamily: serif, fontWeight: 500, fontSize: 84, color: C.cream, textAlign: 'center', lineHeight: 1 }} />
        <Words text={s.sub} delay={6} step={2} style={{ fontFamily: serif, fontStyle: 'italic', fontSize: 72, color: C.gold, textAlign: 'center', marginTop: 6 }} />
      </AbsoluteFill>
      <div style={{
        position: 'absolute', left: (1080 - W) / 2, top: 480, width: W, height: H, borderRadius: 86, background: '#0b0b0b', padding: 16,
        transform: `rotateY(${interpolate(tilt, [0, 1], [-24, -8])}deg) rotateX(${interpolate(tilt, [0, 1], [14, 6])}deg) translateY(${interpolate(tilt, [0, 1], [380, 0])}px)`,
        boxShadow: '0 60px 120px rgba(0,0,0,.55)'
      }}>
        <div style={{ width: '100%', height: '100%', borderRadius: 72, overflow: 'hidden', background: C.cream, position: 'relative' }}>
          <Img src={staticFile(s.page)} style={{ width: '100%', transform: `translateY(${-scroll}px)` }} />
          <div style={{ position: 'absolute', top: 18, left: '50%', marginLeft: -95, width: 190, height: 52, borderRadius: 30, background: '#0b0b0b' }} />
        </div>
      </div>
    </AbsoluteFill>
  )
}

// Real app screenshot in a near-straight phone; new screen rises in over the previous one; tap ripple before the cut
const ScreenScene: React.FC<{ s: Extract<Scene, { kind: 'screen' }>; dur: number }> = ({ s, dur }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const W = 820, PAD = 16, SCALE = (W - 2 * PAD) / 390, TOP = 560, BAR = 44 // status bar: web screenshots have none, so content starts below the notch
  const rise = s.prev ? settle(frame, fps) : 1
  const enter = s.prev ? 1 : settle(frame + 12, fps)
  const zoom = s.prev ? interpolate(frame, [4, dur], [1, 1.16], { easing: Easing.inOut(Easing.cubic), extrapolateLeft: 'clamp' }) : 1
  const tapAt = dur - 16
  const t = interpolate(frame, [tapAt, tapAt + 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const press = s.tap ? interpolate(frame, [tapAt, tapAt + 5, tapAt + 12], [1, 0.94, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : 1
  return (
    <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 30%, ${C.forest} 0%, ${C.forestDark} 85%)` }}>
      <AbsoluteFill style={{ alignItems: 'center', paddingTop: 280, textAlign: 'center' }}>
        <Words text={s.lines[0]} delay={s.big ? -10 : 0} step={2} style={{ fontFamily: s.big ? sans : serif, fontWeight: s.big ? 600 : 500, fontSize: s.big ? 76 : 84, color: s.big ? C.goldLight : C.cream, lineHeight: 1.05 }} />
        <Words text={s.lines[1]} delay={s.big ? -6 : 5} step={2} style={{ fontFamily: serif, fontStyle: 'italic', fontWeight: 500, fontSize: s.big ? 150 : 84, color: s.big ? C.cream : C.gold, lineHeight: 1.05 }} />
      </AbsoluteFill>
      <div style={{ position: 'absolute', left: (1080 - W) / 2, top: TOP, width: W, height: 1900, borderRadius: 96, background: '#0b0b0b', padding: PAD,
        transform: `translateY(${(1 - enter) * 500}px) rotate(${(1 - enter) * 4}deg) scale(${press * zoom})`, transformOrigin: '50% 22%', boxShadow: '0 60px 120px rgba(0,0,0,.55)' }}>
        <div style={{ width: '100%', height: '100%', borderRadius: 82, overflow: 'hidden', position: 'relative', background: C.cream }}>
          {s.prev && <Img src={staticFile(s.prev)} style={{ position: 'absolute', top: BAR * SCALE, width: '100%' }} />}
          <Img src={staticFile(s.img)} style={{ position: 'absolute', top: BAR * SCALE, width: '100%', opacity: rise, transform: `translateY(${(1 - rise) * 120}px)` }} />
          <div style={{ position: 'absolute', top: 16, left: '50%', marginLeft: -100, width: 200, height: 56, borderRadius: 30, background: '#0b0b0b' }} />
          {s.tap && t > 0 && t < 1 && (
            <div style={{ position: 'absolute', left: s.tap.x * SCALE - 70, top: (s.tap.y + BAR) * SCALE - 70, width: 140, height: 140, borderRadius: 70,
              background: 'rgba(255,255,255,.55)', border: '4px solid rgba(255,255,255,.9)', transform: `scale(${0.4 + t})`, opacity: 1 - t * 0.9 }} />
          )}
        </div>
      </div>
    </AbsoluteFill>
  )
}

const PayoffScene: React.FC<{ s: Extract<Scene, { kind: 'payoff' }> }> = ({ s }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const p = spring({ frame: frame - 5, fps, config: { damping: 12, stiffness: 140 } })
  return (
    <AbsoluteFill style={{ background: C.forest, justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
      <Words text={`${s.town},`} delay={-4} style={{ fontFamily: serif, fontWeight: 500, fontSize: 150, color: C.cream, lineHeight: 1 }} />
      <div style={{ fontFamily: serif, fontStyle: 'italic', fontWeight: 500, fontSize: 190, color: C.terraLight, transform: `scale(${p}) rotate(${(1 - p) * -6}deg)`, lineHeight: 1.05 }}>{s.word}</div>
    </AbsoluteFill>
  )
}

const CtaScene: React.FC<{ line?: [string, string] }> = ({ line }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const logo = spring({ frame: frame + 8, fps, config: { damping: 12, stiffness: 150 } })
  const t = settle(frame, fps, 5)
  const pill = spring({ frame: frame - 9, fps, config: { damping: 12, stiffness: 150 } })
  return (
    <AbsoluteFill style={{ background: C.cream, alignItems: 'center', paddingTop: line ? 330 : 470 }}>
      {line && <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <Words text={line[0]} delay={-6} style={{ fontFamily: serif, fontWeight: 500, fontSize: 110, color: C.forest, lineHeight: 1 }} />
        <div style={{ fontFamily: serif, fontStyle: 'italic', fontWeight: 500, fontSize: 130, color: C.terra, lineHeight: 1.05, transform: `scale(${logo})` }}>{line[1]}</div>
      </div>}
      <Img src={staticFile('icon.svg')} style={{ width: line ? 150 : 230, height: line ? 150 : 230, transform: `scale(${logo}) rotate(${(1 - logo) * -90}deg)` }} />
      <div style={{ fontFamily: serif, fontWeight: 600, fontSize: line ? 96 : 150, color: C.forest, letterSpacing: 4, marginTop: line ? 8 : 20, opacity: t, transform: `translateY(${(1 - t) * 30}px)` }}>ROAM</div>
      <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 46, color: C.forest, marginTop: 6, opacity: t }}>Free on iPhone & Android</div>
      <div style={{ marginTop: 40, background: C.terra, color: C.cream, fontFamily: sans, fontWeight: 600, fontSize: 52, padding: '18px 48px', borderRadius: 60, transform: `scale(${pill})` }}>go-roam.uk</div>
    </AbsoluteFill>
  )
}

export const Reel: React.FC<ReelProps> = ({ music, cuts, scenes }) => (
  <AbsoluteFill style={{ background: C.forest }}>
    {scenes.map((s, i) => {
      const dur = cuts[i + 1] - cuts[i]
      return (
        <Sequence key={i} from={cuts[i]} durationInFrames={dur}>
          <Entrance i={(s.kind === 'screen' && scenes[i - 1]?.kind === 'screen') || (s.kind === 'place' && s.continued) ? 0 : i}>
            {s.kind === 'hook' && <HookScene s={s} dur={dur} />}
            {s.kind === 'place' && <PlaceScene s={s} dur={dur} />}
            {s.kind === 'phone' && <PhoneScene s={s} dur={dur} />}
            {s.kind === 'payoff' && <PayoffScene s={s} />}
            {s.kind === 'cta' && <CtaScene line={s.line} />}
            {s.kind === 'screen' && <ScreenScene s={s} dur={dur} />}
          </Entrance>
        </Sequence>
      )
    })}
    {music && (
      <Audio src={staticFile(music.file)} startFrom={Math.round(music.start * 60)}
        volume={f => music.volume * interpolate(f, [cuts.at(-1)! - 30, cuts.at(-1)!], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })} />
    )}
  </AbsoluteFill>
)
