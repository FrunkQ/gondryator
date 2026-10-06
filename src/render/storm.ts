// The weather on a stormy ride (pack.storm): rain falling in front of the main window, lightning on
// both sides, and the sky and the fog throbbing on the beat. Everything is read from the score, so
// a strike lands on its hit: a section change, a drop, a recognised impact, the big snares.
//
//   rain:      a colour; streaks fall from above the cart to the ground, slanted by the ride's speed,
//              thicker as the song gets louder, a downpour on breakdowns and drops.
//   lightning: 0..1, how many of the big snares strike (section changes, drops and impacts always do).
//   pulse:     a colour the sky and fog swell towards on every kick (U.kick), more in loud parts.

import { QUALITY } from './quality';
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Pack } from '../packs/types';
import { sectionAt, type Score } from '../score/types';
import { U } from './shaders';
import type { World } from './world';

const N_RAIN = 900;
const FALL = 24; // m/s

function hash(n: number) { n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d); n = Math.imul(n ^ (n >>> 12), 0x297a2d39); return ((n ^ (n >>> 15)) >>> 0) / 4294967296; }

/** A jagged bolt from the cloud base to the ground, with a couple of forks: thin boxes merged. */
function boltGeometry(seed: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  let k = seed * 7919 + 1;
  const rnd = () => ((k = (k * 16807) % 2147483647) / 2147483647);
  const seg = (a: THREE.Vector3, b: THREE.Vector3, w: number) => {
    const d = b.clone().sub(a), len = d.length();
    const g = new THREE.BoxGeometry(w, len, w);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    parts.push(g);
  };
  const branch = (start: THREE.Vector3, steps: number, w: number, depth: number) => {
    let p = start.clone();
    for (let i = 0; i < steps; i++) {
      const q = p.clone().add(new THREE.Vector3((rnd() - 0.5) * 34, -(14 + rnd() * 16), (rnd() - 0.5) * 8));
      if (q.y < 0) q.y = 0;
      seg(p, q, w);
      if (depth > 0 && rnd() < 0.22) branch(q, 3 + Math.floor(rnd() * 3), w * 0.55, depth - 1);
      p = q;
      if (p.y <= 0) break;
    }
  };
  branch(new THREE.Vector3(0, 260, 0), 16, 1.6, 2);
  return mergeGeometries(parts, false)!;
}

export class Storm {
  readonly group = new THREE.Group();
  private rain: THREE.InstancedMesh | null = null;
  private seeds = new Float32Array(N_RAIN * 3);
  private bolts: THREE.Mesh[] = [];
  private pulseCol: THREE.Color;
  private amount = 0;
  /** The strength of the flash now (0..1), for anything else that wants to light up. */
  flash = 0;

  constructor(private pack: Pack, private world: World) {
    const st = pack.storm!;
    this.pulseCol = new THREE.Color(st.pulse ?? '#ffffff');
    if (st.rain) {
      const g = new THREE.BoxGeometry(0.03, 0.9, 0.03);
      const m = new THREE.MeshBasicMaterial({ color: st.rain, transparent: true, opacity: 0.75, depthWrite: false });
      this.rain = new THREE.InstancedMesh(g, m, N_RAIN);
      this.rain.frustumCulled = false;
      this.rain.count = 0;
      for (let i = 0; i < N_RAIN * 3; i++) this.seeds[i] = hash(i * 31 + 7);
      this.group.add(this.rain);
    }
    if (st.lightning) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xe8e0ff, toneMapped: false, fog: false, transparent: true, depthWrite: false });
      for (let i = 0; i < 4; i++) {
        const b = new THREE.Mesh(boltGeometry(i + 3), mat.clone());
        b.visible = false;
        b.frustumCulled = false;
        this.bolts.push(b);
        this.group.add(b);
      }
    }
  }

  /** Every object the storm may show later (for shader warm-up). */
  get hidden(): THREE.Object3D[] { return [...this.bolts, ...(this.rain ? [this.rain] : [])]; }

  /** How hard a strike at t lights things at time s (a flicker: flash, dip, flash, fade). */
  private static shape(d: number) {
    if (d < 0 || d > 1.1) return 0;
    if (d < 0.07) return 1;
    if (d < 0.13) return 0.25;
    if (d < 0.22) return 0.85;
    return 0.85 * Math.exp(-(d - 0.22) * 7);
  }

  /** The strikes that may still be lighting the sky at s: [time, strength, seed]. */
  private strikes(s: number, sc: Score): [number, number, number][] {
    const out: [number, number, number][] = [];
    const chance = this.pack.storm?.lightning ?? 0;
    if (!chance) return out;
    const from = s - 1.1;
    for (const sec of sc.sections) if (sec.t > from && sec.t <= s && sec.t > 0.5) out.push([sec.t, 1, Math.round(sec.t * 100)]);
    for (const m of sc.moments ?? []) if ((m.kind === 'drop' || m.kind === 'lift') && m.t > from && m.t <= s) out.push([m.t, 1, Math.round(m.t * 100) + 1], [m.t + 0.35, 0.8, Math.round(m.t * 100) + 2]);
    for (const c of sc.sounds ?? []) if (c.kind === 'impact' && c.t > from && c.t <= s) out.push([c.t, 0.9, Math.round(c.t * 100) + 3]);
    // The big snares, a few of them, more in loud parts.
    const E = sc.events;
    let lo = 0, hi = E.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (E[m].t < from) lo = m + 1; else hi = m; }
    for (let i = lo; i < E.length && E[i].t <= s; i++) {
      const e = E[i];
      if (e.kind !== 'snare' || e.vel < 0.7) continue;
      const energy = sectionAt(sc, e.t).section?.energy ?? 0.5;
      const seed = Math.round(e.t * 100) + 5;
      if (hash(seed) < chance * (0.08 + 0.35 * energy)) out.push([e.t, 0.7, seed]);
    }
    return out;
  }

  update(s: number, dt: number, sc: Score | null, running: boolean, trainPos: THREE.Vector3, speed: number) {
    // Lightning: the strongest strike lights everything; each one gets a bolt while it flickers.
    let flash = 0;
    let nb = 0;
    if (sc && running) {
      for (const [t, k, seed] of this.strikes(s, sc)) {
        const f = Storm.shape(s - t) * k;
        flash = Math.max(flash, f);
        if (f > 0.05 && nb < this.bolts.length) {
          const b = this.bolts[nb++];
          b.visible = true;
          // Either side of the ride, somewhere ahead, far off.
          const side = hash(seed) < 0.5 ? -1 : 1, dist = 320 + hash(seed + 1) * 380;
          b.position.set(trainPos.x + (hash(seed + 2) - 0.3) * dist * 1.4, 0, side * dist);
          b.rotation.y = hash(seed + 3) * Math.PI;
          b.scale.setScalar(dist / 450);
          (b.material as THREE.MeshBasicMaterial).opacity = Math.min(1, f * 1.4);
        }
      }
    }
    for (let i = nb; i < this.bolts.length; i++) this.bolts[i].visible = false;
    this.flash = flash;
    // The pulse: the kick, harder when the song is loud.
    const pulse = this.pack.storm?.pulse ? U.kick.value * (0.35 + 0.65 * U.energy.value) : 0;
    this.world.setStorm(flash, pulse, this.pulseCol);
    // Rain: thicker when it's loud, a downpour on breakdowns and drops; a drizzle while waiting.
    if (!this.rain) return;
    let want = 0.3;
    if (sc && running) {
      const sec = sectionAt(sc, s).section;
      want = 0.2 + 0.8 * (sec?.energy ?? 0.4);
      if (sec?.label === 'breakdown' || sec?.label === 'drop') want = 1;
    }
    this.amount += (want - this.amount) * (1 - Math.exp(-dt / 1.5));
    const n = Math.round(N_RAIN * this.amount * QUALITY.particles);
    this.rain.count = n;
    const now = performance.now() / 1000;
    const top = trainPos.y + 16;
    const tilt = -Math.atan2(speed, FALL);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), tilt);
    const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    const S = this.seeds;
    for (let i = 0; i < n; i++) {
      const a = S[i * 3], b = S[i * 3 + 1], c = S[i * 3 + 2];
      const span = 90;
      // Drops are fixed in the air along the line (they don't ride with the cart), wrapped round it.
      const bx = a * span * 7;
      const x = trainPos.x - 30 + ((((bx - trainPos.x + 30) % span) + span) % span);
      const y = top - ((now * FALL + c * top) % top);
      const z = -(1.6 + b * b * 34);
      this.rain.setMatrixAt(i, m4.compose(p.set(x, y, z), q, one));
    }
    this.rain.instanceMatrix.needsUpdate = true;
  }
}
