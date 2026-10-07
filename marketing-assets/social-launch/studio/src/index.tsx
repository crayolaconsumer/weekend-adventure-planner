import React from 'react'
import { Composition, registerRoot } from 'remotion'
import { Reel, ReelProps, Scene } from './Reel'
import { Carousel, Profile, PROFILE_COVERS } from './Stills'
import reels from './reels.json'

type R = ReelProps & { id: string }

const Root: React.FC = () => (
  <>
    {(reels as R[]).map(r => (
      <Composition key={r.id} id={r.id} component={Reel} durationInFrames={r.total} fps={60} width={1080} height={1920} defaultProps={r} />
    ))}
    {(reels as R[]).map(r => {
      const hook = r.scenes[0] as Extract<Scene, { kind: 'hook' }>
      const places = r.scenes.filter(s => s.kind === 'place').map(s => (s as Extract<Scene, { kind: 'place' }>).place)
      return <Composition key={'c-' + r.id} id={'carousel-' + r.id} component={Carousel} durationInFrames={places.length + 2} fps={1} width={1080} height={1350}
        defaultProps={{ town: hook.lines[1], title: [hook.lines[0], hook.lines[2]] as [string, string], places }} />
    })}
    {/* End card alone, spliced onto the three shortened original reels */}
    <Composition id="cta-card" component={Reel} durationInFrames={84} fps={60} width={1080} height={1920} defaultProps={{ music: null, cuts: [0, 84], scenes: [{ kind: 'cta' }], total: 84 }} />
    <Composition id="profile" component={Profile} durationInFrames={PROFILE_COVERS.length + 1} fps={1} width={1080} height={1080} />
  </>
)
registerRoot(Root)
