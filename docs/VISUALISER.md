# The non-Gondry view, explained

*"The non-Gondry view :("* is the ride with no vehicle. You sit still at the centre of a sphere of light, and the world around you plays the song. This is a human guide to how it thinks: what it listens to, how it decides what to show, and how a song becomes a journey. For the general architecture see [TECHNOLOGY.md](TECHNOLOGY.md); for the code, `src/render/visualiser.ts` and `src/render/shaders.ts`.

Try it: <https://gondryator.starsystemx.com/?pack=non-gondry>, or `?pack=non-gondry&demo` locally.

## One instrument, one kind of reaction

The first rule is that you should be able to *see* which instrument is which. Each kind of data drives its own kind of thing.

```mermaid
flowchart LR
    K[🥁 Kick] --> K1[the whole sky pumps]
    SN[🥁 Snare] --> S1[lightning · starbursts · lasers]
    H[🥁 Hats] --> H1[sparks · confetti · fireflies]
    B[🎸 Bass notes] --> B1[rings blasting from your gaze · bubbles]
    M[🎹 Melody notes] --> M1[a flower per note:<br/>height = pitch, colour = note name]
    P[🎻 Pads, long notes] --> P1[aurora · nebula · snowflakes · petals]
    LP[〰️ Melody pitch, continuous] --> LP1[a wave round the horizon:<br/>ahead of you is what is coming]
    E[📈 Loudness, brightness, build-ups] --> E1[glow, colour speed, tension]
```

**Notes are things; slides are lines.** A note is an object that appears; a pitch that glides is a line that bends.

## The cast: 51 elements in five groups

Every effect belongs to an instrument group, and only groups that are actually playing get shown.

```mermaid
mindmap
  root((elements))
    drums
      kick tunnel
      lightning
      sparks
      drum floor
      starbursts
      confetti
      checker tunnel
      stained glass
      hex pulse
      lasers
      fireflies
      fireworks
      LED wall
    bass
      bass rings
      bass mountains
      sub breathe
      bubbles
      synthwave sun
      metaballs
      fire
      twister
    melody
      melody wave
      flowers
      note circle
      julia set
      lissajous
      light rain
      comets
      sine scroller
      Kefrens bars
      unlimited bobs
    pads
      aurora
      nebula
      snowflakes
      galaxy
      caustics
      petal rain
      oil wheel
    mix
      plasma
      shapes
      ribbons
      starfield
      fractal kaleidoscope
      spectrum
      copper bars
      moire
      truchet
      rotozoomer
      glitterball
      atom
      dot sphere
```

Over all of that sits a **post-effects look** per scene (clean, echo, liquid, kaleido, fold, tunnel, prism, hyper, trip, thermal, CRT, film, glitch), plus folding mirrors, fractal depth and feedback trails.

## Scenes: who is on stage

A *scene* is a handful of numbers: a palette, two or three elements, a look, kaleidoscope folds, trails. They are drawn from a random generator seeded by the song, so **a song always looks like itself**, and R rerolls it.

```mermaid
flowchart TB
    SEC[a new section starts] --> Q{has this part<br/>played before?}
    Q -- yes --> R[bring its pattern back<br/>with a new palette and phase]
    Q -- no --> O[orchestrate: which instrument groups<br/>play in the next 8 seconds?]
    O --> PICK[pick 2 elements, 3 if energetic,<br/>favouring ones not seen lately]
    R --> RUN{straight after itself?<br/>C C C C}
    RUN -- yes --> ALT[alternate two takes: C1 C2 C1 C2<br/>the second wears another look]
    RUN -- no --> APPLY
    ALT --> APPLY[apply, with a crash<br/>that hides the cut]
    PICK --> APPLY
```

Between sections, things keep moving:
- **Twists:** on each new four-bar phrase (once a picture has held for about 6 seconds), and in any case before it has sat still for 14, either one element is swapped for a fresh one, or the scene is re-dressed (palette, mirrors, shapes, look) with a flash.
- **New melody phrases:** when the lead comes back in after a breath, the scene changes.
- **Exhales:** a section clearly quieter than the last thins out to one or two elements with long, slow trails, so the next lift has somewhere to go.

## Reading the song's shape

Because the score is read ahead, the show knows the whole song before it gets there. A classic visualiser can't do this.

```mermaid
xychart-beta
    title "The arc of a song (illustration)"
    x-axis ["intro", "A", "A", "B", "breakdown", "drop", "C", "B", "outro"]
    y-axis "brightness and colour allowed" 0 --> 1
    line [0.3, 0.4, 0.45, 0.55, 0.35, 0.8, 0.9, 1.0, 0.4]
```

- **The arc:** the loudness of the song, smoothed and normalised, sets a ceiling on colour and brightness. The opening stays dark and muted even when loud; full colour is saved for the **climax**.
- **Tension:** in the eight seconds before a lift (a drop, a louder section, the end of a build-up) the show holds its breath. It goes greyer and darker, its trails pull inwards and its clock rushes. Then it lets go on the beat with a shockwave from your gaze.
- **Eras:** stretches whose instrumentation is clearly different (a long intro, a solo, a breakdown with the drums gone) each get a new vibe and one of three **journeys**:
  - **colour rise:** dark and muted to full colour;
  - **complexity bloom:** one element and plain mirrors growing to a deep, crowded kaleidoscope;
  - **thaw:** icy monochrome warming into the palette.

## The song's story, start to finish

```mermaid
flowchart LR
    W[⏳ waiting<br/>neon song card,<br/>glitterball] --> I[intro<br/>dark, few elements]
    I --> V[verses and choruses<br/>parts come back as<br/>themselves, re-coloured]
    V --> T[build<br/>holding its breath]
    T --> D[💥 drop<br/>shockwave, crash]
    D --> C[🎆 climax showpiece<br/>once per song]
    C --> O[🌙 outro<br/>a calm scene, then<br/>fade to clean black]
```

**The climax showpiece** arrives once, in the section holding the song's peak. It is chosen per song, seeded so a song keeps its own:
- **Timeless set pieces** (galaxy and comets, fractal lightning, Julia set and confetti, fire and flowers, caustics and copper bars) are the most common.
- **Decade closers** are picked by the song's release year: the 50s atom on old film; the 60s oil-wheel light show; the 70s glitterball; the 80s outrun sun or an Amiga megademo; the 90s rave; the 00s fireworks; the 10s main-stage LED wall; the 20s glitch. A song gets its own decade's closer only about one time in four. Any closer can turn up for any song now and then, so a folder of songs from one era doesn't keep repeating.

**The outro** takes the last twelve seconds or so, or the closing outro section. It is a calm scene (stars and the galaxy, aurora and nebula, the oil wheel flickering out on film, sinking under water, the dot globe, or simply the scene as it was). It then fades to black over six seconds. No new sparks are thrown and the trails dry up, so the curtain comes down on a clean screen.

## What to react to, if you build your own

| Data in the score | Feels like | A good reaction |
|---|---|---|
| `kind: 'kick'` | the pulse | something big and global, once per hit |
| `kind: 'snare'` | a crack | a sharp, local strike |
| `kind: 'hat'` | shimmer | many small, short-lived things |
| bass `note` with `pitch`, `dur` | weight | something that radiates or rises from low down |
| melody `note` | the tune | one object per note; height from pitch, colour from note name |
| notes with `dur` ≥ 1.2 s | harmony washes | big, slow blooms |
| `envelopes.leadPitch` | slides and glides | a continuous line that bends |
| `envelopes.mix` and per stem | fullness | glow and density |
| `envelopes.bright` | filters opening | colour speed, sparkle |
| `envelopes.rise` and lifts ahead | tension, release | wind up before, burst on the beat |
| `beats`, `phrases` | the grid | timing anything that should land "on the one" |
| `sections` with `group` | the story | scene changes; repeated groups come back as themselves |

The data table in [AGENTS.md](../AGENTS.md#build-a-visualiser-reading-the-score) has the full field names and rules of thumb.

## Handy switches for trying things

| URL parameter | Does |
|---|---|
| `?pack=non-gondry` | open the non-Gondry view |
| `&demo` | play the generated demo song |
| `&viz=45,32` | pin those elements (indexes from `ELEMENTS` in `visualiser.ts`) |
| `&decade=1980` | pin a decade's closer |
| `&bass=3` | pin a bass style |
| `&fb=0` | turn the feedback trails off |
| keys **R** · **X** · **D** | new seed · force an effects look · debug overlay with the song's lettered structure |
