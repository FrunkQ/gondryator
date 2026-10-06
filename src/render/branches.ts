// Branch lines: the extra tracks beside the train's own. The line already exists (a train passes on
// the next track in the breakdown); these make it a railway. The countryside keeps just the one
// neighbouring track; towns get a branch more, industrial yards two, and one runs on the far side.
// A branch peels off its neighbour where the scenery changes (on a section change) and runs back into
// it before the next change; each section nudges the lines across a little, and when someone sings
// (envelopes.voice) the branches weave. Instanced segments laid each frame around the train, like the
// ghost train's coaster track.

import * as THREE from 'three/webgpu';
import { sampleEnvelope, sectionAt, type Score } from '../score/types';
import type { CameraRig } from './rig';

interface Lane {
  /** Resting distance from our track (negative: the main window's side). */
  z: number;
  /** The track it branches from, and joins again. */
  from: number;
  /** Scenery themes it runs through. */
  themes: string[];
}

const LANES: Lane[] = [
  { z: -10.2, from: -4.3, themes: ['town', 'industrial'] },
  { z: -13.2, from: -10.2, themes: ['industrial'] },
  { z: 4.6, from: 0, themes: ['town', 'industrial'] },
];

/** Segment length (m), how far the lines are laid behind and ahead of the train, and the peel-off length. */
const SEG = 1.5, BEHIND = 90, AHEAD = 240, PEEL = 60;
const GAUGE = 0.72;

export class BranchLines {
  readonly group = new THREE.Group();
  score: Score | null = null;
  private rails: THREE.InstancedMesh;
  private ties: THREE.InstancedMesh;
  private bed: THREE.InstancedMesh;
  private readonly n = Math.ceil((BEHIND + AHEAD) / SEG);
  private readonly margin = Math.ceil(PEEL / SEG);

  constructor(private themeForX: (x: number) => string) {
    const per = this.n * LANES.length;
    const railMat = new THREE.MeshStandardMaterial({ color: 0xb0b2b4, metalness: 0.85, roughness: 0.35 });
    this.rails = new THREE.InstancedMesh(new THREE.BoxGeometry(SEG + 0.04, 0.16, 0.08), railMat, 2 * per);
    this.ties = new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 0.1, 2.5), new THREE.MeshStandardMaterial({ color: 0x5a4c3e, roughness: 0.9 }), per);
    this.bed = new THREE.InstancedMesh(new THREE.BoxGeometry(SEG + 0.05, 0.1, 3.4), new THREE.MeshStandardMaterial({ color: 0x7d766c, roughness: 1 }), per);
    for (const m of [this.bed, this.ties, this.rails]) { m.frustumCulled = false; m.count = 0; this.group.add(m); }
  }

  /** How far a lane sits from its resting line in this section: sections nudge the yard about. */
  private shiftAt(t: number, x: number, rig: CameraRig, lane: number): number {
    const sc = this.score;
    if (!sc?.sections.length) return 0;
    const { section, index } = sectionAt(sc, t);
    if (!section) return 0;
    const shift = (i: number) => {
      const s = sc.sections[i];
      const h = Math.sin(((s.group ?? i) + 1) * 12.9898 + lane * 78.233) * 43758.5453;
      return (Math.round((h - Math.floor(h)) * 2) - 1) * 1.1; // -1.1, 0 or 1.1 m
    };
    const now = shift(index), before = index > 0 ? shift(index - 1) : now;
    const k = Math.min(1, Math.max(0, (x - rig.travel(section.t)) / PEEL));
    return before + (now - before) * k * k * (3 - 2 * k);
  }

  /** The weave: someone singing (or the lead line, if the voice curve is missing) bends the branches. */
  private weaveAt(t: number, x: number, lane: number): number {
    const env = this.score?.envelopes;
    if (!env) return 0;
    const v = env.voice
      ? (sampleEnvelope(env.voice, t - 0.6) + sampleEnvelope(env.voice, t) + sampleEnvelope(env.voice, t + 0.6)) / 3
      : 0.4 * Math.max(0, sampleEnvelope(env.contour, t) - 0.3);
    return 1.4 * Math.min(1, v) * Math.sin(x * (Math.PI * 2 / 90) + lane * 2.1);
  }

  update(trainX: number, rig: CameraRig) {
    const n = this.n, mg = this.margin, k0 = Math.floor((trainX - BEHIND) / SEG) - mg, total = n + 2 * mg;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    const on = new Float32Array(total), up = new Float32Array(total), dn = new Float32Array(total);
    const ts = new Float32Array(total);
    for (let i = 0; i < total; i++) ts[i] = rig.timeAtTravel((k0 + i) * SEG);
    const themes = Array.from({ length: total }, (_, i) => this.themeForX((k0 + i) * SEG));
    let nr = 0, nt = 0;
    const zs = new Float32Array(n + 1);
    LANES.forEach((lane, li) => {
      for (let i = 0; i < total; i++) on[i] = lane.themes.includes(themes[i]) ? 1 : 0;
      // Peel off after the change, run back in before the next one (stable in the world, not the screen).
      for (let i = 0; i < total; i++) up[i] = on[i] ? Math.min(1, (i ? up[i - 1] : 1) + SEG / PEEL) : 0;
      for (let i = total - 1; i >= 0; i--) dn[i] = on[i] ? Math.min(1, (i < total - 1 ? dn[i + 1] : 1) + SEG / PEEL) : 0;
      for (let j = 0; j <= n; j++) {
        const i = Math.min(total - 1, j + mg), x = (k0 + i) * SEG, t = ts[i];
        const pres = Math.min(up[i], dn[i]), e = pres * pres * (3 - 2 * pres);
        // (The outer yard line moves half as much: the near houses start not far beyond it.)
        const z = lane.z + (li === 1 ? 0.5 : 1) * (this.shiftAt(t, x, rig, li) + this.weaveAt(t, x, li));
        zs[j] = pres > 0 ? lane.from + (z - lane.from) * e : NaN;
      }
      for (let j = 0; j < n; j++) {
        const z0 = zs[j], z1 = zs[j + 1];
        if (Number.isNaN(z0) || Number.isNaN(z1)) continue;
        const xa = (k0 + j + mg) * SEG, ang = Math.atan2(z1 - z0, SEG), c = Math.cos(ang);
        q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -ang);
        const zm = (z0 + z1) / 2, xm = xa + SEG / 2;
        this.bed.setMatrixAt(nt, m4.compose(p.set(xm, 0.05, zm), q, one));
        this.ties.setMatrixAt(nt++, m4.compose(p.set(xm, 0.12, zm), q, one));
        for (const g of [-GAUGE, GAUGE]) this.rails.setMatrixAt(nr++, m4.compose(p.set(xm - g * Math.sin(ang), 0.24, zm + g * c), q, one.set(1 / c, 1, 1)));
        one.set(1, 1, 1);
      }
    });
    this.rails.count = nr; this.ties.count = this.bed.count = nt;
    for (const m of [this.bed, this.ties, this.rails]) m.instanceMatrix.needsUpdate = true;
  }
}
