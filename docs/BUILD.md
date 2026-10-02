# Gondryator

A browser music visualiser after Michel Gondry's *Star Guitar*: drop in a track and ride a train past scenery where every beat and note becomes an object that crosses the window exactly when it sounds. Built from `gondryator-spec.md` (draft v0.3).

## Run it

```
npm install
npm run dev            # http://localhost:5173  (add ?debug, ?wander, ?webgl, ?demo)
npm run build:single   # dist-single/index.html, one self-contained file
npm run make-tracks    # synthetic test tracks with ground truth -> test-tracks/
node tools/eval-analysis.mjs test-tracks/test-124   # analysis accuracy + speed
npm run build && node tools/e2e.mjs --webgl --wander --file test-tracks/test-124.mp3   # headless run + screenshots
```

Pick a pack from the menu in the bar (or `?pack=around-the-world`); packs switch mid-track without losing your place.

Keys: space play/pause, drag or arrow keys to look around, C centre the view, D debug overlay, G wandering-viewer test, S refocusing on/off, F fullscreen. Drop a `pack.json` on the page to load a pack at runtime; drop a `.mid` with the audio to use it instead of note analysis.

## What is built (against the spec)

| Spec | Status |
|---|---|
| §3 UX: load, in-world title block, go, look around, pause, scrub, debug overlay, calm end | Done. Train waits at a "Gondryator" station, pulls away, passes a lineside board with the track title, artist and cover art, then the music starts. Ends by rolling into a "Terminus" station with the credit line. |
| §4 progressive analysis in a Web Worker, ~10 s ahead | Done with a DSP engine ("bands"): band-split onsets (kick/snare/hat), YIN pitch tracking for bass and lead, chroma pads, causal DP beat tracker, downbeats, bars, 4-bar phrases with repeat detection, sections, per-stem energy envelopes. Commits only append; nothing before `frontierSec` ever changes. |
| §4 fallback / guard | If the frontier falls under 4 s ahead, the train halts at a signal until it is 8 s ahead again. If analysis is slow at the start, the title block extends. Falls back to main-thread analysis if workers are blocked. |
| §4 Demucs stems, Basic Pitch notes, Essentia | Not yet. See "Not done" below. |
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
- **VR**: where the browser supports WebXR (`immersive-vr`), a VR button appears in the bar. On a WebGPU browser it first switches to the WebGL2 renderer (one reload, then tap again), because three's WebXR path needs it. In the headset, head tracking replaces drag-to-look and the refocusing steers the music's objects to wherever you turn; post effects are skipped in the headset.
- Each pack links to the official video that inspired it (in the credits line).
- Press **X** or the ✦ button to lock a look. URL switches: `?fx=off`, `?fx=kaleido`, `?noshadow`, `?nosky`, `?plain`, `?ao` (ambient occlusion, off by default). Resolution adapts to keep the frame rate up.
- Testing: `?virtual` runs the show on a fixed 1/30 s step per frame so slow machines still see every moment; `?start=30` jumps there. `node tools/e2e.mjs --virtual --query "start=30&fx=trip" --shots 33` renders a frame at 33 s.

## Measurements (this container: no GPU, headless Chromium, software rendering)

Analysis on synthetic tracks with known ground truth (`tools/eval-analysis.mjs`):

| | 124 BPM track | 100 BPM track |
|---|---|---|
| Speed | ~47× real time (Node), ~38× in the browser worker | ~44× |
| Tempo | 123.7 | 99.7 |
| Kicks (F1 at ±50 ms) | 96% | 96% |
| Snares | 67% | 72% |
| Hats | 61% | 52% |
| Bass notes onset / pitch | 93% / 128 of 128 | 91% / 96 of 96 |
| Lead notes onset / pitch | 71% / 64 of 96 | 72% / 62 of 80 |
| Beats / downbeats | 70% / 70% (intro has no drums) | 87% / 75% |
| Sections | all 4 boundaries found, plus 1 false one in the intro | all 4 found |

Section-7 refocus metric (top-tier events inside the central third at their time), automated wandering viewer: Star Guitar **100%** (140/140) with steering on, 49% with spawn-time placement only; Around the World **100%** (147/147: kicks and lead notes).

Startup: the first frontier needs about 20 s of analysed audio (beats stabilise, then whole 4-bar phrases are committed), which takes under a second at these speeds.

Frame rate could not be measured meaningfully here (software rendering: 11 to 40 fps at 640×360). Draw calls are about 40 instanced meshes plus the static world.

## Not done yet, and why

- **Demucs stems and Basic Pitch:** this container has no GPU and cannot reach Hugging Face, so the 126 MB HT-Demucs model could not be downloaded or benchmarked (spec milestone 1). The score already carries `analysis.mode` (`bands` | `stems` | `midi`) and the stem fields, so a stems engine can drop in behind the same worker interface. The benchmark has to run on the target laptop.
- **Real music:** no network access to fetch test music, so everything was tuned on synthetic tracks. Expect lower accuracy on dense real mixes, especially lead notes and snares.
- `replicate` / `loop-layer` spawn modes, `dolly-forward` / `locked-off` rigs, WebXR, glTF assets in packs. The Around the World troupes are simple box-and-capsule figures; they would benefit from proper modelled characters.
- **Exports inside the claude.ai viewer:** downloads are blocked there, so the JSON/MIDI buttons only show in the standalone file.
