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

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { makeSpriteMaterial, makeVisualiserMaterial } from './shaders';
import type { CardInfo, ShowDriver } from './driver';
import type { GazeSource } from './spawner';
import type { FxLookName, Pack } from '../packs/types';
import { sampleEnvelope, sectionAt, type Score } from '../score/types';

type Vec3 = [number, number, number];
/** Cosine palettes (Inigo Quilez): colour = a + b * cos(2pi * (c * t + d)). */
const PALETTES: [Vec3, Vec3, Vec3, Vec3][] = [
  [[0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [1, 1, 1], [0, 0.33, 0.67]],     // rainbow
  [[0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [1, 1, 1], [0, 0.1, 0.2]],       // fire and ice
  [[0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [1, 1, 1], [0.3, 0.2, 0.2]],     // sunset
  [[0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [1, 1, 0.5], [0.8, 0.9, 0.3]],   // acid
  [[0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [1, 0.7, 0.4], [0, 0.15, 0.2]],  // peach and teal
  [[0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [2, 1, 0], [0.5, 0.2, 0.25]],    // candy
  [[0.8, 0.5, 0.4], [0.2, 0.4, 0.2], [2, 1, 1], [0, 0.25, 0.25]],     // terracotta
  [[0.5, 0.2, 0.6], [0.5, 0.4, 0.4], [1, 1, 1], [0.6, 0.1, 0.3]],     // ultraviolet
  [[0.2, 0.5, 0.4], [0.3, 0.4, 0.4], [1, 1, 1], [0.1, 0.4, 0.6]],     // deep sea
];
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
];
const NE = ELEMENTS.length;

/** How the arc shows itself, one per era (see updateArc and the shader's arc block). */
export const JOURNEYS = ['colour rise', 'complexity bloom', 'thaw'] as const;
/** A stretch of the song with its own vibe. */
export interface Era { t: number; kind: 'intro' | 'solo' | 'breakdown' | 'drive'; journey: number }

const LOOKS: FxLookName[] = ['trip', 'kaleido', 'liquid', 'prism', 'echo', 'thermal', 'fold', 'hyper', 'tunnel', 'clean'];

interface Scene {
  palette: number;
  shape: [number, number, number, number]; // plasma frequency, swirl, kaleido segments, speed
  mixes: [number, number, number, number]; // plasma, rings, tunnel, phase
  look: FxLookName;
  /** Layer weights: vector shapes, band ribbons, (unused), mirror about the horizon. */
  layers: [number, number, number, number];
  /** Shapes: sides, how many nested, spin speed, starriness. */
  poly: [number, number, number, number];
  /** Video feedback: amount, zoom per frame, turn per frame, colour drift. */
  feedback: { amount: number; zoom: number; turn: number; hue: number };
  /** Deep kaleidoscope on the base pattern: levels (0..5), turn per level, stretch, slide. */
  fold: [number, number, number, number];
  /** Fractal kaleidoscope: mirrors round the gaze, scale, fold constant, drift speed. */
  frac: [number, number, number, number];
  /** Which elements show (indices into ELEMENTS). */
  elements: number[];
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

  add(sp: Sprite) { this.items[this.next] = sp; this.next = (this.next + 1) % this.count; }

  clear() {
    this.items.fill(null);
    for (let i = 0; i < this.count; i++) this.mesh.setMatrixAt(i, this.m4.makeScale(0, 0, 0));
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** `light` scales every sprite's brightness (the song's arc). */
  update(s: number, light = 1) {
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
      this.col.setHSL(f.hue, f.sat, 0.5).multiplyScalar(fade * (0.45 + f.vel * 0.6) * light);
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
    crash: uniform(0), rise: uniform(0), bright: uniform(0.3),
    layers: uniform(new THREE.Vector4()), poly: uniform(new THREE.Vector4(5, 2, 0.4, 0)), bands: uniform(new THREE.Vector3()),
    E0: uniform(new THREE.Vector4(1, 0, 0, 0)), E1: uniform(new THREE.Vector4()), E2: uniform(new THREE.Vector4()), E3: uniform(new THREE.Vector4()), E4: uniform(new THREE.Vector4()),
    fold: uniform(new THREE.Vector4(0, 0.6, 1.3, 0.5)), frac: uniform(new THREE.Vector4(6, 1.2, 0.7, 0.5)),
    kickT: uniform(99), pad: uniform(0),
    arc: uniform(0.3), tension: uniform(0), release: uniform(0), journey: uniform(new THREE.Vector3(1, 0, 0)),
    notes: null as unknown as THREE.DataTexture,
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
  private pools = [this.flowers, this.bubbles, this.bursts, this.confetti, this.flakes];
  private bassTimes = [-99, -99, -99, -99];
  private bassPtr = 0;
  private ptr = 0;
  private lastS = -Infinity;
  private seed: number;
  private rand: () => number;
  private patterns = new Map<string, { scene: Scene; seen: number }>();
  private secIdx = -1;
  private lastLeadT = -99;
  private lastSceneAt = -99;
  /** The song's arc: intensity at 2 Hz over the analysed part of the song (see buildArc). */
  private arcI = new Float32Array(0);
  private arcPeakT = 0;
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

  constructor(private pack: Pack, private score: Score, private camera: THREE.PerspectiveCamera) {
    this.V.wave = new THREE.DataTexture(this.waveData, 256, 1, THREE.RGBAFormat);
    this.V.wave.magFilter = THREE.LinearFilter;
    this.V.wave.minFilter = THREE.LinearFilter;
    this.V.wave.wrapS = THREE.RepeatWrapping;
    this.V.wave.needsUpdate = true;
    this.V.notes = new THREE.DataTexture(this.noteData, 16, 1, THREE.RGBAFormat);
    this.V.notes.needsUpdate = true;
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(400, 128, 64), makeVisualiserMaterial(this.V));
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    this.group.add(this.dome);
    for (const p of this.pools) this.group.add(p.mesh);
    this.seed = hashStr(score.track.hash || score.track.title || 'gondryator');
    this.rand = rng(this.seed);
    this.applyScene(this.makeScene());
  }

  get activeCount() { return this.pools.reduce((n, p) => n + p.live, 0); }
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
    const ev = this.score.events;
    let lo = 0, hi = ev.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (ev[m].t <= s) lo = m + 1; else hi = m; }
    this.ptr = lo;
    this.lastS = s;
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
    const w = [r(), r() * 0.8, r() * 0.8];
    const sum = w[0] + w[1] + w[2] || 1;
    return {
      palette: Math.floor(r() * PALETTES.length),
      shape: [1.5 + r() * 4.5, r() < 0.4 ? 0 : r() * 2.2, segChoices[Math.floor(r() * segChoices.length)], 0.25 + r() * 0.8],
      mixes: [w[0] / sum * 1.6, w[1] / sum * 1.2, w[2] / sum * 1.2, r() * 6],
      look: LOOKS[Math.floor(r() * LOOKS.length)],
      layers: [0, 0, 0, r() < 0.3 ? 1 : 0],
      elements: [0],
      poly: [3 + Math.floor(r() * 6), Math.floor(r() * 5), (r() - 0.5) * 1.6, r() < 0.4 ? r() : 0],
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
    // ?viz=16,17 pins the elements (for trying one out); ?fb=0 turns the feedback trails off.
    const q = new URLSearchParams(location.search);
    const pinned = q.get('viz')?.split(',').map(Number).filter(n => n >= 0 && n < NE);
    const els = pinned?.length ? pinned : sc.elements;
    this.target.fill(0);
    for (const e of els) this.target[e] = e === 0 && els.length > 1 ? 0.7 : 1;
    if (q.get('fb') === '0') sc = { ...sc, feedback: { amount: 0, zoom: 1, turn: 0, hue: 0 } };
    this.V.poly.value.set(...sc.poly);
    this.V.fold.value.set(...sc.fold);
    this.V.frac.value.set(...sc.frac);
    this.feedback = sc.feedback;
    this.look = sc.look;
  }

  private crash() { this.V.crash.value = 1; this.crashPending = true; }

  private newScene(s: number, label: string, sectionStart: boolean) {
    const kept = this.patterns.get(label);
    const repeatable = label !== 'intro' && label !== 'outro';
    let sc: Scene;
    if (kept && repeatable) { kept.seen++; sc = this.makeScene(kept.scene); }
    else {
      sc = this.makeScene();
      sc.elements = this.orchestrate(s);
      if (sectionStart) this.patterns.set(label, { scene: sc, seen: 0 });
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
    const order = active.map(g => ({ g, k: r() * (g === 'mix' ? 0.6 : 1) + Math.min(1, count[g] / 30) * 0.4 })).sort((a, b) => b.k - a.k).map(o => o.g);
    const pick: number[] = [];
    for (const g of order) {
      if (pick.length >= n) break;
      const opts = ELEMENTS.map((el, i) => ({ el, i })).filter(o => o.el.group === g);
      pick.push(opts[Math.floor(r() * opts.length)].i);
    }
    while (pick.length < n) {
      const opts = ELEMENTS.map((el, i) => ({ el, i })).filter(o => active.includes(o.el.group) && !pick.includes(o.i));
      if (!opts.length) break;
      pick.push(opts[Math.floor(r() * opts.length)].i);
    }
    return pick;
  }

  /** One line for the debug overlay and tests: era, journey, arc, tension, elements. */
  get status() {
    const e = this.eras[this.eraIdx];
    return `era ${this.eraIdx + 1}/${this.eras.length} ${e?.kind ?? '-'} · ${JOURNEYS[this.journey]} · arc ${this.arcLvl.toFixed(2)} tension ${this.tensionLvl.toFixed(2)} · ${this.showing.join(', ')}`;
  }

  /** Which elements are showing now (for the debug overlay and tests). */
  get showing() { return ELEMENTS.filter((_, i) => this.target[i] > 0).map(e => e.name); }

  // ------------------------------------------------------------------ per frame
  update(s: number, dt: number, _gaze: GazeSource, frontier: number, running: boolean) {
    const sc = this.score;
    this.camera.getWorldPosition(this.pos);
    this.group.position.copy(this.pos);
    this.camera.getWorldDirection(this.dir);
    this.V.gaze.value.copy(this.dir);
    const gazeAz = Math.atan2(this.dir.x, -this.dir.z);
    this.V.gazeAz.value = gazeAz;
    if (s < this.lastS - 0.05 || s > this.lastS + 1) this.seekTo(s);
    this.lastS = s;

    if (running) {
      // Scene changes: every section, and every new melody phrase (after a breath of 1.5 s).
      const { section: sec, index: idx } = sectionAt(sc, s);
      if (idx !== this.secIdx && sec) { this.secIdx = idx; this.newScene(s, sec.label, true); }
      const lead = sampleEnvelope(sc.envelopes.leadPitch, s);
      if (lead > 0) {
        if (s - this.lastLeadT > 1.5 && s - this.lastSceneAt > 6 && sec) this.newScene(s, sec.label + ':phrase', false);
        this.lastLeadT = s;
      }
      // Events as they sound.
      const ev = sc.events;
      while (this.ptr < ev.length && ev[this.ptr].t <= s && ev[this.ptr].t < frontier) {
        const e = ev[this.ptr++];
        if (s - e.t > 0.3) continue;
        if (e.kind === 'kick') this.lastKick = e.t;
        else if (e.kind === 'snare') {
          this.V.boltAz.value = gazeAz + (this.rand() - 0.5) * 1.6;
          this.V.boltT.value = 0;
          this.V.boltSeed.value = this.rand() * 100;
          if (this.target[18] > 0) this.burst(e.t, e.vel, gazeAz);
        } else if (e.kind === 'hat') {
          if (this.target[19] > 0) this.sprinkle(e.t, e.vel, gazeAz);
        } else if (e.stem === 'bass' && e.kind === 'note') {
          this.bassTimes[this.bassPtr++ % 4] = e.t;
          if (this.target[17] > 0) this.bubble(e.t, e.pitch ?? 40, e.vel, e.dur, gazeAz);
        } else if (e.kind === 'note' && e.pitch !== null && (e.stem === 'other' || e.stem === 'vocals')) {
          this.noteAct[((e.pitch % 12) + 12) % 12] = Math.max(this.noteAct[((e.pitch % 12) + 12) % 12], 0.5 + e.vel * 0.5);
          if (this.target[12] > 0) this.bloom(e.t, e.pitch, e.vel, e.dur, gazeAz);
          if (this.target[20] > 0 && e.dur >= 1.2) this.flake(e.t, e.pitch, e.vel, gazeAz);
        }
      }
    }
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
    const kw = 1 - Math.exp(-dt / 0.6);
    for (let i = 0; i < NE; i++) this.weights[i] += (this.target[i] - this.weights[i]) * kw;
    const w = this.weights;
    this.V.E0.value.set(w[0], w[1], w[2], w[3]); this.V.E1.value.set(w[4], w[5], w[6], w[7]);
    this.V.E2.value.set(w[8], w[9], w[10], w[11]); this.V.E3.value.set(w[12], w[13], w[14], w[15]);
    this.V.E4.value.set(w[16], w[17], w[18], w[19]);
    this.V.pulse0.value = s - this.bassTimes[0]; this.V.pulse1.value = s - this.bassTimes[1];
    this.V.pulse2.value = s - this.bassTimes[2]; this.V.pulse3.value = s - this.bassTimes[3];
    this.V.crash.value *= Math.exp(-dt / 0.22);
    this.V.rise.value = running ? sampleEnvelope(sc.envelopes.rise, s) : 0;
    this.V.bright.value = running ? sampleEnvelope(sc.envelopes.bright, s) : 0.3;
    if (running) this.V.bands.value.set(sampleEnvelope(sc.envelopes.drums, s), sampleEnvelope(sc.envelopes.bass, s), sampleEnvelope(sc.envelopes.other, s));
    else this.V.bands.value.set(0, 0, 0);
    this.updateArc(s, dt, running);
    this.updateWave(s, frontier, running);
    const light = 0.4 + this.arcLvl * 0.8 + this.V.release.value * 0.5;
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
      // Anticipation: a jump in intensity within the next eight seconds (and in the analysed part).
      for (let d = 1; d <= 16; d++) {
        const t2 = s + d / 2;
        if (t2 >= end) break;
        const jump = this.arcAt(t2) - now;
        if (jump > 0.22) { tension = Math.max(tension, Math.min(1, jump * 2) * (1 - d / 17)); }
      }
    }
    const k = 1 - Math.exp(-dt / 1.2);
    this.arcLvl += (arc - this.arcLvl) * k;
    this.tensionLvl += (tension - this.tensionLvl) * (1 - Math.exp(-dt / 0.5));
    // The release: tension falling away fast means the moment arrived.
    if (this.lastTension > 0.35 && this.tensionLvl < this.lastTension - 0.08) this.V.release.value = 1;
    this.lastTension = this.tensionLvl;
    this.V.release.value *= Math.exp(-dt / 0.8);
    this.V.arc.value = this.arcLvl;
    this.V.tension.value = this.tensionLvl;
  }

  /** The feedback the scene wants, bent by the arc: while the song holds its breath, the trails pull inwards. */
  get feedbackNow() {
    const f = this.feedback, t = this.tensionLvl;
    if (t < 0.02) return f;
    return { amount: Math.max(f.amount, 0.75 * t), zoom: f.zoom + (0.975 - f.zoom) * t, turn: f.turn * (1 + t * 2), hue: f.hue };
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
      size: (pad ? 9 : 3.2) * (0.7 + vel * 0.6), spin: (r() - 0.5) * 2,
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
  card(kind: 'landing' | 'title' | 'end', info: CardInfo): boolean {
    if (this.card3d) { this.group.remove(this.card3d); (this.card3d.material as THREE.MeshBasicMaterial).map?.dispose(); }
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 384;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.font = '700 88px system-ui, sans-serif';
    g.fillText(kind === 'landing' ? 'The non-Gondry view :(' : info.name, 512, 170, 980);
    g.font = '400 44px system-ui, sans-serif';
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.fillText(kind === 'landing' ? 'Drop a music file' : info.line2, 512, 250, 980);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
    this.card3d = new THREE.Mesh(new THREE.PlaneGeometry(16, 6), m);
    this.card3d.position.set(0, 1.5, -22);
    this.card3d.renderOrder = 5;
    this.group.add(this.card3d);
    return true;
  }

  private updateCard(s: number, running: boolean) {
    if (!this.card3d) return;
    // The name hangs in the air until the music has played for a few seconds.
    const m = this.card3d.material as THREE.MeshBasicMaterial;
    m.opacity = running ? THREE.MathUtils.clamp(1 - (s - 2) / 3, 0, 1) : 1;
    this.card3d.visible = m.opacity > 0.01;
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
