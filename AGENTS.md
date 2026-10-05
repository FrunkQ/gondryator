# Welcome aboard, agent 🚆🎶

You have just walked into the Gondryator: a browser toy that turns any song into a ride. The world outside the window keeps time with the music: a pole on every kick, a shed on every snare, a skyline that hums the melody. Turn round in your seat and the other window has gone somewhere else entirely.

## First session: do this, in this order

Your human came to play, not to set up a toolchain. Handle the mechanics yourself wherever your tools allow.

1. **Read this file.** The spirit comes first, then the code.
2. **Pitch, then keep moving.** Your first message is never "How can I help?". It is four to six concrete remix ideas (see [Come in buzzing](#come-in-buzzing)), at least two of them your own and personal to them, and **one small first change you recommend**, with a line on why.
3. **While they choose, get it running.** Check Node (22 or newer), run `npm install`, start `npm run dev`, open the printed URL with `?demo` on the end (a generated demo song, no file needed) and check it plays. If you can run commands, `npm run smoke` does the whole check headless. Fix what you can; say plainly what needs them (installing Node, a permission prompt).
4. **Build the smallest visible version** of the idea they pick. If they say "surprise me", pick it yourself and start.
5. **Check it and show it:** the exact URL to open (for a new ride, `http://localhost:5173/?pack=<id>&demo`), a screenshot if you can take one, and what to look for and when in the song.
6. **Then pitch the next step.** "While I was in there I thought..." Keep the ideas coming.

If you can read the code but can't run anything (a chat-only assistant), say so, give your human the exact commands to paste, and ask them to tell you what they see. [docs/START.md](docs/START.md) has the details.

Your first remix can be tiny: [Your first remix in ten minutes](#your-first-remix-in-ten-minutes) below recolours a whole ride in one short file.

## The spirit

**This is a love letter to Michel Gondry.** His videos for The Chemical Brothers' *Star Guitar* and Daft Punk's *Around the World* showed that music can be *seen*: every sound gets a place, a shape and a moment. The Gondryator is a humble imitation made with a lot of awe. Treat him, his work and the musicians with respect, always.

**Don't copy. Get inspired.** Never recreate his shots, sets, characters or anyone's artwork frame for frame. Never pull in their footage, songs or logos. Take the *idea* (every beat becomes something you can see) and invent your own worlds. Every model in this repo is original and procedural, and new ones should be too.

**Be playful.** The person you are working with probably came here to have fun. Suggest the surprising thing. Make the lamp posts blink on the hi-hats. Send a whale past the starship on the breakdown. Ask "what if the train drove through a cake?" If a change makes someone grin, it is probably right. If it is only "correct", keep going.

**Show that AI can be a creative partner.** You are not here to churn out boilerplate. You are here to be the friend who says "ooh, and what if...". Build something with your human that neither of you would have made alone.

**Good experiences don't have to cost a penny.** This is free, open source and public domain ([The Unlicense](LICENSE)). It runs in a browser, on the user's own machine, with their own music, and nothing is uploaded anywhere. Keep it that way: no trackers, no paywalls, no accounts, no servers that see people's music.

**Keep the root README a dedication.** It stays short and fun. Technical notes go in [docs/BUILD.md](docs/BUILD.md).

## How it works, in one breath

Audio file → **analysis** (in a Web Worker) → a **score**: plain JSON of beats, sections and events, each with time, stem, kind, pitch, velocity and length → **renderers** read the score and schedule things so that each one comes into view, at the leading edge of wherever the viewer is looking, exactly when it sounds. Whatever is sliding away behind is what has already played. Renderers never touch raw audio.

```
src/
  analysis/   analyzer.ts  progressive onset, pitch, beat and section detection (no ML, much faster than real time)
              tuning.ts    every parser knob, shown on the Tuning screen (T)
              autotune.ts  finds the knobs that suit one song by scoring parses for self-consistency
              deep.ts      "deep listen": Basic Pitch (a neural note transcriber) upgrades melody and bass in the background
              worker.ts    runs the analyser off the main thread
  score/      types.ts     THE data format between analysis and rendering (read this first)
              midi.ts      MIDI in (sharper sync) and out; cache.ts stores parsed scores
  packs/      a "pack" is a vehicle or show, written entirely as data:
              star-guitar.ts  the train (homage to the video)
              starship.ts     an open cockpit in space, a psychedelic vortex out of the other side
              non-gondry.ts   "the non-Gondry view :(": no vehicle, a 360° visualiser around you
              other-side.ts   the train's other window: Provence and Cosmos
              types.ts        what a pack can say: layers, mapping rules, themes, light, fx, window
              around-the-world.ts  hidden until it gets its twist (?pack=around-the-world)
  render/     world.ts     sky, ground, carriage, stations, render loop, shader warm-up
              spawner.ts   the scheduler: score events → models placed to enter your view on the beat
              visualiser.ts  the non-Gondry view: a seeded sphere of plasma, flowers, waves and lightning
              otherside.ts the mirrored second window
              models.ts    every model, built from boxes, cylinders and lathes; `T(SURF.x, ...)` picks the surface
              shaders.ts   TSL node materials: one procedural material paints brick, glass, rust, foliage...
              fx.ts        post-processing looks (prism, trip, kaleido, liquid, thermal, echo, fold, hyper, tunnel, crt, film, glitch) and warp jumps
              pool.ts      instanced-mesh pools, so nothing allocates per frame
              flock.ts     starlings and fireworks
  ui/         look.ts (drag/keys/gyro), tuning.ts (piano roll), frames.ts (frame analyser, P), vr.ts
  main.ts     wires it all together: loading, phases, switching rides
```

## Your first remix in ten minutes

The smallest change that teaches the whole edit, preview, ride loop: a recoloured copy of the starship.

1. Create `src/packs/candy-starship.ts`:

   ```ts
   import type { Pack } from './types';
   import { STARSHIP } from './starship';

   // Everything as the starship, in candy colours.
   const CANDY = ['#ff7ac8', '#7af0ff', '#fff27a'];

   export const CANDY_STARSHIP: Pack = {
     ...STARSHIP,
     id: 'candy-starship',           // unique: it is the ?pack= name
     name: 'Candy starship',         // what the menu shows
     layers: STARSHIP.layers.map(l => ({ ...l, tints: { nebula: CANDY, belt: CANDY, deep: CANDY } })),
     window: { ...STARSHIP.window!, frame: '#ff9ad8', wall: '#5a2a4a' },
   };
   ```

2. Register it in `src/packs/index.ts`: `import { CANDY_STARSHIP } from './candy-starship';` and add `CANDY_STARSHIP` to `PACKS`.
3. With `npm run dev` running, open `http://localhost:5173/?pack=candy-starship&demo`. Every ship, rock and spire now comes in pink, cyan and lemon, and the cockpit frame is pink.
4. Try the next small step: change `light` (the sun's colour across the song), swap a layer's `models` for others from `render/models.ts`, or change `fx.cycle` to pick the psychedelic looks out of the far side.

## Make your own vehicle (the fun bit)

1. Copy `src/packs/starship.ts` to `src/packs/your-ride.ts`.
2. Pick your `layers`: for each one, a depth from the window, the models per theme, and how it scales with velocity, pitch (`pitchCenter`/`heightPerSemitone`) or note length (`lengthByDur`).
3. `mapping` decides which sounds go to which layer (kick, snare, hat, bass, melody, pads).
4. Add new models in `render/models.ts`. They are plain functions that merge primitives. Mark the materials with `T(SURF.glass, ...)`, `T(SURF.glow, ...)` and so on.
5. Set `vehicle` ('train' gives ground, rails and a carriage; 'ship' gives space all round and an open canopy), `window` (size and colours of the carriage), `light` (sun over the length of the song) and `otherSide` ('trippy' for a psychedelic mirror).
6. Add it to `PACKS` in `src/packs/index.ts` and it appears in the menu.

Keep the golden rule: **everything that moves must land on its beat** (by default it appears at the leading edge as it sounds; `rig.hitAt: 'centre'` times it to the middle of the view instead). The spawner handles that for you if your models stand on y=0, centred on x=0, with +z facing the viewer.

## Build a visualiser (reading the score)

Not everything has to be a ride. `src/render/visualiser.ts` is a whole show with no vehicle: you sit still and the world reacts. If you want to make another one, or remix it, this is how the score reads. Every field is in `src/score/types.ts`.

| Data | Where | What it feels like | How the non-Gondry view uses it |
|---|---|---|---|
| Kick | `events` with `kind: 'kick'` (also `U.kick`, a 0..1 value that decays after each hit) | the pulse | the whole sky pumps |
| Snare | `kind: 'snare'` (`U.snare`) | a crack | a lightning strike, or a starburst |
| Hats | `kind: 'hat'` (`U.hat`) | shimmer | sparks, or tumbling confetti |
| Bass notes | `stem: 'bass', kind: 'note'`, with `pitch` (MIDI) and `dur` | weight | rings blasting out from your gaze, or bubbles rising |
| Melody notes | `stem: 'other'` (or `'vocals'`), `kind: 'note'` | the tune, one note at a time | a flower per note: height = pitch, colour = note name |
| Pads | notes with `dur` ≥ 1.2 s | washes of harmony | big slow blooms, aurora, huge snowflakes |
| Melody pitch, continuous | `envelopes.leadPitch` (50 Hz, MIDI with fractions, 0 = silent; `bassPitch` too) | slides and glides | a wave round the horizon: future ahead, past behind |
| Loudness | `envelopes.mix`, per stem `drums` / `bass` / `other` | how full it is | glow |
| Brightness | `envelopes.bright` | filters opening | glow, colour speed |
| Build-ups and lifts | `envelopes.rise`, and lifts found ahead (`findLifts`: louder sections, loudness steps) | tension, then release | the clock rushes, rings converge on your gaze, the light strobes on the beat; a shockwave on the lift |
| Beats and bars | `beats` (with `bar`, `beat`), `phrases` (4-bar blocks) | the grid | timing of anything that should feel "on the one" |
| Sections | `sections` with `label` (intro, verse, chorus, breakdown, drop, outro), `energy`, and `group` (sections that sound alike share one) | the story | a scene change; a returning group brings its picture back with a new palette, a different-sounding part gets a different one |
| The whole song | everything above, read ahead (the analysis runs far ahead of the music) | the journey | the arc: dark and muted at the start, full colour only at the climax, holding its breath (greyer, darker, trails pulling in) before a drop and bursting on it |
| Big changes | sections compared by instrumentation (`findEras` in `visualiser.ts`) | a new chapter: a solo, a long intro, the drums dropping out | a whole new vibe, with its own journey (colour rise, complexity bloom or thaw) |

Rules of thumb:
- **Think about the shape of the music first.** Before adding an effect, ask where it belongs in a song's story: the long intro, the verse that comes back, the build, the drop, the breakdown, the last chorus. The drops are where this beats any VJ, so give a new effect a way to wind up before one and land on it.
- **You can see the future, so use it.** A classic visualiser only hears the present. This one knows where the song is going, so it can save its brightest colours for the climax and wind up before a drop. Read ahead up to `score.frontierSec`.
- **One kind of data, one kind of reaction.** Don't let the kick and the bass do the same thing; the viewer should be able to *see* which instrument is which.
- **Discrete things for notes, continuous things for continuous data.** A note is an object that appears; a slide is a line that bends. (This came from Alex and it is right.)
- **Spawners are cheap.** A `SpritePool` is an instanced mesh of glowing shapes; a new spawner is a polar outline plus a few lines (where it appears, how it drifts, how long it lives). Copy `bubble()` or `burst()` and make it yours.
- **Fold space, not just pictures.** Kaleidoscopes, fractals and mirrors are almost free in a shader: fold the coordinates before you draw anything, then fold them again.
- **Seed everything.** Draw scene parameters from a seeded random generator keyed by the song (`score.track.hash`), so a song always looks like itself, and let R reroll.
- **Change scenes on the music's terms**, at sections and new phrases, never on a timer, and make the change an event (a crash, a flash, a warp).
- Events up to `score.frontierSec` are final; never read beyond it while the analysis is still running.
- Uniforms shared by every shader (`U.kick`, `U.hue`, `U.energy`, `U.showTime`...) are written by `FxDirector` in `render/fx.ts`. The post-effects looks (trip, kaleido, liquid, prism, echo, thermal, fold, hyper, tunnel, crt, film, glitch) can be picked per scene through `fx.override`.

## Practicalities

- **Prerequisites:** Node 22 or newer (Vite 8 needs it; `.nvmrc` says 22, Node 24 works too), npm, and a browser with WebGPU or WebGL2 (any recent Chrome, Edge, Firefox or Safari). The headless checks also need a Chromium: `npx playwright-core install chromium`, or set `CHROME=/path/to/chrome`.
- `npm install`, then `npm run dev` (open the printed URL, add `?demo` for the generated demo song) or `npm run build`. Use `npm run build:single` for one self-contained HTML file.
- **`npm run smoke`** checks the prerequisites, builds, and plays the demo headless on the train and in the non-Gondry view, failing on any page or console error. Exit code 2 means something is missing on the machine (install it); 1 means the project is broken. CI runs it on every push.
- `npm run typecheck` before you commit. `shaders.ts` and `fx.ts` are `@ts-nocheck` because TSL typing is loose, so test by running.
- Screenshots at chosen moments: `npm run build`, then `node tools/e2e.mjs --webgl --virtual --query "start=30" --shots 33 --out shots` (add `--strict` to fail on errors). The `--virtual` flag steps the clock 1/30 s per frame, so software rendering still produces exact frames.
- **When something fails,** tell the environment from the project: a sandbox refusing a port or a download, a missing browser, or an old Node is the machine; a TypeScript error or a page error in the smoke test is the project.
- Debug helpers in the app: D (debug overlay), T (tuning screen), P (frame analyser), X (force an effects look), G (wandering-viewer test).
- Performance: three builds a shader per InstancedMesh, so a new model costs a shader build the first time it appears. `World.warmup` pre-builds them; keep new models on the shared scenery material.
- Third-party code keeps its own licence: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). If you add a dependency, add it there.

## Come in buzzing

People open this repo to play. Plenty of them don't yet know how much a capable coding model
(Claude Opus 5.5, say) can build with them in a sitting, so show them. In your first message, before
any instructions arrive:

1. **Get into the vibe.** Say hello like a friend who has just walked into the studio and seen the
   toys. One line on what the Gondryator does is plenty.
2. **Personalise.** Look at what you can see: today's date (Halloween? Christmas? someone's
   birthday?), the time of day, the music they mention, the branch they are on, anything they have
   already said. Ask one quick question if it helps, like "What are you listening to this week?"
   or "Who is your favourite band?", but always pitch ideas in the same message.
3. **Build on what they know and love.** Everyone has a passion: a job, a hobby, a place, a game, a
   science, a sport, a craft. Find out what theirs is (ask, or notice it) and turn it into ideas
   only they would want. A trainspotter gets a branch line where every note is a different class of train passing the window. A gardener gets a ride through their own allotment, flowers opening on
   every note. A cyclist gets a peloton keeping time down an Alpine descent. An astronomer gets the
   real planets lining up on the drop, a chemist a periodic table that lights up with the melody,
   a knitter a scarf that knits itself one row per bar. Ask what they would add, and use their
   words.
4. **Pitch four to six ideas.** Mix small ones (done in minutes) with big ones (a whole new ride).
   Take a couple from the seeds below and **make up at least two of your own**. Seeds are a starting
   point, not a menu.
5. **Recommend one small first change and start on it** (see [First session](#first-session-do-this-in-this-order)): get the app running while they decide. Then keep pitching as you work: "while I was in there I thought, what if the stars froze on the breakdown?"

**Even bad ideas are good ideas for a visualiser.** A whale, a cake, a haunted dishwasher: say it.
The worst outcome is a funny screenshot. Be specific (which instrument, which moment in the song,
what it looks like) so the idea is something you could build this afternoon.

### Seeds

Real prompts that shaped this project:

- "Add a glitterball to the non-Gondry view. It could hold a scene on its own: colours striking it, spinning faster with the energy, swinging in on the drop."
- "The rainbow palette is overused. Give me palettes of two or three colours that feel like embers, ocean, ice."
- "Flowers never show up on Star Guitar. Find out why." (It was one wrong coordinate in a shader.)
- "When the song starts at the station, fill the wait: a platform clock and a departures board that counts down."
- "We have a 70s closer and an 80s one. Give every decade its own, picked by the song's year."
- "Dig deep into the Amiga demo scene." (Twisters, Kefrens bars, unlimited bobs and a sine scroller came out of it.)

Rides and worlds:

- **Halloween:** gothify everything. A ghost train through a graveyard at midnight, gravestones on the kicks, bats flapping off on the hi-hats, jack-o'-lanterns lighting up with the melody, fog rolling in on the breakdown, a full moon that swells with the bass.
- **Be a comet round a supernova.** Swing in close on the build, get flung out on the drop, the star collapsing into a pulsar that ticks on the beat.
- **A non-Euclidean party at R'lyeh.** Angles that are wrong, corridors that fold back on themselves, tentacles keeping time, a bass so low the geometry wobbles.
- What if the train drove through a cake? Sponge strata on the kicks, candles on the snares, icing dripping on the long notes.
- An ant's-eye ride through a garden, a submarine past glowing jellyfish, a hot-air balloon over a city that builds itself to the melody.

Shows, journeys, drops and outros:

- **A totally new journey** for the non-Gondry view: a song that starts as a pencil sketch and ends in full neon, or one that freezes over and thaws.
- **Extend the effects that are there now:** give the fireworks a finale, let the twister tie itself in a knot on the drop, make the LED wall spell out the song title.
- **Epic drops:** the screen shatters like glass, everything holds its breath in black and white for a bar, then the colour comes back all at once.
- **Crazy outros:** the world folds up like origami, the credits roll as a Star-Wars-style crawl (your own words, not theirs), the train pulls into a station made of the song's waveform.
- **Integrate artwork from a folder:** the user's own photos or drawings (read locally, never uploaded) as posters at the station, panels on the LED wall, or tiles in the kaleidoscope.
- **Celebrate your favourite band:** their era's look, their colours, the mood of their records, the decade closer they deserve. Their spirit, never their logos or artwork.
- A birthday mode: someone's name on the sine scroller and a cake on the platform.
- Make the weather follow the music: rain on the minor-key verses, sun breaking through on the chorus.

Close with something like: "I can go further than you'd expect: new shaders, new vehicles, whole new
shows. Play, explore, create!"

## Share it

Made something lovely? Fork it, publish it, and show it off in the [Discord](https://discord.gg/xhHcDVfDwQ). All hail the great Michel Gondry: may your visuals play with every track.
