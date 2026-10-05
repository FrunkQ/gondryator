// Life in the sky, driven by the score:
// - a starling murmuration that follows the lead line (height = pitch, a ripple on each note);
// - fireworks (outdoors) or confetti (on the stage) that burst at every section change and on
//   the strongest kicks of high-energy sections;
// - what the sound pass and the moments hear, kept photographic: animals in the track startle the
//   flock, an impact or a cheering crowd sends up a shell, a drop or lift a volley.
// Both are single instanced meshes updated on the CPU; cheap enough for any GPU.

import * as THREE from 'three/webgpu';
import type { Score, ScoreEvent } from '../score/types';
import { instanceColor, vec3 } from 'three/tsl';
import { perf } from '../ui/frames';

const BIRDS = 260;
const SPARKS = 900;

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const v = new THREE.Vector3();
const sc = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);

export class SkyLife {
  readonly group = new THREE.Group();
  private birds: THREE.InstancedMesh;
  private bp = new Float32Array(BIRDS * 3);   // positions relative to the flock centre
  private bv = new Float32Array(BIRDS * 3);
  private centre = new THREE.Vector3(0, 40, -160);
  private sparks: THREE.InstancedMesh;
  private sp = new Float32Array(SPARKS * 3);
  private sv = new Float32Array(SPARKS * 3);
  private life = new Float32Array(SPARKS);
  private next = 0;
  private ptr = 0;
  private lastS = -Infinity;
  private secIdx = -1;
  private lastNote: ScoreEvent | null = null;
  private ripple = 0;
  private startle = 0;
  private soundPtr = 0;
  private momentPtr = 0;
  private lastShell = -Infinity;
  private colors: THREE.Color[];

  /** No starlings in space. */
  set birdsVisible(v: boolean) { this.birds.visible = v; }

  constructor(private stage: boolean) {
    // A bird is a flattened V: two thin wings.
    const wing = (sx: number) => new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0.15), new THREE.Vector3(sx * 0.55, 0.05, -0.1), new THREE.Vector3(0, 0, -0.15),
    ]);
    const g = new THREE.BufferGeometry();
    const pts = [...(wing(1).getAttribute('position').array as Float32Array), ...(wing(-1).getAttribute('position').array as Float32Array)];
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.computeVertexNormals();
    this.birds = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: 0x1b1c20, side: THREE.DoubleSide }), BIRDS);
    this.birds.frustumCulled = false;
    this.birds.visible = !stage;
    for (let i = 0; i < BIRDS; i++) {
      this.bp[i * 3] = (Math.random() - 0.5) * 30;
      this.bp[i * 3 + 1] = (Math.random() - 0.5) * 8;
      this.bp[i * 3 + 2] = (Math.random() - 0.5) * 20;
    }
    // Sparks: small glowing diamonds (fireworks) or paper squares (confetti).
    const sg = stage ? new THREE.PlaneGeometry(0.12, 0.08) : new THREE.OctahedronGeometry(1.3, 0);
    const smat = stage
      ? new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.4, metalness: 0.6 })
      : (() => { const m = new THREE.MeshStandardNodeMaterial({ fog: false }); m.colorNode = vec3(0); (m as any).emissiveNode = (instanceColor as any).mul(12); return m; })();
    this.sparks = new THREE.InstancedMesh(sg, smat, SPARKS);
    this.sparks.frustumCulled = false;
    this.sparks.count = SPARKS;
    for (let i = 0; i < SPARKS; i++) { this.sparks.setMatrixAt(i, m4.makeScale(0, 0, 0)); this.sparks.setColorAt(i, new THREE.Color(1, 1, 1)); }
    this.colors = ['#ff4f8b', '#ffd34f', '#4fd8ff', '#9a6bff', '#7dff6b', '#ffffff'].map(c => new THREE.Color(c));
    this.group.add(this.birds, this.sparks);
  }

  /** Burst `n` sparks at `at`, `speed` m/s, in one colour (plus some white). */
  private burst(at: THREE.Vector3, n: number, speed: number, color: THREE.Color) {
    for (let k = 0; k < n; k++) {
      const i = this.next; this.next = (this.next + 1) % SPARKS;
      // Uniform direction on a sphere.
      const z = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - z * z);
      const sp = speed * (0.7 + Math.random() * 0.3);
      this.sp[i * 3] = at.x; this.sp[i * 3 + 1] = at.y; this.sp[i * 3 + 2] = at.z;
      this.sv[i * 3] = r * Math.cos(a) * sp; this.sv[i * 3 + 1] = z * sp + (this.stage ? speed * 0.6 : 0); this.sv[i * 3 + 2] = r * Math.sin(a) * sp;
      this.life[i] = this.stage ? 4.5 : 2.2 + Math.random() * 0.6;
      this.sparks.setColorAt(i, Math.random() < 0.15 ? this.colors[5] : (this.stage ? this.colors[(Math.random() * 5) | 0] : color));
    }
    this.sparks.instanceColor!.needsUpdate = true;
  }

  update(s: number, dt: number, score: Score | null, running: boolean, viewer: THREE.Vector3, energy: number) {
    // Seeks: re-find the event pointer, drop live sparks.
    if (score && (s < this.lastS - 0.05 || s > this.lastS + 1)) {
      let lo = 0, hi = score.events.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (score.events[m].t <= s) lo = m + 1; else hi = m; }
      this.ptr = lo;
      this.life.fill(0);
      this.soundPtr = (score.sounds ?? []).findIndex(c => c.t > s); if (this.soundPtr < 0) this.soundPtr = score.sounds?.length ?? 0;
      this.momentPtr = (score.moments ?? []).findIndex(m => m.t > s); if (this.momentPtr < 0) this.momentPtr = score.moments?.length ?? 0;
    }
    this.lastS = s;
    if (score && running) {
      // Section changes: a big celebration.
      let idx = 0;
      for (let i = 0; i < score.sections.length; i++) if (score.sections[i].t <= s) idx = i;
      if (idx !== this.secIdx) {
        if (this.secIdx >= 0) { this.celebrate(viewer, 3); this.lastShell = s; }
        this.secIdx = idx;
      }
      // Recognised sounds (score.sounds), as they arrive.
      const cues = score.sounds ?? [];
      while (this.soundPtr < cues.length && cues[this.soundPtr].t <= s) {
        const c = cues[this.soundPtr++];
        if (s - c.t > 0.5) continue;
        if (c.kind === 'animal') this.startle = 1;
        else if ((c.kind === 'impact' || c.kind === 'crowd') && s - this.lastShell > 2) { this.celebrate(viewer, c.kind === 'crowd' ? 2 : 1); this.lastShell = s; }
      }
      // Drops and lifts: a volley, unless a section change just sent one.
      const ms = score.moments ?? [];
      while (this.momentPtr < ms.length && ms[this.momentPtr].t <= s) {
        const m = ms[this.momentPtr++];
        if (s - m.t > 0.5 || (m.kind !== 'drop' && m.kind !== 'lift')) continue;
        if (s - this.lastShell > 1) { this.celebrate(viewer, m.kind === 'drop' ? 3 : 2); this.lastShell = s; }
      }
      while (this.ptr < score.events.length && score.events[this.ptr].t <= s) {
        const e = score.events[this.ptr++];
        if (s - e.t > 0.3) continue;
        if (e.kind === 'kick' && energy > 0.7 && e.vel > 0.8 && Math.random() < 0.35) this.celebrate(viewer, 1);
        if (e.kind === 'note' && e.stem !== 'bass' && e.dur < 1.2) { this.lastNote = e; this.ripple = 1; }
      }
    }
    this.ripple *= Math.exp(-dt / 0.4);
    this.startle *= Math.exp(-dt / 1.2);
    if (!this.stage) this.updateBirds(s, dt, viewer);
    this.updateSparks(dt);
  }

  private celebrate(viewer: THREE.Vector3, shells: number) {
    perf.mark(this.stage ? 'confetti' : 'fireworks');
    for (let k = 0; k < shells; k++) {
      const col = this.colors[(Math.random() * 5) | 0];
      if (this.stage) this.burst(v.set((Math.random() - 0.5) * 12, 15, (Math.random() - 0.5) * 12), 260, 5, col);
      else this.burst(v.set(viewer.x + 40 + (Math.random() - 0.3) * 120, 60 + Math.random() * 40, viewer.z - 180 - Math.random() * 80), 120, 22, col);
    }
  }

  private updateBirds(s: number, dt: number, viewer: THREE.Vector3) {
    // The flock keeps pace with the train some way off, rising and falling with the melody.
    const pitch = this.lastNote?.pitch ?? 64;
    const targetY = 30 + (pitch - 60) * 1.8;
    this.centre.x += ((viewer.x + 30 + Math.sin(s * 0.11) * 60) - this.centre.x) * (1 - Math.exp(-dt * 0.6));
    this.centre.y += (targetY - this.centre.y) * (1 - Math.exp(-dt * 1.2));
    this.centre.z = viewer.z - 150 + Math.sin(s * 0.07) * 30;
    for (let i = 0; i < BIRDS; i++) {
      const o = i * 3;
      // Swirl: each bird circles the centre on its own orbit, pulled back if it strays.
      const px = this.bp[o], py = this.bp[o + 1], pz = this.bp[o + 2];
      const swirl = 0.6 + (i % 7) * 0.08;
      let ax = -pz * swirl - px * 0.15, ay = -py * 0.4, az = px * swirl - pz * 0.15;
      // Each melody note sends a ripple through the flock.
      ay += Math.sin(px * 0.3 + s * 6) * this.ripple * 8;
      // Startled: everyone flies outwards and up, then the swirl gathers them back.
      ax += px * this.startle * 2.5; ay += (4 + py) * this.startle * 2; az += pz * this.startle * 2.5;
      ax += Math.sin(i * 12.9898 + s * 0.7) * 2; az += Math.cos(i * 78.233 + s * 0.9) * 2;
      this.bv[o] = (this.bv[o] + ax * dt) * 0.985; this.bv[o + 1] = (this.bv[o + 1] + ay * dt) * 0.985; this.bv[o + 2] = (this.bv[o + 2] + az * dt) * 0.985;
      this.bp[o] += this.bv[o] * dt; this.bp[o + 1] += this.bv[o + 1] * dt; this.bp[o + 2] += this.bv[o + 2] * dt;
      v.set(this.centre.x + this.bp[o] * 2.2, this.centre.y + this.bp[o + 1], this.centre.z + this.bp[o + 2] * 1.5);
      q.setFromAxisAngle(up, Math.atan2(this.bv[o], this.bv[o + 2]));
      const flap = 0.6 + 0.4 * Math.sin(s * 14 + i);
      sc.set(1.6, 1.6 * flap, 1.6);
      this.birds.setMatrixAt(i, m4.compose(v, q, sc));
    }
    this.birds.instanceMatrix.needsUpdate = true;
  }

  private updateSparks(dt: number) {
    const g = this.stage ? -2.5 : -6, drag = this.stage ? 0.97 : 0.985;
    let any = false;
    for (let i = 0; i < SPARKS; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      const o = i * 3;
      this.life[i] -= dt;
      this.sv[o + 1] += g * dt;
      for (let k = 0; k < 3; k++) { this.sv[o + k] *= drag; this.sp[o + k] += this.sv[o + k] * dt; }
      if (this.stage && this.sp[o + 1] < 0.55) { this.sp[o + 1] = 0.55; this.sv[o] = this.sv[o + 1] = this.sv[o + 2] = 0; }
      const size = this.life[i] <= 0 ? 0 : this.stage ? 1 : Math.min(1, this.life[i] / 1.2) * 0.9;
      v.set(this.sp[o], this.sp[o + 1], this.sp[o + 2]);
      q.setFromEuler(new THREE.Euler(this.life[i] * 7 + i, this.life[i] * 5, i));
      this.sparks.setMatrixAt(i, m4.compose(v, q, sc.setScalar(size)));
    }
    if (any || this.wasAny) this.sparks.instanceMatrix.needsUpdate = true;
    this.wasAny = any;
  }
  private wasAny = false;

  dispose() { this.birds.geometry.dispose(); this.sparks.geometry.dispose(); }
}
