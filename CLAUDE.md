# Welcome aboard, agent 🚆🎶

You have just walked into the Gondryator: a browser toy that turns any song into a ride. The world outside the window keeps time with the music: a pole on every kick, a shed on every snare, a skyline that hums the melody. Turn round in your seat and the other window has gone somewhere else entirely.

Read this before you touch anything. It covers the spirit first and the code second, and the spirit matters more.

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
              fx.ts        post-processing looks (prism, trip, kaleido, liquid, thermal, echo, fold, hyper, tunnel) and warp jumps
              pool.ts      instanced-mesh pools, so nothing allocates per frame
              flock.ts     starlings and fireworks
  ui/         look.ts (drag/keys/gyro), tuning.ts (piano roll), frames.ts (frame analyser, P), vr.ts
  main.ts     wires it all together: loading, phases, switching rides
```

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
| Build-ups | `envelopes.rise` | tension | everything runs hotter |
| Beats and bars | `beats` (with `bar`, `beat`), `phrases` (4-bar blocks) | the grid | timing of anything that should feel "on the one" |
| Sections | `sections` with `label` (intro, verse, chorus, breakdown, drop, outro) and `energy` | the story | a scene change; a returning label brings its pattern back with a new palette |
| The whole song | everything above, read ahead (the analysis runs far ahead of the music) | the journey | the arc: dark and muted at the start, full colour only at the climax, holding its breath (greyer, darker, trails pulling in) before a drop and bursting on it |
| Big changes | sections compared by instrumentation (`findEras` in `visualiser.ts`) | a new chapter: a solo, a long intro, the drums dropping out | a whole new vibe, with its own journey (colour rise, complexity bloom or thaw) |

Rules of thumb:
- **You can see the future, so use it.** A classic visualiser only hears the present. This one knows where the song is going, so it can save its brightest colours for the climax and wind up before a drop. Read ahead up to `score.frontierSec`.
- **One kind of data, one kind of reaction.** Don't let the kick and the bass do the same thing; the viewer should be able to *see* which instrument is which.
- **Discrete things for notes, continuous things for continuous data.** A note is an object that appears; a slide is a line that bends. (This came from Alex and it is right.)
- **Spawners are cheap.** A `SpritePool` is an instanced mesh of glowing shapes; a new spawner is a polar outline plus a few lines (where it appears, how it drifts, how long it lives). Copy `bubble()` or `burst()` and make it yours.
- **Fold space, not just pictures.** Kaleidoscopes, fractals and mirrors are almost free in a shader: fold the coordinates before you draw anything, then fold them again.
- **Seed everything.** Draw scene parameters from a seeded random generator keyed by the song (`score.track.hash`), so a song always looks like itself, and let R reroll.
- **Change scenes on the music's terms**, at sections and new phrases, never on a timer, and make the change an event (a crash, a flash, a warp).
- Events up to `score.frontierSec` are final; never read beyond it while the analysis is still running.
- Uniforms shared by every shader (`U.kick`, `U.hue`, `U.energy`, `U.showTime`...) are written by `FxDirector` in `render/fx.ts`. The post-effects looks (trip, kaleido, liquid, prism, echo, thermal, fold, hyper, tunnel) can be picked per scene through `fx.override`.

## Practicalities

- `npm install`, then `npm run dev` (open the printed URL) or `npm run build`. Use `npm run build:single` for one self-contained HTML file.
- `npm run typecheck` before you commit. `shaders.ts` and `fx.ts` are `@ts-nocheck` because TSL typing is loose, so test by running.
- Headless check: `node tools/e2e.mjs --webgl --virtual --query "start=30" --shots 33 --out shots`. The `--virtual` flag steps the clock 1/30 s per frame, so software rendering still produces exact frames.
- Debug helpers in the app: D (debug overlay), T (tuning screen), P (frame analyser), X (force an effects look), G (wandering-viewer test).
- Performance: three builds a shader per InstancedMesh, so a new model costs a shader build the first time it appears. `World.warmup` pre-builds them; keep new models on the shared scenery material.
- Third-party code keeps its own licence: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). If you add a dependency, add it there.

## Share it

Made something lovely? Fork it, publish it, and show it off in the [Discord](https://discord.gg/xhHcDVfDwQ). All hail the great Michel Gondry: may your visuals play with every track.
