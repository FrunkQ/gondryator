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
//
// A scene is a handful of numbers (palette, plasma frequency, swirl, kaleidoscope segments,
// pattern mix, drift speed, post-effects look) drawn from a seeded random generator, so every
// song gets its own set and the same song looks the same next time. Sections that come back
// (a second chorus) bring their pattern back with a new palette and phase. R rerolls the seed.

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { makeFlowerMaterial, makeVisualiserMaterial } from './shaders';
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
const LOOKS: FxLookName[] = ['trip', 'kaleido', 'liquid', 'prism', 'echo', 'thermal', 'fold', 'hyper', 'tunnel', 'clean'];

interface Scene {
  palette: number;
  shape: [number, number, number, number]; // plasma frequency, swirl, kaleido segments, speed
  mixes: [number, number, number, number]; // plasma, rings, tunnel, phase
  look: FxLookName;
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

const FLOWERS = 420;
const R_FLOWER = 60;

interface Flower { t0: number; life: number; az: number; el: number; size: number; slide: number; spin: number; hue: number; vel: number }

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
  };
  private waveData = new Uint8Array(256 * 4);
  private dome: THREE.Mesh;
  private flowersMesh: THREE.InstancedMesh;
  private flowers: (Flower | null)[] = new Array(FLOWERS).fill(null);
  private nextFlower = 0;
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
  private card3d: THREE.Mesh | null = null;
  private dir = new THREE.Vector3();
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private qSpin = new THREE.Quaternion();
  private col = new THREE.Color();
  private pos = new THREE.Vector3();
  private scl = new THREE.Vector3();

  constructor(private pack: Pack, private score: Score, private camera: THREE.PerspectiveCamera) {
    this.V.wave = new THREE.DataTexture(this.waveData, 256, 1, THREE.RGBAFormat);
    this.V.wave.magFilter = THREE.LinearFilter;
    this.V.wave.minFilter = THREE.LinearFilter;
    this.V.wave.wrapS = THREE.RepeatWrapping;
    this.V.wave.needsUpdate = true;
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(400, 128, 64), makeVisualiserMaterial(this.V));
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    this.group.add(this.dome);
    this.flowersMesh = new THREE.InstancedMesh(flowerGeometry(), makeFlowerMaterial(), FLOWERS);
    this.flowersMesh.frustumCulled = false;
    this.flowersMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < FLOWERS; i++) { this.flowersMesh.setMatrixAt(i, this.m4.makeScale(0, 0, 0)); this.flowersMesh.setColorAt(i, this.col.setRGB(0, 0, 0)); }
    this.group.add(this.flowersMesh);
    this.seed = hashStr(score.track.hash || score.track.title || 'gondryator');
    this.rand = rng(this.seed);
    this.applyScene(this.makeScene());
  }

  get activeCount() { return this.flowers.filter(Boolean).length; }
  themeAt() { return 'void'; }
  refreshLeads() { /* nothing is scheduled ahead */ }

  /** A new seed for this song: a whole new set of scenes, starting now. */
  reroll() {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    this.rand = rng(this.seed);
    this.patterns.clear();
    this.applyScene(this.makeScene());
    this.crash();
    return this.seed;
  }

  /** True once per scene change: main.ts fires the FX director's crash with it. */
  takeCrash() { const c = this.crashPending; this.crashPending = false; return c; }

  reset(s: number) {
    this.flowers.fill(null);
    for (let i = 0; i < FLOWERS; i++) this.flowersMesh.setMatrixAt(i, this.m4.makeScale(0, 0, 0));
    this.flowersMesh.instanceMatrix.needsUpdate = true;
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
      // A section coming back: same pattern, new palette and phase.
      return { ...base, palette: (base.palette + 1 + Math.floor(r() * (PALETTES.length - 1))) % PALETTES.length, mixes: [base.mixes[0], base.mixes[1], base.mixes[2], r() * 6] };
    }
    const segChoices = [0, 0, 3, 4, 5, 6, 8];
    const w = [r(), r() * 0.8, r() * 0.8];
    const sum = w[0] + w[1] + w[2] || 1;
    return {
      palette: Math.floor(r() * PALETTES.length),
      shape: [1.5 + r() * 4.5, r() < 0.4 ? 0 : r() * 2.2, segChoices[Math.floor(r() * segChoices.length)], 0.25 + r() * 0.8],
      mixes: [w[0] / sum * 1.6, w[1] / sum * 1.2, w[2] / sum * 1.2, r() * 6],
      look: LOOKS[Math.floor(r() * LOOKS.length)],
    };
  }

  private applyScene(sc: Scene) {
    const [a, b, c, d] = PALETTES[sc.palette];
    this.V.pa.value.set(...a); this.V.pb.value.set(...b); this.V.pc.value.set(...c); this.V.pd.value.set(...d);
    this.V.shape.value.set(...sc.shape);
    this.V.mixes.value.set(...sc.mixes);
    this.look = sc.look;
  }

  private crash() { this.V.crash.value = 1; this.crashPending = true; }

  private newScene(s: number, label: string, sectionStart: boolean) {
    const kept = this.patterns.get(label);
    const repeatable = label !== 'intro' && label !== 'outro';
    let sc: Scene;
    if (kept && repeatable) { kept.seen++; sc = this.makeScene(kept.scene); }
    else { sc = this.makeScene(); if (sectionStart) this.patterns.set(label, { scene: sc, seen: 0 }); }
    this.applyScene(sc);
    this.crash();
    this.lastSceneAt = s;
  }

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
        if (e.kind === 'snare') {
          this.V.boltAz.value = gazeAz + (this.rand() - 0.5) * 1.6;
          this.V.boltT.value = 0;
          this.V.boltSeed.value = this.rand() * 100;
        } else if (e.stem === 'bass' && e.kind === 'note') {
          this.bassTimes[this.bassPtr++ % 4] = e.t;
        } else if (e.kind === 'note' && e.pitch !== null && (e.stem === 'other' || e.stem === 'vocals')) {
          this.bloom(e.t, e.pitch, e.vel, e.dur, gazeAz);
        }
      }
    }
    this.V.boltT.value += dt;
    this.V.pulse0.value = s - this.bassTimes[0]; this.V.pulse1.value = s - this.bassTimes[1];
    this.V.pulse2.value = s - this.bassTimes[2]; this.V.pulse3.value = s - this.bassTimes[3];
    this.V.crash.value *= Math.exp(-dt / 0.22);
    this.V.rise.value = running ? sampleEnvelope(sc.envelopes.rise, s) : 0;
    this.V.bright.value = running ? sampleEnvelope(sc.envelopes.bright, s) : 0.3;
    this.updateWave(s, frontier, running);
    this.updateFlowers(s);
    this.updateCard(s, running);
  }

  /** A flower for a note: placed near your gaze, as high as the note, coloured by its name. */
  private bloom(t: number, pitch: number, vel: number, dur: number, gazeAz: number) {
    const pad = dur >= 1.2;
    const r = this.rand;
    const f: Flower = {
      t0: t,
      life: pad ? 6 : 2.6,
      az: gazeAz + (r() - 0.5) * (pad ? 2.6 : 1.5),
      el: THREE.MathUtils.clamp((pitch - 62) / 30, -0.5, 1.0) + (r() - 0.5) * 0.12,
      size: (pad ? 9 : 3.2) * (0.7 + vel * 0.6),
      slide: pad ? 0.04 : 0.14,
      spin: (r() - 0.5) * 2,
      hue: (((pitch % 12) + 12) % 12) / 12,
      vel,
    };
    this.flowers[this.nextFlower] = f;
    this.nextFlower = (this.nextFlower + 1) % FLOWERS;
  }

  private updateFlowers(s: number) {
    const mesh = this.flowersMesh;
    for (let i = 0; i < FLOWERS; i++) {
      const f = this.flowers[i];
      if (!f) continue;
      const age = s - f.t0;
      if (age < 0 || age > f.life) {
        this.flowers[i] = null;
        mesh.setMatrixAt(i, this.m4.makeScale(0, 0, 0));
        continue;
      }
      // Splash open with an overshoot, slide down, fade.
      const k = Math.min(1, age / 0.32);
      const pop = 1 + Math.sin(k * Math.PI) * 0.35;
      const fade = Math.min(1, (f.life - age) / 1.2);
      const el = f.el - f.slide * age;
      this.pos.set(Math.cos(el) * Math.sin(f.az), Math.sin(el), -Math.cos(el) * Math.cos(f.az)).multiplyScalar(R_FLOWER);
      this.m4.lookAt(this.pos, new THREE.Vector3(0, 0, 0), THREE.Object3D.DEFAULT_UP);
      this.q.setFromRotationMatrix(this.m4);
      this.qSpin.setFromAxisAngle(new THREE.Vector3(0, 0, 1), f.spin * age);
      this.q.multiply(this.qSpin);
      const sz = f.size * k * pop;
      this.scl.set(sz, sz, sz);
      mesh.setMatrixAt(i, this.m4.compose(this.pos, this.q, this.scl));
      this.col.setHSL(f.hue, 0.85, 0.5).multiplyScalar(fade * (0.45 + f.vel * 0.6));
      mesh.setColorAt(i, this.col);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
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

/** A six-petal flower outline, about 1 m across. */
function flowerGeometry() {
  const shape = new THREE.Shape();
  const N = 96;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = 0.45 + 0.55 * Math.abs(Math.cos(3 * a)) ** 0.8;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  return new THREE.ShapeGeometry(shape, 1);
}
