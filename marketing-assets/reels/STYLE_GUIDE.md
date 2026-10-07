# ROAM reel style guide (from research, 2026-09-27)
James's verdict on v1-v3: "awful, uncaptivating, completely skippable. It needs to be sleek, eye catching, SOTA. Sequences can be sped up, ease in and out, transitions."

Rules: value visible by 2s; hook on screen at frame 0 (never fade from black/logo); 5-10 words/sec captions; cut every 1-2s, never hold a static frame >1.5s; sound added by James when posting (cut on a ~120bpm grid: beats every 0.5s).
Safe zone (Meta 2026 unified): inset top 270px, bottom 380-670px, sides 65px on 1080x1920.
Native > over-polished: premium motion layer WRAPS real phone footage.

Hooks: 1) "POV: it's Saturday, 11am, and you've said 'what shall we do?' four times." over fast swipe stack. 2) "I swiped 20 things to do near me in 10 seconds. Look what's 8 minutes away." 3) "You've lived in [Town] 5 years and never been here." hard cut + punch-in.

Shot template (12-15s, 60fps): 0-0.3 hook on frame0 (scale 1.08->1 spring) | 0.3-2.5 phone mockup 3D tilt rotateY -18->0 with swipe footage, parallax bg | 2.5-5 Screen-Studio auto-zoom 1->1.6 onto the tapped card + motion blur | 5-8 whip/zoom-blur transition to next beat, staggered captions | 8-11 mask reveal / full-bleed place photo, speed ramp fast then slow on payoff | 11-13 kinetic payoff line word-by-word on beat ("Your weekend, sorted.") | 13-15 CTA spring pop (only overshoot here): logo, "Free on iPhone & Android", store badges.

Remotion: spring({frame,fps,config:{damping:200}}) for no-bounce settles; {damping:12,stiffness:120} for pops. @remotion/transitions TransitionSeries with springTiming; presentations slide/wipe/fade/flip/iris (check installed version for zoom-blur/cross-zoom/push-cut). @remotion/motion-blur CameraMotionBlur shutterAngle 180 samples 8-10 around zooms/whips. 3D phone via CSS perspective 1800px + rotateY/X interpolate. Auto-zoom: tap timeline JSON (frame,x,y) -> spring scale/translate on footage layer. Footage via <Video> (@remotion/media if installed) or <OffthreadVideo>. Avoid box-shadow/filter blur (slow) -> pre-rendered PNG shadows. Render 60fps.

Capture: iOS Simulator `xcrun simctl io booted recordVideo --codec h264 --mask ignored out.mp4` (stop with SIGINT), convert to CFR 60: ffmpeg -i out.mp4 -r 60 -c:v libx264 -crf 12 cfr.mp4. Drive taps/swipes deterministically (idb ui tap/swipe, or cliclick/AppleScript on the Simulator window). Avoid CDP screencast (VFR, slow) and Playwright recordVideo (1Mbit VP8 smear).
Pitfalls: logo/blank first frame; text in bottom 35%; bouncy springs everywhere; VFR footage stutter.
