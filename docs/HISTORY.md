# Build log

How the Gondryator was built, round by round, against the original spec (`gondryator-spec.md`, draft v0.3), with the measurements taken along the way. Historical: for how things work now, see [BUILD.md](BUILD.md).

## What is built (against the spec)

| Spec | Status |
|---|---|
| §3 UX: load, in-world title block, go, look around, pause, scrub, debug overlay, calm end | Done. Train waits at a "Gondryator" station, pulls away, passes a lineside board with the track title, artist and cover art, then the music starts. Ends by rolling into a "Terminus" station with the credit line. |
| §4 progressive analysis in a Web Worker, ~10 s ahead | Done with a DSP engine ("bands"): band-split onsets (kick/snare/hat), YIN pitch tracking for bass and lead, chroma pads, causal DP beat tracker, downbeats, bars, 4-bar phrases with repeat detection, sections, per-stem energy envelopes. Commits only append; nothing before `frontierSec` ever changes. |
| §4 fallback / guard | If the frontier falls under 4 s ahead, the train halts at a signal until it is 8 s ahead again. If analysis is slow at the start, the title block extends. Falls back to main-thread analysis if workers are blocked. |
| §4 Demucs stems, Basic Pitch notes, Essentia | Basic Pitch: done later as "deep listen" (see BUILD.md). Demucs stems and Essentia: not done. |
| §5 score format, JSON, MIDI export, IndexedDB cache, optional MIDI input | Done (`src/score/`). |
| §6 mapping, lead times from the camera rig, repetition, sections switch set dressing | Done. Kick → catenary poles, snare → sheds/walls, hats → fence posts, bass → warehouses/farmhouses whose length follows note length, lead → a row of buildings whose heights follow pitch, pads → silos/cooling towers/church towers. Same musical content → same object. Sections cycle industrial → town → countryside; overpass at each new section; a passing train in breakdowns. Train speed follows section energy. Light goes from morning to evening through the track. |
| §7 look-around and refocusing | Done: gaze-weighted spawning, late steering (fast while off-screen, subtle in view, follows head turns), priority tiers. Metric instrumented in the debug overlay. |
| §8 renderer | Three.js `WebGPURenderer` with automatic WebGL2 fallback, instanced pools, audio clock as the only time source. |
| §9 pack format | `pack.json` schema (`src/packs/types.ts`) with layers, mapping, themes, idle scenery, lighting keyframes, rig spec, troupes. Rigs behind a `CameraRig` interface: `lateral-rail` and `orbit`. Spawn modes behind a `ShowDriver` interface: `pass-by` (Spawner) and `perform` (Performer). |
| §10 Pack 1 Star Guitar homage | First version, all procedural original models. |
| §11, §12.6 second pack | Done: *Around the World* homage (`src/packs/around-the-world.ts`, `src/render/performer.ts`). A round stage with five original troupes, one per instrument: drummers stomp on kicks and clap on snares, bass climbers stand on the stair step matching each bass note, tin-toy robots walk the lead line round the stage a step per note, swimmers wave through the pads, and a line of dancers ripples on the hats. The camera orbits slowly; looking around walks you round the stage instead of turning your head. A screen over the stage shows the title and, at the end, the credit line. Every move is computed from show time, so scrubbing and switching packs mid-track just work. |

## Look and effects (rounds 3 and 4)

Everything is procedural: no textures or models are downloaded.

- **Surfaces** (`src/render/shaders.ts`): one TSL material shades all scenery from a per-vertex surface id: brick (bond pattern, mortar, per-brick colour), stone, corrugated metal with rust, roof tiles, concrete panels, rendered plaster with rain streaks, mirror glass with windows that light up at dusk, leafy foliage, wood grain, straw, grass. Patterns fade with distance so nothing shimmers. Bump-mapped.
- **Light**: physical sky with scattering and clouds that moves from morning to evening, a raking sun with soft shadows that follow the train, reflections from the sky, ACES tone mapping, motion blur on near scenery from the train's real speed, film grain and vignette. Carriage windows have glass with dust, and raindrops that refract the view and streak backwards in breakdowns. Swaying grass tufts beside the line, leafy tree crowns.
- **Stage pack**: polished dance floor whose tiles light up on the beat, a mirror ball, eight moving heads with coloured beams that sweep in patterns per section and flash on kicks, glowing stair nosings, metal robots.
- **Effects director** (`src/render/fx.ts`): every section gets a look from the pack's cycle (Star Guitar starts photographic and turns the dial further each section). Kicks punch the frame and bloom the lights, snares split the colours, the palette rolls with the music. Looks: Clean, Prism (RGB split, glow), Trip (surfaces repainted in flowing colour, buildings lean and squash to the beat, a sunburst sky), Kaleidoscope, Liquid (flowing warp, echo, rain), Thermal (posterised false colour), Echo (trails), Fold (the sky mirrors the ground about a tilting horizon). Section changes glitch.
- **VR (experimental, browser)**: where the browser supports WebXR (`immersive-vr`), a VR button appears in the bar. On a WebGPU browser it first switches to the WebGL2 renderer (one reload, then tap again), because three's WebXR path needs it. In the headset, head tracking replaces drag-to-look and the refocusing steers the music's objects to wherever you turn; post effects are skipped in the headset.
- Each pack links to the official video that inspired it (in the credits line).
- Press **X** or the ✦ button to lock a look. URL switches: `?fx=off`, `?fx=kaleido`, `?noshadow`, `?nosky`, `?plain`, `?ao` (ambient occlusion, off by default). Resolution adapts to keep the frame rate up.
- Testing: `?virtual` runs the show on a fixed 1/30 s step per frame so slow machines still see every moment; `?start=30` jumps there. `node tools/e2e.mjs --virtual --query "start=30&fx=trip" --shots 33` renders a frame at 33 s.

## The other window (round 6)

The Star Guitar main window stays close to the original video. Turn round (drag, arrow keys or a headset; the train pack allows a full 180°) and the window across the aisle plays the same score into invented worlds that alternate by section: Provence (poplars on the kick, sunflowers and hay bales on the snare, lavender rows on the bass, cypresses on the melody, châteaux far off) and Cosmos (asteroids, satellites, space stations, crystals pitched to the melody, gas giants and ringed planets on the pads). A starfield dissolves in over that side of the sky when the train leaves for space.

- Pack: `src/packs/other-side.ts`; mirrored spawner and starfield: `src/render/otherside.ts`.
- `?noother` turns it off.
- The main window stays photographic, like the original: the effects only come in as you turn round (forced looks via `X` or `?fx=` still apply everywhere). A milky summer haze (`haze` in the pack), a gravel works and French water towers bring it closer to the video.

## Measurements (this container: no GPU, headless Chromium, software rendering)

Analysis on synthetic tracks with known ground truth (`tools/eval-analysis.mjs`):

| | 124 BPM track | 100 BPM track |
|---|---|---|
| Speed | ~47× real time (Node), ~38× in the browser worker | ~44× |
| Tempo | 123.7 | 99.7 |
| Kicks (F1 at ±50 ms) | 98% | 98% |
| Snares | 67% | 72% |
| Hats | 61% | 52% |
| Bass notes onset / pitch | 93% / 128 of 128 | 91% / 96 of 96 |
| Lead notes onset recall / pitch | 100% / 96 of 96 (precision 40%: pad top notes count as melody) | 100% / 80 of 80 (precision 53%) |
| Beats / downbeats | 85% / 84% (intro has no drums) | 98% / 97% |
| Sections | all 4 boundaries found | 2 of 4 found |

On a real track (Star Guitar, kept local and out of the repo), the beat tracker was jittery: syncopated stabs pulled it off the grid and it averaged 131.5 bpm. The tracker now holds its tempo much harder (`beatTightness`, default 300, was effectively 6) and finds a steady 126.5 bpm, which also lifted the synthetic beat scores above. Soft "kicks" off the eighth-note grid, usually the bass synth, are dropped (`kickGrid`). Sections are limited to one per 8 bars unless the change is far bigger than usual for that song: 15 sections over 6.5 minutes, down from 36.

**Timing.** Each object comes into view at the leading edge of the screen as its sound plays (`rig.hitAt: 'entry'`, the default), so everything you watch slide away is history; looking ahead along the line shows what is coming, which is allowed but not the intended view. Before this round objects were timed to the centre of the view (`hitAt: 'centre'`). The refocus metric now counts top-tier events just entering the view at their time (screen x between 0.6 and 1.15).

Section-7 refocus metric (measured with centre timing: top-tier events inside the central third at their time), automated wandering viewer: Star Guitar **100%** (140/140) with steering on, 49% with spawn-time placement only; Around the World **100%** (147/147: kicks and lead notes).

Startup: the first frontier needs about 20 s of analysed audio (beats stabilise, then whole 4-bar phrases are committed), which takes under a second at these speeds.

Frame rate could not be measured meaningfully here (software rendering: 11 to 40 fps at 640×360). Draw calls are about 40 instanced meshes plus the static world.

