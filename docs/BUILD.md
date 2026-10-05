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

- **Train** (`star-guitar`): the homage to Star Guitar; the other window is Provence and Cosmos (comets, halo gates, freighters and spires of light among the planets). On breakdowns and drops (sections, or break and drop moments), never in the intro or the last 15 s, the disco takes over that side: the non-Gondry view's backdrops (no sprites, which would hang still while the train moves) on the sky and a floor, playing the same score, with the scenery still passing in trippy paint. The starship's far side does the same. `?side=disco` holds the takeover on; `?side=provence` or `cosmos` pins a world. The main window never sees any of it; instead it turns up the odd rare find (`rare` on a layer: a windmill, a big wheel, a ruined abbey, an observatory, a glasshouse, a dovecote, a radio mast), seeded by the song so a song keeps its own.
- **Starship** (`starship`): an open cockpit, one sweep of glass from the console over your head, so far more of the screen is sky. Out of the main side: stars, nebulae and traffic keeping time (lattice struts with a light ring on the kick, cargo pods and asteroids on the snare, nav lights on the hats, freighters as long as the bass note, spires of light at the melody's pitch, planets on the pads). At every new section the ship jumps through a ring gate; in the breakdown a star-liner convoy glides past. Out of the other side (`packs/ship-other-side.ts`), in front of a vortex that spins with the music: a reef adrift in space (lantern buoys on the hats, jellyfish on the kick, anemones and coral fans on the snare, whales gliding by on the bass) and a crystal canyon (geodes, spires, halo gates), alternating by section, with the disco taking over on breaks and drops. The consoles blink along with the track. Rare finds on the main side: a derelict hull, a listening post, a solar sail, a space whale. It starts from the train's angled view and waits for launch beside a floating screen (song name, a T-MINUS countdown strip, a countdown dial, blinking antennas, thrusters underneath).
- **Ghost train** (`halloween`): a Halloween fairground ride. You sit in a little open cart (`vehicle: 'cart'`: low sides, a lap bar, a low nose) on a roller track built under and ahead of you every frame. `rig.coaster` sets its height: each section gets its own (from its energy, seeded so neighbours differ), the track swoops there across the change, swells gently each phrase, plunges towards the ground on a drop and lifts a little on the downbeats of the loudest parts; the cart tips gently with the slope. Main side: a rain of blood (`storm.rain`), spiders on the hats, fire posts and gibbets on the kick, skull rocks, webs, cracked egg huts and giant fruit on the snare, hell-mouths and bone arches on the bass, thorn spires and pillars of fire at the melody's pitch, volcanoes and impossible towers on the pads. Other side (`HALLOWEEN_OTHER`): pumpkin patches, a haunted wood, a town street on Halloween night and a stormy coast with a lighthouse, with no disco takeover (`farTakeover: false`). Both sides catch the lightning (section changes, drops, impacts and some big snares) and throb red on the kick (`storm.pulse`, `render/storm.ts`). It waits at a bulb-lit ghost-train sign ('ghost-gate') and comes back to one at the end. You ride it facing forward (`VIEW.ahead`, `packs/views.ts`): the view rests 50° ahead along the line and each object lands in the middle of that view as it sounds, then sweeps past; the signs turn to face you. The train and the starship use `VIEW.window` (land at the leading edge of a side window).

**Fireworks on cue.** The score is known ahead, so fireworks wind up: each rocket leaves the ground (the rides) or the horizon (the non-Gondry view's fireworks element, 12 cued shells beside a few ambient ones) early, trailing sparks, and bursts exactly on its hit. `render/cues.ts` `fireworkCues` picks the hits: section changes (3 shells), drops (5) and lifts (3), a cheering crowd or an impact the sound pass heard, and, busier in loud parts, big snares and downbeats. Bursts come as peonies, rings and golden willows.

**Palettes.** The psychedelic paint, the starship's vortex, the warp and the space floor all paint with one shared palette (`U.pa..pd`, `palette()` in `render/shaders.ts`). The FX director picks one per section from the pack's `palettes` (default: every general one but the rainbow), seeded by the song, a returning part getting its colours back, and eases between them. Two-colour ones (pumpkin, blood, toxic, moonlight, cyan-magenta, gold-navy, lime-blue) and moody ones that drench a night scene in one hue (graveyard green, bruise, witchlight, ember-dusk, swamp, cold-moon) joined the old harmonies; the non-Gondry view uses the same list.
