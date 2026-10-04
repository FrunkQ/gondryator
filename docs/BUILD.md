# Gondryator

A browser music visualiser after Michel Gondry's *Star Guitar*: drop in a track and ride a train past scenery where every beat and note becomes an object that comes into view exactly when it sounds. Built from `gondryator-spec.md` (draft v0.3).

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

Hosting: `wrangler.jsonc` serves `dist/` as Cloudflare Workers static assets (build `npm run build`, deploy `npx wrangler deploy`; `.nvmrc` pins Node 22 for Vite 8). Any static host works: it is just the files in `dist/`.

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
- **VR (experimental, browser)**: where the browser supports WebXR (`immersive-vr`), a VR button appears in the bar. On a WebGPU browser it first switches to the WebGL2 renderer (one reload, then tap again), because three's WebXR path needs it. In the headset, head tracking replaces drag-to-look and the refocusing steers the music's objects to wherever you turn; post effects are skipped in the headset.
- Each pack links to the official video that inspired it (in the credits line).
- Press **X** or the ✦ button to lock a look. URL switches: `?fx=off`, `?fx=kaleido`, `?noshadow`, `?nosky`, `?plain`, `?ao` (ambient occlusion, off by default). Resolution adapts to keep the frame rate up.
- Testing: `?virtual` runs the show on a fixed 1/30 s step per frame so slow machines still see every moment; `?start=30` jumps there. `node tools/e2e.mjs --virtual --query "start=30&fx=trip" --shots 33` renders a frame at 33 s.

## The other window (round 6)

The Star Guitar main window stays close to the original video. Turn round (drag, arrow keys or a headset; the train pack allows a full 180°) and the window across the aisle plays the same score into invented worlds that alternate by section: Provence (poplars on the kick, sunflowers and hay bales on the snare, lavender rows on the bass, cypresses on the melody, châteaux far off) and Cosmos (asteroids, satellites, space stations, crystals pitched to the melody, gas giants and ringed planets on the pads). A starfield dissolves in over that side of the sky when the train leaves for space.

- Pack: `src/packs/other-side.ts`; mirrored spawner and starfield: `src/render/otherside.ts`.
- `?noother` turns it off.
- The main window stays photographic, like the original: the effects only come in as you turn round (forced looks via `X` or `?fx=` still apply everywhere). A milky summer haze (`haze` in the pack), a gravel works and French water towers bring it closer to the video.

## The rides

Two rides, each with a view true to life and something else entirely across the aisle (turn round to see it):

- **Train** (`star-guitar`): the homage to Star Guitar; the other window is Provence and Cosmos (comets, halo gates, freighters and spires of light among the planets).
- **Starship** (`starship`): an open cockpit, one sweep of glass from the console over your head, so far more of the screen is sky. Out of the main side: stars, nebulae and traffic keeping time (lattice struts with a light ring on the kick, cargo pods and asteroids on the snare, nav lights on the hats, freighters as long as the bass note, spires of light at the melody's pitch, planets on the pads). At every new section the ship jumps through a ring gate; in the breakdown a star-liner convoy glides past. Out of the other side: a psychedelic double of it all (`otherSide: 'trippy'`) in front of a vortex that spins with the music. The consoles blink along with the track.

The riverboat and night bus from an earlier round were dropped (they live in the git history).

**Warp jumps and new looks.** Every section change is a warp jump: a zoom smear towards the centre, star streaks, a flash and a field-of-view kick. On the train it shows out of the other window only; on the starship, everywhere. Two looks join the cycle: `hyper` (stars stream out of the centre and the view punches in on the kick) and `tunnel` (the world wrapped round a wormhole you fall down). Force them with `X` or `?fx=hyper` / `?fx=tunnel`.

**The non-Gondry view :(** (`non-gondry`, `src/render/visualiser.ts`): no vehicle at all. You sit still inside a sphere and look anywhere (drag, or turn your phone). One shader paints the whole sky in angle space: seeded plasma, rings and tunnel stripes through a cosine palette, with optional kaleidoscope folding and swirl. Each kind of data gets its own reaction: a flower for each melody note (height from pitch, colour from the note name, sliding down as it fades), big slow blooms for pads, a wave of light round the horizon tracing the melody's exact pitch (ahead of your gaze is what is coming), rings blasting out from your gaze on each bass note, lightning on the snare, sparks on the hats, the whole sky pumping on the kick, and build-ups running everything hotter. Scenes change at every section and every new melody phrase with a crash (inverted flash plus glitch and warp); a section label that comes back reuses its pattern with a new palette and phase. Scene parameters come from a random generator seeded by the song, so a song always looks like itself; R rerolls. All layers live in one shader with weights, so a scene change never compiles anything.

The elements come from a library of 21 (`ELEMENTS` in `visualiser.ts`), each tied to an instrument group: mix (plasma, vector shapes, ribbons, starfield, a fractal kaleidoscope), drums (kick tunnel, lightning, sparks, drum floor, starbursts, confetti), bass (rings, wireframe mountains, sub breathe, bubbles), melody (wave, flowers, note circle) and pads (aurora, nebula, snowflakes). At each scene change the director counts which groups play over the next 8 s and shows two or three elements from them. Some are painted by the dome shader (weights E0..E4); the simple spawners (flowers, bubbles, starbursts, confetti, snowflakes) are instanced sprites from a shared `SpritePool`, so a new one is a shape plus a few lines saying where it appears and how it drifts.

**The arc.** Because the analysis runs ahead of the music, the show plans for the whole song rather than reacting only to the present moment. `buildArc` smooths the loudness, build-ups and section energy into an intensity curve (2 Hz, rebuilt as the frontier advances) and finds the climax. The show's brightness and saturation are capped by a ceiling that rises towards the climax, so the opening stays dark and muted even when it is loud. A jump in intensity within the next eight seconds raises a tension level: the sky goes greyer and darker and the feedback trails pull inwards, then a release flash fires as the drop lands. Sprites follow the arc too.

**Eras and journeys.** Verse and chorus aren't the only shapes in a song. `findEras` describes each section by what is playing (drums, bass and the rest, how much of the time a lead line sounds, how busy and how wide that lead is, how bright it all is) and starts a new era wherever a section sounds clearly unlike the era so far, with no era shorter than 12 s. It tags each era intro, solo (a busy, wide lead), breakdown (drums mostly gone) or drive. A new era resets the vibe: the random generator is reseeded, remembered chorus patterns are dropped, and it gets the next of three journeys for the arc:
- **colour rise**: dark and muted, climbing to full colour at the climax;
- **complexity bloom**: full colour all along, but one element and shallow mirrors at first, growing into every element folded five deep;
- **thaw**: icy blue monochrome that warms into the palette.

The first era's journey is seeded by the song. The D overlay shows the era, journey, arc, tension and elements.

Kaleidoscopes go deep in two ways. A scene can fold the base pattern's plane up to five times over, turning and stretching between folds (`fold`), and the fractal element is a Kali-style fold-and-invert fractal (p = |p| / p·p − c, nine rounds) seen through a ring of mirrors round your gaze, so every fold mirrors all three axes at once. `?viz=16,17` pins elements to try them out; `?fb=0` turns the feedback trails off.

Around the World is hidden from the menu while it waits for its twist; `?pack=around-the-world` still opens it.

## Deep listen

The fast parser (`analyzer.ts`) is hand-made DSP: it gets the drums, beats and sections right and is far faster than real time, but its melody tracker only hears one note at a time. After it finishes, "deep listen" runs Spotify's Basic Pitch, a small neural network (about 900 KB of model, Apache 2.0) that transcribes polyphonic music into notes, in its own worker on TensorFlow.js (WebGL when the worker can get it, plain JavaScript otherwise).

- The song is resampled to 22050 Hz mono by the browser and processed in 20 s windows (1 s pre-roll, 2 s post-roll, notes kept only if they start inside the window). It starts with the first window 20 s ahead of the playhead, runs to the end, then goes back for the start.
- Its notes are shaped like the fast parser's: per chord (notes within 40 ms), the lowest note under E3 is the bass, the top note is the melody, and one held note (1.2 s or more) becomes a pad. Notes quieter than 0.25 or shorter than 60 ms are dropped. Bar and step come from the beat grid.
- A window is spliced into the live score only if it starts at least 20 s ahead of the playhead, so nothing already scheduled changes under the renderers. When every window is done, a fully upgraded copy is cached (engine `... + basic-pitch 1.0.1`), so the next ride is deep from the first note. Drums, beats, sections and envelopes still come from the fast parser.
- **Only on machines that can take it.** First a free check before anything is downloaded: phones and tablets, fewer than four cores, or under 4 GB of memory skip it. Then the worker times itself on four seconds of the song (after a warm-up run that builds the GPU programs) and carries on only if it ran at least 1.5× faster than real time. A quiet 🎧 note in the play bar says which happened (checking…, deep listen 40%, deep listen, or quick listen), with the reason in its tooltip.
- Skipped when a MIDI file is loaded, in the single-file build (no model file), and with `?nodeep`; `?deep` skips the device precheck and `?deep=force` skips the speed check too (for tests). The D overlay shows its progress, backend and measured speed.
- On a CPU in Node it took about 37 s per 20 s of audio; on synthetic tests it got every lead and bass note's pitch right (41/41 and 39/39).

## Install as an app

The site is a progressive web app (`public/manifest.webmanifest`, `public/sw.js`). In Chrome or Edge, use the ⤓ Install link in the corner (or the install icon in the address bar) and it gets its own window and a desktop icon, keeps working offline after the first visit, and can open music files straight from the desktop ("Open with Gondryator"). Safari: Share → Add to Dock / Home Screen. The service worker caches only the app's own files; pages are fetched network-first, so a new deploy shows up on the next load. The single-file build skips all of this. The commit and build date show in the D overlay, the console and the GitHub link's tooltip.

## The tuning screen

Press `T` (or the 🎛 button, or open with `?tune`) to see what the music parser heard: a Synthesia-style piano roll where every detected hit falls onto the "now" line as it sounds. Drums get their own lanes (kick, snare, hat); bass, melody, pads and vocals fall onto a keyboard at their pitch. Hover a block for its instrument, note name, MIDI number and frequency, start time, length, velocity and bar position. Bars, beats, sections and the tempo are drawn too.

Every parser setting (`src/analysis/tuning.ts`) is a slider: move one and the track is re-parsed in place. "Apply to the show" restarts the ride with those settings (they are saved in the browser; tuned scores are not cached). "Copy" puts them on the clipboard as JSON.

**Presets.** A preset menu sets starting points: Default, Dance and electronic (what auto-tune found on a real Star Guitar recording: a firmer beat, crisper kicks, a melody tracker that keeps quieter top notes), and Live band (a looser beat that can follow a drummer).

**Auto-tune.** The ✨ Auto-tune button re-parses the loudest 32 seconds of the song about 26 times, nudging one setting at a time, and keeps whatever gives the most self-consistent parse (`src/analysis/autotune.ts`). There is no answer key, so a parse is scored on what any good parse of real music looks like: a steady beat; kicks and snares on the eighth-note grid and hats on the sixteenths; a plausible number of hits per bar for each instrument; and, when the mid band is busy, a melody that covers a fair share of the time and moves in steps. It also runs by itself in a worker the first time a song plays on default settings; if it finds something clearly better, the settings are kept for that song (`localStorage` key `gondryator.tuning.<file hash>`) and used from the next play. Settings applied from the tuning screen with a song loaded are kept for that song too. `?noautotune` turns the background run off. On the real Star Guitar it takes about 22 s in Node and lifts the score from 9.75 to 10.58 (melody clarity 0.6 → 0.41, bass confidence 0.15 → 0.22, kick decay 3.5 → 5 dB, beat steadiness 300 → 900).

## Rising and falling

The parser also writes three continuous curves into the score's envelopes (50 Hz, alongside the per-stem loudness):

- `contour`: where the melody sits, 0 to 1 over four octaves, from the top line of the mix (a harmonic-sum pitch estimate every other frame that picks the highest clear voice). On the test tracks it correlates 0.91 and 0.93 with the true melody.
- `bright`: spectral centroid, log-scaled; filters opening read as brightness rising.
- `rise`: build-ups. Loudness and brightness trending up over a few seconds against the last few.

Slides become ridges. The parser also writes the exact pitch of the melody and the bass (`leadPitch`, `bassPitch`: MIDI with fractions, from a parabolic peak refinement, so a glide is smooth, not a staircase). Wherever a line glides smoothly by a semitone or more for half a second or longer, a ride lays down a ridge along the way, each segment as high as the pitch when it comes into view: a mountain line (melody) and low hills (bass) from the train, lavender hills in Provence, ribbons of light in space. Separate notes stay separate objects (Alex: "a slide is a continuous movement, specific notes are individual objects"). On the real Star Guitar the melody glides 38 times (8% of the song). The demo track has a sliding synth line in its breakdown to show them. Build-ups charge the warp jump (streaks and zoom smear grow as the rise climbs), and brightness speeds up the colour cycling of the looks. The `contour` layer type still exists for packs, but no ride uses it.

## The start of a ride

Drop a song and the train glides up to a station board with its name, turning to the angled view on the way, and stops there. It leaves once the first stretch of the score is ready and every shader the ride needs is compiled (or after 15 s at most), so the loading hides behind a natural pause. The starship does the same.

## The frame analyser

Press `P` (or the ⏱ button, or open with `?perf`) for a picture-in-picture strip of frame times against the show clock. Bars are green inside the display's frame budget, amber up to two frames, red beyond. Every frame carries marks for what happened in it: section, scenery, other-window and look changes, a model's first appearance, shaders compiled, new GPU geometry and textures, the sky reflections being re-baked, fireworks, station boards, score updates from the analyser, and long main-thread tasks (Chromium). Stutters show their marks; "Copy report" puts a plain-text report on the clipboard with every stutter, totals per cause, and frames counted against frames expected at the display's refresh rate.

Pace fixes that came out of it: the sky reflections are re-baked into the same render target (a fresh texture made every material rebuild its shader), every shader the ride will need is compiled before departure (`World.warmup`: all ground themes, every pooled model, the space sky), and the renderer asks for the high-performance GPU. Browsers do not let a page reserve GPU memory up front; pre-building everything is the closest equivalent. On laptops with two GPUs the OS setting wins (Windows: Settings > Display > Graphics > browser > High performance).

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

## Not done yet, and why

- **Demucs stems and Basic Pitch:** this container has no GPU and cannot reach Hugging Face, so the 126 MB HT-Demucs model could not be downloaded or benchmarked (spec milestone 1). The score already carries `analysis.mode` (`bands` | `stems` | `midi`) and the stem fields, so a stems engine can drop in behind the same worker interface. The benchmark has to run on the target laptop.
- **Real music:** tuned on synthetic tracks plus one real song supplied locally (not in the repo). Expect lower accuracy on dense real mixes, especially lead notes and snares; auto-tune helps per song.
- `replicate` / `loop-layer` spawn modes, `dolly-forward` / `locked-off` rigs, WebXR, glTF assets in packs. The Around the World troupes are simple box-and-capsule figures; they would benefit from proper modelled characters.
- **Exports inside the claude.ai viewer:** downloads are blocked there, so the JSON/MIDI buttons only show in the standalone file.

## Roadmap: V2, native VR on Steam

V2 is a native VR app for Steam. What carries over unchanged:

- **Analysis** (`src/analysis/`): plain TypeScript over PCM samples, no DOM or renderer dependencies. It can run in Node, a worker, or be ported.
- **Score format** (`src/score/types.ts`, JSON and MIDI export): the contract between analysis and any renderer. A native app can read cached `.json` scores or run the same analysis.
- **Packs** (`src/packs/`): data (layers, mapping rules, rigs, troupes, effect cycles), so a native renderer can load the same `pack.json`.
- **Look-around and refocusing** (`src/render/spawner.ts`): already driven by head yaw/pitch and its velocity, which is exactly what a headset provides. The browser WebXR button is an experiment towards this.
