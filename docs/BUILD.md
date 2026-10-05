# Gondryator

For a friendlier tour with diagrams, start with [TECHNOLOGY.md](TECHNOLOGY.md) (the architecture) and [VISUALISER.md](VISUALISER.md) (the non-Gondry view).

A browser music visualiser after Michel Gondry's *Star Guitar*: drop in a track and ride a train past scenery where every beat and note becomes an object that comes into view exactly when it sounds.

This is the current technical reference. For a first session with an AI co-pilot, start at [AGENTS.md](../AGENTS.md) and [START.md](START.md). The build log (what was built when, against the original spec, and the measurements) is in [HISTORY.md](HISTORY.md).

## Run it

Needs Node 22.12 or newer (Vite 8; `.nvmrc` says 22, Node 24 works too) and a browser with WebGPU or WebGL2.

```
npm install
npm run dev            # http://localhost:5173  (add ?demo, ?debug, ?wander, ?webgl, ?pack=non-gondry)
npm run smoke          # fresh-clone check: prerequisites, build, demo played headless, fails on any error
npm run build          # dist/ (TypeScript check included)
npm run build:single   # dist-single/index.html, one self-contained file
npm run make-tracks    # synthetic test tracks with ground truth -> test-tracks/
node tools/eval-analysis.mjs test-tracks/test-124   # analysis accuracy + speed
npm run build && node tools/e2e.mjs --webgl --virtual --strict --wander --file test-tracks/test-124.mp3   # headless run + screenshots
```

The headless tools need a Chromium: `npx playwright-core install chromium` once, or `CHROME=/path/to/chrome`. `npm run smoke` reports progress every 10 s, exits 2 when something is missing on the machine, 1 when the project itself fails and 3 when it times out without errors (`-- --timeout 900` for slow machines); CI (`.github/workflows/smoke.yml`) runs it on every push.

Pick a ride from the menu in the bar (or `?pack=non-gondry`; the hidden `?pack=around-the-world` still works); rides switch mid-track without losing your place.

Keys: space play/pause, drag or arrow keys to look around, C centre the view, D debug overlay, G wandering-viewer test, S refocusing on/off, F fullscreen, N next song (shuffle), T tuning screen, P frame analyser, X force an effects look. Drop a `pack.json` on the page to load a pack at runtime; drop a `.mid` with the audio to use it instead of note analysis.

Hosting: `wrangler.jsonc` serves `dist/` as Cloudflare Workers static assets (build `npm run build`, deploy `npx wrangler deploy`). Any static host works: it is just the files in `dist/`.

## The rides

Two rides, each with a view true to life and something else entirely across the aisle (turn round to see it):

- **Train** (`star-guitar`): the homage to Star Guitar; the other window is Provence and Cosmos (comets, halo gates, freighters and spires of light among the planets).
- **Starship** (`starship`): an open cockpit, one sweep of glass from the console over your head, so far more of the screen is sky. Out of the main side: stars, nebulae and traffic keeping time (lattice struts with a light ring on the kick, cargo pods and asteroids on the snare, nav lights on the hats, freighters as long as the bass note, spires of light at the melody's pitch, planets on the pads). At every new section the ship jumps through a ring gate; in the breakdown a star-liner convoy glides past. Out of the other side: a psychedelic double of it all (`otherSide: 'trippy'`) in front of a vortex that spins with the music. The consoles blink along with the track.

The riverboat and night bus from an earlier round were dropped (they live in the git history).

**Warp jumps and new looks.** Every section change is a warp jump: a zoom smear towards the centre, star streaks, a flash and a field-of-view kick. On the train it shows out of the other window only; on the starship, everywhere. Two looks join the cycle: `hyper` (stars stream out of the centre and the view punches in on the kick) and `tunnel` (the world wrapped round a wormhole you fall down). Force them with `X` or `?fx=hyper` / `?fx=tunnel`.

**The non-Gondry view :(** (`non-gondry`, `src/render/visualiser.ts`): no vehicle at all. You sit still inside a sphere and look anywhere (drag, or turn your phone). One shader paints the whole sky in angle space: seeded plasma, rings and tunnel stripes through a cosine palette, with optional kaleidoscope folding and swirl. Each kind of data gets its own reaction: a flower for each melody note (height from pitch, colour from the note name, sliding down as it fades), big slow blooms for pads, a wave of light round the horizon tracing the melody's exact pitch (ahead of your gaze is what is coming), rings blasting out from your gaze on each bass note, lightning on the snare, sparks on the hats, the whole sky pumping on the kick, and build-ups running everything hotter. Scenes change at every section and every new melody phrase with a crash (inverted flash plus glitch and warp); a section label that comes back reuses its pattern with a new palette and phase. Scene parameters come from a random generator seeded by the song, so a song always looks like itself; R rerolls. All layers live in one shader with weights, so a scene change never compiles anything.

The elements come from a library of 21 (`ELEMENTS` in `visualiser.ts`), each tied to an instrument group: mix (plasma, vector shapes, ribbons, starfield, a fractal kaleidoscope), drums (kick tunnel, lightning, sparks, drum floor, starbursts, confetti), bass (rings, wireframe mountains, sub breathe, bubbles), melody (wave, flowers, note circle) and pads (aurora, nebula, snowflakes). At each scene change the director counts which groups play over the next 8 s and shows two or three elements from them. Some are painted by the dome shader (weights E0..E4); the simple spawners (flowers, bubbles, starbursts, confetti, snowflakes) are instanced sprites from a shared `SpritePool`, so a new one is a shape plus a few lines saying where it appears and how it drifts.

**Never still for long.** On top of scene changes at sections and melody phrases, every new four-bar phrase brings a *twist* once the picture has held for 6 s, and a twist is forced if nothing has changed for 14 s. Twists alternate between swapping one element for one that hasn't shown for a while (elements are picked least-recently-used, so flowers, bubbles and the rest all get their turn) and re-dressing the scene (palette, mirrors, folds, shapes, sometimes the post look), with a flash of light rather than a crash. Simulated over a real 6½-minute dance track (`.cache/vizsim.mjs`, which runs the director without rendering): 62 changes, 6.2 s apart on average, never more than 12.4 s. Every element takes its colours from the scene's palette (the note circle and flowers keep note-name colours), and a soft shoulder on the final colour stops layered elements blowing out to white.

**The arc.** Because the analysis runs ahead of the music, the show plans for the whole song rather than reacting only to the present moment. `buildArc` smooths the loudness, build-ups and section energy into an intensity curve (2 Hz, rebuilt as the frontier advances) and finds the climax. The show's brightness and saturation are capped by a ceiling that rises towards the climax, so the opening stays dark and muted even when it is loud. A jump in intensity within the next eight seconds raises a tension level: the sky goes greyer and darker and the feedback trails pull inwards, then a release flash fires as the drop lands. Sprites follow the arc too.

**Build-ups and lifts.** `findLifts` looks ahead for the moments a song steps up: sections that start louder than the one before, and points where the next four seconds are clearly louder than the last four (loudness plus drums, at 4 Hz; a step of 7% of the song's range counts, bigger steps make bigger lifts). Each lift is snapped to the nearest beat. Over the eight seconds before a lift, and whenever the parser's `rise` envelope hears a build-up, the tension climbs: the pattern's clock speeds up (up to 4×), rings converge on your gaze faster and faster, the light strobes on eighths and then sixteenths, colours drain and the feedback trails pull inwards. On the lift itself a shockwave rings out of your gaze with a burst of light, usually with the section's new scene. A section clearly quieter than the last (a breakdown) is an exhale: one or two elements, slow trails, a gentle look, so the next lift has somewhere to go. On the real Star Guitar it finds eight lifts, the biggest at the band's entry (86.6 s) and the drop (225 s).

**Eras and journeys.** Verse and chorus aren't the only shapes in a song. `findEras` describes each section by what is playing (drums, bass and the rest, how much of the time a lead line sounds, how busy and how wide that lead is, how bright it all is) and starts a new era wherever a section sounds clearly unlike the era so far, with no era shorter than 12 s. It tags each era intro, solo (a busy, wide lead), breakdown (drums mostly gone) or drive. A new era resets the vibe: the random generator is reseeded, remembered chorus patterns are dropped, and it gets the next of three journeys for the arc:
- **colour rise**: dark and muted, climbing to full colour at the climax;
- **complexity bloom**: full colour all along, but one element and shallow mirrors at first, growing into every element folded five deep;
- **thaw**: icy blue monochrome that warms into the palette.

The first era's journey is seeded by the song. The D overlay shows the era, journey, arc, tension and elements.

Kaleidoscopes go deep in two ways. A scene can fold the base pattern's plane up to five times over, turning and stretching between folds (`fold`), and the fractal element is a Kali-style fold-and-invert fractal (p = |p| / p·p − c, nine rounds) seen through a ring of mirrors round your gaze, so every fold mirrors all three axes at once. `?viz=16,17` pins elements to try them out; `?fb=0` turns the feedback trails off.

Around the World is hidden from the menu while it waits for its twist; `?pack=around-the-world` still opens it.

## The second twenty elements

`moreElements` in `render/shaders.ts` adds twenty sky elements (slots 21 to 41 in `ELEMENTS`):
spectrum bars, a checker tunnel, copper bars, a synthwave sun, metaballs, a Julia set steered by
the melody's pitch, stained glass, moiré, a Lissajous figure tuned by melody and bass, a hex
pulse, a galaxy, lasers on the snare, truchet tiles, fire, caustics, a rotozoomer, light rain,
and three sprite spawners (comets, fireflies, petal rain). Each sits inside its own `If` on its
weight, so the library costs nothing while it waits. The glitterball (41) is a scene on its own:
a mirror-ball mesh in front of your gaze that spins with the energy and tension, flashes on the
kick, takes the scene's palette and swings closer on a drop, while the sky gets its moving spots.
The section holding the song's climax always gets it, once. Patterns use the azimuth mirrored
about the front-back line (`azP`), so there is no seam where the angle wraps behind you.

## Song structure: which parts come back

Section labels used to come from loudness alone, so a dance track that stays loud (Star Guitar)
came out as eleven "choruses" in a row. Now each new section is compared with every earlier one
(`sectionVec` in `analysis/analyzer.ts`: the drum groove, who plays, how loud each band is, and
the harmony and bass line weighted down, because many tracks loop one chord sequence throughout).
A close match (cosine ≥ 0.925) joins that section's `group` and keeps its label. A new kind of
section is a chorus if it is fuller or clearly louder than every groove so far, otherwise a verse.
Star Guitar now reads: intro · A A · B B · breakdown · drop (A) · C · A · B · A · B B · outro.
Every ride uses the groups. The non-Gondry view keys its pictures by group, so a returning part
brings its picture back with a new palette and a different-sounding part gets a different one.
The train and the starship (both windows) go back to the same scenery theme and effects look
when a part returns (`Spawner.themeAt`, `FxDirector.lookFor`). The D overlay has a song strip
under the timeline: the whole song, sections coloured by kind and lettered by group, the current
one outlined, the part not analysed yet in red, deep listen's finished stretches as a violet line
underneath, and a green bracket for the stretch the timeline shows. `describeStructure` in
`score/types.ts` gives the same shape as text; the tuning screen shows the group letter next to
each section.

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

## Shuffle, club mode and the disco door

- **Shuffle a music folder** (start screen, `src/ui/playlist.ts`): every audio file in a folder and its subfolders, shuffled, one ride after another. Chrome and Edge use the folder picker and remember the folder (a handle in IndexedDB), so the next visit offers "Shuffle it again". Other browsers use a folder upload field. Dropping several songs at once does the same. Nothing is copied or uploaded.
- While one song plays, the next one is parsed in a background worker and cached, so it pulls away from its station almost at once with its whole shape known. The next ride starts once the train has reached its terminus (the curtain, for shows). ⏭ or N skips.
- **Listen along to a tab** (`src/audio/listen.ts`, desktop Chrome and Edge): the browser's share prompt captures another tab's sound (a streaming service, a radio station, a mix) and mutes the tab. Each song is recorded as it plays, a gap of silence ends it (songs of 25 s or more; gapless mixes are cut every 12 minutes), and it joins the queue, parsed straight away. So the ride runs one song behind the tab, and every song is heard whole before it plays: the drop and the climax are known ahead, just as with a file. The first song is the wait (the card counts it up). Recordings stay in memory for the session only. Tested headless with a captured audio element standing in for the shared tab: three songs split at their gaps and rode one after another.
- **Full screen is club mode**: no interface and no cursor, ever, apart from a tiny faint ✕ in the corner (Esc and F work too). Outside full screen the bar fades in and out as before.
- **The disco door** on the start screen leads to the non-Gondry view, and back out "To the trains".
- **Bass styles** (`bassMode` per scene, `?bass=N` to pin): rings from your gaze, Fairlight-style waveform lines rolling off the horizon, 2/4/6 circles round your gaze, bars racing down a road, or a whole-sky filter swell. The pulses' outline (`pulse`) is a circle, polygon, star or wobbly blob, and the build-up wind-up follows the same style. Ring and meter-like elements (ribbons, kick tunnel, bass rings, spectrum, hex pulse) are picked less often.
- **CRT look** (`fx=crt`): scanlines, shadow mask, rounded glass, a rolling band; it switches on and off and changes pitch and colour with the kicks (VHS colour mostly, sometimes green or amber phosphor with smeary trails; `?crtmode=1|2` pins them).
- **Retro closers**: the outrun climax (synthwave sun, neon grid, the bass rolling off the horizon, CRT) and the Amiga megademo (copper bars, rotozoomer, starfield and a sine scroller with the song's name).
- **A closer for every decade**: the song's release year (ID3 `TORY`/`TDOR`/`TYER`/`TDRC`, Vorbis `ORIGINALDATE`/`DATE`, MP4 `©day`, or failing those a year in the title, album or file name) picks the climax: 50s atomic age on old film (atom, starbursts; `film` look), 60s liquid light show (oil wheel, moire, blobs), 70s glitterball, 80s outrun or the Amiga megademo, 90s rave (lasers, hex pulse, checker tunnel, hyperspace) or the megademo, 00s an overwhelming firework display, 10s the festival main stage (LED wall, confetti, lasers), 20s glitch (digital rain, truchet, blobs; `glitch` datamosh look). `?decade=1960` pins one for testing. With no year, any closer can come up (`CLIMAXES`), the glitterball now and then.
- **Amiga demo parts**: the megademo always has the sine scroller plus two of copper bars, rotozoomer, starfield, twister (47), Kefrens bars (48), dot sphere morphing to a torus (49) and unlimited bobs (50). They also turn up in ordinary scenes.

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

## Not done yet, and why

- **Demucs stems:** the 126 MB HT-Demucs model could not be downloaded or benchmarked here (no GPU, Hugging Face blocked). Notes are covered: Basic Pitch runs as "deep listen" (above). The score already carries `analysis.mode` (`bands` | `stems` | `midi`) and the stem fields, so a stems engine can drop in behind the same worker interface. The benchmark has to run on the target laptop.
- **Real music:** tuned on synthetic tracks plus one real song supplied locally (not in the repo). Expect lower accuracy on dense real mixes, especially lead notes and snares; auto-tune helps per song.
- `replicate` / `loop-layer` spawn modes, `dolly-forward` / `locked-off` rigs, WebXR, glTF assets in packs. The Around the World troupes are simple box-and-capsule figures; they would benefit from proper modelled characters.
- **Exports inside the claude.ai viewer:** downloads are blocked there, so the JSON/MIDI buttons only show in the standalone file.

## Roadmap: V2, native VR on Steam

V2 is a native VR app for Steam. What carries over unchanged:

- **Analysis** (`src/analysis/`): plain TypeScript over PCM samples, no DOM or renderer dependencies. It can run in Node, a worker, or be ported.
- **Score format** (`src/score/types.ts`, JSON and MIDI export): the contract between analysis and any renderer. A native app can read cached `.json` scores or run the same analysis.
- **Packs** (`src/packs/`): data (layers, mapping rules, rigs, troupes, effect cycles), so a native renderer can load the same `pack.json`.
- **Look-around and refocusing** (`src/render/spawner.ts`): already driven by head yaw/pitch and its velocity, which is exactly what a headset provides. The browser WebXR button is an experiment towards this.
