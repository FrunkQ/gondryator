// The non-Gondry view :( -- no train, no window, no travel. You sit still at the centre of a
// sphere of light and every kind of data in the score drives something different:
//
//   melody notes      flowers that splash open at their pitch (higher = higher up), coloured by
//                     note name round the rainbow, then slide down and fade
//   pads (long notes) big slow blooms further out
//   melody pitch      a wave of light round the horizon: ahead of your gaze is what is coming,
//                     behind it what has played (leadPitch envelope, so slides glide)
//   bass notes        rings that blast outwards from wherever you are looking
//   kick              the whole sky pumps (U.kick), and the plasma jumps
//   snare             lightning strikes
//   hats              sparks
//   build-ups, brightness   everything glows hotter (rise, bright envelopes)
//   sections, melody phrases  a scene change: the old scene crashes into something fresh
//   the whole song    the arc: because the analysis runs ahead of the music, the show knows
//                     where the song is going. It opens dark and muted, gains light and colour as
//                     the song builds, and only reaches full brightness at the climax. Before a
//                     big jump in loudness (a drop) it holds its breath: darker, greyer, the trails
//                     sucking inwards, and then it lets go on the beat.
//   big changes       eras: stretches of the song whose instrumentation is clearly different (a
//                     long intro, a solo, a breakdown with the drums gone) are found in advance.
//                     Each era resets the vibe (new seed, forgotten patterns) and gets one of
//                     three journeys for its arc: a colour rise (dark and muted to full colour),
//                     a complexity bloom (one element and plain mirrors growing to a deep,
//                     crowded kaleidoscope) or a thaw (icy monochrome warming into the palette).
//
// There is a library of sixteen elements (ELEMENTS below), each belonging to one instrument
// group. At every scene change the director looks at which groups are actually playing over the
// next few seconds and picks two or three elements from them (three when the section is
// energetic), so the picture is orchestrated by the song's shape rather than showing everything
// at once. The weights fade, the crash hides the cut.
//
// A scene is a handful of numbers (palette, plasma frequency, swirl, kaleidoscope segments,
// pattern mix, drift speed, post-effects look) drawn from a seeded random generator, so every
// song gets its own set and the same song looks the same next time. Sections that come back
// (a second chorus) bring their pattern back with a new palette and phase. R rerolls the seed.

import { QUALITY } from './quality';
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { makeGlitterMaterial, makeSpriteMaterial, makeVisualiserMaterial, PALETTES as PALETTES_BY_NAME, SHELL_RISE } from './shaders';
import { fireworkCues } from './cues';
import type { CardInfo, ShowDriver } from './driver';
import type { GazeSource } from './spawner';
import type { FxLookName, Pack } from '../packs/types';
import { gridAt, sampleEnvelope, sectionAt, subPartAt, type Score, type SoundCue, type SoundKind } from '../score/types';

type Vec3 = [number, number, number];
// The palettes are shared with the rides (shaders.ts PALETTES); the show uses them all.
const PALETTES = Object.values(PALETTES_BY_NAME);
type Group = 'drums' | 'bass' | 'melody' | 'pads' | 'mix';
/** The element library. The index is the element's slot in the shader's weights (E0..E3). */
export const ELEMENTS: { name: string; group: Group }[] = [
  { name: 'plasma', group: 'mix' },          // 0  seeded plasma, rings and tunnel stripes
  { name: 'shapes', group: 'mix' },          // 1  nested spinning polygons and stars
  { name: 'ribbons', group: 'mix' },         // 2  drums / bass / rest as ribbons round the horizon
  { name: 'starfield', group: 'mix' },       // 3  stars streaming out of your gaze
  { name: 'kick tunnel', group: 'drums' },   // 4  a ring flung out from your gaze on every kick
  { name: 'lightning', group: 'drums' },     // 5  a strike on every snare
  { name: 'sparks', group: 'drums' },        // 6  hats
  { name: 'drum floor', group: 'drums' },    // 7  a grid floor whose cells flash with the drums
  { name: 'bass rings', group: 'bass' },     // 8  rings blasting out from your gaze per bass note
  { name: 'bass mountains', group: 'bass' }, // 9  a wireframe range as tall as the bass is loud
  { name: 'sub breathe', group: 'bass' },    // 10 the whole pattern swells with the bass
  { name: 'melody wave', group: 'melody' },  // 11 the melody's pitch as a wave round the horizon
  { name: 'flowers', group: 'melody' },      // 12 a flower per note
  { name: 'note circle', group: 'melody' },  // 13 twelve note names in a ring; each lights as played
  { name: 'aurora', group: 'pads' },         // 14 curtains of light swaying with the pads
  { name: 'nebula', group: 'pads' },         // 15 clouds that bloom with the pads
  { name: 'fractal kaleidoscope', group: 'mix' }, // 16 a fold-and-invert fractal through a kaleidoscope
  { name: 'bubbles', group: 'bass' },        // 17 a ring bubbling up from below per bass note
  { name: 'starbursts', group: 'drums' },    // 18 a spiky star popping near your gaze per snare
  { name: 'confetti', group: 'drums' },      // 19 diamonds tumbling down on the hats
  { name: 'snowflakes', group: 'pads' },     // 20 a huge slow twelve-armed flake per long note
  // The second twenty (shaders.ts moreElements): classic visualisers, the demoscene, the club.
  { name: 'spectrum', group: 'mix' },        // 21 the bar analyser round the horizon
  { name: 'checker tunnel', group: 'drums' },// 22 falling down a chequered tube, kicked on
  { name: 'copper bars', group: 'mix' },     // 23 Amiga raster bars bouncing up the sky
  { name: 'synthwave sun', group: 'bass' },  // 24 a striped sun on the horizon, swelling with the bass
  { name: 'metaballs', group: 'bass' },      // 25 blobs orbiting your gaze, merging and parting
  { name: 'julia set', group: 'melody' },    // 26 a fractal bent by the melody's pitch
  { name: 'stained glass', group: 'drums' }, // 27 cells with glowing leading, flashing on the hats
  { name: 'moire', group: 'mix' },           // 28 two sets of rings drifting through each other
  { name: 'lissajous', group: 'melody' },    // 29 the oscilloscope figure, tuned by melody and bass
  { name: 'hex pulse', group: 'drums' },     // 30 a honeycomb rippling out on every kick
  { name: 'galaxy', group: 'pads' },         // 31 a spiral turning overhead
  { name: 'lasers', group: 'drums' },        // 32 fans of beams fired by the snare
  { name: 'truchet', group: 'mix' },         // 33 arc tiles flipping on the beat
  { name: 'fire', group: 'bass' },           // 34 flames off the horizon, tall as the bass
  { name: 'caustics', group: 'pads' },       // 35 light through water across the sky
  { name: 'rotozoomer', group: 'mix' },      // 36 a spinning, zooming plaid
  { name: 'light rain', group: 'melody' },   // 37 columns of falling light, bright with the melody
  { name: 'comets', group: 'melody' },       // 38 a comet streaking across per melody note
  { name: 'fireflies', group: 'drums' },     // 39 fireflies drifting up on the hats
  { name: 'petal rain', group: 'pads' },     // 40 petals falling from every long note
  { name: 'glitterball', group: 'mix' },     // 41 the ball spins up in front of you and throws light round the room
  { name: 'sine scroller', group: 'melody' }, // 42 the song's name in chrome letters, bouncing round the horizon
  { name: 'atom', group: 'mix' },            // 43 the atomic age: electrons whirling round a nucleus that throbs with the bass
  { name: 'oil wheel', group: 'pads' },      // 44 a 60s liquid light show: coloured oil pressed between glass
  { name: 'fireworks', group: 'drums' },     // 45 shells bursting all round the sky: peonies, rings, golden willows
  { name: 'LED wall', group: 'drums' },      // 46 a festival screen round the horizon, a new pattern every bar
  { name: 'twister', group: 'bass' },        // 47 the Amiga twister: a bar twisting like rubber, wrung by the bass
  { name: 'kefrens bars', group: 'melody' }, // 48 the Kefrens bars: one shaded bar redrawn down the screen, snaking
  { name: 'dot sphere', group: 'mix' },      // 49 a globe of dots in 3D, spinning and morphing into a torus
  { name: 'unlimited bobs', group: 'melody' }, // 50 a shaded ball whose trail never clears, tracing figures
];
const NE = ELEMENTS.length;
/**
 * Outros: how the show winds down over the song's last seconds (seeded per song). Each is one or
 * two calm elements with a look; then everything fades to black, the trails dry up and no new
 * sparks are thrown, so the curtain comes down on a clean screen.
 */
const OUTROS: { elements: number[]; look: FxLookName }[] = [
  { elements: [3, 31], look: 'clean' },   // drifting off into the stars, the galaxy turning overhead
  { elements: [14, 15], look: 'clean' },  // the aurora and the nebula, lights going down
  { elements: [44], look: 'film' },       // the oil wheel on an old projector, flickering out
  { elements: [35], look: 'liquid' },     // sinking under water, the light fading above
  { elements: [49], look: 'clean' },      // the dot globe, turning slower as the lights go
  { elements: [], look: 'clean' },        // the scene as it was, simply fading to black
];
/** How often each kind of recognised sound repeats its effect while it lasts (seconds; impacts only hit once). */
const SOUND_PERIOD: Record<SoundKind, number> = {
  speech: 0.25, shout: 0.5, laugh: 0.3, sing: 0.7, crowd: 0.25, animal: 1.1, nature: 0.2,
  siren: 0.35, engine: 0.6, impact: 1e9, whoosh: 0.6, tick: 0.5, beep: 0.4,
};
/** The last stretch of a song given to its outro, and the fade to black at its very end. */
const OUTRO_LEN = 12, OUTRO_FADE = 6;
/** The elements drawn as sprites (flowers, bubbles, starbursts, confetti, snowflakes). */
const SPRITE_ELEMENTS = [12, 17, 18, 19, 20, 38, 39, 40];

/** How the arc shows itself, one per era (see updateArc and the shader's arc block). */
export const JOURNEYS = ['colour rise', 'complexity bloom', 'thaw'] as const;
/** A stretch of the song with its own vibe. */
export interface Era { t: number; kind: 'intro' | 'solo' | 'breakdown' | 'drive'; journey: number }

// Post-effects looks for scenes. The gentle ones come up more often, so the scene's own palette
// carries the colour and the loud looks (trip, thermal) stay a treat.
const LOOKS: FxLookName[] = ['clean', 'clean', 'echo', 'echo', 'liquid', 'kaleido', 'fold', 'tunnel', 'prism', 'hyper', 'trip', 'thermal'];
/** Never let the picture sit unchanged longer than this (seconds). */
const MAX_STILL = 14;
/** ...and don't twist it more often than this, unless a section starts. */
const MIN_STILL = 6;

interface Scene {
  palette: number;
  shape: [number, number, number, number]; // plasma frequency, swirl, kaleido segments, speed
  mixes: [number, number, number, number]; // plasma, rings, tunnel, phase
  look: FxLookName;
  /** Layer weights: vector shapes, band ribbons, (unused), mirror about the horizon. */
  layers: [number, number, number, number];
  /** Shapes: sides, how many nested, spin speed, starriness. */
  poly: [number, number, number, number];
  /**
   * The outline of everything that pulses out from your gaze (bass rings, kick ring, tunnel):
   * sides (0 = a circle), starriness, spin, wobble (lobes on a circle). So not every scene is
   * concentric circles.
   */
  pulse: [number, number, number, number];
  /**
   * How the bass pulses: 0 rings from your gaze, 1 waveform lines rolling off the horizon (like an
   * old Fairlight's waterfall display), 2 several circles round your gaze, 3 bars racing down a road
   * towards you, 4 a swell over the whole sky, like a filter opening; then how many circles.
   */
  bassMode: [number, number];
  /** Video feedback: amount, zoom per frame, turn per frame, colour drift. */
  feedback: { amount: number; zoom: number; turn: number; hue: number };
  /** Deep kaleidoscope on the base pattern: levels (0..5), turn per level, stretch, slide. */
  fold: [number, number, number, number];
  /** Fractal kaleidoscope: mirrors round the gaze, scale, fold constant, drift speed. */
  frac: [number, number, number, number];
  /** Which elements show (indices into ELEMENTS). */
  elements: number[];
  /** The horizon: lean (radians), how fast its axis turns (radians/s), and a ceiling (0 or 1). */
  tilt?: [number, number, number];
}

/** A level horizon about half the time; otherwise it leans, now and then right over, turning slowly. */
function randomTilt(r: () => number): [number, number, number] {
  const k = r();
  const lean = k < 0.45 ? 0 : k < 0.85 ? 0.25 + r() * 0.45 : 0.8 + r() * 0.6;
  return [lean, lean ? (r() < 0.5 ? -1 : 1) * (0.03 + r() * 0.09) : 0, r() < 0.3 ? 1 : 0];
}

/** Elements that read as a VU meter or concentric rings: picked less often (see freshest). */
const RARE = new Set([2, 4, 8, 21, 30]);

/** An outline for the pulses: a circle now and then, more often a polygon, a star or a wobbly blob. */
function randomPulse(r: () => number): [number, number, number, number] {
  const k = r();
  if (k < 0.25) return [0, 0, 0, 0];                                         // circle
  if (k < 0.55) return [3 + Math.floor(r() * 5), 0, (r() - 0.5) * 0.8, 0];   // polygon, turning
  if (k < 0.8) return [4 + Math.floor(r() * 5), 0.6 + r() * 0.4, (r() - 0.5) * 0.6, 0]; // star
  return [0, 0, (r() - 0.5) * 0.6, 2 + Math.floor(r() * 5)];                // blob with lobes
}

function randomBassMode(r: () => number): [number, number] {
  const k = r();
  return k < 0.2 ? [0, 1] : k < 0.4 ? [1, 1] : k < 0.6 ? [2, [2, 4, 6][Math.floor(r() * 3)]] : k < 0.8 ? [3, 1] : [4, 1];
}

/**
 * Showpieces for the climax, one per song. The glitterball (41) is one of four, so it stays a
 * treat; the rest pair a big backdrop with something that fires on the drums or the notes.
 */
const OUTRUN = [24, 7, 8];
/** The Amiga megademo: copper bars, a rotozoomer, a starfield and the song's name on a sine scroller. */
const MEGADEMO = [42, 23, 36, 3];
/** The other Amiga classics the megademo draws two of, so no two demos are the same. */
const DEMO_PARTS = [23, 36, 3, 47, 48, 49, 50];
/** The 50s: an atom, atomic starbursts, all on flickering old film. */
const ATOMIC = [43, 18, 3];
/** The 60s: an oil-wheel light show, op-art moire, blobs. */
const LIQUID_LIGHT = [44, 28, 25];
/** The 70s: the glitterball (and lasers, when it is loud). */
const DISCO = [41];
/** The 90s rave: lasers, the honeycomb pulsing, falling down the tunnel, hyperspace. */
const RAVE = [32, 30, 22];
/** The 00s: fireworks, an overwhelming display. */
const FIREWORKS = [45, 18, 6];
/** The 10s: the festival main stage. LED wall, confetti cannons, lasers. */
const MAIN_STAGE = [46, 19, 32];
/** The 20s: everything glitching, digital rain, tiles flipping. */
const GLITCH = [37, 33, 25];
/** Each decade's closers (a song's release year picks the decade; otherwise any of them can come up). */
const DECADES: Record<number, number[][]> = {
  1950: [ATOMIC], 1960: [LIQUID_LIGHT], 1970: [DISCO], 1980: [OUTRUN, OUTRUN, MEGADEMO], 1990: [RAVE, MEGADEMO],
  2000: [FIREWORKS], 2010: [MAIN_STAGE], 2020: [GLITCH],
};
const CLIMAXES: number[][] = [
  DISCO,
  OUTRUN,        // the ultimate 80s: synthwave sun, neon grid, the horizon pulsing on the bass, CRT
  [31, 38, 18],  // galaxy overhead, comets, starbursts
  [16, 5, 40],   // deep fractal kaleidoscope, lightning, petal rain
  [26, 22, 19],  // julia set, checker tunnel, confetti
  [34, 30, 12],  // fire off the horizon, hex pulse, flowers
  [35, 23, 20],  // caustics, copper bars, snowflakes
  MEGADEMO, ATOMIC, LIQUID_LIGHT, RAVE, FIREWORKS, MAIN_STAGE, GLITCH,
];
/** The closers that belong to no decade. */
const TIMELESS = CLIMAXES.slice(2, 7);
const DECADE_PIN = Number(new URLSearchParams(location.search).get('decade')) || 0;
/**
 * The closer for this song (seeded, so a song keeps its own). Its own decade's closer is a treat,
 * not a habit: about one song in four of that era. Every other song draws from everything else,
 * timeless set pieces more often, other decades' now and then. ?decade=1980 pins that decade's.
 */
function pickClimax(r: () => number, year: number | undefined): number[] {
  const any = (l: number[][]) => l[Math.floor(r() * l.length)];
  if (DECADE_PIN) return any(DECADES[Math.max(1950, Math.min(2020, Math.floor(DECADE_PIN / 10) * 10))]);
  const own = year ? DECADES[Math.max(1950, Math.min(2020, Math.floor(year / 10) * 10))] : [];
  if (own.length && r() < 0.25) return any(own);
  // Otherwise anything else: the decade pieces aren't locked to their decade, they just come up
  // less often than the timeless ones, so a folder of songs from one era doesn't keep repeating.
  const others = CLIMAXES.filter(c => !own.includes(c));
  return r() < 0.6 ? any(TIMELESS) : any(others.filter(c => !TIMELESS.includes(c)));
}

/**
 * The scroller's text: the song and the artist in fat chrome capitals, the way a demo greeted the
 * world, on a strip that wraps round the horizon twice.
 */
function scrollerTexture(score: Score): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4096; c.height = 160;
  const g = c.getContext('2d')!;
  const t = score.track;
  const words = [t.title || 'The Gondryator', t.artist].filter(Boolean).join('  ·  ').toUpperCase();
  const text = `★  ${words}  ★  ALL HAIL THE GREAT MICHEL GONDRY  ★  ${words}  ★  REMIX ME  ★  `;
  let size = 120;
  g.font = `900 ${size}px system-ui, sans-serif`;
  while (g.measureText(text).width > c.width - 20 && size > 40) { size -= 4; g.font = `900 ${size}px system-ui, sans-serif`; }
  g.textBaseline = 'middle';
  const grad = g.createLinearGradient(0, 20, 0, 140);
  grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.45, '#9fd8ff'); grad.addColorStop(0.5, '#1a2a6a'); grad.addColorStop(0.75, '#ff9adf'); grad.addColorStop(1, '#ffffff');
  g.fillStyle = grad;
  const w = g.measureText(text).width;
  g.fillText(text, (c.width - w) / 2, 82);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Small, fast, seedable random numbers (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }

const R_SPRITE = 60;

/**
 * One thing a spawner threw into the sky. It lives at (az, el) on a sphere round you, drifts by
 * (vAz, vEl) radians a second, pops open over `pop` seconds, grows by `grow` per second and fades
 * out over its last `fadeOut` seconds. Hue and saturation colour it; vel scales its brightness.
 */
/** How far ahead of a note its sprite may start opening, so it is full on the beat (s). */
const PREROLL = 0.35;

interface Sprite { t0: number; life: number; az: number; el: number; size: number; vAz: number; vEl: number; spin: number; hue: number; sat: number; vel: number; pop: number; grow: number; fadeOut: number; wobble: number }

/** An instanced mesh plus a ring buffer of sprites: the flowers, bubbles, starbursts... all use one. */
class SpritePool {
  readonly mesh: THREE.InstancedMesh;
  private items: (Sprite | null)[];
  private next = 0;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private qSpin = new THREE.Quaternion();
  private pos = new THREE.Vector3();
  private scl = new THREE.Vector3();
  private col = new THREE.Color();
  private static readonly ZERO = new THREE.Vector3();
  private static readonly Z = new THREE.Vector3(0, 0, 1);

  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, private count: number) {
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.items = new Array(count).fill(null);
    for (let i = 0; i < count; i++) { this.mesh.setMatrixAt(i, this.m4.makeScale(0, 0, 0)); this.mesh.setColorAt(i, this.col.setRGB(0, 0, 0)); }
  }

  get live() { let n = 0; for (const it of this.items) if (it) n++; return n; }

  /** Off: the far-side backdrop has no sprites (they would hang still while the world travels). */
  off = false;

  /**
   * Adds a sprite timed so its pop finishes, full size, at `sp.t0` (its sound): it starts opening
   * up to PREROLL seconds early. (The visualiser hands sprites over that far ahead of the music.)
   */
  add(sp: Sprite) { if (this.off || (QUALITY.particles < 1 && Math.random() > QUALITY.particles)) return; sp.t0 -= Math.min(sp.pop, PREROLL); sp.life += Math.min(sp.pop, PREROLL); this.items[this.next] = sp; this.next = (this.next + 1) % this.count; }

  clear() {
    this.items.fill(null);
    for (let i = 0; i < this.count; i++) this.mesh.setMatrixAt(i, this.m4.makeScale(0, 0, 0));
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** `light` scales every sprite's brightness (the song's arc). */
  update(s: number, light = 1) {
    if (this.off) return;
    const mesh = this.mesh;
    for (let i = 0; i < this.count; i++) {
      const f = this.items[i];
      if (!f) continue;
      const age = s - f.t0;
      if (age < 0 || age > f.life) {
        this.items[i] = null;
        mesh.setMatrixAt(i, this.m4.makeScale(0, 0, 0));
        continue;
      }
      // Pop open with an overshoot, drift, fade.
      const k = Math.min(1, age / f.pop);
      const pop = 1 + Math.sin(k * Math.PI) * 0.35;
      const fade = Math.min(1, (f.life - age) / f.fadeOut);
      const el = THREE.MathUtils.clamp(f.el + f.vEl * age, -1.5, 1.5);
      const az = f.az + f.vAz * age + Math.sin(age * 3 + f.t0) * f.wobble;
      this.pos.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)).multiplyScalar(R_SPRITE);
      this.m4.lookAt(this.pos, SpritePool.ZERO, THREE.Object3D.DEFAULT_UP);
      this.q.setFromRotationMatrix(this.m4);
      this.qSpin.setFromAxisAngle(SpritePool.Z, f.spin * age);
      this.q.multiply(this.qSpin);
      const sz = f.size * k * pop * (1 + f.grow * age);
      this.scl.set(sz, sz, sz);
      mesh.setMatrixAt(i, this.m4.compose(this.pos, this.q, this.scl));
      this.col.setHSL(f.hue, f.sat, 0.55).multiplyScalar(fade * (0.6 + f.vel * 0.7) * light);
      mesh.setColorAt(i, this.col);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}

export class Visualiser implements ShowDriver {
  readonly group = new THREE.Group();
  metric = { hits: 0, total: 0, recent: [] as boolean[], byLayer: {} as Record<string, [number, number]> };
  steering = false;
  gazeSpawning = false;
  /** The post-effects look this scene asks for (main.ts hands it to the FX director). */
  look: FxLookName = 'trip';
  private crashPending = false;

  private V = {
    pa: uniform(new THREE.Vector3()), pb: uniform(new THREE.Vector3()), pc: uniform(new THREE.Vector3()), pd: uniform(new THREE.Vector3()),
    shape: uniform(new THREE.Vector4(3, 0.5, 0, 0.5)), mixes: uniform(new THREE.Vector4(1, 0, 0, 0)),
    gaze: uniform(new THREE.Vector3(0, 0, -1)), gazeAz: uniform(0),
    pulse0: uniform(99), pulse1: uniform(99), pulse2: uniform(99), pulse3: uniform(99),
    boltAz: uniform(0), boltT: uniform(99), boltSeed: uniform(0),
    wave: null as unknown as THREE.DataTexture,
    /** The sine scroller's text (element 42), drawn once per song. */
    scroll: null as unknown as THREE.CanvasTexture,
    crash: uniform(0), rise: uniform(0), bright: uniform(0.3),
    layers: uniform(new THREE.Vector4()), poly: uniform(new THREE.Vector4(5, 2, 0.4, 0)), bands: uniform(new THREE.Vector3()),
    E0: uniform(new THREE.Vector4(1, 0, 0, 0)), E1: uniform(new THREE.Vector4()), E2: uniform(new THREE.Vector4()), E3: uniform(new THREE.Vector4()), E4: uniform(new THREE.Vector4()),
    E5: uniform(new THREE.Vector4()), E6: uniform(new THREE.Vector4()), E7: uniform(new THREE.Vector4()), E8: uniform(new THREE.Vector4()), E9: uniform(new THREE.Vector4()), E10: uniform(new THREE.Vector4()), E11: uniform(new THREE.Vector4()), E12: uniform(new THREE.Vector4()),
    /** Melody and bass pitch, held through the gaps and eased (MIDI): the Julia set bends with them. */
    pitches: uniform(new THREE.Vector2()),
    /** The Lissajous figure's two frequencies: picked from the held notes on each downbeat, then
     * eased there, so the figure changes shape with the bar instead of flicking on every wobble. */
    figure: uniform(new THREE.Vector2(3, 2)),
    /** Slow copies for shapes: bass loudness and other loudness eased over a third of a second, and
     * a turn that steps on each beat but never swings back (the rotozoomer). */
    soft: uniform(new THREE.Vector3()),
    /** The horizon's lean (radians), the turn of the axis it leans about, and floor-to-ceiling mirror (0..1). */
    tilt: uniform(new THREE.Vector3()),
    /** The glitterball: spin speed (radians/s), flash, and its tint. */
    glitter: uniform(new THREE.Vector2(0.6, 0)), glitterTint: uniform(new THREE.Vector3(0.35, 0.3, 0.5)),
    fold: uniform(new THREE.Vector4(0, 0.6, 1.3, 0.5)), frac: uniform(new THREE.Vector4(6, 1.2, 0.7, 0.5)),
    kickT: uniform(99), pad: uniform(0), dim: uniform(0), pulseShape: uniform(new THREE.Vector4()), bassMode: uniform(new THREE.Vector2()),
    arc: uniform(0.3), tension: uniform(0), release: uniform(0), releaseT: uniform(99), phase: uniform(0), journey: uniform(new THREE.Vector3(1, 0, 0)),
    notes: null as unknown as THREE.DataTexture,
    /** Cued fireworks (element 45): burst time, azimuth, elevation, seed. */
    shells: Array.from({ length: 12 }, () => uniform(new THREE.Vector4(-99, 0, 0.3, 0))),
  };
  private noteData = new Uint8Array(16 * 4);
  private noteAct = new Float32Array(12);
  private weights = new Float32Array(NE);
  private target = new Float32Array(NE);
  private lastKick = -99;
  private padLvl = 0;
  /** Video feedback the current scene wants (main.ts hands it to the FX director). */
  feedback = { amount: 0, zoom: 1, turn: 0, hue: 0 };
  private waveData = new Uint8Array(256 * 4);
  private dome: THREE.Mesh;
  /** The simple spawners: one pool each. */
  private flowers = new SpritePool(polarShape(a => 0.45 + 0.55 * Math.abs(Math.cos(3 * a)) ** 0.8), makeSpriteMaterial('petal'), 420);
  private bubbles = new SpritePool(ringGeometry(), makeSpriteMaterial('flat'), 160);
  private bursts = new SpritePool(polarShape(a => 0.12 + 0.88 * Math.abs(Math.cos(4 * a)) ** 14, 192), makeSpriteMaterial('spike'), 80);
  private confetti = new SpritePool(polarShape(a => 1 / (Math.abs(Math.cos(a)) + Math.abs(Math.sin(a)) * 1.8), 8), makeSpriteMaterial('flat'), 400);
  private flakes = new SpritePool(polarShape(a => 0.18 + 0.62 * Math.abs(Math.cos(6 * a)) ** 10 + 0.2 * Math.abs(Math.cos(18 * a)) ** 6, 384), makeSpriteMaterial('petal'), 40);
  /** A comet: a long teardrop, head at +x, streaking across the sky. */
  private comets = new SpritePool(polarShape(a => (Math.cos(a) > 0 ? 0.3 + 0.7 * Math.cos(a) ** 0.5 : 0.3 * (1 + Math.cos(a)) + 0.02) * (Math.abs(Math.sin(a)) < 0.2 || Math.cos(a) > 0 ? 1 : 0.6), 96), makeSpriteMaterial('spike'), 60);
  private fireflies = new SpritePool(polarShape(() => 1, 16), makeSpriteMaterial('spike'), 200);
  /** One petal: a narrow ellipse. */
  private petals = new SpritePool(polarShape(a => 1 / Math.sqrt(Math.cos(a) ** 2 + (2.6 * Math.sin(a)) ** 2), 32), makeSpriteMaterial('petal'), 240);
  private pools = [this.flowers, this.bubbles, this.bursts, this.confetti, this.flakes, this.comets, this.fireflies, this.petals];
  private bassTimes = [-99, -99, -99, -99];
  private bassPtr = 0;
  private ptr = 0;
  /** The sprites' own place in the events, up to PREROLL seconds ahead of `ptr`. */
  private sptr = 0;
  private lastS = -Infinity;
  private seed: number;
  private rand: () => number;
  private patterns = new Map<string, { scene: Scene; seen: number }>();
  private secIdx = -1;
  private lastLeadT = -99;
  private lastSceneAt = -99;
  /** When anything last changed (a scene or a twist), the scene showing, and when each element last showed. */
  private lastChange = -99;
  private current: Scene | null = null;
  private lastUsed = new Float64Array(64).fill(-1e9);
  private phraseIdx = -1;
  private twists = 0;
  private subIdx = 0;
  private tiltTarget: [number, number, number] = [0, 0, 0];
  /** The song's arc: intensity at 2 Hz over the analysed part of the song (see buildArc). */
  private arcI = new Float32Array(0);
  private arcPeakT = 0;
  /** Lifts: moments the song steps up (a drop, a bigger section, the end of a build-up), found ahead. */
  lifts: { t: number; size: number }[] = [];
  private liftPtr = 0;
  private releaseT = 99;
  private phase = 0;
  private arcBuiltAt = -1;
  private arcLvl = 0.3;
  private tensionLvl = 0;
  private lastTension = 0;
  /** Eras found so far (rebuilt with the arc), and the one playing. */
  eras: Era[] = [];
  private eraIdx = -1;
  private journey = 0;
  private journeyW = new THREE.Vector3(1, 0, 0);
  private card3d: THREE.Mesh | null = null;
  private dir = new THREE.Vector3();
  private pos = new THREE.Vector3();

  /**
   * `far`: this show runs on the far side of a train or starship (the other window), not all round
   * you: only the half of the sky on the +z side faded in by
   * `far.reveal`, with no sprites and its gaze kept on that side, so none of it can leak into the
   * main window.
   */
  constructor(private pack: Pack, private score: Score, private camera: THREE.PerspectiveCamera, private far?: { reveal: { value: number } }) {
    this.V.wave = new THREE.DataTexture(this.waveData, 256, 1, THREE.RGBAFormat);
    this.V.wave.magFilter = THREE.LinearFilter;
    this.V.wave.minFilter = THREE.LinearFilter;
    this.V.wave.wrapS = THREE.RepeatWrapping;
    this.V.wave.needsUpdate = true;
    this.V.notes = new THREE.DataTexture(this.noteData, 16, 1, THREE.RGBAFormat);
    this.V.notes.needsUpdate = true;
    this.V.scroll = scrollerTexture(score);
    this.dome = far
      ? new THREE.Mesh(new THREE.SphereGeometry(400, 96, 48, 0, Math.PI), makeVisualiserMaterial(this.V, far)) // phi 0..π: the +z half
      : new THREE.Mesh(new THREE.SphereGeometry(400, 128, 64), makeVisualiserMaterial(this.V));
    this.dome.frustumCulled = false;
    this.dome.renderOrder = far ? -6 : -10;
    this.group.add(this.dome);
    // On the far side only the backdrop plays: sprites would hang still while the train travels
    // past, so the passing scenery brings the show's objects instead.
    if (far) for (const p of this.pools) p.off = true;
    else for (const p of this.pools) this.group.add(p.mesh);
    this.seed = hashStr(score.track.hash || score.track.title || 'gondryator');
    this.rand = rng(this.seed);
    this.applyScene(this.makeScene());
  }

  get activeCount() { return this.pools.reduce((n, p) => n + p.live, 0); }
  /** Everything with a shader of its own (for warm-up). */
  /** For the far side: a material for a floor plane, wearing the same show by direction. */
  farFloorMaterial() { return makeVisualiserMaterial(this.V, { reveal: this.far!.reveal, floor: true }); }
  get meshes(): THREE.Object3D[] { return this.far ? [this.dome] : [this.dome, ...this.pools.map(p => p.mesh)]; }
  themeAt() { return 'void'; }
  refreshLeads() { /* nothing is scheduled ahead */ }

  /** A new seed for this song: a whole new set of scenes, starting now. */
  reroll() {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    this.rand = rng(this.seed);
    this.patterns.clear();
    const sc = this.makeScene();
    if (this.lastS > 0) sc.elements = this.orchestrate(this.lastS);
    this.applyScene(sc);
    this.crash();
    return this.seed;
  }

  /** True once per scene change: main.ts fires the FX director's crash with it. */
  takeCrash() { const c = this.crashPending; this.crashPending = false; return c; }

  reset(s: number) {
    for (const p of this.pools) p.clear();
    this.bassTimes.fill(-99);
    this.seekTo(s);
  }

  private seekTo(s: number) {
    this.shellsUntil = -1;
    for (const u of this.V.shells) (u.value as THREE.Vector4).x = -99;
    if (s < this.outroStart) this.outroOn = false;
    if (s < this.arcPeakT) this.glitterDone = false;
    const ev = this.score.events;
    let lo = 0, hi = ev.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (ev[m].t <= s) lo = m + 1; else hi = m; }
    this.ptr = this.sptr = lo;
    this.lastS = s;
    this.phraseIdx = -1;
    this.lastChange = Math.min(this.lastChange, s);
    this.liftPtr = 0;
    while (this.liftPtr < this.lifts.length && this.lifts[this.liftPtr].t <= s) this.liftPtr++;
    const cues = this.score.sounds ?? [];
    this.soundPtr = 0;
    while (this.soundPtr < cues.length && cues[this.soundPtr].t <= s) this.soundPtr++;
    this.cuesOn.length = 0;
  }

  // ------------------------------------------------------------------ scenes
  private makeScene(base?: Scene): Scene {
    const r = this.rand;
    if (base) {
      // A section coming back: same pattern, new palette and phase (and the feedback turns the other way).
      return {
        ...base,
        palette: (base.palette + 1 + Math.floor(r() * (PALETTES.length - 1))) % PALETTES.length,
        mixes: [base.mixes[0], base.mixes[1], base.mixes[2], r() * 6],
        fold: [base.fold[0], base.fold[1] + (r() - 0.5) * 0.4, base.fold[2], base.fold[3]],
        feedback: { ...base.feedback, turn: -base.feedback.turn, hue: r() * 0.08 },
      };
    }
    const segChoices = [0, 0, 3, 4, 5, 6, 8];
    // The tunnel (rings round your gaze) is a seasoning, not the main dish: in a third of the scenes, lightly.
    const w = [r(), r() * 0.8, r() < 0.33 ? r() * 0.35 : 0];
    const sum = w[0] + w[1] + w[2] || 1;
    return {
      palette: Math.floor(r() * PALETTES.length),
      shape: [1.5 + r() * 4.5, r() < 0.4 ? 0 : r() * 2.2, segChoices[Math.floor(r() * segChoices.length)], 0.25 + r() * 0.8],
      mixes: [w[0] / sum * 1.6, w[1] / sum * 1.2, w[2] / sum * 1.2, r() * 6],
      look: LOOKS[Math.floor(r() * LOOKS.length)],
      layers: [0, 0, 0, r() < 0.3 ? 1 : 0],
      elements: [0],
      poly: [3 + Math.floor(r() * 6), Math.floor(r() * 5), (r() - 0.5) * 1.6, r() < 0.4 ? r() : 0],
      pulse: randomPulse(r),
      tilt: randomTilt(r),
      bassMode: randomBassMode(r),
      // Deep kaleidoscope in about half the scenes, sometimes absurdly deep.
      fold: [r() < 0.5 ? 0 : 1 + Math.floor(r() * r() * 5), 0.3 + r() * 1.2, 1.1 + r() * 0.5, 0.2 + r() * 0.9],
      frac: [[4, 5, 6, 8, 10, 12][Math.floor(r() * 6)], 0.9 + r() * 0.8, 0.55 + r() * 0.35, 0.3 + r() * 0.9],
      // Feedback trails in about half the scenes: pour out or suck in, turning one way or the other.
      feedback: r() < 0.55
        ? { amount: 0.6 + r() * 0.25, zoom: r() < 0.6 ? 1.006 + r() * 0.02 : 0.985 + r() * 0.01, turn: (r() - 0.5) * 0.03, hue: r() * 0.08 }
        : { amount: 0, zoom: 1, turn: 0, hue: 0 },
    };
  }

  private applyScene(sc: Scene) {
    // The complexity bloom: early in the arc a scene shows one element and shallow mirrors; by the
    // climax it shows everything it picked, folded deep.
    if (this.journey === 1) {
      const a = this.arcLvl;
      sc = { ...sc, elements: sc.elements.slice(0, Math.max(1, Math.round(0.6 + a * 3))), fold: [Math.min(5, Math.round(a * 5.4)), sc.fold[1], sc.fold[2], sc.fold[3]] };
    }
    const [a, b, c, d] = PALETTES[sc.palette];
    this.V.pa.value.set(...a); this.V.pb.value.set(...b); this.V.pc.value.set(...c); this.V.pd.value.set(...d);
    this.V.shape.value.set(...sc.shape);
    this.V.mixes.value.set(...sc.mixes);
    this.V.layers.value.set(...sc.layers);
    this.V.pulseShape.value.set(...(sc.pulse ?? [0, 0, 0, 0]));
    this.tiltTarget = sc.tilt ?? [0, 0, 0];
    this.V.bassMode.value.set(...(sc.bassMode ?? [0, 1]));
    // ?bass=3 (or 2,4 for four circles) pins the bass style, for trying one out.
    const pinBass = new URLSearchParams(location.search).get('bass')?.split(',').map(Number);
    if (pinBass) this.V.bassMode.value.set(pinBass[0], pinBass[1] ?? 4);
    // ?tilt=0.9,1 pins the horizon's lean (and the ceiling).
    const pinTilt = new URLSearchParams(location.search).get('tilt')?.split(',').map(Number);
    if (pinTilt) this.tiltTarget = [pinTilt[0], 0.06, pinTilt[1] ?? 0];
    // ?viz=16,17 pins the elements (for trying one out); ?fb=0 turns the feedback trails off.
    const q = new URLSearchParams(location.search);
    const pinned = q.get('viz')?.split(',').map(Number).filter(n => n >= 0 && n < NE);
    const els = pinned?.length ? pinned : sc.elements;
    this.target.fill(0);
    for (const e of els) this.target[e] = e === 0 && els.length > 1 ? 0.7 : 1;
    if (q.get('fb') === '0') sc = { ...sc, feedback: { amount: 0, zoom: 1, turn: 0, hue: 0 } };
    this.current = sc;
    for (const e of els) this.lastUsed[e] = this.lastS;
    this.lastChange = this.lastS;
    this.V.poly.value.set(...sc.poly);
    this.V.fold.value.set(...sc.fold);
    this.V.frac.value.set(...sc.frac);
    this.feedback = sc.feedback;
    this.look = sc.look;
  }

  private crash() { this.V.crash.value = 1; this.crashPending = true; }

  private newScene(s: number, label: string, key: string, sectionStart: boolean) {
    const repeatable = label !== 'intro' && label !== 'outro';
    // Back-to-back repeats of one part (C C C C) alternate two takes on its pattern, C1 C2 C1 C2:
    // the repetition still shows, but the second take wears a different look and one new element.
    let base: Scene | undefined;
    if (sectionStart && repeatable) {
      const { index } = sectionAt(this.score, s);
      let run = 0;
      while (index - run - 1 >= 0 && sectionKey(this.score.sections[index - run - 1]) === key) run++;
      if (run % 2 === 1) { base = this.patterns.get(key)?.scene; key += '#2'; }
    }
    const kept = this.patterns.get(key);
    let sc: Scene;
    if (kept && repeatable) { kept.seen++; sc = this.makeScene(kept.scene); }
    else if (base) {
      sc = this.makeScene(base);
      const looks = LOOKS.filter(l => l !== base!.look);
      const fresh = this.orchestrate(s).filter(e => !base!.elements.includes(e));
      const els = base.elements.slice();
      if (fresh.length && els.length) els[Math.floor(this.rand() * els.length)] = fresh[0];
      Object.assign(sc, { look: looks[Math.floor(this.rand() * looks.length)], elements: els });
      this.patterns.set(key, { scene: sc, seen: 0 });
    } else {
      sc = this.makeScene();
      sc.elements = this.orchestrate(s);
      // What this part comes back as: its own pattern, never the one-off climax showpiece.
      const plain = { ...sc, elements: sc.elements.slice() };
      // The section holding the song's climax gets a showpiece, once: the glitterball about one
      // song in four (seeded, so a song keeps its own), otherwise one of the other big set pieces.
      const sec = sectionAt(this.score, s);
      const next = this.score.sections[sec.index + 1]?.t ?? Infinity;
      if (sectionStart && !this.glitterDone && this.arcPeakT >= s && this.arcPeakT < next) {
        this.glitterDone = true;
        const big = (sec.section?.energy ?? 0.5) > 0.6;
        const cr = rng(this.seed ^ 0x9e3779b9);
        const pick = pickClimax(cr, this.score.track.year);
        const decade = !TIMELESS.includes(pick);
        sc.elements = pick === DISCO ? (big ? [41, 32] : [41]) : big || decade ? [...pick] : pick.slice(0, 2);
        const r = this.rand;
        if (pick === MEGADEMO) {
          // The scroller always, with two other classics drawn from the demo parts.
          const parts = [...DEMO_PARTS].sort(() => cr() - 0.5);
          sc.elements = [42, parts[0], parts[1]];
        }
        if (pick === ATOMIC) Object.assign(sc, { look: 'film', layers: [0, 0, 0, 0], feedback: { amount: 0.3, zoom: 1.0, turn: 0, hue: 0 } });
        if (pick === LIQUID_LIGHT) Object.assign(sc, { look: 'liquid', palette: [3, 5, 7, 10][Math.floor(r() * 4)], feedback: { amount: 0.6, zoom: 1.003, turn: (r() - 0.5) * 0.006, hue: 0.03 } });
        if (pick === RAVE) Object.assign(sc, { look: 'hyper', bassMode: [3, 1] });
        if (pick === FIREWORKS) Object.assign(sc, { look: 'prism', layers: [0, 0, 0, 0], mixes: [0.15, 0, 0, sc.mixes[3]], feedback: { amount: 0.7, zoom: 0.998, turn: 0, hue: 0.0 } });
        if (pick === MAIN_STAGE) Object.assign(sc, { look: 'clean', layers: [0, 0, 0, 0], mixes: [0.2, 0, 0, sc.mixes[3]] });
        if (pick === GLITCH) Object.assign(sc, { look: 'glitch' });
        // The 80s closer: the bass rolls off the horizon in waveform lines under the sun, in pink,
        // sunset or ultraviolet, on an old tube, swirling, with trails.
        if (pick === MEGADEMO) Object.assign(sc, { look: 'prism', layers: [0, 0, 0, 0], fold: [0, sc.fold[1], sc.fold[2], sc.fold[3]] });
        if (pick === OUTRUN) {
            Object.assign(sc, {
            bassMode: [1, 1], look: 'crt', tilt: [0, 0, 0], palette: [2, 3, 10][Math.floor(r() * 3)],
            shape: [sc.shape[0], 0.6 + r() * 1.2, sc.shape[2], sc.shape[3]],
            feedback: { amount: 0.55, zoom: 1.006, turn: (r() - 0.5) * 0.01, hue: 0.04 },
          });
        }
      }
      if (sectionStart || key.includes('/')) this.patterns.set(key, { scene: plain, seen: 0 });
    }
    // An exhale: a section clearly quieter than the last (a breakdown) thins out to one or two
    // elements with long, slow trails, so the next lift has somewhere to go.
    const { index } = sectionAt(this.score, s);
    const prevE = this.score.sections[index - 1]?.energy, curE = this.score.sections[index]?.energy;
    if (sectionStart && prevE !== undefined && curE !== undefined && prevE - curE > 0.12) {
      sc = { ...sc, elements: sc.elements.slice(0, label === 'breakdown' ? 1 : 2), look: this.rand() < 0.5 ? 'echo' : 'liquid',
        feedback: { amount: 0.85, zoom: 0.992, turn: (this.rand() - 0.5) * 0.01, hue: 0.02 } };
    }
    this.applyScene(sc);
    this.crash();
    this.lastSceneAt = s;
  }

  /**
   * Pick two or three elements for what is playing over the next eight seconds: one from each
   * active group first (in a seeded random order), three when the section is energetic.
   */
  private orchestrate(s: number): number[] {
    const sc = this.score, r = this.rand;
    const until = Math.min(s + 8, sc.final ? Infinity : sc.frontierSec);
    const count: Record<Group, number> = { drums: 0, bass: 0, melody: 0, pads: 0, mix: 1 };
    for (const e of sc.events) {
      if (e.t < s) continue;
      if (e.t >= until) break;
      if (e.stem === 'drums') count.drums++;
      else if (e.stem === 'bass') count.bass++;
      else if (e.kind === 'note' && e.dur >= 1.2) count.pads++;
      else if (e.kind === 'note') count.melody++;
    }
    const active = (Object.keys(count) as Group[]).filter(g => g === 'mix' || count[g] >= (g === 'pads' ? 1 : 3));
    const energy = sectionAt(sc, s).section?.energy ?? 0.5;
    const n = energy > 0.55 ? 3 : 2;
    // Groups in a seeded order, the busiest instruments a little more likely first.
    const order = active.map(g => ({ g, k: r() + Math.min(1, count[g] / 30) * 0.4 })).sort((a, b) => b.k - a.k).map(o => o.g);
    const pick: number[] = [];
    for (const g of order) {
      if (pick.length >= n) break;
      pick.push(this.freshest(ELEMENTS.map((el, i) => ({ el, i })).filter(o => o.el.group === g && !pick.includes(o.i) && o.i !== 41)));
    }
    while (pick.length < n) {
      const opts = ELEMENTS.map((el, i) => ({ el, i })).filter(o => active.includes(o.el.group) && !pick.includes(o.i) && o.i !== 41);
      if (!opts.length) break;
      pick.push(this.freshest(opts));
    }
    return pick;
  }

  /** One line for the debug overlay and tests: era, journey, arc, tension, elements. */
  get status() {
    const e = this.eras[this.eraIdx];
    return `era ${this.eraIdx + 1}/${this.eras.length} ${e?.kind ?? '-'} · ${JOURNEYS[this.journey]} · arc ${this.arcLvl.toFixed(2)} tension ${this.tensionLvl.toFixed(2)} · ${this.showing.join(', ')}${this.cuesOn.length ? ` · hearing ${this.cuesOn.map(o => o.c.kind).join(', ')}` : ''}${this.outroOn ? ' · outro' : ''}`;
  }

  /** Of these elements, one of the two shown least recently (so everything gets its turn). */
  private freshest(opts: { i: number }[]) {
    // The meter-like elements (ribbons, kick tunnel, bass rings, spectrum, hex pulse) are easy to
    // overdo: skip them more often than not when anything else will do.
    if (this.far) { const bg = opts.filter(o => !SPRITE_ELEMENTS.includes(o.i)); if (bg.length) opts = bg; }
    const keep = opts.filter(o => !RARE.has(o.i) || this.rand() < 0.35);
    if (keep.length) opts = keep;
    const byAge = opts.slice().sort((a, b) => this.lastUsed[a.i] - this.lastUsed[b.i] || a.i - b.i);
    return byAge[Math.min(byAge.length - 1, Math.floor(this.rand() * 2))].i;
  }

  /**
   * A twist: a smaller change than a new scene, on a phrase boundary, so the picture never sits
   * still for long. It alternates between swapping one element for one that hasn't shown for a
   * while and re-dressing the scene (palette, mirrors, folds, shapes, look), with a flash of light
   * instead of a crash.
   */
  private twist(s: number) {
    const cur = this.current;
    if (!cur) return;
    const r = this.rand;
    let sc: Scene;
    if (this.twists++ % 2 === 0 && cur.elements.length) {
      const fresh = this.orchestrate(s).filter(e => !cur.elements.includes(e));
      const out = Math.floor(r() * cur.elements.length);
      const els = cur.elements.slice();
      if (fresh.length) els[out] = fresh[0];
      sc = { ...cur, elements: els };
    } else {
      const segChoices = [0, 3, 4, 5, 6, 8, 12];
      sc = {
        ...cur,
        palette: (cur.palette + 1 + Math.floor(r() * (PALETTES.length - 1))) % PALETTES.length,
        shape: [cur.shape[0] * (0.7 + r() * 0.6), cur.shape[1], segChoices[Math.floor(r() * segChoices.length)], cur.shape[3]],
        mixes: [cur.mixes[0], cur.mixes[1], cur.mixes[2], r() * 6],
        fold: [Math.max(0, Math.min(5, cur.fold[0] + (r() < 0.5 ? -1 : 1) * (1 + Math.floor(r() * 2)))), 0.3 + r() * 1.2, cur.fold[2], cur.fold[3]],
        poly: [3 + Math.floor(r() * 6), cur.poly[1], -cur.poly[2], r() < 0.4 ? r() : 0],
        pulse: randomPulse(r),
        tilt: r() < 0.5 ? cur.tilt : randomTilt(r),
        bassMode: r() < 0.5 ? cur.bassMode : randomBassMode(r),
        look: r() < 0.5 ? cur.look : LOOKS[Math.floor(r() * LOOKS.length)],
      };
    }
    this.applyScene(sc);
    this.V.release.value = Math.max(this.V.release.value, 0.45);
    this.lastChange = s;
  }

  /** Which elements are showing now (for the debug overlay and tests). */
  get showing() { return ELEMENTS.filter((_, i) => this.target[i] > 0).map(e => e.name); }

  // ------------------------------------------------------------------ per frame
  update(s: number, dt: number, _gaze: GazeSource, frontier: number, running: boolean) {
    const sc = this.score;
    this.camera.getWorldPosition(this.pos);
    this.group.position.copy(this.pos);
    this.camera.getWorldDirection(this.dir);
    // On the far side, the gaze is always somewhere out of the other window.
    if (this.far) this.dir.set(this.dir.x * 0.5, this.dir.y, Math.max(this.dir.z, 0.75)).normalize();
    this.V.gaze.value.copy(this.dir);
    const gazeAz = Math.atan2(this.dir.x, -this.dir.z);
    this.V.gazeAz.value = gazeAz;
    if (s < this.lastS - 0.05 || s > this.lastS + 1) this.seekTo(s);
    this.lastS = s;

    // The outro: the song's last stretch gets a calm scene of its own, then fades to black.
    const D = sc.final ? sc.track.durationSec : Infinity;
    const fade = running ? THREE.MathUtils.clamp((s - (D - OUTRO_FADE)) / OUTRO_FADE, 0, 1) : 0;
    this.fade = fade;
    if (running && sc.final && s >= this.outroStart && !this.outroOn) this.startOutro(s);
    if (running) {
      // Scene changes: every section, and every new melody phrase (after a breath of 1.5 s).
      const { section: sec, index: idx } = sectionAt(sc, s);
      if (this.outroOn) this.secIdx = idx;
      if (idx !== this.secIdx && sec) { this.secIdx = idx; this.subIdx = 0; this.newScene(s, sec.label, sectionKey(sec), true); }
      // A long section changes as it goes, in sub-parts of eight bars (C1a, C1b...): new colours
      // and shapes on each, a whole new scene on every other one. A returning part gets the same
      // run of scenes back.
      const { sub } = subPartAt(sc, s);
      if (sec && sub !== this.subIdx && !this.outroOn) {
        this.subIdx = sub;
        if (sub % 2 === 0) this.newScene(s, sec.label, sectionKey(sec) + '/' + String.fromCharCode(97 + sub), false);
        else { this.twists = 1; this.twist(s); }
      }
      // Twists: on each new phrase (four bars) once the picture has held for a few seconds, and
      // in any case before it has sat still for MAX_STILL seconds.
      let pi = this.phraseIdx;
      while (pi + 1 < sc.phrases.length && sc.phrases[pi + 1].t <= s) pi++;
      if (pi !== this.phraseIdx) {
        this.phraseIdx = pi;
        if (s - this.lastChange >= MIN_STILL && !this.outroOn) this.twist(s);
      }
      if (s - this.lastChange > MAX_STILL && !this.outroOn) this.twist(s);
      const lead = sampleEnvelope(sc.envelopes.leadPitch, s);
      if (lead > 0) {
        if (s - this.lastLeadT > 1.5 && s - this.lastSceneAt > 6 && sec && !this.outroOn) this.newScene(s, sec.label, sectionKey(sec) + ':phrase', false);
        this.lastLeadT = s;
      }
      // Events as they sound: the pulses, rings and lightning, timed from the note itself.
      const ev = sc.events;
      while (this.ptr < ev.length && ev[this.ptr].t <= s && ev[this.ptr].t < frontier) {
        const e = ev[this.ptr++];
        if (s - e.t > 0.3 || fade > 0) continue; // (no new sparks once the lights are going down)
        if (e.kind === 'kick') this.lastKick = e.t;
        else if (e.kind === 'snare') {
          this.V.boltAz.value = gazeAz + (this.rand() - 0.5) * 1.6;
          this.V.boltT.value = s - e.t;
          this.V.boltSeed.value = this.rand() * 100;
        } else if (e.stem === 'bass' && e.kind === 'note') this.bassTimes[this.bassPtr++ % 4] = e.t;
        else if (e.kind === 'note' && e.pitch !== null && (e.stem === 'other' || e.stem === 'vocals')) {
          this.noteAct[((e.pitch % 12) + 12) % 12] = Math.max(this.noteAct[((e.pitch % 12) + 12) % 12], 0.5 + e.vel * 0.5);
        }
      }
      // ...and the sprites a moment ahead, so each one has finished opening as its note sounds
      // (SpritePool.add starts it early). The song is read ahead, so the future is known.
      if (this.sptr < this.ptr - 64 || this.sptr > ev.length) this.sptr = this.ptr;
      while (this.sptr < ev.length && ev[this.sptr].t <= s + PREROLL && ev[this.sptr].t < frontier) {
        const e = ev[this.sptr++];
        if (s - e.t > 0.3 || fade > 0) continue;
        if (e.kind === 'snare') {
          if (this.target[18] > 0) this.burst(e.t, e.vel, gazeAz);
        } else if (e.kind === 'hat') {
          if (this.target[19] > 0) this.sprinkle(e.t, e.vel, gazeAz);
          if (this.target[39] > 0) this.firefly(e.t, e.vel, gazeAz);
        } else if (e.stem === 'bass' && e.kind === 'note') {
          if (this.target[17] > 0) this.bubble(e.t, e.pitch ?? 40, e.vel, e.dur, gazeAz);
        } else if (e.kind === 'note' && e.pitch !== null && (e.stem === 'other' || e.stem === 'vocals')) {
          if (this.target[12] > 0) this.bloom(e.t, e.pitch, e.vel, e.dur, gazeAz);
          if (this.target[20] > 0 && e.dur >= 1.2) this.flake(e.t, e.pitch, e.vel, gazeAz);
          if (this.target[38] > 0 && e.dur < 1.2) this.comet(e.t, e.pitch, e.vel, gazeAz);
          if (this.target[40] > 0 && e.dur >= 1.2) this.petalRain(e.t, e.pitch, e.vel, gazeAz);
        }
      }
    }
    if (running && fade === 0) this.hearSounds(s, gazeAz);
    if (running && fade === 0 && this.target[45] > 0) this.planShells(s, frontier, gazeAz);
    this.V.boltT.value += dt;
    this.V.kickT.value = s - this.lastKick;
    // Pads: how many long notes are sounding.
    let pads = 0;
    if (running) for (let i = Math.max(0, this.ptr - 60); i < this.ptr; i++) { const e = sc.events[i]; if (e.kind === 'note' && e.dur >= 1.2 && e.t <= s && e.t + e.dur > s) pads++; }
    this.padLvl += (Math.min(1, pads / 2) - this.padLvl) * (1 - Math.exp(-dt / 0.4));
    this.V.pad.value = this.padLvl;
    // Note names light and fade.
    for (let i = 0; i < 12; i++) { this.noteAct[i] *= Math.exp(-dt / 0.5); this.noteData[i * 4] = Math.round(this.noteAct[i] * 255); this.noteData[i * 4 + 3] = 255; }
    this.V.notes.needsUpdate = true;
    // Element weights ease towards the scene's choice.
    // (Under a crash the new scene snaps in, hidden by the flash, so it is there on the beat.)
    const kw = 1 - Math.exp(-dt / (this.V.crash.value > 0.3 ? 0.12 : 0.6));
    for (let i = 0; i < NE; i++) this.weights[i] += (this.target[i] * (1 - fade) - this.weights[i]) * kw;
    // Sprites are added light, so on a bright backdrop they vanish: dim it while any are on.
    this.V.dim.value = this.far ? 0 : 0.55 * Math.max(...SPRITE_ELEMENTS.map(i => this.weights[i]));
    const w = this.weights;
    this.V.E0.value.set(w[0], w[1], w[2], w[3]); this.V.E1.value.set(w[4], w[5], w[6], w[7]);
    this.V.E2.value.set(w[8], w[9], w[10], w[11]); this.V.E3.value.set(w[12], w[13], w[14], w[15]);
    this.V.E4.value.set(w[16], w[17], w[18], w[19]);
    this.V.E5.value.set(w[20], w[21], w[22], w[23]); this.V.E6.value.set(w[24], w[25], w[26], w[27]);
    this.V.E7.value.set(w[28], w[29], w[30], w[31]); this.V.E8.value.set(w[32], w[33], w[34], w[35]);
    this.V.E9.value.set(w[36], w[37], w[38], w[39]); this.V.E10.value.set(w[40], w[41], w[42], w[43]);
    this.V.E11.value.set(w[44], w[45], w[46], w[47]); this.V.E12.value.set(w[48], w[49], w[50], 0);
    this.V.pulse0.value = s - this.bassTimes[0]; this.V.pulse1.value = s - this.bassTimes[1];
    this.V.pulse2.value = s - this.bassTimes[2]; this.V.pulse3.value = s - this.bassTimes[3];
    this.V.crash.value *= Math.exp(-dt / 0.22);
    this.V.rise.value = running ? sampleEnvelope(sc.envelopes.rise, s) : 0;
    this.V.bright.value = running ? sampleEnvelope(sc.envelopes.bright, s) : 0.3;
    if (running) this.V.bands.value.set(sampleEnvelope(sc.envelopes.drums, s), sampleEnvelope(sc.envelopes.bass, s), sampleEnvelope(sc.envelopes.other, s));
    else this.V.bands.value.set(0, 0, 0);
    this.updateArc(s, dt, running);
    this.updatePitches(sc, s, dt, running);
    // The horizon leans over a couple of seconds, its axis turning all the while.
    const TL = this.V.tilt.value, kt = 1 - Math.exp(-dt / 2.0);
    TL.x += ((this.far ? 0 : this.tiltTarget[0]) - TL.x) * kt;
    TL.y += this.tiltTarget[1] * dt;
    TL.z += ((this.far ? 0 : this.tiltTarget[2]) - TL.z) * kt;
    this.updateGlitterball(s, dt, running);
    this.updateWave(s, frontier, running);
    // The spawners are the notes themselves, so they stay bright even early in the arc.
    const light = (0.8 + this.arcLvl * 0.5 + this.V.release.value * 0.5) * (1 - fade) * (this.far ? this.far.reveal.value : 1);
    for (const p of this.pools) p.update(s, light);
    this.updateCard(s, running);
  }

  // ------------------------------------------------------------------ the arc
  // The analysis runs ahead of the music, so unlike a classic visualiser this one can look at the
  // whole song. Intensity is the mix loudness smoothed over about eight seconds, plus the
  // build-ups and the section energy, normalised so the loudest stretch is 1.

  private buildArc() {
    const sc = this.score;
    const end = sc.final ? sc.track.durationSec : sc.frontierSec;
    const n = Math.max(1, Math.floor(end * 2));
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / 2;
      const sec = sectionAt(sc, t).section;
      raw[i] = sampleEnvelope(sc.envelopes.mix, t) + sampleEnvelope(sc.envelopes.rise, t) * 0.3 + (sec?.energy ?? 0.5) * 0.4;
    }
    // Smooth (+/- 4 s), then normalise between the quietest and loudest stretches.
    const sm = new Float32Array(n);
    let lo = Infinity, hi = -Infinity, peak = 0;
    for (let i = 0; i < n; i++) {
      let sum = 0, c = 0;
      for (let j = Math.max(0, i - 8); j <= Math.min(n - 1, i + 8); j++) { sum += raw[j]; c++; }
      sm[i] = sum / c;
      if (sm[i] < lo) lo = sm[i];
      if (sm[i] > hi) { hi = sm[i]; peak = i; }
    }
    for (let i = 0; i < n; i++) sm[i] = hi > lo ? (sm[i] - lo) / (hi - lo) : 0.5;
    this.arcI = sm;
    this.arcPeakT = peak / 2;
    this.arcBuiltAt = end;
    this.eras = this.findEras(end);
    this.lifts = this.findLifts(end);
    this.liftPtr = 0;
    while (this.liftPtr < this.lifts.length && this.lifts[this.liftPtr].t <= this.lastS) this.liftPtr++;
  }

  /**
   * Lifts, found ahead of time. First the parser's moments (score.moments): drops and lifts, on
   * their beat, and the peak of a build that no drop follows. Then, to fill the gaps (and for
   * older scores without moments), sections that start louder than the one before, and places
   * where the next four seconds are clearly louder than the last four. The show winds up over the
   * bars before each one and lets go on it.
   */
  private findLifts(end: number) {
    const sc = this.score;
    const sure: { t: number; size: number }[] = [];
    for (const m of sc.moments ?? []) {
      if (m.t >= end) break;
      if (m.kind === 'drop') sure.push({ t: m.t, size: Math.max(0.6, m.size) });
      else if (m.kind === 'lift') sure.push({ t: m.t, size: 0.3 + 0.5 * m.size });
      else if (m.kind === 'build' && m.dur) {
        const peak = m.t + m.dur;
        if (peak < end && !sc.moments!.some(x => (x.kind === 'drop' || x.kind === 'lift') && Math.abs(x.t - peak) < 1)) sure.push({ t: peak, size: 0.4 + 0.4 * m.size });
      }
    }
    // Where the music breaks or stops, the guesses below would only find it coming back late.
    const quiet = (sc.moments ?? []).filter(m => m.kind === 'break' || m.kind === 'stop');
    const near = (t: number) => sure.some(l => Math.abs(l.t - t) < 6) || quiet.some(m => t > m.t && t - m.t < 6);
    const out: { t: number; size: number }[] = [];
    for (let i = 1; i < sc.sections.length; i++) {
      const a = sc.sections[i - 1], b = sc.sections[i];
      if (b.t < end && b.energy - a.energy > 0.06) out.push({ t: b.t, size: Math.min(1, 0.45 + (b.energy - a.energy) * 3) });
    }
    // Loudness steps, at 4 Hz.
    const n = Math.floor(end * 4);
    const mix = new Float32Array(n);
    for (let i = 0; i < n; i++) mix[i] = sampleEnvelope(sc.envelopes.mix, i / 4) + sampleEnvelope(sc.envelopes.drums, i / 4) * 0.5;
    const pre = new Float32Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + mix[i];
    const mean = (a: number, b: number) => (pre[Math.min(n, b)] - pre[Math.max(0, a)]) / Math.max(1, Math.min(n, b) - Math.max(0, a));
    let lo = Infinity, hi = -Infinity;
    for (const v of mix) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const range = Math.max(1e-6, hi - lo);
    let best = { t: -99, d: 0 };
    for (let i = 16; i < n - 16; i++) {
      const d = (mean(i, i + 16) - mean(i - 16, i)) / range;
      if (d > 0.07 && d > best.d && i / 4 - best.t < 6) best = { t: i / 4, d };
      else if (d > 0.07 && i / 4 - best.t >= 6) { if (best.d > 0) out.push({ t: best.t, size: Math.min(1, best.d * 3) }); best = { t: i / 4, d }; }
    }
    if (best.d > 0) out.push({ t: best.t, size: Math.min(1, best.d * 3) });
    // Snap each lift to the nearest beat, merge ones closer than 6 s (keep the bigger).
    const beats = sc.beats;
    const snap = (t: number) => { let bt = t, bd = 1; for (const b of beats) { const dd = Math.abs(b.t - t); if (dd < bd) { bd = dd; bt = b.t; } if (b.t > t + 1) break; } return bt; };
    out.sort((a, b) => a.t - b.t);
    const merged: { t: number; size: number }[] = [];
    for (const l of out) {
      if (near(l.t)) continue;
      const last = merged[merged.length - 1];
      if (last && l.t - last.t < 6) { if (l.size > last.size) { last.t = snap(l.t); last.size = l.size; } }
      else merged.push({ t: snap(l.t), size: l.size });
    }
    return [...sure, ...merged].sort((a, b) => a.t - b.t).filter((l, i, a) => i === 0 || l.t - a[i - 1].t >= 2);
  }

  /**
   * Big changes, found ahead of time: describe each section by what is playing (drums, bass, the
   * rest, how much of it has a lead line, how busy and wide that lead is, how bright), and start a
   * new era wherever a section sounds clearly unlike the era so far. Short eras are not allowed.
   */
  private findEras(end: number): Era[] {
    const sc = this.score;
    const secs = sc.sections.filter(x => x.t < end);
    if (!secs.length) return [{ t: 0, kind: 'intro', journey: this.seed % 3 }];
    const feats: number[][] = [];
    for (let i = 0; i < secs.length; i++) {
      const a = secs[i].t, b = Math.min(end, secs[i + 1]?.t ?? end);
      let d = 0, bs = 0, o = 0, br = 0, lead = 0, n = 0, sum = 0, sum2 = 0;
      for (let t = a; t < b; t += 0.25) {
        d += sampleEnvelope(sc.envelopes.drums, t); bs += sampleEnvelope(sc.envelopes.bass, t);
        o += sampleEnvelope(sc.envelopes.other, t); br += sampleEnvelope(sc.envelopes.bright, t);
        const p = sampleEnvelope(sc.envelopes.leadPitch, t);
        if (p > 0) { lead++; sum += p; sum2 += p * p; }
        n++;
      }
      const notes = sc.events.filter(e => e.t >= a && e.t < b && e.kind === 'note' && e.stem !== 'bass').length;
      const range = lead > 2 ? Math.sqrt(Math.max(0, sum2 / lead - (sum / lead) ** 2)) / 6 : 0;
      n = Math.max(1, n);
      feats.push([d / n, bs / n, o / n, lead / n, range, notes / Math.max(1, b - a) / 4, br / n]);
    }
    // Normalise each feature by its song-wide maximum.
    const mx = feats[0].map((_, k) => Math.max(1e-6, ...feats.map(f => f[k])));
    const F = feats.map(f => f.map((v, k) => v / mx[k]));
    const dens = F.map(f => f[5]).sort((x, y) => x - y)[Math.floor(F.length / 2)];
    const kindOf = (f: number[], i: number): Era['kind'] =>
      i === 0 ? 'intro' : f[0] < 0.35 ? 'breakdown' : f[3] > 0.6 && f[5] > dens * 1.3 && f[4] > 0.5 ? 'solo' : 'drive';
    const eras: Era[] = [{ t: 0, kind: 'intro', journey: this.seed % 3 }];
    let mean = F[0].slice(), count = 1;
    for (let i = 1; i < secs.length; i++) {
      const f = F[i];
      const dist = Math.sqrt(f.reduce((acc, v, k) => acc + (v - mean[k]) ** 2, 0));
      const kind = kindOf(f, i);
      const since = secs[i].t - eras[eras.length - 1].t;
      const changed = dist > 0.55 || (kind !== 'drive' && kind !== eras[eras.length - 1].kind && dist > 0.35);
      if (changed && since >= 12) {
        eras.push({ t: secs[i].t, kind, journey: (eras[eras.length - 1].journey + 1) % JOURNEYS.length });
        mean = f.slice(); count = 1;
      } else {
        count++;
        mean = mean.map((v, k) => v + (f[k] - v) / count);
      }
    }
    return eras;
  }

  /** The era playing at s (index into eras). */
  private eraAt(s: number) { let i = 0; while (i + 1 < this.eras.length && this.eras[i + 1].t <= s) i++; return i; }

  private arcAt(t: number) {
    const a = this.arcI;
    if (!a.length) return 0.5;
    return a[THREE.MathUtils.clamp(Math.round(t * 2), 0, a.length - 1)];
  }

  /**
   * Where the song is on its journey: how bright and colourful the show may be (arc), and how
   * much it is holding its breath for a jump in the next few seconds (tension).
   */
  private updateArc(s: number, dt: number, running: boolean) {
    const sc = this.score;
    const end = sc.final ? sc.track.durationSec : sc.frontierSec;
    if (running && (end - this.arcBuiltAt > 4 || (sc.final && this.arcBuiltAt !== end))) this.buildArc();
    // A new era: a whole new vibe (new seed, patterns forgotten) and its own journey.
    if (running && this.eras.length) {
      const ei = this.eraAt(s);
      if (ei !== this.eraIdx) {
        const first = this.eraIdx < 0;
        this.eraIdx = ei;
        this.journey = this.eras[ei].journey;
        if (!first) {
          this.rand = rng((this.seed ^ Math.imul(ei + 1, 0x9e3779b9)) >>> 0);
          this.patterns.clear();
          this.secIdx = -2; // forces a fresh scene on the next frame
          this.V.release.value = 1;
        }
      }
    }
    this.journeyW.set(this.journey === 0 ? 1 : 0, this.journey === 1 ? 1 : 0, this.journey === 2 ? 1 : 0);
    (this.V.journey.value as THREE.Vector3).lerp(this.journeyW, 1 - Math.exp(-dt / 1.5));
    let arc = 0.3, tension = 0;
    if (running && this.arcI.length) {
      const now = this.arcAt(s);
      // The journey: a ceiling that rises towards the climax and eases off a little after it,
      // so the opening stays dark even when it is loud and the peak gets the most colour.
      const toPeak = this.arcPeakT > 0 ? THREE.MathUtils.clamp(s / this.arcPeakT, 0, 1) : 1;
      const ceiling = s <= this.arcPeakT ? 0.35 + 0.65 * toPeak ** 1.3 : 0.85 + 0.15 * Math.exp(-(s - this.arcPeakT) / 20);
      arc = ceiling * (0.45 + 0.55 * now);
      // Anticipation: wind up over the eight seconds (four bars at 120 bpm) before each lift,
      // and with any build-up the parser hears (the rise envelope).
      while (this.liftPtr < this.lifts.length && this.lifts[this.liftPtr].t <= s) {
        // The lift lands: let go, with a shockwave out of your gaze.
        const l = this.lifts[this.liftPtr++];
        if (s - l.t < 0.5) { this.V.release.value = Math.max(this.V.release.value, 0.5 + l.size * 0.5); this.releaseT = s - l.t; }
      }
      const next = this.lifts[this.liftPtr];
      if (next) { const ahead = next.t - s; if (ahead < 8) tension = next.size * (1 - ahead / 8) ** 1.5; }
      tension = Math.max(tension, Math.min(1, sampleEnvelope(this.score.envelopes.rise, s) * 0.8));
    }
    // A stop (score.moments): the lights go down with the music, fast, and snap back with it.
    let snappy = false;
    for (const m of this.score.moments ?? []) {
      if (m.t > s) break;
      if (m.kind === 'stop' && s < m.t + (m.dur ?? 0) + 0.3) { snappy = true; if (s < m.t + (m.dur ?? 0)) arc *= 0.2; }
    }
    const k = 1 - Math.exp(-dt / (snappy ? 0.08 : 1.2));
    this.arcLvl += (arc - this.arcLvl) * k;
    this.tensionLvl += (tension - this.tensionLvl) * (1 - Math.exp(-dt / 0.5));
    this.lastTension = this.tensionLvl;
    this.releaseT += dt;
    this.V.releaseT.value = this.releaseT;
    // The pattern's own clock speeds up as the tension builds (it rushes towards the drop).
    this.phase += dt * (this.V.shape.value.w) * (1 + this.tensionLvl * 3);
    this.V.phase.value = this.phase;
    this.V.release.value *= Math.exp(-dt / 0.8);
    this.V.arc.value = this.arcLvl;
    this.V.tension.value = this.tensionLvl;
  }

  /** The feedback the scene wants, bent by the arc: while the song holds its breath, the trails pull inwards. */
  get feedbackNow() {
    const f = this.feedback, t = this.tensionLvl;
    // The trails dry up as the lights go down, so nothing is left smeared on the screen.
    if (this.fade > 0) return { ...f, amount: f.amount * (1 - this.fade) ** 2 };
    if (t < 0.02 || this.outroOn) return f;
    return { amount: Math.max(f.amount, 0.75 * t), zoom: f.zoom + (0.975 - f.zoom) * t, turn: f.turn * (1 + t * 2), hue: f.hue };
  }

  /** Where the outro starts: the last OUTRO_LEN seconds, or a closing outro section a little before. */
  private get outroStart() {
    const sc = this.score;
    if (!sc.final) return Infinity;
    const D = sc.track.durationSec, last = sc.sections[sc.sections.length - 1];
    const own = last?.label === 'outro' && last.t > D - 40 ? last.t : Infinity;
    return Math.max(0, Math.min(D - OUTRO_LEN, own));
  }

  /** The outro scene: one of OUTROS (seeded), calm, with no trails, and nothing new thrown in. */
  private startOutro(s: number) {
    this.outroOn = true;
    const r = rng(this.seed ^ 0x51ed270b);
    const o = OUTROS[Math.floor(r() * OUTROS.length)];
    const cur = this.current ?? this.makeScene();
    const sc: Scene = o.elements.length
      ? { ...cur, elements: o.elements, look: o.look, layers: [0, 0, 0, 0], fold: [0, cur.fold[1], cur.fold[2], cur.fold[3]], feedback: { amount: 0, zoom: 1, turn: 0, hue: 0 } }
      : { ...cur, elements: cur.elements.filter(e => !SPRITE_ELEMENTS.includes(e)).slice(0, 2), feedback: { amount: 0, zoom: 1, turn: 0, hue: 0 } };
    if (!sc.elements.length) sc.elements = [0];
    this.applyScene(sc);
    this.crash();
    this.lastSceneAt = s;
  }

  // ------------------------------------------------------------------ recognised sounds
  // The sound pass (analysis/sounds.ts) recognises things that are not the music: someone talking,
  // a crowd, a siren, an explosion, birds, rain. Each family pops in with its own little effect,
  // shaped like the sound: a hit is one burst, a siren swings red and blue for as long as it wails,
  // speech runs along under your gaze like captions. They come and go with the sound itself, over
  // whatever scene is showing (so an intro full of samples comes alive before the beat arrives).

  private soundPtr = 0;
  private cuesOn: { c: SoundCue; next: number; n: number }[] = [];

  /**
   * Fireworks on cue: the score is known ahead, so a rocket can leave the horizon SHELL_RISE
   * seconds early and burst exactly on its hit. Each frame, the hits that have just come within
   * reach get a rocket (render/cues.ts says which hits, and how many shells each).
   */
  private shellsUntil = -1;
  private shellSlot = 0;
  private planShells(s: number, frontier: number, gazeAz: number) {
    const until = Math.min(s + SHELL_RISE, frontier);
    if (this.shellsUntil < s - 0.05) this.shellsUntil = s; // after a seek, or when the show comes on
    if (until <= this.shellsUntil) return;
    for (const c of fireworkCues(this.score, this.shellsUntil, until)) {
      for (let k = 0; k < c.shells; k++) {
        const u = this.V.shells[this.shellSlot++ % this.V.shells.length].value as THREE.Vector4;
        const spread = c.shells > 1 ? (k / (c.shells - 1) - 0.5) * 2.2 : (this.rand() - 0.5) * 1.8;
        u.set(c.t + k * 0.06, gazeAz + spread + (this.rand() - 0.5) * 0.3, 0.22 + this.rand() * 0.3, Math.floor(c.t * 97 + k * 13) % 1000);
      }
    }
    this.shellsUntil = until;
  }

  private hearSounds(s: number, gazeAz: number) {
    const cues = this.score.sounds;
    if (!cues) return;
    while (this.soundPtr < cues.length && cues[this.soundPtr].t <= s) {
      const c = cues[this.soundPtr++];
      if (s - c.t > 1) continue; // (long gone: a seek)
      this.cuesOn.push({ c, next: c.t, n: 0 });
    }
    for (let i = this.cuesOn.length - 1; i >= 0; i--) {
      const on = this.cuesOn[i];
      if (s >= on.c.t + on.c.dur) { this.cuesOn.splice(i, 1); continue; }
      if (s < on.next) continue;
      // The far-side backdrop has no sprites: a hit flashes the whole sky instead.
      if (this.far) {
        if (on.c.kind === 'impact' || on.c.kind === 'shout' || on.c.kind === 'whoosh') this.V.crash.value = Math.max(this.V.crash.value, on.c.kind === 'whoosh' ? 0.4 : 0.8);
        on.n++; on.next = s + SOUND_PERIOD[on.c.kind];
        continue;
      }
      this.soundFx(on.c.kind, s, on.c.score, gazeAz, on.n++);
      on.next = s + SOUND_PERIOD[on.c.kind];
    }
  }

  /** One beat of a sound's effect: `n` counts them (0 is its arrival). */
  private soundFx(kind: SoundKind, t: number, score: number, gazeAz: number, n: number) {
    const r = this.rand, v = Math.min(1, 0.3 + score);
    const base = { t0: t, pop: 0.08, grow: 0, wobble: 0, spin: 0, vel: v };
    switch (kind) {
      case 'speech': {
        // Captions: a row of soft dots running along under your gaze, a word at a time.
        const voice = sampleEnvelope(this.score.envelopes.voice, t);
        const w = 2 + Math.floor(r() * 4);
        for (let i = 0; i < w; i++) this.fireflies.add({ ...base, life: 2.2, fadeOut: 0.8, az: gazeAz + 0.3 + i * 0.06, vAz: -0.14,
          el: -0.34, vEl: 0, size: 0.35 + voice * 0.35, hue: 0.55, sat: 0.12 });
        break;
      }
      case 'shout':
        this.bursts.add({ ...base, life: 0.8, fadeOut: 0.6, grow: 1.8, az: gazeAz + (r() - 0.5) * 0.6, vAz: 0, el: (r() - 0.3) * 0.4, vEl: 0, size: 9 + v * 6, spin: 4, hue: 0.02, sat: 0.2 });
        if (n === 0) this.V.release.value = Math.max(this.V.release.value, 0.35);
        break;
      case 'laugh':
        for (let i = 0; i < 3; i++) this.bubbles.add({ ...base, t0: t + i * 0.06, life: 2.6, fadeOut: 0.9, grow: 0.2, wobble: 0.08, az: gazeAz + (r() - 0.5) * 1.2, vAz: 0,
          el: -0.4, vEl: 0.3 + r() * 0.2, size: 1 + r() * 1.5, hue: 0.08 + r() * 0.07, sat: 0.8 });
        break;
      case 'sing':
        // A halo of petals drifting down round the top of your view while someone sings.
        this.petals.add({ ...base, life: 5, pop: 0.4, fadeOut: 2, wobble: 0.1, az: gazeAz + (r() - 0.5) * 2.2, vAz: (r() - 0.5) * 0.05, el: 0.75 + r() * 0.2, vEl: -0.08,
          size: 0.9 + r() * 0.6, spin: (r() - 0.5) * 2, hue: 0.9 + r() * 0.15, sat: 0.35, vel: 0.35 + score * 0.3 });
        break;
      case 'crowd':
        // Confetti all round the room.
        for (let i = 0; i < 6; i++) this.confetti.add({ ...base, life: 2.6, fadeOut: 0.8, wobble: 0.05, az: this.far ? gazeAz + (r() - 0.5) * 2.4 : r() * Math.PI * 2, vAz: (r() - 0.5) * 0.1, el: 0.5 + r() * 0.5, vEl: -0.3 - r() * 0.2,
          size: 0.7 + r() * 0.5, spin: (r() - 0.5) * 12, hue: r(), sat: 0.9 });
        break;
      case 'animal': {
        // A little flock flies across.
        const dir = r() < 0.5 ? -1 : 1, el = 0.2 + r() * 0.4;
        for (let i = 0; i < 4; i++) this.comets.add({ ...base, t0: t + i * 0.12, life: 2.4, fadeOut: 0.6, wobble: 0.06, az: gazeAz - dir * (0.9 + i * 0.07), vAz: dir * 0.6,
          el: el + (i % 2) * 0.05, vEl: 0.02, size: 1.2, hue: 0.12, sat: 0.3 });
        break;
      }
      case 'nature':
        // Rain, wind, water: blue streaks falling.
        for (let i = 0; i < 4; i++) this.confetti.add({ ...base, life: 1.4, fadeOut: 0.4, az: gazeAz + (r() - 0.5) * 2.6, vAz: -0.05, el: 0.6 + r() * 0.3, vEl: -0.9 - r() * 0.3,
          size: 0.4, hue: 0.56 + r() * 0.05, sat: 0.6 });
        break;
      case 'siren': {
        // Red and blue swinging side to side for as long as it wails.
        const side = n % 2 ? 1 : -1;
        this.bursts.add({ ...base, life: 0.5, fadeOut: 0.4, grow: 0.6, az: gazeAz + side * 0.55, vAz: 0, el: 0.25, vEl: 0, size: 7 + v * 4, spin: 6, hue: side > 0 ? 0.62 : 0.0, sat: 1, vel: 0.9 });
        break;
      }
      case 'engine': {
        const dir = r() < 0.5 ? -1 : 1;
        this.comets.add({ ...base, life: 1.6, fadeOut: 0.5, az: gazeAz - dir * 1.0, vAz: dir * 1.3, el: -0.2 + r() * 0.1, vEl: 0, size: 3 + v * 2, hue: 0.07, sat: 0.8 });
        break;
      }
      case 'impact':
        // One big hit: a starburst, a flash and a shockwave.
        if (n === 0) {
          this.bursts.add({ ...base, life: 1.2, fadeOut: 1, grow: 2.4, az: gazeAz, vAz: 0, el: 0.05, vEl: 0, size: 14 + v * 8, spin: 2, hue: 0.08, sat: 0.5, vel: 1.4 });
          this.V.crash.value = Math.max(this.V.crash.value, 0.6 * v);
          this.V.release.value = Math.max(this.V.release.value, 0.7);
          this.releaseT = 0;
        }
        break;
      case 'whoosh':
        for (let i = 0; i < 3; i++) {
          const dir = r() < 0.5 ? -1 : 1;
          this.comets.add({ ...base, t0: t + i * 0.05, life: 0.9, fadeOut: 0.4, az: gazeAz - dir * 1.2, vAz: dir * 2.6, el: (r() - 0.3) * 0.6, vEl: 0, size: 4, hue: 0.55, sat: 0.2, vel: 0.9 });
        }
        break;
      case 'tick':
        // A clock: one mark a tick, going round your gaze.
        this.confetti.add({ ...base, life: 1.2, fadeOut: 0.6, az: gazeAz + Math.sin(n * 0.5236) * 0.4, vAz: 0, el: 0.05 + Math.cos(n * 0.5236) * 0.4, vEl: 0, size: 0.8, hue: 0.12, sat: 0.15, vel: 0.8 });
        break;
      case 'beep':
        this.bubbles.add({ ...base, life: 0.9, fadeOut: 0.5, grow: 0.8, az: gazeAz + (r() - 0.5) * 0.8, vAz: 0, el: (r() - 0.4) * 0.5, vEl: 0, size: 1.6, hue: 0.33, sat: 0.9 });
        break;
    }
  }

  // ------------------------------------------------------------------ spawners
  // Each one is a few lines: where it appears, how it moves, how long it lives. Copy one to add more.

  /** A flower for a note: placed near your gaze, as high as the note, coloured by its name; it slides down. */
  private bloom(t: number, pitch: number, vel: number, dur: number, gazeAz: number) {
    const pad = dur >= 1.2, r = this.rand;
    this.flowers.add({
      t0: t, life: pad ? 6 : 2.6, pop: 0.32, fadeOut: 1.2, grow: 0, wobble: 0,
      az: gazeAz + (r() - 0.5) * (pad ? 2.6 : 1.5), vAz: 0,
      el: THREE.MathUtils.clamp((pitch - 62) / 30, -0.5, 1.0) + (r() - 0.5) * 0.12, vEl: pad ? -0.04 : -0.14,
      size: (pad ? 12 : 6) * (0.7 + vel * 0.6), spin: (r() - 0.5) * 2,
      hue: (((pitch % 12) + 12) % 12) / 12, sat: 0.85, vel,
    });
  }

  /** A bubble for a bass note: a ring that wobbles up from below, bigger for lower notes. */
  private bubble(t: number, pitch: number, vel: number, dur: number, gazeAz: number) {
    const r = this.rand;
    const n = 2 + Math.floor(vel * 3);
    for (let i = 0; i < n; i++) this.bubbles.add({
      t0: t + i * 0.05, life: 3 + Math.min(2, dur), pop: 0.25, fadeOut: 1, grow: 0.15, wobble: 0.04,
      az: gazeAz + (r() - 0.5) * 1.8, vAz: 0,
      el: -0.55 - r() * 0.2, vEl: 0.22 + r() * 0.12,
      size: THREE.MathUtils.clamp(5.5 - (pitch - 28) * 0.12, 1.5, 6) * (0.5 + r() * 0.6), spin: 0,
      hue: (((pitch % 12) + 12) % 12) / 12, sat: 0.7, vel,
    });
  }

  /** A starburst for a snare: pops hot near your gaze, spins and swells as it dies. */
  private burst(t: number, vel: number, gazeAz: number) {
    const r = this.rand;
    this.bursts.add({
      t0: t, life: 0.9, pop: 0.06, fadeOut: 0.7, grow: 1.4, wobble: 0,
      az: gazeAz + (r() - 0.5) * 1.2, vAz: 0, el: (r() - 0.3) * 0.6, vEl: 0,
      size: 5 + vel * 6, spin: (r() < 0.5 ? -1 : 1) * (2 + r() * 3),
      hue: r(), sat: 0.35, vel: 0.6 + vel,
    });
  }

  /** Confetti for a hat: a few diamonds tumbling down past your view. */
  private sprinkle(t: number, vel: number, gazeAz: number) {
    const r = this.rand;
    for (let i = 0; i < 3; i++) this.confetti.add({
      t0: t, life: 2.4, pop: 0.05, fadeOut: 0.8, grow: 0, wobble: 0.05,
      az: gazeAz + (r() - 0.5) * 2.4, vAz: (r() - 0.5) * 0.1, el: 0.3 + r() * 0.6, vEl: -0.35 - r() * 0.25,
      size: 0.7 + r() * 0.6, spin: (r() - 0.5) * 12,
      hue: r(), sat: 0.95, vel: 0.4 + vel * 0.6,
    });
  }

  /** A comet for a melody note: streaks across the sky at the note's height, tail behind it. */
  private comet(t: number, pitch: number, vel: number, gazeAz: number) {
    const r = this.rand, dir = r() < 0.5 ? -1 : 1;
    this.comets.add({
      t0: t, life: 1.8, pop: 0.08, fadeOut: 0.8, grow: 0, wobble: 0,
      az: gazeAz - dir * (0.6 + r() * 0.5), vAz: dir * (0.7 + r() * 0.4),
      el: THREE.MathUtils.clamp((pitch - 62) / 30, -0.3, 0.9) + (r() - 0.5) * 0.1, vEl: -0.05,
      size: 3 + vel * 3, spin: 0, hue: (((pitch % 12) + 12) % 12) / 12, sat: 0.6, vel: 0.6 + vel * 0.5,
    });
  }

  /** Fireflies on the hats: small warm lights drifting up and wandering. */
  private firefly(t: number, vel: number, gazeAz: number) {
    const r = this.rand;
    for (let i = 0; i < 2; i++) this.fireflies.add({
      t0: t, life: 3.5, pop: 0.3, fadeOut: 1.5, grow: 0, wobble: 0.12,
      az: gazeAz + (r() - 0.5) * 2.6, vAz: (r() - 0.5) * 0.06, el: -0.3 + r() * 0.5, vEl: 0.05 + r() * 0.06,
      size: 0.35 + r() * 0.35, spin: 0, hue: 0.1 + r() * 0.08, sat: 0.9, vel: 0.5 + vel * 0.5,
    });
  }

  /** Petal rain for a long note: a flurry of petals falling and turning. */
  private petalRain(t: number, pitch: number, vel: number, gazeAz: number) {
    const r = this.rand, hue = (((pitch % 12) + 12) % 12) / 12;
    for (let i = 0; i < 10; i++) this.petals.add({
      t0: t + i * 0.08, life: 6, pop: 0.3, fadeOut: 2, grow: 0, wobble: 0.08,
      az: gazeAz + (r() - 0.5) * 2.4, vAz: (r() - 0.5) * 0.08, el: 0.7 + r() * 0.4, vEl: -0.16 - r() * 0.1,
      size: 1.1 + r() * 0.8, spin: (r() - 0.5) * 3, hue: hue + (r() - 0.5) * 0.06, sat: 0.7, vel: 0.5 + vel * 0.5,
    });
  }

  /** A snowflake for a long note: huge, slow, high, turning gently. */
  private flake(t: number, pitch: number, vel: number, gazeAz: number) {
    const r = this.rand;
    this.flakes.add({
      t0: t, life: 8, pop: 1.2, fadeOut: 3, grow: 0.04, wobble: 0.02,
      az: gazeAz + (r() - 0.5) * 2, vAz: (r() - 0.5) * 0.04, el: 0.25 + r() * 0.45, vEl: -0.02,
      size: 12 + vel * 8, spin: (r() - 0.5) * 0.5,
      hue: (((pitch % 12) + 12) % 12) / 12, sat: 0.5, vel: 0.3 + vel * 0.5,
    });
  }

  /** The melody's pitch over the next and last five seconds, round the horizon. */
  private updateWave(s: number, frontier: number, running: boolean) {
    const env = this.score.envelopes.leadPitch, contour = this.score.envelopes.contour;
    const D = this.waveData;
    for (let i = 0; i < 256; i++) {
      const rel = (i / 256 - 0.5) * 2; // -1 behind on the left .. +1 behind on the right
      const tt = s + rel * 5;
      let y = 0.5, on = 0;
      if (running && tt >= 0 && tt < frontier) {
        const p = env ? sampleEnvelope(env, tt) : 0;
        if (p > 0) { y = THREE.MathUtils.clamp(0.5 + (p - 66) / 40, 0.05, 0.95); on = 1; }
        else if (!env && contour) { y = 0.1 + 0.8 * sampleEnvelope(contour, tt); on = 0.6; }
      }
      // Fade towards the back so the wave reads as passing through your view.
      on *= 1 - Math.abs(rel) * 0.6;
      D[i * 4] = Math.round(y * 255); D[i * 4 + 1] = Math.round(on * 255); D[i * 4 + 2] = 0; D[i * 4 + 3] = 255;
    }
    this.V.wave.needsUpdate = true;
  }

  // ------------------------------------------------------------------ cards
  private cardCanvas: HTMLCanvasElement | null = null;
  private ball: THREE.Mesh | null = null;
  private lastSparkle = 0;
  private cardText = { name: '', line2: '', status: '' };
  /** How far the waiting line's task has got (a neon bar under it), or null for none. */
  private cardProgress: number | null = null;

  card(kind: 'landing' | 'title' | 'end', info: CardInfo): boolean {
    if (this.card3d) { this.group.remove(this.card3d); (this.card3d.material as THREE.MeshBasicMaterial).map?.dispose(); }
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 576;
    this.cardCanvas = c;
    const plain = kind === 'landing' && info.name === 'Gondryator';
    this.cardText = { name: plain ? 'The non-Gondry view :(' : info.name, line2: plain ? 'Drop a music file' : info.line2, status: kind === 'title' ? 'Tuning in' : '' };
    this.cardProgress = null;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
    this.card3d = new THREE.Mesh(new THREE.PlaneGeometry(16, 9), m);
    this.drawCard();
    this.card3d.position.set(0, 0.5, -22);
    // The glitterball, hung above the name while the show gets ready.
    if (!this.ball) {
      const geo = new THREE.IcosahedronGeometry(3, 3).toNonIndexed();
      geo.computeVertexNormals();
      const flash = uniform(0);
      const mat = makeGlitterMaterial({ tint: this.V.glitterTint, flash });
      mat.userData.flash = flash;
      this.ball = new THREE.Mesh(geo, mat);
      this.ball.position.set(0, 7.8, -22);
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 20, 6), new THREE.MeshBasicMaterial({ color: 0x777788 }));
      cord.position.y = 12;
      this.ball.add(cord);
      this.group.add(this.ball);
    }
    this.ball.visible = kind === 'title';
    this.card3d.renderOrder = 5;
    this.group.add(this.card3d);
    return true;
  }

  /**
   * While the shaders build, the song's name glows in neon with a line under it: "tuning in",
   * then a countdown. `text` comes from the same estimate as the train's departures board.
   */
  setWaiting(text: string, progress: number | null = null) {
    const status = text === 'Waiting for a clear line' ? 'Tuning in' : text.replace('Departs in', 'Starting in').replace('Departing', 'Here we go');
    const p = progress === null ? null : Math.round(progress * 50) / 50;
    if (status === this.cardText.status && p === this.cardProgress) return;
    this.cardText.status = status;
    this.cardProgress = p;
    this.drawCard();
  }

  private drawCard() {
    const c = this.cardCanvas, card = this.card3d;
    if (!c || !card) return;
    const g = c.getContext('2d')!;
    const { name, line2, status } = this.cardText;
    g.clearRect(0, 0, c.width, c.height);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = 104;
    do { g.font = `800 ${size}px system-ui, sans-serif`; size -= 4; } while (g.measureText(name).width > 960 && size > 40);
    // Neon: wide coloured haze, then a tighter glow in a sweep of hues, then a hot white core.
    const grad = g.createLinearGradient(40, 0, 984, 0);
    grad.addColorStop(0, '#ff3fa4'); grad.addColorStop(0.5, '#7a5cff'); grad.addColorStop(1, '#2fd6ff');
    for (const [blur, alpha] of [[48, 0.6], [18, 0.9]] as const) {
      g.shadowColor = '#b04cff'; g.shadowBlur = blur; g.globalAlpha = alpha;
      g.strokeStyle = grad; g.lineWidth = 10; g.strokeText(name, 512, 160);
    }
    g.globalAlpha = 1; g.shadowBlur = 8; g.shadowColor = '#ffffff';
    g.lineWidth = 3; g.strokeStyle = '#fff4ff'; g.strokeText(name, 512, 160);
    g.shadowBlur = 0;
    g.font = '400 42px system-ui, sans-serif';
    g.fillStyle = 'rgba(220,235,255,0.8)';
    g.fillText(line2, 512, 262, 960);
    // A countdown gets big neon digits, so you can see when the show will kick in.
    const count = /(\d+)s$/.exec(status)?.[1];
    if (count) {
      g.font = '700 40px ui-monospace, Menlo, monospace';
      g.fillStyle = '#ffd36a'; g.shadowColor = '#ff9a00'; g.shadowBlur = 16;
      g.fillText(status.replace(/\s*\d+s$/, '').toUpperCase(), 512, 345);
      g.font = '900 170px system-ui, sans-serif';
      const n = Number(count), hot = Math.max(0, Math.min(1, 1 - n / 10));
      for (const [blur, alpha] of [[50, 0.7], [20, 1]] as const) {
        g.shadowColor = hot > 0.5 ? '#ff3fa4' : '#2fd6ff'; g.shadowBlur = blur; g.globalAlpha = alpha;
        g.strokeStyle = grad; g.lineWidth = 8; g.strokeText(count, 512, 470);
      }
      g.globalAlpha = 1; g.shadowColor = '#ffffff'; g.shadowBlur = 10;
      g.fillStyle = '#fff4ff'; g.fillText(count, 512, 470);
      g.shadowBlur = 0;
    } else if (status) {
      g.font = '700 46px ui-monospace, Menlo, monospace';
      g.fillStyle = '#ffd36a'; g.shadowColor = '#ff9a00'; g.shadowBlur = 16;
      g.fillText(status.toUpperCase(), 512, 370, 980);
      g.shadowBlur = 0;
      if (this.cardProgress !== null) {
        g.fillStyle = 'rgba(255,211,106,0.2)'; g.fillRect(212, 412, 600, 10);
        g.fillStyle = grad; g.shadowColor = '#ff9a00'; g.shadowBlur = 14;
        g.fillRect(212, 412, 600 * Math.min(1, Math.max(0, this.cardProgress)), 10);
        g.shadowBlur = 0;
      }
    }
    (card.material as THREE.MeshBasicMaterial).map!.needsUpdate = true;
  }

  /**
   * The glitterball as a scene of its own (element 41): it hangs in front of you, spins faster with
   * the energy, flashes on the kick, takes the scene's colours, and swings in closer on the drops.
   */
  private glitterSpin = 0;
  private glitterDone = false;
  private outroOn = false;
  /** 0 until the last OUTRO_FADE seconds of the song, then rising to 1: the lights going down. */
  private fade = 0;
  // The raw pitch curves drop to 0 in every gap and wobble across semitones, which made the
  // figures that read them snap between two shapes. Hold the last note, ease towards it, and only
  // re-pick the Lissajous frequencies on a downbeat.
  private heldPitch = [0, 0];
  private figureBar = -1;
  private figureTarget = [3, 2];
  private spinBeat = 0;
  private spinTarget = 0;
  private updatePitches(sc: Score, s: number, dt: number, running: boolean) {
    const raw = running ? [sampleEnvelope(sc.envelopes.leadPitch, s), sc.envelopes.bassPitch ? sampleEnvelope(sc.envelopes.bassPitch, s) : 0] : [0, 0];
    for (let i = 0; i < 2; i++) if (raw[i] > 0) this.heldPitch[i] = raw[i];
    const P = this.V.pitches.value, k = 1 - Math.exp(-dt / 0.35);
    if (P.x === 0) P.x = this.heldPitch[0];
    if (P.y === 0) P.y = this.heldPitch[1];
    P.x += (this.heldPitch[0] - P.x) * k; P.y += (this.heldPitch[1] - P.y) * k;
    const g = running ? gridAt(sc, s) : null;
    if (g && g.bar !== this.figureBar && g.beat === 1) {
      this.figureBar = g.bar;
      this.figureTarget = [(Math.round(this.heldPitch[0]) % 5) + 1, (Math.round(this.heldPitch[1]) % 4) + 1];
    }
    const S = this.V.soft.value, ks = 1 - Math.exp(-dt / 0.35), B = this.V.bands.value;
    S.x += (B.y - S.x) * ks; S.y += (B.z - S.y) * ks;
    if (g && g.beat !== this.spinBeat) { this.spinBeat = g.beat; this.spinTarget += 0.15; }
    S.z += (this.spinTarget - S.z) * (1 - Math.exp(-dt / 0.12));
    const F = this.V.figure.value, kf = 1 - Math.exp(-dt / 0.25);
    F.x += (this.figureTarget[0] - F.x) * kf; F.y += (this.figureTarget[1] - F.y) * kf;
  }

  private updateGlitterball(s: number, dt: number, running: boolean) {
    const ball = this.ball, w = this.weights[41];
    if (!ball || !running || s < 6) return;
    ball.visible = w > 0.02;
    if (!ball.visible) return;
    const energy = sectionAt(this.score, s).section?.energy ?? 0.5;
    const speed = 0.3 + energy * 1.4 + this.tensionLvl * 2 + this.V.release.value * 3;
    this.glitterSpin += dt * speed;
    ball.rotation.y = this.glitterSpin;
    this.V.glitter.value.set(speed, this.V.release.value);
    (ball.material as any).userData.flash.value = Math.max(this.kickLvl(s), this.V.release.value);
    const p = this.V.pa.value, b = this.V.pb.value;
    this.V.glitterTint.value.set(p.x + b.x * 0.5, p.y + b.y * 0.2, p.z - b.z * 0.3);
    // In front of your gaze, closer (bigger) as the arc climbs and on a drop.
    const dist = 15 - 5 * this.arcLvl - 4 * this.V.release.value;
    const g = this.V.gaze.value;
    ball.position.set(g.x * dist, g.y * dist + 1.2, g.z * dist);
    ball.scale.setScalar(w * 1.6 * (1 + 0.06 * this.kickLvl(s)));
  }

  private kickLvl(s: number) { return Math.exp(-(s - this.lastKick) / 0.15); }

  private updateCard(s: number, running: boolean) {
    if (!this.card3d) return;
    // A slow breath and sway while it waits.
    const tt = performance.now() / 1000;
    this.card3d.scale.setScalar(1 + Math.sin(tt * 1.7) * 0.02);
    this.card3d.rotation.z = Math.sin(tt * 0.6) * 0.02;
    // The name hangs in the air until the music has played for a few seconds.
    const m = this.card3d.material as THREE.MeshBasicMaterial;
    m.opacity = running ? THREE.MathUtils.clamp(1 - (s - 2) / 3, 0, 1) : 1;
    this.card3d.visible = m.opacity > 0.01;
    const ball = this.ball;
    if (ball && ball.visible && (!running || s < 6)) {
      ball.rotation.y = tt * 0.8;
      // Once the music starts, the ball is hauled up out of sight.
      ball.position.y = 7.8 + (running ? Math.max(0, s - 1) ** 2 * 3 : 0);
      // Spots of light thrown round the room while it waits.
      if (!running && tt - this.lastSparkle > 0.12) {
        this.lastSparkle = tt;
        const r = this.rand;
        this.bursts.add({ t0: s, life: 1.4, pop: 0.1, fadeOut: 1, grow: 0.2, wobble: 0, az: (r() - 0.5) * 3.2, vAz: 0.25, el: (r() - 0.35) * 1.2, vEl: 0,
          size: 1.2 + r() * 1.5, spin: 0, hue: r(), sat: 0.25, vel: 0.9 });
      }
    }
  }
}

/** A flat outline in polar form: radius r(angle), about 2 m across at r = 1. */
function polarShape(radius: (a: number) => number, N = 96) {
  const shape = new THREE.Shape();
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = radius(a);
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  return new THREE.ShapeGeometry(shape, 1);
}

/** A thin ring (a bubble seen side on). */
function ringGeometry() { return new THREE.RingGeometry(0.82, 1, 48, 1); }

/**
 * Which picture a section gets: sections that sound alike (the analyser's groups) share one, so a
 * chorus comes back as itself with a new palette, and a verse that sounds different looks different.
 */
function sectionKey(sec: { label: string; group?: number }) {
  return sec.group === undefined ? sec.label : `group ${sec.group}`;
}
